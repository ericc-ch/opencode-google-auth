# GeminiOAuth Implementation Plan

## Current State

Basic OAuth flow with local HTTP server, missing:

- PKCE support (for headless flow)
- No-browser/headless flow
- Token refresh
- Configurable timeout

---

## Target Service API

```typescript
export class GeminiOAuth extends Effect.Service<GeminiOAuth>()("GeminiOAuth", {
  sync: () => ({
    // Browser flow - full OAuth with local server (no PKCE)
    authenticate: (options?: { timeout?: Duration }) => Effect<AuthResult, OAuthError>

    // Generate auth URL with PKCE (for headless flow only)
    generateAuthUrl: () => Effect<{ url: string, verifier: string }, OAuthError>

    // Exchange code for tokens (for headless flow only)
    exchangeCode: (code: string, verifier: string) => Effect<AuthResult, OAuthError>

    // Refresh expired access token
    refreshToken: (refreshToken: string) => Effect<RefreshResult, OAuthError>
  }),
}) {}
```

### Types

```typescript
type AuthResult = {
  access: string
  refresh: string
  expires: number // timestamp in ms
}

type RefreshResult = {
  access: string
  expires: number // timestamp in ms
}
```

---

## Implementation Details

### 1. `authenticate(options?)` - Browser Flow

Full browser flow with local HTTP server. No PKCE needed (localhost redirect is secure).

```typescript
authenticate: (options?: { timeout?: Duration }) =>
  Effect.gen(function* () {
    const timeout = options?.timeout ?? Duration.minutes(5)
    const client = new OAuth2Client({
      clientId: OAUTH_CLIENT_ID,
      clientSecret: OAUTH_CLIENT_SECRET,
    })

    const deferredParams = yield* Deferred.make<SuccessParams, OAuthError>()
    const redirectUri = yield* HttpServer.addressFormattedWith((address) =>
      Effect.succeed(`${address}/oauth2callback`),
    )
    const state = crypto.randomUUID()

    const url = client.generateAuthUrl({
      state,
      redirect_uri: redirectUri,
      access_type: "offline",
      scope: OAUTH_SCOPE,
    })

    // Open browser
    yield* Effect.tryPromise({
      try: () => open(url),
      catch: (error) =>
        new OAuthError({ message: "Failed to open browser", _error: error }),
    })

    // Start callback server
    const serverFiber = yield* HttpRouter.empty.pipe(
      HttpRouter.get(
        "/oauth2callback" /* ... handler that signals deferredParams */,
      ),
      HttpServer.serveEffect(),
      Effect.forkScoped,
    )

    // Wait for callback with timeout
    const params = yield* Deferred.await(deferredParams).pipe(
      Effect.timeout(timeout),
      Effect.catchTag("TimeoutException", () =>
        Effect.fail(new OAuthError({ message: "Authentication timed out" })),
      ),
    )

    yield* Fiber.interrupt(serverFiber)

    // Validate state
    if (state !== params.state) {
      return yield* new OAuthError({
        message: "Invalid state parameter. Possible CSRF attack.",
      })
    }

    // Exchange code for tokens (no PKCE verifier needed)
    const result = yield* Effect.tryPromise({
      try: () =>
        client.getToken({ code: params.code, redirect_uri: redirectUri }),
      catch: (error) =>
        new OAuthError({ message: "Failed to exchange code", _error: error }),
    })

    const tokens = result.tokens

    return {
      access: tokens.access_token!,
      refresh: tokens.refresh_token!,
      expires: tokens.expiry_date!,
    }
  })
```

### 2. Headless Flow (with PKCE)

For headless environments (SSH, Docker). Uses PKCE for extra security since user manually pastes code.

**`generateAuthUrl()`** - Generates OAuth URL with PKCE verifier.

```typescript
generateAuthUrl: () =>
  Effect.gen(function* () {
    const client = new OAuth2Client({
      clientId: OAUTH_CLIENT_ID,
      clientSecret: OAUTH_CLIENT_SECRET,
    })

    const { codeVerifier, codeChallenge } = yield* Effect.promise(() =>
      client.generateCodeVerifierAsync(),
    )

    // Different redirect URI for manual code entry
    const redirectUri = "https://codeassist.google.com/authcode"

    const url = client.generateAuthUrl({
      redirect_uri: redirectUri,
      access_type: "offline",
      scope: OAUTH_SCOPE,
      code_challenge_method: CodeChallengeMethod.S256,
      code_challenge: codeChallenge,
    })

    return { url, verifier: codeVerifier }
  })
```

**`exchangeCode(code, verifier)`** - Exchanges manually-entered code for tokens.

```typescript
exchangeCode: (code: string, verifier: string) =>
  Effect.gen(function* () {
    const client = new OAuth2Client({
      clientId: OAUTH_CLIENT_ID,
      clientSecret: OAUTH_CLIENT_SECRET,
    })

    const redirectUri = "https://codeassist.google.com/authcode"

    const result = yield* Effect.tryPromise({
      try: () =>
        client.getToken({
          code,
          redirect_uri: redirectUri,
          codeVerifier: verifier,
        }),
      catch: (error) =>
        new OAuthError({ message: "Failed to exchange code", _error: error }),
    })

    const tokens = result.tokens

    return {
      access: tokens.access_token!,
      refresh: tokens.refresh_token!,
      expires: tokens.expiry_date!,
    }
  })
```

