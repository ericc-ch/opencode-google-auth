# Plugin Restructuring Plan

## Overview

Restructure the plugin to have cleaner abstractions:

- **OAuth**: Only handles initial authentication
- **Session**: Manages session lifecycle (projectId, endpoint, token refresh)
- **Transform**: Pure functions for request/response transformation
- **Streaming**: Effect Stream for SSE parsing (hybrid approach)

## Current Issues

1. **TokenManager** is unused - OpenCode provides `getAuth()`
2. **OAuth** has `refresh()` but it belongs in Session conceptually
3. **RequestTransformer** is a Context.Tag service but logic is pure
4. **project.ts** duplicates refresh logic and feels "half-baked"
5. SSE streaming just passes through, could use Effect Stream

## New Directory Structure

```
src/
├── main.ts                     # Plugin entry point (simplified)
├── models.json                 # Fallback model data
├── types.ts                    # Shared types
│
├── lib/
│   ├── config.ts               # Constants (CODE_ASSIST_VERSION, etc.)
│   ├── runtime.ts              # makeProviderRuntime()
│   │
│   └── services/
│       ├── config.ts           # ProviderConfig Context.Tag + configs
│       ├── oauth.ts            # OAuth { authenticate } only
│       ├── session.ts          # Session { projectId, endpoint, getAccessToken }
│       └── opencode.ts         # OpenCode context + logger
│
└── transform/
    ├── index.ts                # Re-exports
    ├── types.ts                # Transform-specific types
    ├── request.ts              # Pure: transformRequest()
    ├── response.ts             # Pure: transformNonStreamingResponse()
    ├── stream.ts               # Effect Stream: transformStreamingResponse()
    ├── request.test.ts         # Tests
    ├── response.test.ts        # Tests
    └── stream.test.ts          # Tests
```

## File Changes

### Files to Delete

- `src/lib/services/token-manager.ts` - unused, OpenCode manages tokens
- `src/lib/services/transform.ts` - replaced by `transform/` folder
- `src/lib/project.ts` - merged into session.ts

### Files to Create

- `src/lib/services/session.ts`
- `src/transform/index.ts`
- `src/transform/types.ts`
- `src/transform/request.ts`
- `src/transform/response.ts`
- `src/transform/stream.ts`
- `src/transform/request.test.ts`
- `src/transform/response.test.ts`
- `src/transform/stream.test.ts`

### Files to Modify

- `src/lib/services/oauth.ts` - remove refresh(), simplify to authenticate only
- `src/lib/runtime.ts` - update layer composition
- `src/main.ts` - use Session + pure transform functions

## Detailed Specifications

### 1. oauth.ts (Simplified)

```typescript
import { Context, Data, Deferred, Effect, Fiber, Layer, Schema } from "effect"
import {
  HttpRouter,
  HttpServer,
  HttpServerRequest,
  HttpServerResponse,
} from "@effect/platform"
import { BunHttpServer } from "@effect/platform-bun"
import { OAuth2Client, type Credentials } from "google-auth-library"
import type { ProviderConfigShape } from "./config"

export class OAuthError extends Data.TaggedError("OAuthError")<{
  readonly reason: "browser" | "callback" | "state_mismatch" | "token_exchange"
  readonly message: string
  readonly cause?: unknown
}> {}

export interface OAuthShape {
  readonly authenticate: () => Effect.Effect<Credentials, OAuthError>
}

export class OAuth extends Context.Tag("OAuth")<OAuth, OAuthShape>() {}

export const makeOAuthLive = (config: ProviderConfigShape) =>
  Layer.scoped(
    OAuth,
    Effect.gen(function* () {
      const client = new OAuth2Client({
        clientId: config.CLIENT_ID,
        clientSecret: config.CLIENT_SECRET,
      })

      const authenticate = Effect.fn(function* () {
        // OAuth flow: start server, generate URL, wait for callback, exchange code
        // ... (keep existing authenticate logic)
      })

      return { authenticate }
    }),
  )
```

**Key changes:**

- Remove `refresh()` method
- Remove `token_refresh` from OAuthError reasons
- Keep only `authenticate()` for initial login

### 2. session.ts (New)

