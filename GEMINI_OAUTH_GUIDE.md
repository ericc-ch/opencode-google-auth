# Gemini OAuth Implementation Guide & Effect Rewrite

This document provides a detailed explanation of the Gemini OAuth flow, compares the current implementation with the reference `gemini-cli`, and outlines a plan to rewrite the implementation using the `Effect` library.

## 1. How Gemini OAuth Works (Deep Dive)

The Gemini CLI authentication uses the **OAuth 2.0 Authorization Code Flow with PKCE** (Proof Key for Code Exchange). This flow is the standard for secure authentication in native/desktop applications.

### The Flow Sequence

1.  **Preparation (PKCE & State)**
    - The client generates a random **code verifier** (cryptographically random string).
    - It hashes this verifier to create a **code challenge** (SHA-256).
    - It generates a **state** parameter. In the current implementation, this `state` encodes the `verifier` (encrypted/encoded) so the server is stateless. In the reference CLI, the state is a random string used to prevent CSRF, and the verifier is stored in memory.

2.  **Authorization Request**
    - The client starts a local HTTP server to listen for the callback.
    - The client opens the user's browser to the Google Authorization URL:
      ```
      https://accounts.google.com/o/oauth2/v2/auth
      ?client_id=...
      &redirect_uri=http://localhost:<PORT>/oauth2callback
      &response_type=code
      &scope=...
      &code_challenge=...
      &code_challenge_method=S256
      &state=...
      ```

3.  **User Consent**
    - The user logs in to Google and grants permission to the application.

4.  **Callback**
    - Google redirects the browser to the `redirect_uri` (e.g., `http://localhost:8085/oauth2callback?code=AUTH_CODE&state=...`).
    - The local HTTP server intercepts this request and extracts the `code` and `state`.
    - The server responds to the browser (usually with a "Success" HTML page) and closes the connection.

5.  **Token Exchange**
    - The client takes the `code` (from the callback) and the `verifier` (from step 1).
    - It makes a POST request to `https://oauth2.googleapis.com/token`:
      ```
      POST /token
      client_id=...
      client_secret=...
      code=AUTH_CODE
      grant_type=authorization_code
      redirect_uri=...
      code_verifier=VERIFIER
      ```
    - Google validates that the `code` was linked to the `code_challenge` (from Step 2) and that the `verifier` matches that challenge.

6.  **Completion**
    - Google returns an **Access Token** (short-lived) and a **Refresh Token** (long-lived).
    - The client stores the Refresh Token securely for future sessions.

---

## 2. Comparative Analysis

| Feature              | Current Implementation (`opencode`)                            | Reference Implementation (`gemini-cli`)                                              |
| :------------------- | :------------------------------------------------------------- | :----------------------------------------------------------------------------------- |
| **Library**          | Native `fetch` & Manual PKCE                                   | `google-auth-library` (Official SDK)                                                 |
| **Port Handling**    | **Fixed Port (8085)**. <br>⚠️ _Risk: Fails if port is in use._ | **Dynamic Port**. <br>✅ _Reliable: Finds an open random port._                      |
| **PKCE**             | **Explicit**. Manually generates challenge/verifier.           | **Implicit/Explicit**. Handled by library or manual flows depending on auth type.    |
| **State Management** | **Stateless**. Embeds `verifier` inside the `state` param.     | **Stateful**. Keeps `verifier` in memory (closure) and uses random `state` for CSRF. |
| **Browser Launch**   | Uses `node:child_process` / `open`.                            | Uses `open` package with retry logic.                                                |
| **Callback Server**  | Simple `http.createServer`.                                    | `http.createServer` with specific error handling for loopback addresses.             |

### Key Improvements Needed for Rewrite

1.  **Dynamic Port Allocation**: The most critical improvement. The system must find an available port (e.g., passing `0` to `listen`) and update the `redirect_uri` accordingly.
2.  **Robust Resource Management**: Using Effect's `Scope` to ensure the HTTP server is always closed, even if the flow errors or times out.
3.  **Structured Error Handling**: Replacing `try/catch` with Effect's typed error channels.

---

## 3. Rewrite Guide (Using Effect)

The rewrite will structure the OAuth logic as a **Service** within the Effect ecosystem. We will stick to the "Manual" HTTP implementation (mirroring current logic) but wrapped in Effect patterns for robustness.