Import needed: `CodeChallengeMethod` from `google-auth-library`

### 3. `refreshToken(refreshToken)`

Stateless token refresh using OAuth2Client.

```typescript
refreshToken: (refreshToken: string) =>
  Effect.gen(function* () {
    const client = new OAuth2Client({
      clientId: OAUTH_CLIENT_ID,
      clientSecret: OAUTH_CLIENT_SECRET,
    })

    client.setCredentials({ refresh_token: refreshToken })

    const { token } = yield* Effect.tryPromise({
      try: () => client.getAccessToken(),
      catch: (error) =>
        new OAuthError({ message: "Failed to refresh token", _error: error }),
    })

    return {
      access: token!,
      expires: client.credentials.expiry_date!,
    }
  })
```

---

## Usage in OpenCode Plugin

### Browser Flow (`method: "auto"`)

```typescript
authorize: async () => {
  return {
    url: "", // Not needed - authenticate() opens browser itself
    instructions: "Complete sign-in in your browser.",
    method: "auto",
    callback: async () => {
      const result = await runEffect(geminiOAuth.authenticate())
      return {
        type: "success",
        access: result.access,
        refresh: result.refresh,
        expires: result.expires,
      }
    },
  }
}
```

### Headless Flow (`method: "code"`)

```typescript
authorize: async () => {
  const { url, verifier } = await runEffect(geminiOAuth.generateAuthUrl())

  return {
    url,
    instructions: "Complete OAuth and paste the authorization code.",
    method: "code",
    callback: async (code: string) => {
      const result = await runEffect(geminiOAuth.exchangeCode(code, verifier))
      return {
        type: "success",
        access: result.access,
        refresh: result.refresh,
        expires: result.expires,
      }
    },
  }
}
```

### Loader (Token Refresh)

```typescript
loader: async (getAuth, provider) => {
  return {
    apiKey: "",
    async fetch(input, init) {
      const auth = await getAuth()
      if (auth.type !== "oauth") return fetch(input, init)

      // Check if token needs refresh (with 60s buffer)
      if (auth.expires && auth.expires < Date.now() + 60000) {
        const refreshed = await runEffect(
          geminiOAuth.refreshToken(auth.refresh!),
        )
        await client.auth.set({
          path: { id: "gemini" },
          body: {
            type: "oauth",
            refresh: auth.refresh,
            access: refreshed.access,
            expires: refreshed.expires,
          },
        })
      }

      // Add auth header
      const headers = new Headers(init?.headers)
      headers.set("Authorization", `Bearer ${auth.access}`)
      return fetch(input, { ...init, headers })
    },
  }
}
```

---

## Project Context

The Gemini Code Assist API requires a Google Cloud project for every request. This section covers how to set up and manage project context.

### Flow

```
User authenticates
       ↓
loadCodeAssist API → Check if user has project
       ↓
  Has project? ──Yes──→ Use existing project
       │
       No
       ↓
  onboardUser API → Create managed project (polls until done)
       ↓
  Use new project ID for all requests
```

### API Endpoints

Base URL: `https://cloudcode-pa.googleapis.com/v1internal`

**`loadCodeAssist`** - Check if user is already onboarded

```typescript
// Request
{
  cloudaicompanionProject?: string,  // Optional: user's configured project
  metadata: {
    ideType: "IDE_UNSPECIFIED",
    platform: "PLATFORM_UNSPECIFIED",
    pluginType: "GEMINI",
    duetProject?: string,  // Same as cloudaicompanionProject
  }
}

// Response
{
  cloudaicompanionProject?: string,  // Existing managed project (if any)
  currentTier?: { id: string },      // User's current tier (FREE, STANDARD, etc.)
  allowedTiers?: Array<{             // Available tiers for onboarding
    id: string,
    isDefault?: boolean,
    userDefinedCloudaicompanionProject?: boolean,
  }>
}
```

**`onboardUser`** - Create/assign a managed project

```typescript
// Request
{
  tierId: string,                    // "FREE" or "STANDARD"
  cloudaicompanionProject?: string,  // Required for non-FREE tiers
  metadata: {
    ideType: "IDE_UNSPECIFIED",
    platform: "PLATFORM_UNSPECIFIED",
    pluginType: "GEMINI",
    duetProject?: string,
  }
}

// Response (Long Running Operation)
{
  done: boolean,
  response?: {
    cloudaicompanionProject?: {
      id: string,  // The managed project ID
    }
  }
}
```

### Reference Implementation (from Gemini CLI)