```typescript
import { Context, Data, Effect, Ref } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "@effect/platform"
import { OAuth2Client, type Credentials } from "google-auth-library"
import { ProviderConfig, type ProviderConfigShape } from "./config"
import { OpenCodeContext } from "./opencode"

// Errors
export class SessionError extends Data.TaggedError("SessionError")<{
  readonly reason: "project_fetch" | "token_refresh" | "no_tokens" | "unauthorized"
  readonly message: string
  readonly cause?: unknown
}> {}

// Response schema (from project.ts)
const LoadCodeAssistResponse = Schema.Struct({
  currentTier: Schema.Struct({ ... }),
  allowedTiers: Schema.Array(...),
  cloudaicompanionProject: Schema.String,
  gcpManaged: Schema.Boolean,
  manageSubscriptionUri: Schema.String,
})

// Session interface
export interface SessionShape {
  readonly projectId: string
  readonly endpoint: string
  readonly getAccessToken: () => Effect.Effect<string, SessionError>
}

// Initialize session from credentials
export const initSession = (credentials: Credentials) =>
  Effect.gen(function* () {
    const config = yield* ProviderConfig
    const openCode = yield* OpenCodeContext
    const httpClient = yield* HttpClient.HttpClient

    const endpoint = config.ENDPOINTS[0] ?? ""

    // Create OAuth2Client for refresh operations (internal)
    const oauthClient = new OAuth2Client({
      clientId: config.CLIENT_ID,
      clientSecret: config.CLIENT_SECRET,
    })

    // State: current credentials
    const credentialsRef = yield* Ref.make(credentials)

    // Internal: refresh tokens
    const refreshTokens = Effect.gen(function* () {
      const current = yield* Ref.get(credentialsRef)
      oauthClient.setCredentials(current)

      const result = yield* Effect.tryPromise({
        try: () => oauthClient.refreshAccessToken(),
        catch: (cause) =>
          new SessionError({
            reason: "token_refresh",
            message: "Failed to refresh access token",
            cause,
          }),
      })

      const newCredentials = result.credentials
      yield* Ref.set(credentialsRef, newCredentials)

      // Persist to OpenCode
      yield* Effect.promise(() =>
        openCode.client.auth.set({
          path: { id: config.SERVICE_NAME },
          body: {
            type: "oauth",
            access: newCredentials.access_token!,
            refresh: newCredentials.refresh_token!,
            expires: newCredentials.expiry_date!,
          },
        }),
      )

      return newCredentials
    })

    // Internal: fetch project
    const fetchProject = (accessToken: string) =>
      Effect.gen(function* () {
        const response = yield* pipe(
          HttpClientRequest.post(`${endpoint}/v1internal:loadCodeAssist`),
          HttpClientRequest.setHeader("Authorization", `Bearer ${accessToken}`),
          HttpClientRequest.bodyJson({
            metadata: {
              ideType: "IDE_UNSPECIFIED",
              platform: "PLATFORM_UNSPECIFIED",
              pluginType: "GEMINI",
            },
          }),
          Effect.flatMap((req) => httpClient.execute(req)),
        )

        return yield* HttpClientResponse.matchStatus({
          "2xx": HttpClientResponse.schemaBodyJson(LoadCodeAssistResponse),
          401: () => new SessionError({ reason: "unauthorized", message: "Token expired" }),
          orElse: (res) =>
            new SessionError({
              reason: "project_fetch",
              message: `Failed to fetch project: ${res.status}`,
            }),
        })(response)
      })

    // Fetch project with retry on 401
    const project = yield* Effect.gen(function* () {
      const creds = yield* Ref.get(credentialsRef)
      return yield* fetchProject(creds.access_token!)
    }).pipe(
      Effect.catchTag("SessionError", (e) =>
        e.reason === "unauthorized"
          ? Effect.gen(function* () {
              const refreshed = yield* refreshTokens
              return yield* fetchProject(refreshed.access_token!)
            })
          : Effect.fail(e),
      ),
    )

    // Public: get fresh access token (refreshes if needed)
    const getAccessToken = () =>
      Effect.gen(function* () {
        const creds = yield* Ref.get(credentialsRef)

        // Check if expired (with 5 min buffer)
        const buffer = 5 * 60 * 1000
        const isExpired = (creds.expiry_date ?? 0) < Date.now() + buffer

        if (isExpired) {
          const refreshed = yield* refreshTokens
          return refreshed.access_token!
        }

        return creds.access_token!
      })

    return {
      projectId: project.cloudaicompanionProject,
      endpoint,
      getAccessToken,
    } satisfies SessionShape
  })
```