### Architecture

We will define a `GeminiAuth` service.

### Available Effect Packages for OAuth

Effect provides several utilities that can replace manual implementations:

#### 1. HTTP Server Management (`@effect/platform-node`)

The `NodeHttpServer` layer provides automatic port allocation and resource management:

```typescript
import { NodeHttpServer } from "@effect/platform-node"
import { HttpServer } from "@effect/platform"

// Dynamic port allocation - OS finds available port
const ServerLive = NodeHttpServer.layer(() => createServer(), { port: 0 })

// Get assigned port from HttpServer service
const port =
  yield
  * Effect.flatMap(HttpServer.HttpServer, (server) =>
    Effect.succeed(server.address().port),
  )
```

**Key Benefits:**

- `{ port: 0 }` automatically finds an available port
- Server lifecycle is managed by Effect's `acquireRelease` pattern
- Automatic cleanup when scope exits
- Typed server configuration

#### 2. HTTP Client (`@effect/platform`)

Effect's `HttpClient` provides a structured way to make HTTP requests:

```typescript
import { HttpClient, HttpClientRequest } from "@effect/platform"

// Token exchange
const response =
  yield
  * HttpClientRequest.post("https://oauth2.googleapis.com/token").pipe(
    HttpClientRequest.bodyUrlParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
      redirect_uri,
      code_verifier: verifier,
    }),
    HttpClient.fetch,
    Effect.flatMap(HttpClientResponse.text),
  )

// Get user info
const userInfo =
  yield
  * HttpClient.get(
    "https://www.googleapis.com/oauth2/v1/userinfo?alt=json",
  ).pipe(
    HttpClientRequest.setHeaders({
      Authorization: `Bearer ${accessToken}`,
    }),
    HttpClient.fetch,
    Effect.flatMap(HttpClientResponse.json),
  )
```

**Key Benefits:**

- Request/response typed with Effect patterns
- Built-in error handling
- Composable request building
- Automatic resource cleanup

#### 3. Scope & Resource Management

Effect's `Scope` ensures automatic cleanup of resources like the HTTP server:

```typescript
Effect.scoped(
  Effect.gen(function* () {
    // Server automatically closed when scope exits
    const server = yield* makeCallbackServer
    const port = (server.address() as any).port

    // ... rest of auth flow
  }),
)
```

**Key Benefits:**

- No manual `close()` calls needed
- Resources cleaned up even on errors
- Composable resource management
- Timeout support via `Effect.timeout()`

#### 4. Complete Effect-Based Server Example

Here's how the callback server can be implemented using Effect:

```typescript
import {
  HttpServer,
  HttpServerResponse,
  HttpServerRequest,
  HttpRouter,
} from "@effect/platform"
import { NodeHttpServer } from "@effect/platform-node"
import { createServer } from "node:http"

const makeCallbackServer = Effect.gen(function* (_) {
  const server = yield* _(
    Effect.acquireRelease(
      Effect.sync(() => createServer()),
      (server) => Effect.sync(() => server.close()),
    ),
  )

  const port = yield* _(
    Effect.async<number, GeminiAuthError>((resume) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address()
        if (addr && typeof addr === "object") {
          resume(Effect.succeed(addr.port))
        } else {
          resume(
            Effect.fail(new GeminiAuthError({ message: "Failed to get port" })),
          )
        }
      })
      server.on("error", (err) =>
        resume(
          Effect.fail(
            new GeminiAuthError({ message: "Server error", cause: err }),
          ),
        ),
      )
    }),
  )

  const redirectUri = `http://localhost:${port}/oauth2callback`

  let resolveCallback: (url: URL) => void
  let rejectCallback: (error: Error) => void
  const callbackPromise = new Promise<URL>((resolve, reject) => {
    resolveCallback = resolve
    rejectCallback = reject
  })

  const app = HttpRouter.empty.pipe(
    HttpRouter.post("/oauth2callback", () =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const url = new URL(request.url, `http://${request.headers.host}`)
        const code = url.searchParams.get("code")
        const state = url.searchParams.get("state")

        if (!code || !state) {
          return HttpServerResponse.text(
            "Authorization code or state missing",
            { status: 400 },
          )
        }

        resolveCallback(url)

        return HttpServerResponse.html(successResponse)
      }),
    ),
    HttpServer.serveEffect(),
  )

  yield* _(app)

  return {
    server,
    port,
    redirectUri,
    waitForCallback: () => Effect.promise(() => callbackPromise),
  }
})
```

#### 1. Dependencies & Configuration

Define the configuration (Client ID, Secret) using `Config`.

```typescript
// src/gemini/config.ts
import * as Config from "effect/Config"

