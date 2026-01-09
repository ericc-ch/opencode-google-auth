import { describe, expect, it } from "bun:test"

import { HttpClient } from "@effect/platform"
import { BunHttpServer } from "@effect/platform-bun"
import { Effect, Exit, Layer } from "effect"
import type { OAuth2Client } from "google-auth-library"

import { GeminiOAuth, GoogleOAuth2Client, OAuthError } from "./gemini"

const createMockClient = (overrides: Partial<OAuth2Client>) =>
  overrides as typeof GoogleOAuth2Client.Service

describe("GeminiOAuth", () => {
  describe("authenticate", () => {
    it("succeeds with valid callback and token exchange", async () => {
      const expectedTokens = {
        access_token: "test_access_token",
        refresh_token: "test_refresh_token",
        expiry_date: Date.now() + 3600 * 1000,
      }

      let capturedState: string | undefined
      const mockClient = createMockClient({
        generateAuthUrl: (opts) => {
          capturedState = opts?.state
          return "https://mock-auth-url.com"
        },
        getToken: () =>
          Promise.resolve({
            tokens: expectedTokens,
            res: null,
          }),
      })

      const MockClientLayer = Layer.succeed(GoogleOAuth2Client, mockClient)
      const TestLayer = Layer.provide(
        GeminiOAuth.DefaultWithoutDependencies,
        MockClientLayer,
      )

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const oauth = yield* GeminiOAuth
          const client = yield* HttpClient.HttpClient

          const { authUrl, callback } = yield* oauth.authenticate({
            openBrowser: false,
          })

          expect(authUrl).toBe("https://mock-auth-url.com")

          yield* client.get(
            `/oauth2callback?code=test_code&state=${capturedState}`,
          )

          return yield* callback()
        }).pipe(
          Effect.scoped,
          Effect.provide(
            Layer.provideMerge(TestLayer, BunHttpServer.layerTest),
          ),
        ),
      )

      expect(result).toEqual(expectedTokens)
    })

    it("fails with callback error from OAuth provider", async () => {
      const mockClient = createMockClient({
        generateAuthUrl: () => "https://mock-auth-url.com",
      })

      const MockClientLayer = Layer.succeed(GoogleOAuth2Client, mockClient)
      const TestLayer = Layer.provide(
        GeminiOAuth.DefaultWithoutDependencies,
        MockClientLayer,
      )

      const result = await Effect.runPromiseExit(
        Effect.gen(function* () {
          const oauth = yield* GeminiOAuth
          const client = yield* HttpClient.HttpClient

          const { callback } = yield* oauth.authenticate({
            openBrowser: false,
          })

          yield* client.get(
            "/oauth2callback?error=access_denied&error_description=User%20denied%20access",
          )

          return yield* callback()
        }).pipe(
          Effect.scoped,
          Effect.provide(
            Layer.provideMerge(TestLayer, BunHttpServer.layerTest),
          ),
        ),
      )

      expect(Exit.isFailure(result)).toBe(true)
      if (Exit.isFailure(result)) {
        const error = result.cause
        expect(error._tag).toBe("Fail")
        if (error._tag === "Fail") {
          expect(error.error).toBeInstanceOf(OAuthError)
          expect((error.error as OAuthError).reason).toBe("callback")
        }
      }
    })

    it("fails with state mismatch", async () => {
      const mockClient = createMockClient({
        generateAuthUrl: () => "https://mock-auth-url.com",
        getToken: () =>
          Promise.resolve({
            tokens: { access_token: "test" },
            res: null,
          }),
      })

      const MockClientLayer = Layer.succeed(GoogleOAuth2Client, mockClient)
      const TestLayer = Layer.provide(
        GeminiOAuth.DefaultWithoutDependencies,
        MockClientLayer,
      )

      const result = await Effect.runPromiseExit(
        Effect.gen(function* () {
          const oauth = yield* GeminiOAuth
          const client = yield* HttpClient.HttpClient

          const { callback } = yield* oauth.authenticate({
            openBrowser: false,
          })

          yield* client.get("/oauth2callback?code=test_code&state=wrong_state")

          return yield* callback()
        }).pipe(
          Effect.scoped,
          Effect.provide(
            Layer.provideMerge(TestLayer, BunHttpServer.layerTest),
          ),
        ),
      )

      expect(Exit.isFailure(result)).toBe(true)
      if (Exit.isFailure(result)) {
        const error = result.cause
        expect(error._tag).toBe("Fail")
        if (error._tag === "Fail") {
          expect(error.error).toBeInstanceOf(OAuthError)
          expect((error.error as OAuthError).reason).toBe("state_mismatch")
        }
      }
    })

    it("fails when token exchange throws", async () => {
      let capturedState: string | undefined
      const mockClient = createMockClient({
        generateAuthUrl: (opts) => {
          capturedState = opts?.state
          return "https://mock-auth-url.com"
        },
        getToken: () => Promise.reject(new Error("Token exchange failed")),
      })

      const MockClientLayer = Layer.succeed(GoogleOAuth2Client, mockClient)
      const TestLayer = Layer.provide(
        GeminiOAuth.DefaultWithoutDependencies,
        MockClientLayer,
      )

      const result = await Effect.runPromiseExit(
        Effect.gen(function* () {
          const oauth = yield* GeminiOAuth
          const client = yield* HttpClient.HttpClient

          const { callback } = yield* oauth.authenticate({
            openBrowser: false,
          })

          yield* client.get(
            `/oauth2callback?code=test_code&state=${capturedState}`,
          )

          return yield* callback()
        }).pipe(
          Effect.scoped,
          Effect.provide(
            Layer.provideMerge(TestLayer, BunHttpServer.layerTest),
          ),
        ),
      )

      expect(Exit.isFailure(result)).toBe(true)
      if (Exit.isFailure(result)) {
        const error = result.cause
        expect(error._tag).toBe("Fail")
        if (error._tag === "Fail") {
          expect(error.error).toBeInstanceOf(OAuthError)
          expect((error.error as OAuthError).reason).toBe("token_exchange")
        }
      }
    })
  })

  describe("refresh", () => {
    it("succeeds when refreshAccessToken returns credentials", async () => {
      const mockClient = createMockClient({
        setCredentials: () => {},
        refreshAccessToken: () =>
          Promise.resolve({
            credentials: { access_token: "new_access_token" },
            res: null,
          }),
      })

      const MockClientLayer = Layer.succeed(GoogleOAuth2Client, mockClient)
      const TestLayer = Layer.provide(
        GeminiOAuth.DefaultWithoutDependencies,
        MockClientLayer,
      )

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const oauth = yield* GeminiOAuth
          return yield* oauth.refresh({
            refresh_token: "test_refresh_token",
          })
        }).pipe(Effect.provide(TestLayer)),
      )

      expect(result).toEqual({ access_token: "new_access_token" })
    })

    it("fails when refreshAccessToken throws", async () => {
      const mockClient = createMockClient({
        setCredentials: () => {},
        refreshAccessToken: () => Promise.reject(new Error("Refresh failed")),
      })

      const MockClientLayer = Layer.succeed(GoogleOAuth2Client, mockClient)
      const TestLayer = Layer.provide(
        GeminiOAuth.DefaultWithoutDependencies,
        MockClientLayer,
      )

      const result = await Effect.runPromiseExit(
        Effect.gen(function* () {
          const oauth = yield* GeminiOAuth
          return yield* oauth.refresh({
            refresh_token: "test_refresh_token",
          })
        }).pipe(Effect.provide(TestLayer)),
      )

      expect(Exit.isFailure(result)).toBe(true)
      if (Exit.isFailure(result)) {
        const error = result.cause
        expect(error._tag).toBe("Fail")
        if (error._tag === "Fail") {
          expect(error.error).toBeInstanceOf(OAuthError)
          expect(error.error.reason).toBe("token_refresh")
        }
      }
    })
  })
})
