# Gemini OAuth Service Implementation Plan

## Overview

This document outlines the implementation plan for the Gemini OAuth service in `src/lib/auth/gemini.ts`. The service handles Google OAuth authentication compatible with Gemini CLI, supporting both browser-based and headless (`NO_BROWSER`) flows.

## Goals

1. Implement browser-based OAuth flow with proper security (state validation, token exchange)
2. Implement headless/manual code flow for SSH/headless environments
3. Return tokens in a format suitable for OpenCode integration
4. Use Effect Service pattern with proper error handling

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  GeminiOAuth Service                                    │
├─────────────────────────────────────────────────────────┤
│  authenticate(options?: AuthOptions): Effect<Tokens>    │
│    - options.headless: boolean (defaults to auto-detect)│
└─────────────────────────────┬───────────────────────────┘
                              │
          ┌───────────────────┴───────────────────┐
          ▼                                       ▼
┌──────────────────────┐               ┌──────────────────────┐
│  Browser Flow        │               │  Headless Flow       │
│  - Local HTTP server │               │  - PKCE              │
│  - open() browser    │               │  - Display URL       │
│  - Auto callback     │               │  - User pastes code  │
└──────────────────────┘               └──────────────────────┘
```

## Types

### Input Options

```typescript
interface AuthOptions {
  /** Force headless mode (auto-detected from NO_BROWSER env if not set) */
  headless?: boolean
  /** Timeout in milliseconds (default: 5 minutes) */
  timeout?: number
}
```

### Output

```typescript
interface Tokens {
  accessToken: string
  refreshToken: string
  /** Expiration timestamp */
  expiresAt: Date
}
```

### Errors

Define tagged error types using `Data.TaggedError`:

| Error Type                 | Cause                                                    |
| -------------------------- | -------------------------------------------------------- |
| `OAuthStateMismatch`       | State parameter doesn't match (possible CSRF)            |
| `OAuthCallbackError`       | Google returned an error in callback (user denied, etc.) |
| `OAuthTokenExchangeFailed` | Failed to exchange code for tokens                       |
| `OAuthTimeout`             | Authentication timed out                                 |
| `OAuthServerError`         | HTTP server failed to start/listen                       |
| `OAuthBrowserError`        | Failed to open browser (non-fatal, log only)             |
| `OAuthUserCancelled`       | User cancelled the flow (headless: empty input)          |

## Constants

```typescript
const OAUTH_CLIENT_ID =
  "681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com"
const OAUTH_CLIENT_SECRET = "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"

const OAUTH_SCOPE = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
]

const SIGN_IN_SUCCESS_URL =
  "https://developers.google.com/gemini-code-assist/auth_success_gemini"
const SIGN_IN_FAILURE_URL =
  "https://developers.google.com/gemini-code-assist/auth_failure_gemini"

// For headless flow
const HEADLESS_REDIRECT_URI = "https://codeassist.google.com/authcode"
```

## Browser Flow

### Sequence

1. **Start HTTP server** on port 0 (OS assigns available port)
2. **Generate state** using `crypto.randomUUID()`
3. **Build auth URL** with OAuth2Client
4. **Open browser** with `open(authUrl)` - handle errors gracefully (log, don't fail)
5. **Wait for callback** at `/oauth2callback` with timeout (default: 5 minutes)
6. **Validate callback**:
   - Check state matches -> `OAuthStateMismatch` if not
   - Check for error params -> `OAuthCallbackError` if present
   - Extract authorization code
7. **Exchange code for tokens** using `client.getToken()`
8. **Redirect user** to success/failure URL (HTTP 301)
9. **Shutdown server** (handled by Effect scope)
10. **Return tokens**

### Callback Handler Logic

```
GET /oauth2callback?code=XXX&state=YYY

  state !== expected
    -> Redirect to SIGN_IN_FAILURE_URL
    -> Fail with OAuthStateMismatch

  error param present
    -> Redirect to SIGN_IN_FAILURE_URL
    -> Fail with OAuthCallbackError

  code present
    -> Exchange with client.getToken()
       -> Fails: Redirect to SIGN_IN_FAILURE_URL, fail with OAuthTokenExchangeFailed
       -> Success: Redirect to SIGN_IN_SUCCESS_URL, return tokens