export const GeminiConfig = Config.map(
  Config.all({
    clientId: Config.string("GEMINI_CLIENT_ID"),
    clientSecret: Config.string("GEMINI_CLIENT_SECRET"),
    // ... defaults or fallbacks
  }),
  (config) => ({ ...config }),
)
```

#### 2. The Service Interface

Define the capabilities of the Auth service.

```typescript
// src/gemini/domain.ts
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"

export interface AuthTokens {
  readonly accessToken: string
  readonly refreshToken: string
  readonly expiryDate: number
}

export class GeminiAuthError extends Data.TaggedError("GeminiAuthError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

export interface GeminiAuth {
  readonly authorize: () => Effect.Effect<AuthTokens, GeminiAuthError>
  readonly refresh: (
    token: string,
  ) => Effect.Effect<AuthTokens, GeminiAuthError>
}

export const GeminiAuth = Context.GenericTag<GeminiAuth>("@app/GeminiAuth")
```

#### 3. Implementation Plan

The implementation will compose several smaller "Effects" using Effect's HTTP utilities:

**A. Find Available Port & Start Server (Using Effect HTTP)**

```typescript
import {
  HttpServer,
  HttpServerResponse,
  HttpServerRequest,
  HttpRoute,
  HttpApp,
} from "@effect/platform"
import { NodeHttpServer } from "@effect/platform-node"
import { createServer } from "node:http"

const makeCallbackServer = Effect.gen(function* (_) {
  // Use NodeHttpServer layer with port 0 for dynamic allocation
  const server = yield* _(
    Effect.acquireRelease(
      Effect.sync(() => createServer()),
      (server) => Effect.sync(() => server.close()),
    ),
  )

  // Bind to port 0 (random available port)
  const port = yield* _(
    Effect.async<number, GeminiAuthError>((resume) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address()
        if (addr && typeof addr === "object") {
          resume(Effect.succeed(addr.port))
        } else {
          resume(
            Effect.fail(new GeminiAuthError({ message: "Failed to get port" })),
          )
        }
      })
      server.on("error", (err) =>
        resume(
          Effect.fail(
            new GeminiAuthError({ message: "Server error", cause: err }),
          ),
        ),
      )
    }),
  )

  const redirectUri = `http://localhost:${port}/oauth2callback`

  return { server, port, redirectUri }
})
```

**Alternative: Using Effect's HttpServer Directly**

For a more idiomatic Effect approach, you can use `HttpServer` service:

```typescript
const makeCallbackServerEffect = Effect.gen(function* (_) {
  // Create server with dynamic port
  const serverLayer = NodeHttpServer.layer(() => createServer(), { port: 0 })

  const callbackUrl = Effect.gen(function* (_) {
    const httpServer = yield* _(HttpServer.HttpServer)
    const port = httpServer.address.port
    return `http://localhost:${port}/oauth2callback`
  })

  return { serverLayer, callbackUrl }
})
```

**B. The Authorization Flow (Effect.gen)**

```typescript
export const GeminiAuthLive = Layer.effect(
  GeminiAuth,
  Effect.gen(function* (_) {
    // Dependencies
    const config = yield* _(GeminiConfig)

    const authorize = Effect.gen(function* (_) {
      // 1. Generate PKCE
      const pkce = yield* _(generatePkceEffect)

      // 2. Start Local Server (Scoped)
      // Using Effect's acquireRelease for automatic cleanup
      const { server, port, redirectUri } = yield* _(
        makeCallbackServer.pipe(Effect.scoped),
      )

      // 3. Construct URL
      const authUrl = buildAuthUrl(config, pkce, redirectUri)

      // 4. Open Browser
      yield* _(openBrowser(authUrl))

      // 5. Wait for Callback (Promise-based logic wrapped in Effect.async)
      const callback = yield* _(
        waitForCallback(server).pipe(Effect.timeout("5 minutes")),
      )

      const code = callback.searchParams.get("code")
      const state = callback.searchParams.get("state")

      if (!code || !state) {
        return yield* _(
          Effect.fail(
            new GeminiAuthError({ message: "Missing code or state" }),
          ),
        )
      }

      // 6. Exchange Token using HttpClient
      const tokens = yield* _(
        exchangeTokenEffect(config, code, pkce.verifier, redirectUri),
      )

      return tokens
    }).pipe(
      // Ensure server is closed via scope
      Effect.scoped,
    )

    const refresh = (token: string) =>
      Effect.gen(function* (_) {
        // Implement refresh using HttpClient
        return yield* _(refreshTokenEffect(config, token))
      })

    return { authorize, refresh }
  }),
)
```

### Detailed Steps for the Coder

1.  **Create `src/gemini/effect/Client.ts`**:
    - Implement the `GeminiAuth` interface.
    - Use `Effect.acquireRelease` to manage the `http.Server`.
    - **Crucial**: Pass `0` to `server.listen` to get a random port. Read that port to construct the `redirect_uri`.
    - Ensure the `redirect_uri` passed to `buildAuthUrl` is the _exact same_ one passed to `exchangeToken`.

2.  **PKCE & State**:
    - Keep the current logic of encoding state if you prefer statelessness, OR switch to a closure-based approach since the Effect workflow runs in a single process context (the closure is easier and more secure as the verifier never leaves memory).
    - Recommendation: Use closure/scope variable for `verifier` (Stateful). It's simpler and safer.

3.  **HTTP Client**:
    - Use `Effect.tryPromise` to wrap the `fetch` calls to Google's token endpoint.
    - Handle 4xx/5xx responses by mapping them to `GeminiAuthError`.

4.  **Integration**:
    - Expose the `authorize` function to the main CLI.
    - Ensure `Layer` is provided in the main entry point.

### Summary of Changes

| Component        | Old (Current)                         | New (Effect)                               |
| :--------------- | :------------------------------------ | :----------------------------------------- |
| **Server**       | `startOAuthListener` (manual Promise) | `Effect.acquireRelease` (Managed Resource) |
| **Port**         | 8085 (Fixed)                          | Random (0)                                 |
| **Flow Control** | Async/Await                           | `Effect.gen` + `Effect.scoped`             |
| **Verifier**     | Encoded in URL param                  | Kept in Scope (Closure)                    |

---

## 4. Implementation Reference (Detailed)

### 4.0 Package Dependencies

To use Effect's HTTP capabilities, you'll need these packages:

```json
{
  "dependencies": {
    "effect": "^3.x",
    "@effect/platform": "^0.x",
    "@effect/platform-node": "^0.x"
  }
}
```

These packages are available from:

- `effect` - Core Effect library
- `@effect/platform` - Platform-agnostic HTTP abstractions
- `@effect/platform-node` - Node.js-specific implementations

### 4.1 PKCE Generation as an Effect

### 4.1 PKCE Generation as an Effect

```typescript
import { generatePKCE } from "@openauthjs/openauth/pkce"
import * as Effect from "effect/Effect"

