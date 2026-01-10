import {
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from "@effect/platform"
import { Data, Effect, pipe, Schema } from "effect"
import type { Credentials } from "google-auth-library"
import { ProviderConfig } from "./services/config"
import { OAuth } from "./services/oauth"
import { OpenCodeContext } from "./services/opencode"

class TokenExpiredError extends Data.TaggedError("TokenExpiredError")<{}> {}

const CodeAssistTier = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.String,
  userDefinedCloudaicompanionProject: Schema.Boolean,
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
  const oauth = yield* OAuth
  const config = yield* ProviderConfig
  const openCode = yield* OpenCodeContext

  const makeRequest = (currentTokens: Credentials) => {
    // Ensure we have a valid endpoint
    const endpoint = config.ENDPOINTS[0] ?? ""
    const version = "v1internal" // We can add this to config if needed, but it's constant for now

    return pipe(
      HttpClientRequest.post(`${endpoint}/${version}:loadCodeAssist`),
      HttpClientRequest.setHeader(
        "Authorization",
        `Bearer ${currentTokens.access_token}`,
      ),
      // We assume metadata structure is compatible or we move it to config
      // config.HEADERS has some metadata, but :loadCodeAssist might expect specific body
      // The original code used CLIENT_METADATA.
      // Let's assume we can construct it or it's not strictly required to be exactly the same object constant if we pass the same values.
      // Actually, let's just use a simple object here matching what's expected.
      HttpClientRequest.bodyJson({
        metadata: {
          ideType: "IDE_UNSPECIFIED",
          platform: "PLATFORM_UNSPECIFIED",
          pluginType: "GEMINI",
        },
      }),
      Effect.andThen((req) => client.execute(req)),
      Effect.andThen(
        HttpClientResponse.matchStatus({
          "2xx": (res) =>
            HttpClientResponse.schemaBodyJson(LoadCodeAssistResponse)(res),
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
    )
  }

  return yield* pipe(
    makeRequest(tokens),
    Effect.catchTag("TokenExpiredError", () =>
      Effect.gen(function* () {
        const newTokens = yield* oauth.refresh(tokens)

        const accessToken = newTokens.access_token
        const refreshToken = newTokens.refresh_token
        const expiryDate = newTokens.expiry_date

        if (!accessToken || !refreshToken || !expiryDate) {
          return yield* Effect.fail("Failed to refresh tokens")
        }

        yield* Effect.promise(() =>
          openCode.client.auth.set({
            path: { id: config.SERVICE_NAME },
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
