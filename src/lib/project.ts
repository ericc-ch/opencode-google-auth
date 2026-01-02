import {
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from "@effect/platform"
import { Data, Effect, pipe, Schema } from "effect"
import type { Credentials } from "google-auth-library"
import { GeminiOAuth } from "./auth/gemini"
import {
  CLIENT_METADATA,
  CODE_ASSIST_ENDPOINT,
  CODE_ASSIST_VERSION,
  SERVICE_NAME,
} from "./config"
import { OpenCodeContext } from "./opencode"

class TokenExpiredError extends Data.TaggedError("TokenExpiredError")<{}> {}

const PrivacyNotice = Schema.Struct({})

const CodeAssistTier = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.String,
  userDefinedCloudaicompanionProject: Schema.Boolean,
  privacyNotice: PrivacyNotice,
  isDefault: Schema.optional(Schema.Boolean),
})

const LoadCodeAssistResponse = Schema.Struct({
  currentTier: CodeAssistTier,
  allowedTiers: Schema.Array(CodeAssistTier),
  cloudaicompanionProject: Schema.String,
  gcpManaged: Schema.Boolean,
  manageSubscriptionUri: Schema.String,
})

export type LoadCodeAssistResponse = typeof LoadCodeAssistResponse.Type

export class ProjectError extends Data.TaggedError("ProjectError")<{
  readonly reason: "client_error" | "server_error" | "unknown"
  readonly status?: number
  readonly response: HttpClientResponse.HttpClientResponse
}> {}

export const loadCodeAssist = Effect.fn(function* (tokens: Credentials) {
  const client = yield* HttpClient.HttpClient
  const gemini = yield* GeminiOAuth
  const openCode = yield* OpenCodeContext

  const makeRequest = (currentTokens: Credentials) =>
    pipe(
      HttpClientRequest.post(
        `${CODE_ASSIST_ENDPOINT}/${CODE_ASSIST_VERSION}:loadCodeAssist`,
      ),
      HttpClientRequest.setHeader(
        "Authorization",
        `Bearer ${currentTokens.access_token}`,
      ),
      HttpClientRequest.bodyJson({ metadata: CLIENT_METADATA }),
      Effect.andThen((req) => client.execute(req)),
      Effect.andThen(
        HttpClientResponse.matchStatus({
          "2xx": (res) => res.json,
          401: () => new TokenExpiredError(),
          "4xx": (res) =>
            new ProjectError({
              reason: "client_error",
              status: res.status,
              response: res,
            }),
          "5xx": (res) =>
            new ProjectError({
              reason: "server_error",
              status: res.status,
              response: res,
            }),
          orElse: (res) =>
            new ProjectError({
              reason: "unknown",
              status: res.status,
              response: res,
            }),
        }),
      ),
      Effect.andThen(Schema.decodeUnknown(LoadCodeAssistResponse)),
    )

  return yield* pipe(
    makeRequest(tokens),
    Effect.catchTag("TokenExpiredError", () =>
      Effect.gen(function* () {
        const newTokens = yield* gemini.refresh(tokens)

        const accessToken = newTokens.access_token
        const refreshToken = newTokens.refresh_token
        const expiryDate = newTokens.expiry_date

        if (!accessToken || !refreshToken || !expiryDate) {
          return yield* Effect.fail("Failed to refresh tokens")
        }

        yield* Effect.promise(() =>
          openCode.client.auth.set({
            path: { id: SERVICE_NAME },
            body: {
              type: "oauth",
              access: accessToken,
              refresh: refreshToken,
              expires: expiryDate,
            },
          }),
        )

        return yield* makeRequest(newTokens)
      }),
    ),
  )
})