export const generatePKCEEffect = Effect.tryPromise({
  try: () => generatePKCE(),
  catch: (error) =>
    new GeminiAuthError({ message: "Failed to generate PKCE", cause: error }),
})
```

### 4.2 Handling the Redirect Callback (Using Node.js Server)

```typescript
import * as http from "node:http"

const waitForCallback = (server: http.Server) =>
  Effect.async<URL, GeminiAuthError>((resume) => {
    server.on("request", (req, res) => {
      if (!req.url) {
        res.writeHead(400, { "Content-Type": "text/plain" })
        res.end("Invalid request")
        return
      }

      const url = new URL(req.url, `http://${req.headers.host}`)
      const code = url.searchParams.get("code")
      const state = url.searchParams.get("state")

      if (code && state) {
        res.writeHead(200, { "Content-Type": "text/html" })
        res.end(successResponse)
        resume(Effect.succeed(url))
      } else {
        res.writeHead(400)
        res.end("Authorization code or state missing")
        resume(
          Effect.fail(
            new GeminiAuthError({
              message: "Authorization code or state missing",
            }),
          ),
        )
      }
    })

    // Handle server errors
    server.on("error", (err) => {
      resume(
        Effect.fail(
          new GeminiAuthError({ message: "Server error", cause: err }),
        ),
      )
    })
  })
