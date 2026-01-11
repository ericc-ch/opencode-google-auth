import { describe, expect, it } from "bun:test"
import { transformRequest } from "./request"
import { GEMINI_CLI_CONFIG } from "../lib/services/config"

describe("transformRequest", () => {
  const baseParams = {
    accessToken: "test-token",
    projectId: "test-project-123",
  }

  const config = GEMINI_CLI_CONFIG

  describe("URL transformation", () => {
    it("transforms /v1beta/models/{model}:{action} to /v1internal:{action}", () => {
      const result = transformRequest(
        {
          ...baseParams,
          input:
            "https://example.com/v1beta/models/gemini-2.5-pro:generateContent",
          init: undefined,
        },
        config,
      )

      expect(result.input).toContain("/v1internal:generateContent")
      expect(result.streaming).toBe(false)
    })

    it("detects streaming requests", () => {
      const result = transformRequest(
        {
          ...baseParams,
          input:
            "https://example.com/v1beta/models/gemini-2.5-pro:streamGenerateContent",
          init: undefined,
        },
        config,
      )

      expect(result.input).toContain("/v1internal:streamGenerateContent")
      expect(result.input).toContain("alt=sse")
      expect(result.streaming).toBe(true)
    })

    it("passes through non-matching URLs", () => {
      const url = "https://example.com/some/other/path"
      const result = transformRequest(
        {
          ...baseParams,
          input: url,
          init: undefined,
        },
        config,
      )

      expect(result.input).toBe(url)
      expect(result.streaming).toBe(false)
    })
  })

  describe("header transformation", () => {
    it("sets Authorization header", () => {
      const result = transformRequest(
        {
          ...baseParams,
          input:
            "https://example.com/v1beta/models/gemini-2.5-pro:generateContent",
          init: {},
        },
        config,
      )

      const headers = result.init.headers as Headers
      expect(headers.get("Authorization")).toBe("Bearer test-token")
    })

    it("removes x-api-key header", () => {
      const result = transformRequest(
        {
          ...baseParams,
          input:
            "https://example.com/v1beta/models/gemini-2.5-pro:generateContent",
          init: {
            headers: {
              "x-api-key": "some-key",
              "x-goog-api-key": "another-key",
            },
          },
        },
        config,
      )

      const headers = result.init.headers as Headers
      expect(headers.get("x-api-key")).toBeNull()
      expect(headers.get("x-goog-api-key")).toBeNull()
    })

    it("sets Accept header for streaming", () => {
      const result = transformRequest(
        {
          ...baseParams,
          input:
            "https://example.com/v1beta/models/gemini-2.5-pro:streamGenerateContent",
          init: {},
        },
        config,
      )

      const headers = result.init.headers as Headers
      expect(headers.get("Accept")).toBe("text/event-stream")
    })

    it("applies provider-specific headers", () => {
      const result = transformRequest(
        {
          ...baseParams,
          input:
            "https://example.com/v1beta/models/gemini-2.5-pro:generateContent",
          init: {},
        },
        config,
      )

      const headers = result.init.headers as Headers
      expect(headers.get("User-Agent")).toBe(config.HEADERS["User-Agent"])
      expect(headers.get("X-Goog-Api-Client")).toBe(
        config.HEADERS["X-Goog-Api-Client"],
      )
    })
  })

  describe("body transformation", () => {
    it("wraps request body with project and model", () => {
      const originalBody = JSON.stringify({ contents: [{ text: "Hello" }] })

      const result = transformRequest(
        {
          ...baseParams,
          input:
            "https://example.com/v1beta/models/gemini-2.5-pro:generateContent",
          init: { body: originalBody },
        },
        config,
      )

      const body = JSON.parse(result.init.body as string)
      expect(body.project).toBe("test-project-123")
      expect(body.model).toBe("gemini-2.5-pro")
      expect(body.request).toEqual({ contents: [{ text: "Hello" }] })
    })

    it("preserves body if not JSON", () => {
      const originalBody = "not-json"

      const result = transformRequest(
        {
          ...baseParams,
          input:
            "https://example.com/v1beta/models/gemini-2.5-pro:generateContent",
          init: { body: originalBody },
        },
        config,
      )

      expect(result.init.body).toBe("not-json")
    })
  })

  describe("input types", () => {
    it("handles URL object", () => {
      const url = new URL(
        "https://example.com/v1beta/models/gemini-2.5-pro:generateContent",
      )
      const result = transformRequest(
        {
          ...baseParams,
          input: url,
          init: undefined,
        },
        config,
      )

      expect(result.input).toContain("/v1internal:generateContent")
    })

    it("handles Request object", () => {
      const request = new Request(
        "https://example.com/v1beta/models/gemini-2.5-pro:generateContent",
      )
      const result = transformRequest(
        {
          ...baseParams,
          input: request,
          init: undefined,
        },
        config,
      )

      expect(result.input).toContain("/v1internal:generateContent")
    })
  })
})
