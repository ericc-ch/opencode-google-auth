# OpenCode Plugin Auth Integration Guide

This document outlines the signature required to integrate a custom OAuth provider into OpenCode using the `Plugin` system.

## 1. Plugin Entry Point

A plugin is an async function that returns a `Hooks` object. The `auth` hook is where you define your provider and methods.

```typescript
import type { Plugin, Hooks } from "@opencode-ai/plugin"

export const main: Plugin = async (ctx) => {
  return {
    auth: {
      provider: "gemini-cli", // Unique ID for your provider
      methods: [
        {
          type: "oauth",
          label: "OAuth with Google",
          authorize: async (inputs) => {
            // Step 1: Return the Auth URL and Callback logic
            return {
              url: "https://accounts.google.com/o/oauth2/v2/auth?...",
              instructions: "Complete sign-in in your browser.",
              method: "auto", // "auto" for local server, "code" for manual paste
              callback: async () => {
                // Step 2: This is called after the user interacts with the URL
                // Here you bridge your Effect logic
              },
            }
          },
        },
      ],
    },
  }
}
```

## 2. The Bridge: Effect → OpenCode

OpenCode expects `Promise` based hooks. You can bridge your `Effect` logic using `Effect.runPromise`.

```typescript
import { Effect } from "effect"

// Your Effect logic for starting server and capturing tokens
const authFlow = Effect.gen(function* () {
  // ... your Effect code ...
  return {
    refresh: "refresh_token",
    access: "access_token",
    expires: Date.now() + 3600000,
  }
})

// Inside callback:
callback: async () => {
  try {
    const result = await Effect.runPromise(authFlow)
    return { type: "success", ...result }
  } catch (err) {
    return { type: "failed" }
  }
}
```

## 3. Return Signatures

| Component             | Expected Return Type                     |
| :-------------------- | :--------------------------------------- |
| **`authorize`**       | `Promise<AuthOuathResult>`               |
| **`callback (auto)`** | `() => Promise<TokenResult>`             |
| **`callback (code)`** | `(code: string) => Promise<TokenResult>` |

**TokenResult (Success):**

```typescript
{
  type: "success",
  refresh: string,  // Stored for future renewal
  access: string,   // Used for immediate API calls
  expires: number   // Absolute timestamp in ms (Date.now() + ttl)
}
```

## 4. Execution Flow

1.  **`authorize()`**: OpenCode calls this first. It should return the Google Auth URL. It should **not** block; it just sets up the "intent".
2.  **User Interaction**: OpenCode displays the `url` and `instructions` to the user.
3.  **`callback()`**: OpenCode calls this when it detects the user has initiated the flow.
    - In `method: "auto"`, your `callback` should start the local HTTP server, wait for the redirect, exchange the code, and shut down the server.
    - In `method: "code"`, the user pastes the final URL/code, which is passed as an argument to your `callback`.