```

### 4.3 Token Exchange Using Effect HttpClient

```typescript
import {
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from "@effect/platform"
import * as Effect from "effect/Effect"

const exchangeTokenEffect = (
  config: { clientId: string; clientSecret: string },
  code: string,
  verifier: string,
  redirectUri: string,
) =>
  Effect.gen(function* (_) {
    const response = yield* _(
      HttpClientRequest.post("https://oauth2.googleapis.com/token").pipe(
        HttpClientRequest.bodyUrlParams({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          code,
          grant_type: "authorization_code",
          redirect_uri: redirectUri,
          code_verifier: verifier,
        }),
        HttpClient.fetch,
      ),
    )

    if (!response.ok) {
      const errorText = yield* _(HttpClientResponse.text(response))
      return yield* _(
        Effect.fail(
          new GeminiAuthError({
            message: `Token exchange failed: ${errorText}`,
            cause: response.status,
          }),
        ),
      )
    }

    const tokenPayload = yield* _(
      HttpClientResponse.json(response),
    ) as unknown as GeminiTokenResponse

    if (!tokenPayload.refresh_token) {
      return yield* _(
        Effect.fail(
          new GeminiAuthError({ message: "Missing refresh token in response" }),
        ),
      )
    }

    // Get user info
    const userInfo = yield* _(
      HttpClient.get(
        "https://www.googleapis.com/oauth2/v1/userinfo?alt=json",
      ).pipe(
        HttpClientRequest.setHeaders({
          Authorization: `Bearer ${tokenPayload.access_token}`,
        }),
        HttpClient.fetch,
        Effect.flatMap((response) =>
          response.ok ? HttpClientResponse.json(response) : Effect.succeed({}),
        ),
      ),
    ) as unknown as GeminiUserInfo

    return {
      type: "success" as const,
      refresh: tokenPayload.refresh_token,
      access: tokenPayload.access_token,
      expires: Date.now() + tokenPayload.expires_in * 1000,
      email: userInfo.email,
    }
  })
```

### 4.4 Putting it all Together

```typescript
import * as http from "node:http"

export const authorize = Effect.gen(function* () {
  const config = yield* _(GeminiConfig)

  // Start server with dynamic port
  const { server, port, redirectUri } = yield* _(
    Effect.acquireRelease(
      Effect.async<
        { server: http.Server; port: number; redirectUri: string },
        GeminiAuthError
      >((resume) => {
        const server = http.createServer()

        server.listen(0, "127.0.0.1", () => {
          const addr = server.address()
          if (addr && typeof addr === "object") {
            resume(
              Effect.succeed({
                server,
                port: addr.port,
                redirectUri: `http://localhost:${addr.port}/oauth2callback`,
              }),
            )
          } else {
            resume(
              Effect.fail(
                new GeminiAuthError({ message: "Failed to get port" }),
              ),
            )
          }
        })

        server.on("error", (err) => {
          resume(
            Effect.fail(
              new GeminiAuthError({ message: "Server error", cause: err }),
            ),
          )
        })
      }),
      ({ server }) =>
        Effect.sync(() => {
          server.close()
        }),
    ),
  )

  // Generate PKCE
  const { challenge, verifier } = yield* _(generatePKCEEffect)

  // Build auth URL
  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth")
  authUrl.searchParams.set("client_id", config.clientId)
  authUrl.searchParams.set("redirect_uri", redirectUri)
  authUrl.searchParams.set("response_type", "code")
  authUrl.searchParams.set("scope", SCOPES.join(" "))
  authUrl.searchParams.set("code_challenge", challenge)
  authUrl.searchParams.set("code_challenge_method", "S256")
  authUrl.searchParams.set("state", encodeState({ verifier }))
  authUrl.searchParams.set("access_type", "offline")
  authUrl.searchParams.set("prompt", "consent")

  // Open browser
  yield* _(openBrowser(authUrl.toString()))

  // Wait for callback
  const callbackUrl = yield* _(
    waitForCallback(server).pipe(Effect.timeout("5 minutes")),
  )

  const code = callbackUrl.searchParams.get("code")
  const state = callbackUrl.searchParams.get("state")

  if (!code || !state) {
    return yield* _(
      Effect.fail(new GeminiAuthError({ message: "Missing code or state" })),
    )
  }

  // Exchange token using HttpClient
  const tokens = yield* _(
    exchangeTokenEffect(config, code, verifier, redirectUri),
  )

  return tokens
}).pipe(Effect.scoped)
```

### 4.5 Running the Effect in the CLI

To run the Effect-based OAuth in your CLI:

```typescript
import { NodeRuntime } from "@effect/platform-node"
import { Layer } from "effect"

// Provide the GeminiAuth live layer
const MainLive = Layer.launch(GeminiAuthLive)

// Run the authorization
NodeRuntime.runMain(
  Effect.gen(function* () {
    const geminiAuth = yield* _(GeminiAuth)
    const tokens = yield* _(geminiAuth.authorize())
    console.log("Authentication successful!", tokens)
  }).pipe(Effect.provide(MainLive)),
)
```

### 4.6 Summary of Key Changes

| Aspect               | Current Implementation | Effect-Based Implementation                                     |
| -------------------- | ---------------------- | --------------------------------------------------------------- |
| **Server Creation**  | `http.createServer()`  | `NodeHttpServer.layer()` or manual with `Effect.acquireRelease` |
| **Port Allocation**  | Fixed port 8085        | `{ port: 0 }` for dynamic allocation                            |
| **HTTP Requests**    | `fetch()`              | `HttpClient` from `@effect/platform`                            |
| **Error Handling**   | `try/catch`            | Effect's error channel with typed errors                        |
| **Resource Cleanup** | Manual `close()`       | `Effect.acquireRelease` + `Effect.scoped`                       |
| **Timeouts**         | Manual `setTimeout`    | `Effect.timeout()`                                              |
| **Async Operations** | `Promise`              | `Effect.async` / `Effect.tryPromise`                            |
| **Configuration**    | Environment variables  | `Config` layer with type safety                                 |

---

# OAuth 2.0 Authorization Flow (Personal Account via Browser)

This document outlines the "happy path" for a personal user authenticating via the browser, based on `@packages/core/src/code_assist/oauth2.ts`.

## 1. Client Initialization

The process begins in `initOauthClient`, where the `OAuth2Client` is instantiated with the application's credentials.

```typescript
// @packages/core/src/code_assist/oauth2.ts

const client = new OAuth2Client({
  clientId: OAUTH_CLIENT_ID,
  clientSecret: OAUTH_CLIENT_SECRET,
  transporterOptions: {
    proxy: config.getProxy(),
  },
})
```

## 2. Setting up Web Authorization

The system prepares for the browser interaction by calling `authWithWeb`. This function:

1.  Finds an available local port.
2.  Constructs the local redirect URI.
3.  Generates a random state string for security (CSRF protection).
4.  Generates the Google Authorization URL.

```typescript
// @packages/core/src/code_assist/oauth2.ts

async function authWithWeb(client: OAuth2Client): Promise<OauthWebLogin> {
  const port = await getAvailablePort();
  // ...
  const redirectUri = `http://localhost:${port}/oauth2callback`;
  const state = crypto.randomBytes(32).toString('hex');
  const authUrl = client.generateAuthUrl({
    redirect_uri: redirectUri,
    access_type: 'offline',
    scope: OAUTH_SCOPE,
    state,
  });

  // ... (Server setup continues below)
```

## 3. Starting the Local Server

A temporary HTTP server is created to listen for the callback from Google. It returns a `loginCompletePromise` that resolves when the flow is finished.

```typescript
// @packages/core/src/code_assist/oauth2.ts

  const loginCompletePromise = new Promise<void>((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      // ... (Callback handling logic)
    });

    server.listen(port, host, () => {
      // Server started successfully
    });
    // ...
  });

  return {
    authUrl,
    loginCompletePromise,
  };
}
```

## 4. User Interaction (Opening Browser)

Back in `initOauthClient`, the CLI opens the generated `authUrl` in the user's default browser and waits for the local server to confirm completion.

```typescript
// @packages/core/src/code_assist/oauth2.ts