**Key features:**

- Creates internal OAuth2Client for refresh
- `Ref<Credentials>` tracks current tokens
- `getAccessToken()` checks expiry, refreshes if needed
- `fetchProject()` with automatic retry on 401
- Persists refreshed tokens to OpenCode

### 3. transform/types.ts

```typescript
import type { ProviderConfigShape } from "../lib/services/config"

export type TransformRequestParams = {
  input: string | URL | Request
  init: RequestInit | undefined
  accessToken: string
  projectId: string
}

export type TransformRequestResult = {
  input: string
  init: RequestInit
  streaming: boolean
}

export type TransformContext = {
  accessToken: string
  projectId: string
  config: ProviderConfigShape
}
```

### 4. transform/request.ts

```typescript
import type { ProviderConfigShape } from "../lib/services/config"
import type { TransformRequestParams, TransformRequestResult } from "./types"
import { CODE_ASSIST_VERSION } from "../lib/config"

const STREAM_ACTION = "streamGenerateContent"

const getUrlString = (input: string | URL | Request): string => {
  if (typeof input === "string") return input
  if (input instanceof URL) return input.toString()
  return input.url
}

export const transformRequest = (
  params: TransformRequestParams,
  config: ProviderConfigShape,
): TransformRequestResult => {
  const url = new URL(getUrlString(params.input))

  // Match /v1beta/models/{model}:{action}
  const match = url.pathname.match(/\/v1beta\/models\/([^:]+):(\w+)/)
  if (!match) {
    return {
      input: url.toString(),
      init: params.init ?? {},
      streaming: false,
    }
  }

  const [, model, action] = match
  const streaming = action === STREAM_ACTION

  // Transform URL
  url.pathname = `/${CODE_ASSIST_VERSION}:${action}`
  if (streaming) {
    url.searchParams.set("alt", "sse")
  }

  // Transform headers
  const headers = new Headers(params.init?.headers)
  headers.set("Authorization", `Bearer ${params.accessToken}`)
  Object.entries(config.HEADERS).forEach(([key, value]) => {
    headers.set(key, value)
  })
  headers.delete("x-api-key")
  headers.delete("x-goog-api-key")
  if (streaming) {
    headers.set("Accept", "text/event-stream")
  }

  // Transform body
  let body = params.init?.body
  if (typeof body === "string" && body) {
    try {
      const parsed = JSON.parse(body) as Record<string, unknown>
      const wrapped = {
        project: params.projectId,
        model,
        request: parsed,
      }
      body = JSON.stringify(wrapped)
    } catch {
      // Keep original body if parse fails
    }
  }

  return {
    input: url.toString(),
    init: {
      ...params.init,
      headers,
      body,
    },
    streaming,
  }
}
```

### 5. transform/response.ts

```typescript
// Non-streaming response transformation
export const transformNonStreamingResponse = async (
  response: Response,
): Promise<Response> => {
  const contentType = response.headers.get("content-type") ?? ""
  if (!contentType.includes("application/json")) {
    return response
  }

  const text = await response.text()
  try {
    const parsed = JSON.parse(text) as { response?: unknown }
    if (parsed.response !== undefined) {
      return new Response(JSON.stringify(parsed.response), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      })
    }
  } catch {
    // Return original if parse fails
  }

  return new Response(text, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}
```

### 6. transform/stream.ts

