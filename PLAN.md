# Implementation Plan: Dual Provider Google Auth

## Goal

Two separate OpenCode plugins in one package:

- `geminiCli` - Gemini CLI OAuth provider
- `antigravity` - Antigravity OAuth provider (supports Gemini + Claude models)

## Architecture

Each plugin is a simple `Plugin` function export. OpenCode loads them automatically.

```ts
// src/main.ts
export const geminiCli: Plugin = async (context) => { ... }
export const antigravity: Plugin = async (context) => { ... }
```

No factory pattern. No complex routing. User picks provider when adding auth, gets that provider's models.

---

## Current State

### What exists:

| File                     | Purpose                                   |
| ------------------------ | ----------------------------------------- |
| `src/lib/auth/gemini.ts` | Gemini CLI OAuth (works, no PKCE)         |
| `src/lib/fetch.ts`       | Request/response transform for Gemini CLI |
| `src/lib/project.ts`     | `loadCodeAssist` for project discovery    |
| `src/lib/config.ts`      | Gemini CLI constants only                 |
| `src/main.ts`            | Single `main` export (Gemini CLI only)    |

### What's missing:

- Antigravity OAuth credentials & constants
- Antigravity request transformation (extra fields)
- Second plugin export

---

## Provider Differences

| Aspect            | Gemini CLI                                                                 | Antigravity                                                                 |
| ----------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Client ID         | `681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com` | `1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com` |
| Client Secret     | `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`                                      | `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`                                       |
| Redirect Port     | 8085                                                                       | 51121                                                                       |
| Scopes            | 3 (cloud-platform, email, profile)                                         | 5 (+ cclog, experimentsandconfigs)                                          |
| Endpoints         | 1 (prod only)                                                              | 3 (daily sandbox → daily → prod)                                            |
| User-Agent        | `google-api-nodejs-client/9.15.1`                                          | `antigravity/1.104.0 darwin/arm64`                                          |
| X-Goog-Api-Client | `gl-node/22.17.0`                                                          | `google-cloud-sdk vscode_cloudshelleditor/0.1`                              |
| Models            | Gemini only                                                                | Gemini + Claude                                                             |

### Scopes

**Gemini CLI:**

```ts
;[
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
]
```

**Antigravity:**

```ts
;[
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/cclog",
  "https://www.googleapis.com/auth/experimentsandconfigs",
]
```

### Endpoints

**Gemini CLI:** Single endpoint

```
https://cloudcode-pa.googleapis.com
```

**Antigravity:** Fallback order (try each on failure/429)

```
https://daily-cloudcode-pa.sandbox.googleapis.com  (daily sandbox)
https://daily-cloudcode-pa.googleapis.com          (daily)
https://cloudcode-pa.googleapis.com                (prod)
```

### Request Body Differences

**Gemini CLI:** Simple wrapper

```json
{
  "project": "project-id",
  "model": "gemini-2.5-flash",
  "request": {
    /* original request */
  }
}
```

**Antigravity:** Extra fields

```json
{
  "project": "project-id",
  "model": "gemini-2.5-flash",
  "userAgent": "antigravity",
  "requestType": "agent",
  "requestId": "agent-uuid",
  "request": {
    "sessionId": "-1234567890"
    /* original request */
  }
}
```

### Headers

**Gemini CLI:**

```ts
{
  "User-Agent": "google-api-nodejs-client/9.15.1",
  "X-Goog-Api-Client": "gl-node/22.17.0",
  "Client-Metadata": "ideType=IDE_UNSPECIFIED,platform=PLATFORM_UNSPECIFIED,pluginType=GEMINI",
}
```

**Antigravity:**

```ts
{
  "User-Agent": "antigravity/1.104.0 darwin/arm64",
  "X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
  "Client-Metadata": '{"ideType":"IDE_UNSPECIFIED","platform":"PLATFORM_UNSPECIFIED","pluginType":"GEMINI"}',
}
```

---

## Implementation Tasks

### Core (4 tasks)

#### 1. Expand `src/lib/config.ts`

Add Antigravity constants alongside existing Gemini CLI:

```ts
// Existing Gemini CLI
export const GEMINI_CLI = {
  SERVICE_NAME: "gemini-cli",
  CLIENT_ID: "681255809395-...",
  CLIENT_SECRET: "GOCSPX-4uH...",
  SCOPES: [...],
  REDIRECT_PORT: 8085,
  ENDPOINT: "https://cloudcode-pa.googleapis.com",
  HEADERS: {...},
} as const

// New Antigravity
export const ANTIGRAVITY = {
  SERVICE_NAME: "antigravity",
  CLIENT_ID: "1071006060591-...",
  CLIENT_SECRET: "GOCSPX-K58...",
  SCOPES: [...],  // includes cclog, experimentsandconfigs
  REDIRECT_PORT: 51121,
  ENDPOINTS: [
    "https://daily-cloudcode-pa.sandbox.googleapis.com",
    "https://daily-cloudcode-pa.googleapis.com",
    "https://cloudcode-pa.googleapis.com",
  ],
  HEADERS: {...},
} as const
```

#### 2. Create `src/lib/auth/antigravity.ts`