const webLogin = await authWithWeb(client)

// ... logging messages ...

// Attempt to open the authentication URL in the default browser.
const childProcess = await open(webLogin.authUrl)

// ...

// Wait for the server callback (or timeout)
await Promise.race([webLogin.loginCompletePromise, timeoutPromise])
```

## 5. Handling the Callback

When the user approves the login in the browser, Google redirects to `http://localhost:{port}/oauth2callback`. The local server intercepts this request.

It verifies the `state`, exchanges the authorization code for tokens, and sets them on the client.

```typescript
// @packages/core/src/code_assist/oauth2.ts (inside http.createServer)

// acquire the code from the querystring
const qs = new url.URL(req.url!, "http://localhost:3000").searchParams

if (qs.get("state") !== state) {
  // ... Handle CSRF mismatch ...
} else if (qs.get("code")) {
  try {
    // Exchange code for Access/Refresh tokens
    const { tokens } = await client.getToken({
      code: qs.get("code")!,
      redirect_uri: redirectUri,
    })

    // Set credentials in memory
    client.setCredentials(tokens)

    // Optional: Fetch user info immediately for UI
    await fetchAndCacheUserInfo(client)

    // Redirect user's browser to success page
    res.writeHead(HTTP_REDIRECT, { Location: SIGN_IN_SUCCESS_URL })
    res.end()

    // Resolve the main promise to unblock the CLI
    resolve()
  } catch (error) {
    // ... Handle errors ...
  }
}
```

