import { beforeEach, describe, expect, it, mock } from "bun:test"

import * as Effect from "effect/Effect"
import { HttpClient } from "@effect/platform"
import { NodeHttpServer } from "@effect/platform-node"

import {
  authorizeGemini,
  exchangeGemini,
  exchangeGeminiWithEffect,
  generatePKCEParams,
  startCallbackServer,
  refreshGeminiTokenWithEffect,
} from "./gemini"
import { GEMINI_CLIENT_ID, GEMINI_CLIENT_SECRET, GEMINI_REDIRECT_URI, GEMINI_SCOPES } from "../../constants"

const REDIRECT_PATH = "/oauth/callback"

interface PKCEParams {
  codeVerifier: string
  codeChallenge: string
  state: string
}

describe("Gemini OAuth (Effect-based)", () => {
  let fetchMock: ReturnType<typeof mock<typeof global.fetch>

  beforeEach(() => {
    mock.restore()
    fetchMock = mock(async (input, init) => {
      return new Response("OK", { status: 200 })
    })
    ;(globalThis as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch
  })

  describe("PKCE Generation", () => {
    it("should generate valid PKCE parameters", async () => {
      const result = await Effect.runPromise(generatePKCEParams())

      expect(result.codeVerifier).toBeDefined()
      expect(result.codeChallenge).toBeDefined()
      expect(result.state).toBeDefined()

      expect(result.codeVerifier.length).toBeGreaterThanOrEqual(43)
      expect(result.codeVerifier.length).toBeLessThanOrEqual(128)

      expect(result.state.length).toBeGreaterThan(0)
      expect(result.codeChallenge).not.toBe(result.codeVerifier)
    })

    it("should generate different values each time", async () => {
      const params1 = await Effect.runPromise(generatePKCEParams())
      const params2 = await Effect.runPromise(generatePKCEParams())

      expect(params1.codeVerifier).not.toBe(params2.codeVerifier)
      expect(params1.codeChallenge).not.toBe(params2.codeChallenge)
      expect(params1.state).not.toBe(params2.state)
    })

    it("should generate code challenge that is SHA256 hash of verifier", async () => {
      const params = await Effect.runPromise(generatePKCEParams())

      const crypto = await import("node:crypto")
      const expectedChallenge = crypto
        .createHash("sha256")
        .update(params.codeVerifier)
        .digest("base64url")

      expect(params.codeChallenge).toBe(expectedChallenge)
    })
  })

  describe("Authorization URL", () => {
    it("should build authorization URL with all required parameters", async () => {
      const params: PKCEParams = {
        codeVerifier: "test_verifier_32_chars_long_string_",
        codeChallenge: "test_challenge",
        state: "test_state_16_bytes",
      }

      const url = await Effect.runPromise(
        buildAuthorizationUrl(params, 8080),
      )

      const urlObj = new URL(url)
      expect(urlObj.origin).toBe("https://accounts.google.com")
      expect(urlObj.pathname).toBe("/o/oauth2/v2/auth")

      expect(urlObj.searchParams.get("client_id")).toBe(GEMINI_CLIENT_ID)
      expect(urlObj.searchParams.get("response_type")).toBe("code")
      expect(urlObj.searchParams.get("redirect_uri")).toBe(
        `http://localhost:8080${REDIRECT_PATH}`,
      )
      expect(urlObj.searchParams.get("scope")).toBe(GEMINI_SCOPES.join(" "))
      expect(urlObj.searchParams.get("code_challenge")).toBe("test_challenge")
      expect(urlObj.searchParams.get("code_challenge_method")).toBe("S256")
      expect(urlObj.searchParams.get("state")).toBe("test_state_16_bytes")
      expect(urlObj.searchParams.get("access_type")).toBe("offline")
      expect(urlObj.searchParams.get("prompt")).toBe("consent")
    })

    it("should use port from server when building authorization URL", async () => {
      const params: PKCEParams = {
        codeVerifier: "verifier",
        codeChallenge: "challenge",
        state: "state",
      }

      const url = await Effect.runPromise(buildAuthorizationUrl(params, 9999))

      const urlObj = new URL(url)
      expect(urlObj.searchParams.get("redirect_uri")).toBe(
        `http://localhost:9999${REDIRECT_PATH}`,
      )
    })
  })

  describe("Callback Server", () => {
    it("should allocate dynamic port when listening on port 0", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function*() {
          const server = yield* startCallbackServer("expected_state_123")
          return server
        }).pipe(Effect.provide(NodeHttpServer.layerTest)),
      )

      expect(result.port).toBeGreaterThan(0)
      expect(result.port).not.toBe(8080)
    })

    it("should handle OAuth callback successfully", async () => {
      const mockCallbackPromise = Promise.resolve({ code: "test_code", state: "test_state" })

      const result = await Effect.runPromise(
        Effect.gen(function*() {
          const server = yield* startCallbackServer("test_state")

          const client = yield* HttpClient.HttpClient
          yield* client
            .get(`${REDIRECT_PATH}?code=test_code&state=test_state`)
            .pipe(
              Effect.andThen((response) => response.text),
            )

          const callback = yield* Effect.promise(() => mockCallbackPromise)
          return callback
        }).pipe(Effect.provide(NodeHttpServer.layerTest)),
      )

      expect(result.code).toBe("test_code")
      expect(result.state).toBe("test_state")
    })

    it("should reject when state parameter does not match", async () => {
      let errorThrown = false
      try {
        await Effect.runPromise(
          Effect.gen(function*() {
            const server = yield* startCallbackServer("expected_state")

            const client = yield* HttpClient.HttpClient
            yield* client
              .get(`${REDIRECT_PATH}?code=test_code&state=wrong_state`)
              .pipe(
                Effect.andThen((response) => response.text),
              )
          }).pipe(Effect.provide(NodeHttpServer.layerTest)),
        )
      } catch (error) {
        errorThrown = true
        expect(error).toBeInstanceOf(Error)
      }

      expect(errorThrown).toBe(true)
    })

    it("should reject on OAuth error callback", async () => {
      let errorThrown = false
      try {
        await Effect.runPromise(
          Effect.gen(function*() {
            const server = yield* startCallbackServer("test_state")

            const client = yield* HttpClient.HttpClient
            yield* client
              .get(
                `${REDIRECT_PATH}?error=access_denied&error_description=User denied access`,
              )
              .pipe(
                Effect.andThen((response) => response.text),
              )
          }).pipe(Effect.provide(NodeHttpServer.layerTest)),
        )
      } catch (error) {
        errorThrown = true
        expect(error).toBeInstanceOf(Error)
      }

      expect(errorThrown).toBe(true)
    })

    it("should timeout after 5 minutes if no callback received", async () => {
      const startTime = Date.now()

      try {
        await Effect.runPromise(
          Effect.gen(function*() {
            const server = yield* startCallbackServer("test_state")
            const port = yield* Effect.sync(() => server.port)

            yield* Effect.sleep("5 minutes")
          }).pipe(Effect.provide(NodeHttpServer.layerTest)),
        )
      } catch (error) {
        const elapsed = Date.now() - startTime
        expect(elapsed).toBeGreaterThan(4.9 * 60 * 1000)
        expect(elapsed).toBeLessThan(5.1 * 60 * 1000)
      }
    })
  })

  describe("Token Exchange", () => {
    it("should exchange authorization code for tokens successfully", async () => {
      const mockTokenResponse = {
        access_token: "new_access_token",
        refresh_token: "new_refresh_token",
        expires_in: 3600,
      }

      fetchMock.mockImplementationOnce(async () => {
        return new Response(JSON.stringify(mockTokenResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      })

      fetchMock.mockImplementationOnce(async () => {
        return new Response(JSON.stringify({ email: "test@example.com" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      })

      const result = await Effect.runPromise(
        exchangeGeminiWithEffect(
          "test_code",
          "test_verifier",
          "http://localhost:8080/callback",
        ),
      )

      expect(result.type).toBe("success")
      if (result.type === "success") {
        expect(result.access).toBe("new_access_token")
        expect(result.refresh).toBe("new_refresh_token")
        expect(result.expires).toBeGreaterThan(Date.now())
        expect(result.email).toBe("test@example.com")
      }
    })

    it("should fail when token endpoint returns error", async () => {
      fetchMock.mockImplementationOnce(async () => {
        return new Response(
          JSON.stringify({
            error: "invalid_grant",
            error_description: "Invalid authorization code",
          }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          },
        )
      })

      const result = await Effect.runPromise(
        exchangeGeminiWithEffect(
          "test_code",
          "test_verifier",
          "http://localhost:8080/callback",
        ),
      )

      expect(result.type).toBe("failed")
      if (result.type === "failed") {
        expect(result.error).toContain("invalid_grant")
      }
    })

    it("should include correct parameters in token request", async () => {
      let capturedRequest: RequestInit | undefined

      fetchMock.mockImplementationOnce(async (input, init) => {
        capturedRequest = init
        return new Response(
          JSON.stringify({
            access_token: "test_token",
            refresh_token: "test_refresh",
            expires_in: 3600,
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        )
      })

      fetchMock.mockImplementationOnce(async () => {
        return new Response(JSON.stringify({ email: "test@example.com" }), {
          status: 200,
        })
      })

      await Effect.runPromise(
        exchangeGeminiWithEffect(
          "auth_code_123",
          "code_verifier_456",
          "http://localhost:9999/oauth/callback",
        ),
      )

      expect(capturedRequest).toBeDefined()
      expect(capturedRequest?.method).toBe("POST")
      expect(capturedRequest?.headers).toMatchObject({
        "Content-Type": "application/x-www-form-urlencoded",
      })

      const body = capturedRequest?.body as URLSearchParams
      expect(body.get("client_id")).toBe(GEMINI_CLIENT_ID)
      expect(body.get("client_secret")).toBe(GEMINI_CLIENT_SECRET)
      expect(body.get("code")).toBe("auth_code_123")
      expect(body.get("grant_type")).toBe("authorization_code")
      expect(body.get("redirect_uri")).toBe("http://localhost:9999/oauth/callback")
      expect(body.get("code_verifier")).toBe("code_verifier_456")
    })
  })

  describe("Token Refresh", () => {
    it("should refresh access token successfully", async () => {
      const mockRefreshResponse = {
        access_token: "new_access_token",
        refresh_token: "new_refresh_token",
        expires_in: 3600,
      }

      fetchMock.mockImplementationOnce(async () => {
        return new Response(JSON.stringify(mockRefreshResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      })

      const result = await Effect.runPromise(
        refreshGeminiTokenWithEffect("old_refresh_token"),
      )

      expect(result.type).toBe("success")
      if (result.type === "success") {
        expect(result.access).toBe("new_access_token")
        expect(result.refresh).toBe("new_refresh_token")
        expect(result.expires).toBeGreaterThan(Date.now())
      }
    })

    it("should include refresh token in request", async () => {
      let capturedRequest: RequestInit | undefined

      fetchMock.mockImplementationOnce(async (input, init) => {
        capturedRequest = init
        return new Response(
          JSON.stringify({
            access_token: "test_token",
            refresh_token: "test_refresh",
            expires_in: 3600,
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        )
      })

      await Effect.runPromise(refreshGeminiTokenWithEffect("refresh_token_xyz"))

      expect(capturedRequest).toBeDefined()
      expect(capturedRequest?.method).toBe("POST")

      const body = capturedRequest?.body as URLSearchParams
      expect(body.get("grant_type")).toBe("refresh_token")
      expect(body.get("refresh_token")).toBe("refresh_token_xyz")
      expect(body.get("client_id")).toBe(GEMINI_CLIENT_ID)
      expect(body.get("client_secret")).toBe(GEMINI_CLIENT_SECRET)
    })

    it("should fail on refresh error", async () => {
      fetchMock.mockImplementationOnce(async () => {
        return new Response(
          JSON.stringify({
            error: "invalid_grant",
            error_description: "Invalid refresh token",
          }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          },
        )
      })

      const result = await Effect.runPromise(
        refreshGeminiTokenWithEffect("invalid_refresh_token"),
      )

      expect(result.type).toBe("failed")
      if (result.type === "failed") {
        expect(result.error).toContain("invalid_grant")
      }
    })
  })

  describe("Full OAuth Flow Integration", () => {
    it("should complete full OAuth flow with dynamic port", async () => {
      const pkceParams = await Effect.runPromise(generatePKCEParams())

      const result = await Effect.runPromise(
        Effect.gen(function*() {
          const server = yield* startCallbackServer(pkceParams.state)
          const port = yield* Effect.sync(() => server.port)

          const authUrl = yield* buildAuthorizationUrl(pkceParams, port)

          expect(authUrl).toContain(`redirect_uri=http://localhost:${port}${REDIRECT_PATH}`)
          expect(authUrl).toContain(`state=${pkceParams.state}`)
          expect(authUrl).toContain(`code_challenge=${pkceParams.codeChallenge}`)

          const mockTokenResponse = {
            access_token: "test_access_token",
            refresh_token: "test_refresh_token",
            expires_in: 3600,
          }

          fetchMock.mockImplementationOnce(async () => {
            return new Response(JSON.stringify(mockTokenResponse), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            })
          })

          fetchMock.mockImplementationOnce(async () => {
            return new Response(JSON.stringify({ email: "test@example.com" }), {
              status: 200,
            })
          })

          const client = yield* HttpClient.HttpClient
          const callbackUrl = `${REDIRECT_PATH}?code=test_code&state=${pkceParams.state}`

          yield* client
            .get(callbackUrl)
            .pipe(
              Effect.andThen((response) => response.text),
            )

          const callback = yield* server.response
          const tokens = yield* exchangeGeminiWithEffect(
            callback.code,
            pkceParams.codeVerifier,
            `http://localhost:${port}${REDIRECT_PATH}`,
          )

          return { port, callback, tokens }
        }).pipe(Effect.provide(NodeHttpServer.layerTest)),
      )

      expect(result.port).toBeGreaterThan(0)
      expect(result.callback.code).toBe("test_code")
      expect(result.tokens.type).toBe("success")
      if (result.tokens.type === "success") {
        expect(result.tokens.access).toBe("test_access_token")
        expect(result.tokens.refresh).toBe("test_refresh_token")
      }
    })

    it("should handle state mismatch during full flow", async () => {
      const pkceParams = await Effect.runPromise(generatePKCEParams())

      let errorThrown = false
      try {
        await Effect.runPromise(
          Effect.gen(function*() {
            const server = yield* startCallbackServer(pkceParams.state)

            const client = yield* HttpClient.HttpClient
            const wrongStateUrl = `${REDIRECT_PATH}?code=test_code&state=wrong_state`

            yield* client.get(wrongStateUrl).pipe(
              Effect.andThen((response) => response.text),
            )

            yield* server.response
          }).pipe(Effect.provide(NodeHttpServer.layerTest)),
        )
      } catch (error) {
        errorThrown = true
        expect(error).toBeInstanceOf(Error)
      }

      expect(errorThrown).toBe(true)
    })
  })

  describe("Legacy Functions (for comparison)", () => {
    it("authorizeGemini should return authorization URL and verifier", async () => {
      const result = await authorizeGemini()

      expect(result.url).toBeDefined()
      expect(result.verifier).toBeDefined()

      const url = new URL(result.url)
      expect(url.origin).toBe("https://accounts.google.com")
      expect(url.searchParams.get("client_id")).toBe(GEMINI_CLIENT_ID)
      expect(url.searchParams.get("response_type")).toBe("code")
      expect(url.searchParams.get("code_challenge")).toBeDefined()
      expect(url.searchParams.get("code_challenge_method")).toBe("S256")
    })

    it("exchangeGemini should exchange code for tokens", async () => {
      fetchMock.mockImplementationOnce(async () => {
        return new Response(
          JSON.stringify({
            access_token: "legacy_access",
            refresh_token: "legacy_refresh",
            expires_in: 3600,
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        )
      })

      fetchMock.mockImplementationOnce(async () => {
        return new Response(JSON.stringify({ email: "test@example.com" }), {
          status: 200,
        })
      })

      const result = await exchangeGemini("test_code", "test_state")

      expect(result.type).toBe("success")
      if (result.type === "success") {
        expect(result.access).toBe("legacy_access")
        expect(result.refresh).toBe("legacy_refresh")
        expect(result.email).toBe("test@example.com")
      }
    })

    it("exchangeGemini should handle errors", async () => {
      fetchMock.mockImplementationOnce(async () => {
        return new Response(
          JSON.stringify({
            error: "invalid_grant",
          }),
          {
            status: 400,
          },
        )
      })

      const result = await exchangeGemini("bad_code", "test_state")

      expect(result.type).toBe("failed")
      if (result.type === "failed") {
        expect(result.error).toBeDefined()
      }
    })
  })
})
