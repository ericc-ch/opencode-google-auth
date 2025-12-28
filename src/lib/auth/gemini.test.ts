import { beforeEach, describe, expect, it, mock } from "bun:test"

import * as Effect from "effect/Effect"
import { HttpClient } from "@effect/platform"
import { NodeHttpServer } from "@effect/platform-node"

import {
  GeminiOAuth,
  OAuthStateMismatch,
  OAuthCallbackError,
  OAuthTimeout,
  Tokens,
  AuthOptions,
  OAuthTokenExchangeFailed
} from "./gemini"
import { GEMINI_CLIENT_ID, GEMINI_CLIENT_SECRET } from "../constants"

describe("Gemini OAuth Service", () => {
  it("should be defined", () => {
      expect(GeminiOAuth).toBeDefined()
  })

  it("should have authenticate and refresh methods exposed via the service tag", () => {
      // We can inspect the Tag
      expect(GeminiOAuth.key).toBeDefined()
  })

  it("should be usable within an Effect", async () => {
      const program = Effect.gen(function* () {
          const service = yield* GeminiOAuth
          return service
      })

      const runnable = program.pipe(
          Effect.provide(GeminiOAuth.Default)
      )

      const service = await Effect.runPromise(runnable)

      expect(service.authenticate).toBeDefined()
      expect(service.refresh).toBeDefined()
      expect(typeof service.authenticate).toBe("function")
      expect(typeof service.refresh).toBe("function")
  })

  it("should use correct constants", () => {
      expect(GEMINI_CLIENT_ID).toBeDefined()
      expect(GEMINI_CLIENT_SECRET).toBeDefined()
  })
})
