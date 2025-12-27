# OpenCode Plugin Auth Integration Guide

This document provides a comprehensive reference for integrating custom OAuth and API key authentication providers into OpenCode using the Plugin system.

## Table of Contents

1. [Overview](#1-overview)
2. [Plugin Input Context](#2-plugin-input-context)
3. [Auth Hook Structure](#3-auth-hook-structure)
4. [Auth Methods](#4-auth-methods)
5. [Prompts System](#5-prompts-system)
6. [The Loader Function](#6-the-loader-function)
7. [Return Signatures](#7-return-signatures)
8. [Execution Flow](#8-execution-flow)
9. [Complete Type Reference](#9-complete-type-reference)
10. [Complete Examples](#10-complete-examples)

---

## 1. Overview

A plugin is an async function that receives a context object and returns a `Hooks` object. The `auth` hook allows you to define custom authentication providers with two method types:

- **`oauth`**: For OAuth 2.0 flows (Google, GitHub, etc.)
- **`api`**: For simple API key authentication

```typescript
import type { Plugin } from "@opencode-ai/plugin"

export const main: Plugin = async () => {
  return {
    auth: {
      provider: "my-provider",
      methods: [
        {
          type: "oauth",
          label: "OAuth with Google",
          authorize: async () => {
            /* ... */
          },
        },
        { type: "api", label: "Enter API Key" },
      ],
    },
  }
}
```

---

## 2. Plugin Input Context

The plugin function receives a `PluginInput` object (commonly named `ctx`) containing utilities and project information.

### PluginInput Properties

| Property    | Type                                      | Description                            |
| :---------- | :---------------------------------------- | :------------------------------------- |
| `client`    | `ReturnType<typeof createOpencodeClient>` | OpenCode SDK client for API calls      |
| `project`   | `Project`                                 | Current project information            |
| `directory` | `string`                                  | Absolute path to the working directory |
| `worktree`  | `string`                                  | Git worktree path                      |
| `$`         | `BunShell`                                | Shell utilities for running commands   |

### Client API Examples

The `client` object provides access to OpenCode's internal APIs:

```typescript
// Show a toast notification to the user
await ctx.client.tui.showToast({
  body: {
    message: "Authentication successful!",
    variant: "success", // "info" | "warning" | "success" | "error"
  },
})

// Store authentication credentials
await ctx.client.auth.set({
  path: { id: "my-provider" },
  body: {
    type: "oauth",
    refresh: "refresh_token_here",
    access: "access_token_here",
    expires: Date.now() + 3600000,
  },
})
```

---

## 3. Auth Hook Structure

The `auth` hook defines your authentication provider configuration.

```typescript
type AuthHook = {
  provider: string
  loader?: (
    auth: () => Promise<Auth>,
    provider: Provider,
  ) => Promise<LoaderResult>
  methods: AuthMethod[]
}
```

### Properties

| Property   | Required | Description                                                |
| :--------- | :------- | :--------------------------------------------------------- |
| `provider` | Yes      | Unique identifier for your provider (e.g., `"gemini-cli"`) |
| `loader`   | No       | Initialization function called when plugin loads           |
| `methods`  | Yes      | Array of authentication methods (oauth and/or api)         |

### Example

```typescript
auth: {
  provider: "my-google-auth",
  loader: async (getAuth, provider) => {
    // Called on plugin initialization
    return { apiKey: "" }
  },
  methods: [
    { type: "oauth", label: "Sign in with Google", authorize: async () => { /* ... */ } },
    { type: "api", label: "Use API Key" },
  ],
}
```

---

## 4. Auth Methods

### 4.1 OAuth Method

For OAuth 2.0 authentication flows.

```typescript
{
  type: "oauth"
  label: string
  prompts?: Prompt[]
  authorize(inputs?: Record<string, string>): Promise<AuthOauthResult>
}
```

| Field       | Required | Description                                        |
| :---------- | :------- | :------------------------------------------------- |
| `type`      | Yes      | Literal `"oauth"`                                  |
| `label`     | Yes      | Display name shown in auth selection UI            |
| `prompts`   | No       | Array of prompts to collect user input before auth |
| `authorize` | Yes      | Function that initiates OAuth and returns callback |

#### Example

```typescript
{
  type: "oauth",
  label: "OAuth with Google",
  authorize: async (inputs) => {
    const authUrl = buildGoogleAuthUrl()

    return {
      url: authUrl,
      instructions: "Complete sign-in in your browser.",
      method: "auto",
      callback: async () => {
        const tokens = await waitForOAuthCallback()
        return {
          type: "success",
          refresh: tokens.refreshToken,
          access: tokens.accessToken,
          expires: Date.now() + tokens.expiresIn * 1000,
        }
      },
    }
  },
}
```

### 4.2 API Key Method

For simple API key authentication.

```typescript
{
  type: "api"
  label: string
  prompts?: Prompt[]
  authorize?(inputs?: Record<string, string>): Promise<ApiKeyResult>
}
```

| Field       | Required | Description                                                       |
| :---------- | :------- | :---------------------------------------------------------------- |
| `type`      | Yes      | Literal `"api"`                                                   |
| `label`     | Yes      | Display name shown in auth selection UI                           |
| `prompts`   | No       | Array of prompts to collect user input (e.g., the API key)        |
| `authorize` | No       | Custom handler; if omitted, OpenCode handles default API key flow |

#### Example

```typescript
{
  type: "api",
  label: "Manually enter API Key",
  prompts: [
    {
      type: "text",
      key: "apiKey",
      message: "Enter your API Key",
      placeholder: "sk-...",
    },
  ],
}
```

---

## 5. Prompts System

Prompts allow you to collect user input before the `authorize` function is called. The collected values are passed to `authorize` via the `inputs` parameter.

### 5.1 Text Prompts

For free-form text input.

```typescript
{
  type: "text"
  key: string
  message: string
  placeholder?: string
  validate?: (value: string) => string | undefined
  condition?: (inputs: Record<string, string>) => boolean
}
```

| Field         | Required | Description                                                      |
| :------------ | :------- | :--------------------------------------------------------------- |
| `type`        | Yes      | Literal `"text"`                                                 |
| `key`         | Yes      | Key in the `inputs` object passed to `authorize`                 |
| `message`     | Yes      | Prompt message displayed to the user                             |
| `placeholder` | No       | Placeholder text shown in the input field                        |
| `validate`    | No       | Validation function; return error string or `undefined` if valid |
| `condition`   | No       | Return `true` to show this prompt, `false` to skip it            |

#### Example

```typescript
{
  type: "text",
  key: "projectId",
  message: "Enter your Google Cloud Project ID",
  placeholder: "my-project-123",
}
```

### 5.2 Select Prompts

For choosing from predefined options.

```typescript
{
  type: "select"
  key: string
  message: string
  options: Array<{
    label: string
    value: string
    hint?: string
  }>
  condition?: (inputs: Record<string, string>) => boolean
}
```

| Field             | Required | Description                                        |
| :---------------- | :------- | :------------------------------------------------- |
| `type`            | Yes      | Literal `"select"`                                 |
| `key`             | Yes      | Key in the `inputs` object passed to `authorize`   |
| `message`         | Yes      | Prompt message displayed to the user               |
| `options`         | Yes      | Array of selectable options                        |
| `options[].label` | Yes      | Display text for the option                        |
| `options[].value` | Yes      | Value stored in `inputs` when selected             |
| `options[].hint`  | No       | Additional hint text shown alongside the option    |
| `condition`       | No       | Return `true` to show this prompt, `false` to skip |

#### Example

```typescript
{
  type: "select",
  key: "region",
  message: "Select your region",
  options: [
    { label: "US", value: "us", hint: "United States" },
    { label: "EU", value: "eu", hint: "Europe" },
    { label: "Asia", value: "asia", hint: "Asia Pacific" },
  ],
}
```

### 5.3 Conditional Prompts

Use the `condition` function to show prompts based on previous answers.

```typescript
prompts: [
  {
    type: "select",
    key: "accountType",
    message: "Select account type",
    options: [
      { label: "Personal", value: "personal" },
      {
        label: "Enterprise",
        value: "enterprise",
        hint: "Requires organization ID",
      },
    ],
  },
  {
    type: "text",
    key: "orgId",
    message: "Enter your organization ID",
    placeholder: "org-...",
    // Only shown when enterprise is selected
    condition: (inputs) => inputs.accountType === "enterprise",
  },
]
```

### 5.4 Validation

Use the `validate` function to validate user input. Return an error message string if invalid, or `undefined` if valid.

```typescript
{
  type: "text",
  key: "apiKey",
  message: "Enter your API key",
  placeholder: "sk-...",
  validate: (value) => {
    if (!value) {
      return "API key is required"
    }
    if (!value.startsWith("sk-")) {
      return "API key must start with 'sk-'"
    }
    if (value.length < 20) {
      return "API key is too short"
    }
    return undefined // Valid
  },
}
```

---

## 6. The Loader Function

The `loader` function is called when your plugin initializes. It allows you to set up custom request handling, validate credentials, and configure the provider.

### Signature

```typescript
loader?: (
  auth: () => Promise<Auth>,
  provider: Provider
) => Promise<LoaderResult>
```

### Parameters

| Parameter  | Type                  | Description                                         |
| :--------- | :-------------------- | :-------------------------------------------------- |
| `auth`     | `() => Promise<Auth>` | Function to get current auth state                  |
| `provider` | `Provider`            | Provider configuration including models and options |

### Auth Object

The `auth()` function returns the current authentication state:

```typescript
type Auth = {
  type: "oauth" | "api"
  refresh?: string // Refresh token (oauth)
  access?: string // Access token (oauth)
  expires?: number // Expiration timestamp in ms (oauth)
  key?: string // API key (api)
}
```

### Return Value (LoaderResult)

The loader can return an object with these optional properties:

| Property | Type           | Description                                     |
| :------- | :------------- | :---------------------------------------------- |
| `apiKey` | `string`       | Override the API key used for requests          |
| `fetch`  | `typeof fetch` | Custom fetch function to intercept API requests |
| `*`      | `any`          | Any additional custom properties                |

### Use Cases

1. **Validate stored credentials** on startup
2. **Refresh expired access tokens** before making requests
3. **Intercept and transform API requests** (add headers, rewrite URLs)
4. **Set model costs** to 0 for free tiers

### Example

```typescript
loader: async (getAuth, provider) => {
  const auth = await getAuth()

  // Skip if not OAuth authenticated
  if (auth.type !== "oauth") {
    return {}
  }

  // Set all model costs to 0 (free tier)
  if (provider.models) {
    for (const model of Object.values(provider.models)) {
      if (model) {
        model.cost = { input: 0, output: 0 }
      }
    }
  }

  return {
    apiKey: "", // Override API key (empty for OAuth)
    async fetch(input, init) {
      // Check if this is a request we should intercept
      const url = typeof input === "string" ? input : input.url
      if (!url.includes("generativelanguage.googleapis.com")) {
        return fetch(input, init)
      }

      // Get fresh auth state
      const currentAuth = await getAuth()
      if (currentAuth.type !== "oauth" || !currentAuth.access) {
        return fetch(input, init)
      }

      // Add authorization header
      const headers = new Headers(init?.headers)
      headers.set("Authorization", `Bearer ${currentAuth.access}`)

      return fetch(input, { ...init, headers })
    },
  }
},
```

---

## 7. Return Signatures

### AuthOauthResult

The `authorize` function must return this object:

```typescript
type AuthOauthResult = {
  url: string
  instructions: string
} & (
  | { method: "auto"; callback(): Promise<TokenResult> }
  | { method: "code"; callback(code: string): Promise<TokenResult> }
)
```

| Field          | Description                                                     |
| :------------- | :-------------------------------------------------------------- |
| `url`          | OAuth authorization URL to open in browser                      |
| `instructions` | User-facing instructions displayed in the UI                    |
| `method`       | `"auto"` = plugin handles callback, `"code"` = user pastes code |
| `callback`     | Function called after user completes OAuth                      |

### Why This Structure?

The `authorize` → `callback` split exists because OpenCode controls the CLI/TUI and needs to display the URL to users before the OAuth flow completes. Here's what happens:

1. Your `authorize()` is called → returns immediately with URL
2. OpenCode displays URL and instructions to user
3. OpenCode calls `callback()` immediately and awaits the Promise
4. Your `callback()` waits for OAuth redirect, exchanges code, returns tokens

**Important**: Since OpenCode calls `callback()` right away and just awaits it, you can manage the entire server lifecycle inside `callback()`. This is the recommended pattern:

```typescript
authorize: async () => ({
  url: authUrl,
  instructions: "Sign in with Google",
  method: "auto",
  callback: async () => {
    const server = startServer() // Start here
    const code = await waitForCode() // Wait here
    server.stop() // Stop here
    return exchangeForTokens(code) // Return tokens
  },
})
```

### Method: "auto" vs "code"

| Method   | When to Use                                        | Callback Signature             |
| :------- | :------------------------------------------------- | :----------------------------- |
| `"auto"` | Plugin runs local server to capture OAuth redirect | `callback(): Promise<...>`     |
| `"code"` | User manually pastes the redirect URL or auth code | `callback(code): Promise<...>` |

The `method` field tells OpenCode how to wait:

- **`"auto"`**: OpenCode shows a spinner and awaits your `callback()`. Your plugin handles everything (local server, redirect capture, code exchange).
- **`"code"`**: OpenCode prompts the user to paste the redirect URL/code, then passes that string to `callback(code)`. Use this for headless/SSH environments where a local server isn't possible.

### TokenResult (Success with OAuth tokens)

```typescript
{
  type: "success"
  provider?: string    // Optional: override provider ID
  refresh: string      // Refresh token - stored by OpenCode for future sessions
  access: string       // Access token - used for API requests
  expires: number      // Expiration timestamp in milliseconds (Date.now() + ttl)
}
```

### TokenResult (Success with API key)

```typescript
{
  type: "success"
  provider?: string    // Optional: override provider ID
  key: string          // API key
}
```

### TokenResult (Failure)

```typescript
{
  type: "failed"
  error?: string       // Optional error message for debugging
}
```

---

## 8. Execution Flow

### OAuth Flow

```
1. Plugin loads
   └─> loader() called (if defined)
       └─> Validate credentials, set up fetch interceptor

2. User initiates authentication
   └─> prompts collected (if defined)
       └─> User answers prompts
           └─> inputs object populated

3. authorize(inputs) called
   └─> Plugin builds OAuth URL
   └─> Returns { url, instructions, method, callback }

4. OpenCode displays URL and instructions
   └─> User opens URL in browser
   └─> User completes OAuth consent

5. callback() invoked
   ├─> method: "auto"
   │   └─> Plugin's local server captures redirect
   │   └─> Plugin exchanges code for tokens
   └─> method: "code"
       └─> User pastes redirect URL/code
       └─> callback(code) called
       └─> Plugin exchanges code for tokens

6. TokenResult returned
   └─> type: "success"
       └─> OpenCode stores refresh, access, expires
   └─> type: "failed"
       └─> Error displayed to user
```

### API Key Flow

```
1. Plugin loads
   └─> loader() called (if defined)

2. User initiates authentication
   └─> prompts collected (if defined)
       └─> User enters API key

3. authorize(inputs) called (if defined)
   └─> Custom validation/handling
   └─> Returns { type: "success", key: "..." }

4. OpenCode stores API key
```

### Headless Environment Detection

When running in SSH or headless environments, you may want to fall back to the `"code"` method:

```typescript
authorize: async () => {
  const isHeadless = !!(
    process.env.SSH_CONNECTION
    || process.env.SSH_CLIENT
    || process.env.SSH_TTY
    || process.env.OPENCODE_HEADLESS
  )

  if (isHeadless) {
    return {
      url: authUrl,
      instructions: "Paste the redirect URL after completing OAuth.",
      method: "code",
      callback: async (code) => {
        // Handle pasted code/URL
      },
    }
  }

  // Normal flow with local server
  return {
    url: authUrl,
    instructions: "Complete sign-in in your browser.",
    method: "auto",
    callback: async () => {
      // Local server captures redirect
    },
  }
}
```

---

## 9. Complete Type Reference

All types for copy-paste reference.

```typescript
// Plugin entry point
type Plugin = (input: PluginInput) => Promise<Hooks>

// Context passed to plugin
type PluginInput = {
  client: ReturnType<typeof createOpencodeClient>
  project: Project
  directory: string
  worktree: string
  $: BunShell
}

// Hooks object returned by plugin
interface Hooks {
  auth?: AuthHook
  // ... other hooks (event, config, tool, etc.)
}

// Auth hook configuration
type AuthHook = {
  provider: string
  loader?: (
    auth: () => Promise<Auth>,
    provider: Provider,
  ) => Promise<Record<string, any>>
  methods: AuthMethod[]
}

// Auth method types
type AuthMethod = OAuthMethod | ApiMethod

type OAuthMethod = {
  type: "oauth"
  label: string
  prompts?: Prompt[]
  authorize(inputs?: Record<string, string>): Promise<AuthOauthResult>
}

type ApiMethod = {
  type: "api"
  label: string
  prompts?: Prompt[]
  authorize?(inputs?: Record<string, string>): Promise<ApiKeyResult>
}

// Prompt types
type Prompt = TextPrompt | SelectPrompt

type TextPrompt = {
  type: "text"
  key: string
  message: string
  placeholder?: string
  validate?: (value: string) => string | undefined
  condition?: (inputs: Record<string, string>) => boolean
}

type SelectPrompt = {
  type: "select"
  key: string
  message: string
  options: Array<{
    label: string
    value: string
    hint?: string
  }>
  condition?: (inputs: Record<string, string>) => boolean
}

// OAuth authorize result
type AuthOauthResult = {
  url: string
  instructions: string
} & (
  | { method: "auto"; callback(): Promise<TokenResult> }
  | { method: "code"; callback(code: string): Promise<TokenResult> }
)

// Token result variants
type TokenResult = TokenSuccess | TokenFailed

type TokenSuccess = {
  type: "success"
  provider?: string
} & ({ refresh: string; access: string; expires: number } | { key: string })

type TokenFailed = {
  type: "failed"
  error?: string
}

// API key result (for api method authorize)
type ApiKeyResult =
  | { type: "success"; key: string; provider?: string }
  | { type: "failed" }

// Auth state (from getAuth in loader)
type Auth = {
  type: "oauth" | "api"
  refresh?: string
  access?: string
  expires?: number
  key?: string
}
```

---

## 10. Complete Examples

### Example 1: Simple OAuth Plugin

A basic OAuth plugin with automatic callback handling. Note that the server lifecycle is fully managed inside `callback()` - this is the recommended pattern.

```typescript
import type { Plugin } from "@opencode-ai/plugin"

export const main: Plugin = async () => {
  return {
    auth: {
      provider: "my-oauth-provider",
      methods: [
        {
          type: "oauth",
          label: "Sign in with Google",
          authorize: async () => {
            // Build OAuth URL
            const state = crypto.randomUUID()
            const authUrl = new URL(
              "https://accounts.google.com/o/oauth2/v2/auth",
            )
            authUrl.searchParams.set("client_id", "YOUR_CLIENT_ID")
            authUrl.searchParams.set(
              "redirect_uri",
              "http://localhost:8085/callback",
            )
            authUrl.searchParams.set("response_type", "code")
            authUrl.searchParams.set("scope", "openid email")
            authUrl.searchParams.set("state", state)

            return {
              url: authUrl.toString(),
              instructions: "Complete sign-in in your browser.",
              method: "auto",
              callback: async () => {
                // Start server, wait for callback, stop server - all in one place
                let resolveCode: (code: string) => void
                const codePromise = new Promise<string>((resolve) => {
                  resolveCode = resolve
                })

                const server = Bun.serve({
                  port: 8085,
                  fetch(req) {
                    const url = new URL(req.url)
                    if (url.pathname === "/callback") {
                      const code = url.searchParams.get("code")
                      if (code) resolveCode(code)
                      return new Response("Success! You can close this tab.")
                    }
                    return new Response("Not found", { status: 404 })
                  },
                })

                try {
                  const code = await codePromise
                  const tokens = await exchangeCodeForTokens(code, state)

                  return {
                    type: "success",
                    refresh: tokens.refresh_token,
                    access: tokens.access_token,
                    expires: Date.now() + tokens.expires_in * 1000,
                  }
                } finally {
                  server.stop()
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

### Example 2: API Key with Validation

An API key method with custom validation.

```typescript
import type { Plugin } from "@opencode-ai/plugin"

export const main: Plugin = async () => {
  return {
    auth: {
      provider: "my-api-provider",
      methods: [
        {
          type: "api",
          label: "Enter API Key",
          prompts: [
            {
              type: "text",
              key: "apiKey",
              message: "Enter your API key",
              placeholder: "sk-...",
              validate: (value) => {
                if (!value) return "API key is required"
                if (!value.startsWith("sk-")) return "Invalid API key format"
                if (value.length < 32) return "API key is too short"
                return undefined
              },
            },
          ],
          authorize: async (inputs) => {
            const apiKey = inputs?.apiKey
            if (!apiKey) {
              return { type: "failed" }
            }

            // Optionally validate the key against the API
            const isValid = await validateApiKey(apiKey)
            if (!isValid) {
              return { type: "failed" }
            }

            return {
              type: "success",
              key: apiKey,
            }
          },
        },
      ],
    },
  }
}
```

### Example 3: OAuth with Loader and Request Interception

A complete plugin with loader for token refresh and request interception.

```typescript
import type { Plugin } from "@opencode-ai/plugin"

export const main: Plugin = async ({ client }) => {
  return {
    auth: {
      provider: "my-full-provider",
      loader: async (getAuth, provider) => {
        const auth = await getAuth()

        // Only set up interception for OAuth auth
        if (auth.type !== "oauth") {
          return {}
        }

        // Set model costs to 0 (free tier)
        if (provider.models) {
          for (const model of Object.values(provider.models)) {
            if (model) model.cost = { input: 0, output: 0 }
          }
        }

        return {
          apiKey: "",
          async fetch(input, init) {
            const url = typeof input === "string" ? input : input.url

            // Only intercept requests to our API
            if (!url.includes("api.example.com")) {
              return fetch(input, init)
            }

            // Get current auth and check if token needs refresh
            let currentAuth = await getAuth()
            if (currentAuth.type !== "oauth") {
              return fetch(input, init)
            }

            // Refresh token if expired
            if (
              currentAuth.expires
              && currentAuth.expires < Date.now() + 60000
            ) {
              const refreshed = await refreshAccessToken(currentAuth.refresh)
              if (refreshed) {
                await client.auth.set({
                  path: { id: "my-full-provider" },
                  body: {
                    type: "oauth",
                    refresh: currentAuth.refresh,
                    access: refreshed.access_token,
                    expires: Date.now() + refreshed.expires_in * 1000,
                  },
                })
                currentAuth = await getAuth()
              }
            }

            // Add auth header
            const headers = new Headers(init?.headers)
            headers.set("Authorization", `Bearer ${currentAuth.access}`)

            return fetch(input, { ...init, headers })
          },
        }
      },
      methods: [
        {
          type: "oauth",
          label: "OAuth with Example",
          prompts: [
            {
              type: "text",
              key: "projectId",
              message: "Enter your project ID (optional)",
              placeholder: "my-project",
            },
          ],
          authorize: async (inputs) => {
            const projectId = inputs?.projectId || "default"

            const isHeadless = !!(
              process.env.SSH_CONNECTION || process.env.OPENCODE_HEADLESS
            )

            const authUrl = buildAuthUrl(projectId)

            if (isHeadless) {
              return {
                url: authUrl,
                instructions: "Complete OAuth and paste the redirect URL here.",
                method: "code",
                callback: async (callbackUrl) => {
                  const url = new URL(callbackUrl)
                  const code = url.searchParams.get("code")
                  if (!code) return { type: "failed", error: "No code in URL" }

                  const tokens = await exchangeCode(code)
                  return {
                    type: "success",
                    refresh: tokens.refresh_token,
                    access: tokens.access_token,
                    expires: Date.now() + tokens.expires_in * 1000,
                  }
                },
              }
            }

            // Non-headless: return URL, handle server entirely in callback
            return {
              url: authUrl,
              instructions: "Complete sign-in in your browser.",
              method: "auto",
              callback: async () => {
                // Start server inside callback - cleaner lifecycle management
                let resolveCallback: (url: URL) => void
                const callbackPromise = new Promise<URL>((resolve) => {
                  resolveCallback = resolve
                })

                const server = Bun.serve({
                  port: 8085,
                  fetch(req) {
                    const url = new URL(req.url)
                    if (url.pathname === "/callback") {
                      resolveCallback(url)
                      return new Response("Success! You can close this tab.")
                    }
                    return new Response("Not found", { status: 404 })
                  },
                })

                try {
                  const callbackUrl = await callbackPromise
                  const code = callbackUrl.searchParams.get("code")
                  if (!code)
                    return { type: "failed", error: "No code received" }

                  const tokens = await exchangeCode(code)
                  return {
                    type: "success",
                    refresh: tokens.refresh_token,
                    access: tokens.access_token,
                    expires: Date.now() + tokens.expires_in * 1000,
                  }
                } finally {
                  server.stop()
                }
              },
            }
          },
        },
        {
          type: "api",
          label: "Enter API Key",
        },
      ],
    },
  }
}
```