## 6. Token Persistence

When `client.setCredentials` is called (or whenever tokens are refreshed), the `tokens` event listener is triggered to save the credentials to disk.

```typescript
// @packages/core/src/code_assist/oauth2.ts

client.on("tokens", async (tokens: Credentials) => {
  if (useEncryptedStorage) {
    await OAuthCredentialStorage.saveCredentials(tokens)
  } else {
    await cacheCredentials(tokens)
  }

  await triggerPostAuthCallbacks(tokens)
})
```

## 7. Cleanup & Return

Once `loginCompletePromise` resolves, the temporary server closes (inside `finally` block of `authWithWeb`), and `initOauthClient` returns the authenticated client.

````typescript
// @packages/core/src/code_assist/oauth2.ts

    await Promise.race([webLogin.loginCompletePromise, timeoutPromise]);

    // ... logging success ...

    await triggerPostAuthCallbacks(client.credentials);
  }

  return client;

## 8. Handling Existing Tokens
When `initOauthClient` is called, it first checks for previously saved credentials to avoid unnecessary re-authentication.

1.  **Load:** It calls `fetchCachedCredentials()` to read tokens from disk (either encrypted or plain JSON).
2.  **Verify:** If tokens exist, it sets them on the client and attempts to verify them:
    *   `client.getAccessToken()`: Checks if the access token is structurally valid and not expired locally.
    *   `client.getTokenInfo(token)`: Makes a network call to Google's servers to ensure the token hasn't been revoked.
3.  **Resume:** If valid, it triggers callbacks and returns the client immediately, skipping the browser flow.

```typescript
// @packages/core/src/code_assist/oauth2.ts

  const credentials = await fetchCachedCredentials();

  // ...

  if (credentials) {
    client.setCredentials(credentials as Credentials);
    try {
      // Local check
      const { token } = await client.getAccessToken();
      if (token) {
        // Server check
        await client.getTokenInfo(token);

        // ... success ...
        return client;
      }
    } catch (error) {
      // Invalid/Expired credentials -> proceed to full auth flow
    }
  }
````

## 9. Token Refreshing

The `google-auth-library` handles token refreshing automatically. When an access token expires, the client uses the `refresh_token` to request a new one.

To ensure these new tokens are persisted:

1.  **Listener:** The code attaches a listener to the `tokens` event on the client.
2.  **Save:** Whenever tokens are refreshed (or initially set), this listener fires, saving the new credentials to storage.

```typescript
// @packages/core/src/code_assist/oauth2.ts

client.on("tokens", async (tokens: Credentials) => {
  if (useEncryptedStorage) {
    await OAuthCredentialStorage.saveCredentials(tokens)
  } else {
    await cacheCredentials(tokens)
  }

  await triggerPostAuthCallbacks(tokens)
})
```