```

### Timeout

Use `Effect.timeout` or `Effect.race`:

```typescript
Effect.race(authFlow, Effect.delay(Effect.fail(new OAuthTimeout()), timeout))
```

## Headless Flow

### When to Activate

Headless mode activates when:

- `options.headless === true`, OR
- Environment variable `NO_BROWSER=true` is set

### Sequence

1. **Generate PKCE** code verifier and challenge using `client.generateCodeVerifierAsync()`
2. **Generate state** using `crypto.randomUUID()`
3. **Build auth URL** with:
   - `redirect_uri: HEADLESS_REDIRECT_URI`
   - `code_challenge_method: CodeChallengeMethod.S256`
   - `code_challenge: codeVerifier.codeChallenge`
4. **Return URL / prompt for code** (see design decision below)
5. **Exchange code** with PKCE verifier: `client.getToken({ code, codeVerifier, redirect_uri })`
6. **Return tokens**

### Design Decision: Code Input

> **Note:** The mechanism for prompting user input in headless mode needs to be determined based on OpenCode's UI capabilities. Options include:
>
> **Option A: Callback-based**
>
> ```typescript
> interface HeadlessCallbacks {
>   displayUrl: (url: string) => Effect<void>
>   promptForCode: () => Effect<string>
> }
> ```
>
> **Option B: Two-step API**
>
> ```typescript
> // Step 1: Get auth URL and completion function
> const { authUrl, completeAuth } = yield * startHeadlessAuth()
> // Step 2: Display URL to user (caller's responsibility)
> // Step 3: Complete with code
> const tokens = yield * completeAuth(userInputCode)
> ```
>
> **Option C: Simple readline**
> Use Bun's stdin or Effect's Console service to prompt directly.
>
> Recommendation: Option B is most flexible for integration with OpenCode's UI, but consult OpenCode's capabilities first.

## Service Pattern

Export as an Effect Service:

```typescript
export class GeminiOAuth extends Effect.Service<GeminiOAuth>()("GeminiOAuth", {
  effect: Effect.gen(function* () {
    return {
      authenticate: (options?: AuthOptions): Effect<Tokens, OAuthError> => {
        const isHeadless = options?.headless ?? detectHeadless()
        return isHeadless ? headlessFlow(options) : browserFlow(options)
      },
    }
  }),
  dependencies: [BunHttpServer.layer(...)], // if needed
}) {}
```

## Changes from Current WIP

| Current                               | Change To                                         |
| ------------------------------------- | ------------------------------------------------- |
| `Effect.promise(() => open(authUrl))` | Handle errors gracefully, don't fail the flow     |
| `HttpServerResponse.text("Ok")`       | Redirect to success/failure URLs (HTTP 301)       |
| No state validation                   | Add state validation before processing            |
| No token exchange                     | Add `client.getToken()` call                      |
| Returns nothing useful                | Return `Tokens` type                              |
| No timeout                            | Add 5-minute default timeout                      |
| Top-level `BunRuntime.runMain`        | Export as Effect Service                          |
| Schema validation (keep)              | Keep `SuccessParamsSchema`, `FailureParamsSchema` |

## Implementation Checklist

### Phase 1: Browser Flow (Core)

- [ ] Define error types using `Data.TaggedError`
- [ ] Define `Tokens` return type
- [ ] Implement state validation in callback handler
- [ ] Implement token exchange with `client.getToken()`
- [ ] Change callback response to redirect (301 to success/failure URLs)
- [ ] Add timeout using `Effect.timeout` or `Effect.race`
- [ ] Handle `open()` errors gracefully (log, don't fail)
- [ ] Ensure server shuts down after auth completes (Effect scope)
- [ ] Export as Effect Service (remove `BunRuntime.runMain`)

### Phase 2: Headless Flow

- [ ] Add headless detection (`NO_BROWSER` env var)
- [ ] Implement PKCE generation with `client.generateCodeVerifierAsync()`
- [ ] Design and implement code input mechanism
- [ ] Use `HEADLESS_REDIRECT_URI` for headless flow
- [ ] Exchange code with PKCE verifier

### Phase 3: Polish

- [ ] Add configurable timeout option
- [ ] Add proper logging/debug output
- [ ] Write tests
- [ ] Document public API

## Reference

- Gemini CLI OAuth implementation: `.context/gemini-cli/packages/core/src/code_assist/oauth2.ts`
- OpenCode integration spec: `docs/GEMINI_AUTH_INTEGRATION.md`
