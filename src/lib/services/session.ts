import { HttpClient, HttpClientRequest } from "@effect/platform"
import { Data, Effect, Ref, Schema } from "effect"
import { OAuth2Client, type Credentials } from "google-auth-library"
import { CODE_ASSIST_VERSION, ProviderConfig } from "./config"
import { OpenCodeContext } from "./opencode"
import type { VeryRequired } from "../../types"

export class SessionError extends Data.TaggedError("SessionError")<{
  readonly reason:
    | "project_fetch"
    | "token_refresh"
    | "no_tokens"
    | "unauthorized"
  readonly message: string
  readonly cause?: unknown
}> {}

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

export class Session extends Effect.Service<Session>()("Session", {
  effect: Effect.gen(function* () {
    const config = yield* ProviderConfig
    const openCode = yield* OpenCodeContext
    const httpClient = yield* HttpClient.HttpClient

    const credentialsRef = yield* Ref.make<VeryRequired<Credentials> | null>(
      null,
    )
    const projectRef = yield* Ref.make<LoadCodeAssistResponse | null>(null)

    const endpoint = config.ENDPOINTS[0] ?? ""
    const oauthClient = new OAuth2Client({
      clientId: config.CLIENT_ID,
      clientSecret: config.CLIENT_SECRET,
    })

    const getCredentials = Effect.gen(function* () {
      const current = yield* Ref.get(credentialsRef)
      if (!current) {
        return yield* new SessionError({
          reason: "no_tokens",
          message: "No credentials set",
        })
      }

      return current
    })

    const refreshTokens = Effect.gen(function* () {
      const credentials = yield* getCredentials
      oauthClient.setCredentials(credentials)

      const result = yield* Effect.tryPromise({
        try: () => oauthClient.refreshAccessToken(),
        catch: (cause) =>
          new SessionError({
            reason: "token_refresh",
            message: "Failed to refresh access token",
            cause,
          }),
      })

      const newCredentials = result.credentials
      yield* Ref.set(
        credentialsRef,
        newCredentials as VeryRequired<Credentials>,
      )

      const accessToken = newCredentials.access_token
      const refreshToken = newCredentials.refresh_token
      const expiryDate = newCredentials.expiry_date

      if (accessToken && refreshToken && expiryDate) {
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
      }

      return newCredentials
    })

    const fetchProject = Effect.gen(function* () {
      const credentials = yield* getCredentials

      const request = yield* HttpClientRequest.post(
        `${endpoint}/${CODE_ASSIST_VERSION}:loadCodeAssist`,
      ).pipe(
        HttpClientRequest.bearerToken(credentials.access_token),
        HttpClientRequest.bodyJson({
          metadata: {
            ideType: "IDE_UNSPECIFIED",
            platform: "PLATFORM_UNSPECIFIED",
            pluginType: "GEMINI",
          },
        }),
      )

      const response = yield* httpClient.execute(request)

      if (response.status === 401) {
        return yield* new SessionError({
          reason: "unauthorized",
          message: "Token expired",
        })
      }

      if (response.status >= 400) {
        return yield* new SessionError({
          reason: "project_fetch",
          message: `HTTP error: ${response.status}`,
        })
      }

      const json = yield* response.json

      const body = yield* Schema.decodeUnknown(LoadCodeAssistResponse)(json)

      return body
    }).pipe(
      Effect.catchAll((cause) => {
        if (cause instanceof SessionError) {
          return Effect.fail(cause)
        }
        return Effect.fail(
          new SessionError({
            reason: "project_fetch",
            message: "Failed to fetch project",
            cause,
          }),
        )
      }),
    )

    const ensureProject = Effect.gen(function* () {
      const cached = yield* Ref.get(projectRef)
      if (cached !== null) {
        return cached
      }
      const project = yield* fetchProject
      yield* Ref.set(projectRef, project)
      return project
    })

    const getAccessToken = () =>
      Effect.gen(function* () {
        const currentCreds = yield* Ref.get(credentialsRef)

        if (!currentCreds?.access_token) {
          return yield* new SessionError({
            reason: "no_tokens",
            message: "No access token available",
          })
        }

        const buffer = 5 * 60 * 1000
        const isExpired = (currentCreds.expiry_date ?? 0) < Date.now() + buffer

        let accessToken = currentCreds.access_token

        if (isExpired) {
          yield* Effect.log("Access token expired, refreshing...")
          const refreshed = yield* refreshTokens
          if (!refreshed.access_token) {
            return yield* new SessionError({
              reason: "token_refresh",
              message: "Refresh did not return access token",
            })
          }
          accessToken = refreshed.access_token
        }

        yield* ensureProject
        return accessToken
      })

    return {
      setCredentials: (credentials: VeryRequired<Credentials>) =>
        Ref.set(credentialsRef, credentials),
      getAccessToken,
    }
  }),
}) {}
