# Implementation Plan

## Overview

OpenCode plugin for Gemini OAuth authentication using Google's Cloud Code Assist API. Rewrite of opencode-gemini-auth using Effect.

**Provider ID**: `gemini-cli` (to not conflict with opencode-gemini-auth's `google`)

## Progress

| Task                             | Status      | Notes                                         |
| -------------------------------- | ----------- | --------------------------------------------- |
| Config hook with models          | DONE        | Fetches from models.dev, falls back to static |
| Static models fallback           | DONE        | `src/models.json` + `scripts/fetch-models.ts` |
| OAuth flow                       | DONE        | `src/lib/auth/gemini.ts` with Effect          |
| Token refresh                    | DONE        | `GeminiOAuth.refresh()` method                |
| Loader function                  | IN PROGRESS | Stub returns `{}`, needs customFetch          |
| Project context (loadCodeAssist) | TODO        | `src/lib/auth/project.ts`                     |
| Request/response transformation  | TODO        | `src/lib/request/transform.ts`                |
| customFetch implementation       | TODO        | Transform requests for Cloud Code Assist API  |

## Architecture

```
+-----------------------------------------------------------------+
|  1. config hook (runs once on plugin load)                DONE  |
|     Auto-inject provider.gemini-cli config:                     |
|     - npm: @ai-sdk/google                                       |
|     - api: https://cloudcode-pa.googleapis.com                  |
|     - models: gemini-2.5-pro, gemini-2.5-flash, etc.            |
+--------------------------------+--------------------------------+
                                 |
                                 v
+-----------------------------------------------------------------+
|  2. loader() (runs once per session when auth is OAuth)   TODO  |
|     - Check auth.type === "oauth", else return {}               |
|     - Set all model costs to 0 (free tier)                      |
|     - Fetch project context (Effect):                           |
|       - loadCodeAssist() -> get existing project                |
|       - If none + FREE tier -> onboardUser() -> create one      |
|       - If none + non-FREE -> throw ProjectIdRequiredError      |
|     - Return { apiKey: "", fetch: customFetch }                 |
|       where customFetch captures projectId in closure           |
+--------------------------------+--------------------------------+
                                 |
                                 v
+-----------------------------------------------------------------+
|  3. customFetch (runs on each API request)                TODO  |
|     - Get latest auth via getAuth()                             |
|     - If token expired -> refresh (Effect) -> persist via       |
|       ctx.client.auth.set()                                     |
|     - Transform request:                                        |
|       - Path: /v1beta/models/X:action -> /v1internal:action     |
|       - Body: wrap in { project, model, request }               |
|       - Headers: Authorization Bearer, remove x-api-key         |
|     - Execute fetch                                             |
|     - Transform response:                                       |
|       - Unwrap { response: X } -> X                             |
|       - Handle SSE streaming rewrites                           |
+-----------------------------------------------------------------+
```

## Files

| File                           | Status | Purpose                                           |
| ------------------------------ | ------ | ------------------------------------------------- |
| `src/main.ts`                  | DONE   | Plugin entry with config hook + OAuth methods     |
| `src/lib/auth/gemini.ts`       | DONE   | OAuth flow + token refresh (Effect service)       |
| `src/lib/runtime.ts`           | DONE   | Effect runtime with OpenCode logger + file logger |
| `src/lib/opencode.ts`          | DONE   | OpenCodeContext service + custom Effect logger    |
| `src/models.json`              | DONE   | Static fallback for models.dev data               |
| `scripts/fetch-models.ts`      | DONE   | Prebuild script to update models.json             |
| `src/lib/auth/project.ts`      | TODO   | Project context: loadCodeAssist, onboardUser      |
| `src/lib/request/transform.ts` | TODO   | Request/response transformation (pure functions)  |

## Implemented Features

### Config Hook (`src/main.ts:40-51`)

- Fetches model definitions from `https://models.dev/api.json` using Effect HttpClient
- Falls back to static `src/models.json` if fetch fails
- Filters to 5 gemini-cli supported models:
  - `gemini-2.5-pro`
  - `gemini-2.5-flash`
  - `gemini-2.5-flash-lite`
  - `gemini-3-pro-preview`
  - `gemini-3-flash-preview`
- Sets API endpoint to `https://cloudcode-pa.googleapis.com`

### OAuth Flow (`src/lib/auth/gemini.ts`)

- `GeminiOAuth` Effect service with:
  - `authenticate()` - Starts OAuth flow, opens browser, returns auth URL and callback
  - `refresh()` - Refreshes access token using google-auth-library
- Uses Gemini CLI's OAuth credentials (same as official gemini-cli)
- Callback server using `@effect/platform` HttpServer
- State parameter validation for CSRF protection

### Static Models Fallback

- `scripts/fetch-models.ts` - Prebuild script that fetches from models.dev
- `src/models.json` - Pre-generated static data (committed to git)
- `package.json` has `"prebuild": "bun run scripts/fetch-models.ts"`

## Remaining Work

### 1. Implement Project Context (`src/lib/auth/project.ts`)

Create Effect functions for:

```typescript
// Fetch existing project context
const loadCodeAssist: Effect<ProjectContext, ProjectError>

// Create managed project for FREE tier users
const onboardUser: Effect<ProjectContext, ProjectError>

// Combined: try load, then onboard if FREE tier
const ensureProjectContext: Effect<ProjectContext, ProjectError>
```

Reference: `.context/opencode-gemini-auth/src/plugin/project.ts`

Key endpoints:

- `POST https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist`
- `POST https://cloudcode-pa.googleapis.com/v1internal:onboardUser`

### 2. Implement Request Transform (`src/lib/request/transform.ts`)

Pure functions to bridge the AI SDK's standard Gemini API format to Cloud Code Assist format.

#### Why We Need This

The `@ai-sdk/google` SDK sends requests in standard Gemini API format, but we're hitting Cloud Code Assist which expects a different format:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  AI SDK sends (standard Gemini API format)                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│  POST /v1beta/models/gemini-2.5-flash:streamGenerateContent                 │
│  Headers: x-goog-api-key: ""                                                │
│  Body: { "contents": [...], "generationConfig": {...} }                     │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼  customFetch transforms
┌─────────────────────────────────────────────────────────────────────────────┐
│  Cloud Code Assist expects                                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│  POST /v1internal:streamGenerateContent?alt=sse                             │
│  Headers: Authorization: Bearer <token>                                     │
│  Body: { "project": "...", "model": "...", "request": { contents, ... } }   │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼  fetch() executes
┌─────────────────────────────────────────────────────────────────────────────┐
│  Cloud Code Assist returns                                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│  { "response": { "candidates": [...], "usageMetadata": {...} } }            │
│  SSE: data: {"response": {...}}                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼  customFetch transforms back
┌─────────────────────────────────────────────────────────────────────────────┐
│  AI SDK expects (standard format)                                           │
├─────────────────────────────────────────────────────────────────────────────┤
│  { "candidates": [...], "usageMetadata": {...} }                            │
│  SSE: data: {...}                                                           │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### Functions to Implement

```typescript
/**
 * Parse URL to extract model and action, determine if streaming.
 * Returns null if URL doesn't match expected pattern.
 *
 * @example
 * parseRequestUrl("/v1beta/models/gemini-2.5-flash:streamGenerateContent")
 * // => { model: "gemini-2.5-flash", action: "streamGenerateContent", streaming: true }
 */
function parseRequestUrl(url: string): {
  model: string
  action: string
  streaming: boolean
} | null

/**
 * Build the Cloud Code Assist URL path.
 *
 * @example
 * buildCodeAssistPath("streamGenerateContent", true)
 * // => "/v1internal:streamGenerateContent?alt=sse"
 *
 * buildCodeAssistPath("generateContent", false)
 * // => "/v1internal:generateContent"
 */
function buildCodeAssistPath(action: string, streaming: boolean): string

/**
 * Wrap request body in Cloud Code Assist format.
 *
 * @example
 * wrapRequestBody(
 *   { contents: [...], generationConfig: {...} },
 *   "my-project-id",
 *   "gemini-2.5-flash"
 * )
 * // => {
 * //   project: "my-project-id",
 * //   model: "gemini-2.5-flash",
 * //   request: { contents: [...], generationConfig: {...} }
 * // }
 */
function wrapRequestBody(
  body: Record<string, unknown>,
  projectId: string,
  model: string,
): { project: string; model: string; request: Record<string, unknown> }

/**
 * Unwrap response body from Cloud Code Assist format.
 * If body has { response: X }, return X. Otherwise return as-is.
 *
 * @example
 * unwrapResponseBody({ response: { candidates: [...] } })
 * // => { candidates: [...] }
 *
 * unwrapResponseBody({ candidates: [...] })
 * // => { candidates: [...] }  (already unwrapped, return as-is)
 */
function unwrapResponseBody(body: unknown): unknown

/**
 * Transform a single SSE line, unwrapping the response field.
 * Only transforms lines starting with "data:".
 *
 * @example
 * transformStreamLine('data: {"response":{"candidates":[...]}}')
 * // => 'data: {"candidates":[...]}'
 *
 * transformStreamLine('event: message')
 * // => 'event: message'  (non-data lines pass through)
 */
function transformStreamLine(line: string): string

/**
 * Create a TransformStream that unwraps SSE response fields line-by-line.
 * Handles buffering for partial lines across chunks.
 *
 * Usage in customFetch:
 *   const transformed = response.body.pipeThrough(createStreamTransformer())
 *   return new Response(transformed, { ... })
 */
function createStreamTransformer(): TransformStream<Uint8Array, Uint8Array>
```

#### Implementation Notes

1. **URL Pattern**: Match `/v1beta/models/([^:]+):(\w+)` to extract model and action
2. **Streaming Detection**: `action === "streamGenerateContent"`
3. **Model Fallbacks**: Optional, can add later. Reference uses `gemini-2.5-flash-image` → `gemini-2.5-flash`
4. **Stream Transform**: Use `TextDecoderStream` + line splitting + `TextEncoderStream`

Reference: `.context/opencode-gemini-auth/src/plugin/request.ts`

### 3. Implement customFetch in Loader (`src/main.ts`)

Update loader function to:

1. Check `auth.type === "oauth"`, else return `{}`
2. Call `ensureProjectContext()` to get project ID
3. Return `{ apiKey: "", fetch: customFetch }` where customFetch:
   - Gets latest auth via `getAuth()`
   - Checks token expiry, refreshes if needed
   - Transforms request (path, body, headers)
   - Executes fetch
   - Transforms response

## Key Behaviors

| Aspect                        | Behavior                                               |
| ----------------------------- | ------------------------------------------------------ |
| Project context               | Fetch once per `loader()` call, no caching/persistence |
| Refresh token storage         | Raw refresh token only, no encoded project ID          |
| Non-FREE tier without project | Throw error with helpful message                       |
| Provider config               | Auto-inject via `config` hook                          |
| Streaming                     | Full SSE streaming response transformation             |

## Two Gemini APIs

| Aspect        | Standard Gemini API                      | Cloud Code Assist API                |
| ------------- | ---------------------------------------- | ------------------------------------ |
| Endpoint      | `generativelanguage.googleapis.com`      | `cloudcode-pa.googleapis.com`        |
| Auth          | API Key (`x-goog-api-key`)               | OAuth Bearer token                   |
| URL pattern   | `/v1beta/models/{model}:generateContent` | `/v1internal:generateContent`        |
| Request body  | `{ contents, generationConfig }`         | `{ project, model, request: {...} }` |
| Response body | `{ candidates, usageMetadata }`          | `{ response: { candidates, ... } }`  |
| Free tier     | Requires API key                         | Google manages a project for you     |

## Project Context Flow

```
User authenticates
       |
       v
loadCodeAssist API -> Check if user has project
       |
  Has project? --Yes--> Use existing project
       |
       No
       v
  Check tier
       |
  FREE? --Yes--> onboardUser API -> Create managed project -> Use it
       |
       No
       v
  Throw ProjectIdRequiredError (user must set OPENCODE_GEMINI_PROJECT_ID)
```

## Constants

Add to `src/lib/config.ts`:

```typescript
export const GEMINI_CODE_ASSIST_ENDPOINT = "https://cloudcode-pa.googleapis.com"

export const CODE_ASSIST_HEADERS = {
  "User-Agent": "google-api-nodejs-client/9.15.1",
  "X-Goog-Api-Client": "gl-node/22.17.0",
  "Client-Metadata":
    "ideType=IDE_UNSPECIFIED,platform=PLATFORM_UNSPECIFIED,pluginType=GEMINI",
} as const

// Optional: model name remapping for unsupported variants
export const MODEL_FALLBACKS: Record<string, string> = {
  "gemini-2.5-flash-image": "gemini-2.5-flash",
}
```

## Environment Variables

| Variable                               | Purpose                                   |
| -------------------------------------- | ----------------------------------------- |
| `OPENCODE_GEMINI_PROJECT_ID`           | Override project ID (for paid tier users) |
| `SSH_CONNECTION` / `OPENCODE_HEADLESS` | Use manual code flow instead of browser   |

## Reference Files

| File                                                     | Purpose                |
| -------------------------------------------------------- | ---------------------- |
| `.context/opencode-gemini-auth/src/plugin.ts`            | Working reference impl |
| `.context/opencode-gemini-auth/src/plugin/project.ts`    | Project context logic  |
| `.context/opencode-gemini-auth/src/plugin/request.ts`    | Request transformation |
| `.context/opencode-gemini-auth/src/plugin/token.ts`      | Token refresh          |
| `.context/gemini-cli/packages/core/src/config/models.ts` | Model definitions      |