Copy the pattern from `gemini.ts` with:

- Antigravity client ID/secret
- Port 51121
- 5 scopes (add cclog, experimentsandconfigs)
- Same Effect-TS patterns (Service, Deferred, Scope, etc.)

Key differences from gemini.ts:

- `new OAuth2Client({ clientId: ANTIGRAVITY.CLIENT_ID, ... })`
- `redirect_uri: \`http://localhost:51121/oauth-callback\``
- `scope: ANTIGRAVITY.SCOPES`

#### 3. Create `src/lib/request/antigravity.ts`

Request transformation with extra fields. Based on existing `fetch.ts` but adds:

```ts
const wrapped = {
  project: projectId,
  model,
  userAgent: "antigravity",
  requestType: "agent",
  requestId: `agent-${crypto.randomUUID()}`,
  request: {
    ...parsed,
    sessionId: generateSessionId(parsed),
  },
}
```

Also needs:

- Different headers (User-Agent, X-Goog-Api-Client, Client-Metadata)
- Endpoint fallback logic (try each endpoint on 429/error)

#### 4. Update `src/main.ts`

Rename `main` to `geminiCli`, add `antigravity` export:

```ts
import { GeminiOAuth } from "./lib/auth/gemini"
import { AntigravityOAuth } from "./lib/auth/antigravity"
import { transformRequest as transformGeminiCli } from "./lib/fetch"
import { transformRequest as transformAntigravity } from "./lib/request/antigravity"

export const geminiCli: Plugin = async (context) => {
  // Use GeminiOAuth, transformGeminiCli, GEMINI_CLI config
  return { config, auth }
}

export const antigravity: Plugin = async (context) => {
  // Use AntigravityOAuth, transformAntigravity, ANTIGRAVITY config
  return { config, auth }
}
```

---

### Optional Improvements (3 tasks)

#### 5. PKCE Support

Both reference implementations use PKCE. Add to both auth modules:

```ts
// src/lib/auth/pkce.ts
export const generatePKCE = Effect.sync(() => {
  const verifier = crypto.randomBytes(32).toString("base64url")
  const challenge = crypto
    .createHash("sha256")
    .update(verifier)
    .digest("base64url")
  return { verifier, challenge, method: "S256" as const }
})
```

Then in auth URL generation:

```ts
const pkce = yield * generatePKCE
const authUrl = client.generateAuthUrl({
  // ...existing params
  code_challenge: pkce.challenge,
  code_challenge_method: pkce.method,
})
```

And in token exchange:

```ts
const result =
  yield
  * Effect.tryPromise(() =>
    client.getToken({
      code: search.code,
      redirect_uri: redirectUri,
      codeVerifier: pkce.verifier, // Add this
    }),
  )
```

#### 6. Endpoint Fallback for Antigravity

Try each endpoint on 429 or network error:

```ts
const tryEndpoints = (
  endpoints: string[],
  makeRequest: (ep: string) => Effect<Response>,
) =>
  Effect.gen(function* () {
    for (const endpoint of endpoints) {
      const result = yield* Effect.either(makeRequest(endpoint))
      if (Either.isRight(result)) return result.right

      const error = result.left
      if (error._tag === "RateLimitError" || error._tag === "NetworkError") {
        continue // Try next endpoint
      }
      return yield* Effect.fail(error) // Non-retryable, stop
    }
    return yield* Effect.fail(new Error("All endpoints failed"))
  })
```

#### 7. Rate Limit Retry

Parse 429 responses for retry delay, use Effect.retry:

```ts
// Parse retryDelay from 429 response body
const parseRetryDelay = (body: unknown): number | null => {
  // Look for: error.details[].retryDelay = "3.957s"
  // Parse duration string to milliseconds
}

// Retry policy
const retryPolicy = Schedule.exponential("1 second").pipe(
  Schedule.intersect(Schedule.recurs(3)),
  Schedule.whileInput((e) => e._tag === "RateLimitError"),
)

// Use in request
const response = yield * makeRequest(endpoint).pipe(Effect.retry(retryPolicy))
```

---

## File Structure After Implementation

```
src/
├── lib/
│   ├── auth/
│   │   ├── gemini.ts           # (rename to gemini-cli.ts)
│   │   ├── antigravity.ts      # NEW
│   │   └── pkce.ts             # NEW (optional)
│   ├── request/
│   │   └── antigravity.ts      # NEW
│   ├── fetch.ts                # (existing, Gemini CLI transform)
│   ├── config.ts               # EXPANDED
│   ├── project.ts              # (existing)
│   ├── runtime.ts              # (existing)
│   └── opencode.ts             # (existing)
└── main.ts                     # UPDATED (two exports)
```

---

## References

- `.context/cli-proxy-api/internal/runtime/executor/antigravity_executor.go` - Original Go implementation
- `.context/cli-proxy-api/internal/runtime/executor/gemini_cli_executor.go` - Gemini CLI Go implementation
- `.context/opencode-antigravity-auth/src/plugin.ts` - TypeScript reference (overcomplicated)
- `.context/opencode-antigravity-auth/src/constants.ts` - Constants reference
- `.context/opencode-antigravity-auth/src/plugin/request.ts` - Request transform reference