```typescript
import { Effect, Stream } from "effect"

// Unwrap { response: X } -> X
const unwrapResponse = (data: { response?: unknown }): unknown =>
  data.response !== undefined ? data.response : data

// Parse SSE from byte stream
const parseSSE = (body: ReadableStream<Uint8Array>) =>
  Stream.fromReadableStream(body, (e) => e as Error).pipe(
    Stream.decodeText("utf-8"),
    Stream.splitLines,
    Stream.filter((line) => line.startsWith("data: ")),
    Stream.map((line) => line.slice(6)),
    Stream.filter((json) => json.trim().length > 0),
    Stream.map((json) => {
      try {
        return JSON.parse(json) as { response?: unknown }
      } catch {
        return { response: json }
      }
    }),
  )

// Encode back to SSE format
const encodeSSE = (data: unknown): Uint8Array =>
  new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`)

// Transform streaming response (hybrid: Effect Stream internally, native Response out)
export const transformStreamingResponse = (
  response: Response,
): Effect.Effect<Response, Error, never> =>
  Effect.gen(function* () {
    if (!response.body) {
      return response
    }

    const transformed = parseSSE(response.body).pipe(
      Stream.map(unwrapResponse),
      Stream.map(encodeSSE),
    )

    const readable = yield* Stream.toReadableStream(transformed)

    return new Response(readable, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    })
  })
```

### 7. Updated main.ts

```typescript
import type { GoogleGenerativeAIProviderSettings } from "@ai-sdk/google"
import { HttpClient } from "@effect/platform"
import type { Plugin } from "@opencode-ai/plugin"
import { Effect, Layer, pipe } from "effect"
import type { Credentials } from "google-auth-library"

import { makeProviderRuntime } from "./lib/runtime"
import {
  GEMINI_CLI_CONFIG,
  GEMINI_CLI_MODELS,
  GeminiCliConfigLive,
  ProviderConfig,
} from "./lib/services/config"
import { makeOAuthLive, OAuth } from "./lib/services/oauth"
import { initSession } from "./lib/services/session"
import { transformRequest } from "./transform/request"
import { transformNonStreamingResponse } from "./transform/response"
import { transformStreamingResponse } from "./transform/stream"
import fallbackModels from "./models.json"
import type { OpenCodeModel } from "./types"

const fetchModels = Effect.gen(function* () {
  const client = yield* HttpClient.HttpClient
  const response = yield* client.get("https://models.dev/api.json")
  const data = (yield* response.json) as Record<string, unknown>
  return data.google as typeof fallbackModels
}).pipe(Effect.catchAll(() => Effect.succeed(fallbackModels)))

const GeminiLayer = Layer.mergeAll(
  GeminiCliConfigLive,
  makeOAuthLive(GEMINI_CLI_CONFIG),
)

export const geminiCli: Plugin = async (context) => {
  const runtime = makeProviderRuntime(context, GeminiLayer)
  const config = await runtime.runPromise(ProviderConfig)

  const googleConfig = await runtime.runPromise(fetchModels)
  const filteredModels = pipe(
    googleConfig.models,
    (models) => Object.entries(models),
    (entries) => entries.filter(([key]) => GEMINI_CLI_MODELS.includes(key)),
    (filtered) => Object.fromEntries(filtered),
  )

  return {
    config: async (cfg) => {
      cfg.provider ??= {}
      cfg.provider[config.SERVICE_NAME] = {
        ...googleConfig,
        id: config.SERVICE_NAME,
        name: config.DISPLAY_NAME,
        api: config.ENDPOINTS[0] ?? "",
        models: filteredModels as Record<string, OpenCodeModel>,
      }
    },
    auth: {
      provider: config.SERVICE_NAME,
      loader: async (getAuth) => {
        const auth = await getAuth()
        if (auth.type !== "oauth") return {}

        const credentials: Credentials = {
          access_token: auth.access,
          refresh_token: auth.refresh,
          expiry_date: auth.expires,
        }

        // Initialize session (fetches project, sets up token refresh)
        const session = await runtime.runPromise(initSession(credentials))

        return {
          apiKey: "",
          fetch: (async (input, init) => {
            // Get fresh access token (refreshes if needed)
            const accessToken = await runtime.runPromise(
              session.getAccessToken(),
            )

            // Transform request (pure function)
            const result = transformRequest(
              { input, init, accessToken, projectId: session.projectId },
              config,
            )

            // Make request
            const response = await fetch(result.input, result.init)

            // Transform response
            return result.streaming ?
                await Effect.runPromise(transformStreamingResponse(response))
              : await transformNonStreamingResponse(response)
          }) as typeof fetch,
        } satisfies GoogleGenerativeAIProviderSettings
      },
      methods: [
        {
          type: "oauth",
          label: "OAuth with Google",
          authorize: async () => {
            const result = await runtime.runPromise(
              pipe(
                OAuth,
                Effect.flatMap((oauth) => oauth.authenticate()),
              ),
            )

            return {
              url: "Authentication complete",
              method: "auto",
              instructions: "You are now authenticated!",
              callback: async () => {
                const accessToken = result.access_token
                const refreshToken = result.refresh_token
                const expiryDate = result.expiry_date

                if (!accessToken || !refreshToken || !expiryDate) {
                  return { type: "failed" }
                }

                return {
                  type: "success",
                  provider: config.SERVICE_NAME,
                  access: accessToken,
                  refresh: refreshToken,
                  expires: expiryDate,
                }
              },
            }
          },
        },
      ],
    },
  }
}
```

### 8. Updated runtime.ts

```typescript
import { FetchHttpClient, PlatformLogger } from "@effect/platform"
import { BunFileSystem } from "@effect/platform-bun"
import type { PluginInput } from "@opencode-ai/plugin"
import { Effect, Layer, Logger, ManagedRuntime, pipe } from "effect"
import path from "node:path"
import type { ProviderConfig } from "./services/config"
import type { OAuth } from "./services/oauth"
import { makeOpenCodeLogger, OpenCodeContext } from "./services/opencode"

