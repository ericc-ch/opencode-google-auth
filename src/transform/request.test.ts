import { describe, expect, it } from "bun:test"
import { transformRequest } from "./request"
import { geminiCliConfig, ProviderConfig } from "../services/config"
import { Session } from "../services/session"
import { Effect, Layer, pipe } from "effect"

describe("transformRequest", () => {
  const baseParams = {
    accessToken: "test-token",
    projectId: "test-project-123",
  }

  const config = geminiCliConfig()

  const MockSession = Layer.succeed(
    Session,
    Session.of({
      getAccessToken: Effect.succeed(baseParams.accessToken),
      ensureProject: Effect.succeed({
        cloudaicompanionProject: baseParams.projectId,
        currentTier: {
          id: "free",
          name: "Free",
          description: "",
          userDefinedCloudaicompanionProject: false,
        },
        allowedTiers: [],
        gcpManaged: false,
        manageSubscriptionUri: "",
      }),
      setCredentials: () => Effect.void,
    } as unknown as Session),
  ).pipe(Layer.provideMerge(Layer.succeed(ProviderConfig, config)))

  const runTransform = (
    input: Parameters<typeof fetch>[0],
    init: Parameters<typeof fetch>[1],
    endpoint = "https://example.com",
  ) =>
    pipe(
      transformRequest(input, init, endpoint),
      Effect.provide(MockSession),
      Effect.runPromise,
    )

  describe("URL transformation", () => {
    it("transforms /v1beta/models/{model}:{action} to /v1internal:{action}", async () => {
      const result = await runTransform(
        "https://example.com/v1beta/models/gemini-2.5-pro:generateContent",
        undefined,
      )

      expect(result.input).toContain("/v1internal:generateContent")
      expect(result.streaming).toBe(false)
    })

    it("detects streaming requests", async () => {
      const result = await runTransform(
        "https://example.com/v1beta/models/gemini-2.5-pro:streamGenerateContent",
        undefined,
      )

      expect(result.input).toContain("/v1internal:streamGenerateContent")
      expect(result.input).toContain("alt=sse")
      expect(result.streaming).toBe(true)
    })

    it("passes through non-matching URLs", async () => {
      const url = "https://example.com/some/other/path"
      const result = await runTransform(url, undefined)

      expect(result.input).toBe(url)
      expect(result.streaming).toBe(false)
    })
  })

  describe("header transformation", () => {
    it("sets Authorization header", async () => {
      const result = await runTransform(
        "https://example.com/v1beta/models/gemini-2.5-pro:generateContent",
        {},
      )

      const headers = result.init.headers as Headers
      expect(headers.get("Authorization")).toBe("Bearer test-token")
    })

    it("removes x-api-key header", async () => {
      const result = await runTransform(
        "https://example.com/v1beta/models/gemini-2.5-pro:generateContent",
        {
          headers: {
            "x-api-key": "some-key",
            "x-goog-api-key": "another-key",
          },
        },
      )

      const headers = result.init.headers as Headers
      expect(headers.get("x-api-key")).toBeNull()
      expect(headers.get("x-goog-api-key")).toBeNull()
    })

    it("sets Accept header for streaming", async () => {
      const result = await runTransform(
        "https://example.com/v1beta/models/gemini-2.5-pro:streamGenerateContent",
        {},
      )

      const headers = result.init.headers as Headers
      expect(headers.get("Accept")).toBe("text/event-stream")
    })

    it("applies provider-specific headers", async () => {
      const result = await runTransform(
        "https://example.com/v1beta/models/gemini-2.5-pro:generateContent",
        {},
      )

      const headers = result.init.headers as Headers
      expect(headers.get("User-Agent")).toBe(
        config.HEADERS["User-Agent"] ?? null,
      )
      expect(headers.get("X-Goog-Api-Client")).toBe(
        config.HEADERS["X-Goog-Api-Client"] ?? null,
      )
    })
  })

  describe("body transformation", () => {
    it("wraps request body with project and model", async () => {
      const originalBody = JSON.stringify({ contents: [{ text: "Hello" }] })

      const result = await runTransform(
        "https://example.com/v1beta/models/gemini-2.5-pro:generateContent",
        { body: originalBody },
      )

      const body = JSON.parse(result.init.body as string)
      expect(body.project).toBe("test-project-123")
      expect(body.model).toBe("gemini-2.5-pro")
      expect(body.request).toEqual({ contents: [{ text: "Hello" }] })
    })

    it("preserves body if not JSON", async () => {
      const originalBody = "not-json"

      const result = await runTransform(
        "https://example.com/v1beta/models/gemini-2.5-pro:generateContent",
        { body: originalBody },
      )

      expect(result.init.body).toBe("not-json")
    })
  })

  describe("input types", () => {
    it("handles URL object", async () => {
      const url = new URL(
        "https://example.com/v1beta/models/gemini-2.5-pro:generateContent",
      )
      const result = await runTransform(url, undefined)

      expect(result.input).toContain("/v1internal:generateContent")
    })

    it("handles Request object", async () => {
      const request = new Request(
        "https://example.com/v1beta/models/gemini-2.5-pro:generateContent",
      )
      const result = await runTransform(request, undefined)

      expect(result.input).toContain("/v1internal:generateContent")
    })
  })
})
