# Gemini Authentication Integration

> **Note:** The current implementation is being rewritten. This document serves as the specification.

## Overview

This plugin enables OpenCode users to authenticate with Google OAuth (same as Gemini CLI) to access Gemini models without an API key.

**Key insight:** The plugin provides a custom `fetch` that transforms requests/responses between the `@ai-sdk/google` SDK format and the Cloud Code Assist API format.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  @ai-sdk/google SDK                                         │
│  baseURL: https://cloudcode-pa.googleapis.com               │
│  Sends: /v1beta/models/gemini-2.5-flash:generateContent     │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Plugin fetch() - ALWAYS transforms                         │
│  1. Rewrite path: /v1beta/models/X:action → /v1internal:action
│  2. Wrap body: { project, model, request: originalBody }    │
│  3. Set auth header: Authorization: Bearer <token>          │
│  4. Unwrap response: { response: X } → X                    │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Cloud Code Assist API                                      │
│  https://cloudcode-pa.googleapis.com/v1internal:*           │
└─────────────────────────────────────────────────────────────┘
```

## The Two Gemini APIs

| Aspect        | Standard Gemini API                      | Cloud Code Assist API                |
| ------------- | ---------------------------------------- | ------------------------------------ |
| Endpoint      | `generativelanguage.googleapis.com`      | `cloudcode-pa.googleapis.com`        |
| Auth          | API Key (`x-goog-api-key`)               | OAuth Bearer token                   |
| URL pattern   | `/v1beta/models/{model}:generateContent` | `/v1internal:generateContent`        |
| Request body  | `{ contents, generationConfig }`         | `{ project, model, request: {...} }` |
| Response body | `{ candidates, usageMetadata }`          | `{ response: { candidates, ... } }`  |
| Free tier     | Requires API key                         | Google manages a project for you     |

## Provider Configuration

Users configure in `opencode.json`:

```json
{
  "provider": {
    "gemini-cli": {
      "npm": "@ai-sdk/google",
      "models": {
        "gemini-2.5-pro": {},
        "gemini-2.5-flash": {}
      }
    }
  }
}
```

The plugin's loader injects:

- `baseURL: "https://cloudcode-pa.googleapis.com"`
- `fetch: customFetch` (handles all transformations)

## Request Transformation

| Aspect        | SDK sends                                               | Plugin transforms to                                          |
| ------------- | ------------------------------------------------------- | ------------------------------------------------------------- |
| Path          | `/v1beta/models/gemini-2.5-flash:generateContent`       | `/v1internal:generateContent`                                 |
| Path (stream) | `/v1beta/models/gemini-2.5-flash:streamGenerateContent` | `/v1internal:streamGenerateContent?alt=sse`                   |
| Auth          | `x-goog-api-key: ...`                                   | `Authorization: Bearer <token>`                               |
| Body          | `{ contents, generationConfig }`                        | `{ project, model, request: { contents, generationConfig } }` |

## Response Transformation

| Aspect | API returns                    | Plugin transforms to |
| ------ | ------------------------------ | -------------------- |
| Body   | `{ response: { candidates } }` | `{ candidates }`     |
| SSE    | `data: {"response":{...}}`     | `data: {...}`        |

## Project Discovery

Free tier users need a managed project ID. On first request:

1. Call `POST /v1internal:loadCodeAssist` → get `cloudaicompanionProject`
2. If none, call `POST /v1internal:onboardUser` with `tierId: "FREE"` → creates managed project
3. Cache project ID in the `refresh` field: `"refreshToken|projectId"`

## OAuth Flow

Uses Gemini CLI's public OAuth credentials:

- Client ID: `681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com`
- Scopes: `cloud-platform`, `userinfo.email`, `userinfo.profile`

Flow:

1. Start local HTTP server on dynamic port
2. Open browser to Google OAuth consent
3. Catch callback at `/oauth2callback`
4. Exchange code for tokens
5. Return `{ refresh, access, expires }` to OpenCode

## File Structure

```
src/
├── plugin.ts           # Main plugin export
├── constants.ts        # OAuth credentials, endpoints
├── gemini/
│   └── oauth.ts        # OAuth flow (PKCE, token exchange)
└── plugin/
    ├── project.ts      # Project discovery (loadCodeAssist, onboardUser)
    ├── request.ts      # Request/response transformation
    ├── token.ts        # Token refresh
    └── server.ts       # OAuth callback server
```

## Environment Variables

| Variable                               | Purpose                         |
| -------------------------------------- | ------------------------------- |
| `OPENCODE_GEMINI_DEBUG=1`              | Log requests/responses          |
| `OPENCODE_GEMINI_PROJECT_ID`           | Override project ID (paid tier) |
| `SSH_CONNECTION` / `OPENCODE_HEADLESS` | Use manual code flow            |