```typescript
// From .context/gemini-cli/packages/core/src/code_assist/setup.ts

const CODE_ASSIST_ENDPOINT = "https://cloudcode-pa.googleapis.com"
const CODE_ASSIST_API_VERSION = "v1internal"

const CLIENT_METADATA = {
  ideType: "IDE_UNSPECIFIED",
  platform: "PLATFORM_UNSPECIFIED",
  pluginType: "GEMINI",
}

async function setupUser(
  accessToken: string,
): Promise<{ projectId: string; userTier: string }> {
  // Check for user-configured project ID
  const configuredProjectId =
    process.env["GOOGLE_CLOUD_PROJECT"]
    || process.env["GOOGLE_CLOUD_PROJECT_ID"]
    || undefined

  // Step 1: Check if user is already onboarded
  const loadRes = await fetch(
    `${CODE_ASSIST_ENDPOINT}/${CODE_ASSIST_API_VERSION}:loadCodeAssist`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        cloudaicompanionProject: configuredProjectId,
        metadata: {
          ...CLIENT_METADATA,
          duetProject: configuredProjectId,
        },
      }),
    },
  )

  const loadData = await loadRes.json()

  // If user has a current tier, they're already onboarded
  if (loadData.currentTier) {
    if (loadData.cloudaicompanionProject) {
      return {
        projectId: loadData.cloudaicompanionProject,
        userTier: loadData.currentTier.id,
      }
    }
    // User has tier but no managed project - need configured project
    if (configuredProjectId) {
      return {
        projectId: configuredProjectId,
        userTier: loadData.currentTier.id,
      }
    }
    throw new Error("Project ID required - set GOOGLE_CLOUD_PROJECT env var")
  }

  // Step 2: User needs onboarding - find default tier
  const defaultTier = loadData.allowedTiers?.find((t: any) => t.isDefault)
    || loadData.allowedTiers?.[0] || { id: "FREE" }

  // Step 3: Onboard user (FREE tier uses managed project, others need configured project)
  const onboardReq =
    defaultTier.id === "FREE" ?
      {
        tierId: "FREE",
        cloudaicompanionProject: undefined, // Google creates managed project
        metadata: CLIENT_METADATA,
      }
    : {
        tierId: defaultTier.id,
        cloudaicompanionProject: configuredProjectId, // Required for non-FREE
        metadata: {
          ...CLIENT_METADATA,
          duetProject: configuredProjectId,
        },
      }

  // Poll until onboarding completes
  let onboardRes: any
  do {
    const res = await fetch(
      `${CODE_ASSIST_ENDPOINT}/${CODE_ASSIST_API_VERSION}:onboardUser`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(onboardReq),
      },
    )
    onboardRes = await res.json()

    if (!onboardRes.done) {
      await new Promise((resolve) => setTimeout(resolve, 5000)) // Wait 5s before retry
    }
  } while (!onboardRes.done)

  const managedProjectId = onboardRes.response?.cloudaicompanionProject?.id
  if (managedProjectId) {
    return {
      projectId: managedProjectId,
      userTier: defaultTier.id,
    }
  }

  // Fallback to configured project
  if (configuredProjectId) {
    return {
      projectId: configuredProjectId,
      userTier: defaultTier.id,
    }
  }

  throw new Error("Project ID required - set GOOGLE_CLOUD_PROJECT env var")
}
```

### Persisting Project ID (opencode-gemini-auth approach)

Since OpenCode only stores `refresh`, `access`, `expires`, the project ID can be encoded in the refresh token:

```typescript
// Encode project info into refresh token string
function formatRefreshParts(parts: {
  refreshToken: string
  projectId?: string
  managedProjectId?: string
}): string {
  const segments = [parts.refreshToken]
  if (parts.projectId) segments.push(`p:${parts.projectId}`)
  if (parts.managedProjectId) segments.push(`m:${parts.managedProjectId}`)
  return segments.join("|")
}

// Decode project info from refresh token string
function parseRefreshParts(refresh?: string): {
  refreshToken: string
  projectId?: string
  managedProjectId?: string
} {
  if (!refresh) return { refreshToken: "" }

  const parts = refresh.split("|")
  const result: any = { refreshToken: parts[0] }

  for (let i = 1; i < parts.length; i++) {
    if (parts[i].startsWith("p:")) result.projectId = parts[i].slice(2)
    if (parts[i].startsWith("m:")) result.managedProjectId = parts[i].slice(2)
  }

  return result
}
```

### Using Project ID in Requests

Every request to the Code Assist API must include the project:

```typescript
// Request body structure for generateContent, etc.
{
  project: projectId,  // Required
  model: "gemini-2.5-flash",
  request: {
    // ... actual request payload
  }
}
```

---

## Notes

- Browser flow: No PKCE (localhost redirect is already secure)
- Headless flow: Uses PKCE (user manually pastes code, needs extra security)
- Headless flow uses different redirect URI: `https://codeassist.google.com/authcode`
- All functions are stateless - create fresh `OAuth2Client` per call
- PKCE verifier must be passed from `generateAuthUrl()` to `exchangeCode()` (caller holds state)
- Timeout only applies to browser flow (headless flow is controlled by OpenCode's UX)
- Project context is required for Code Assist API - either user-configured or Google-managed (FREE tier)