export type ProviderLayer = Layer.Layer<ProviderConfig | OAuth, never, never>

export const makeProviderRuntime = (
  context: PluginInput,
  ProviderLayer: ProviderLayer,
) => {
  const OpenCodeLive = Layer.succeed(OpenCodeContext, context)

  const combinedLogger = Effect.gen(function* () {
    const fileLogger = yield* pipe(
      Logger.jsonLogger,
      PlatformLogger.toFile(path.join(import.meta.dir, "plugin.log")),
    )
    const openCodeLogger = yield* makeOpenCodeLogger

    return Logger.zip(openCodeLogger, fileLogger)
  })

  const LoggerLive = Logger.replaceScoped(Logger.defaultLogger, combinedLogger)

  const Services = Layer.mergeAll(
    ProviderLayer,
    OpenCodeLive,
    BunFileSystem.layer,
    FetchHttpClient.layer,
  )

  const MainLive = pipe(LoggerLive, Layer.provideMerge(Services))

  return ManagedRuntime.make(MainLive)
}
```

## Implementation Order

1. Create `transform/` module (types, request, response, stream)
2. Add tests for transform functions
3. Create `session.ts` (absorbs project.ts logic + refresh)
4. Simplify `oauth.ts` (remove refresh)
5. Update `runtime.ts` (remove RequestTransformer from types)
6. Update `main.ts` (wire everything together)
7. Delete old files (token-manager.ts, transform.ts, project.ts)
8. Run lint, typecheck, and tests

## Testing Strategy

### transform/request.test.ts

- Test URL transformation (/v1beta/models/X:action -> /v1internal:action)
- Test header injection (Authorization, provider headers)
- Test body wrapping (project, model, request)
- Test streaming detection

### transform/response.test.ts

- Test JSON unwrapping ({ response: X } -> X)
- Test non-JSON passthrough
- Test error responses

### transform/stream.test.ts

- Test SSE parsing (data: lines)
- Test JSON parsing within SSE
- Test response unwrapping in stream
- Test empty/malformed lines handling

## Summary

| Before                                     | After                          |
| ------------------------------------------ | ------------------------------ |
| `OAuth.authenticate()` + `OAuth.refresh()` | `OAuth.authenticate()` only    |
| `TokenManager` service                     | Removed                        |
| `project.ts` with manual refresh           | Merged into `session.ts`       |
| `RequestTransformer` Context.Tag           | Pure functions in `transform/` |
| Native TransformStream for SSE             | Effect Stream (hybrid)         |
| Refresh logic duplicated                   | Single location in Session     |
