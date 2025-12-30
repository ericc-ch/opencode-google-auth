import {
  HttpRouter,
  HttpServer,
  HttpServerRequest,
  HttpServerResponse,
} from "@effect/platform"
import { Data, Deferred, Effect, Fiber, Schema } from "effect"
import { OAuth2Client, type Credentials } from "google-auth-library"
import open from "open"

const OAUTH_CLIENT_ID =
  "681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com"
const OAUTH_CLIENT_SECRET = "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"
const OAUTH_SCOPE = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
]

const SuccessParamsSchema = Schema.Struct({
  code: Schema.String,
  state: Schema.String,
})

const FailureParamsSchema = Schema.Struct({
  error: Schema.String,
  error_description: Schema.optional(Schema.String),
  state: Schema.optional(Schema.String),
})
const isFailureParams = Schema.is(FailureParamsSchema)

const ParamsSchema = Schema.Union(SuccessParamsSchema, FailureParamsSchema)

export class GoogleOAuth2Client extends Effect.Service<GoogleOAuth2Client>()(
  "GoogleOAuth2Client",
  {
    sync: () =>
      new OAuth2Client({
        clientId: OAUTH_CLIENT_ID,
        clientSecret: OAUTH_CLIENT_SECRET,
      }),
  },
) {}

export class OAuthError extends Data.TaggedError("OAuthError")<{
  readonly reason:
    | "browser"
    | "callback"
    | "state_mismatch"
    | "token_exchange"
    | "token_refresh"
  readonly message: string
  readonly cause?: unknown
}> {}

export interface AuthenticateOptions {
  openBrowser?: boolean
}

export class GeminiOAuth extends Effect.Service<GeminiOAuth>()("GeminiOAuth", {
  dependencies: [GoogleOAuth2Client.Default],
  scoped: Effect.gen(function* () {
    const client = yield* GoogleOAuth2Client

    return {
      authenticate: Effect.fn(function* (options?: AuthenticateOptions) {
        const openBrowser = options?.openBrowser ?? true

        yield* HttpServer.logAddress

        const deferredParams = yield* Deferred.make<
          typeof SuccessParamsSchema.Type,
          OAuthError
        >()

        const redirectUri = yield* HttpServer.addressFormattedWith((address) =>
          Effect.succeed(`${address}/oauth2callback`),
        )
        const state = crypto.randomUUID()

        const authUrl = client.generateAuthUrl({
          state,
          redirect_uri: redirectUri,
          access_type: "offline",
          scope: OAUTH_SCOPE,
        })

        if (openBrowser) {
          yield* Effect.tryPromise({
            try: () => open(authUrl),
            catch: (cause) =>
              new OAuthError({
                reason: "browser",
                message: "Failed to open browser",
                cause,
              }),
          })
        }

        const serverFiber = yield* HttpRouter.empty.pipe(
          HttpRouter.get(
            "/oauth2callback",
            Effect.gen(function* () {
              const params =
                yield* HttpServerRequest.schemaSearchParams(ParamsSchema)

              if (isFailureParams(params)) {
                yield* Deferred.fail(
                  deferredParams,
                  new OAuthError({
                    reason: "callback",
                    message: `${params.error} - ${params.error_description ?? "No additional details provided"}`,
                  }),
                )
              } else {
                yield* Deferred.succeed(deferredParams, params)
              }

              return yield* HttpServerResponse.text(
                "You may now close this tab now.",
              )
            }).pipe(Effect.tapError(Effect.logError)),
          ),
          HttpServer.serveEffect(),
          Effect.fork,
        )

        const callback = Effect.fn(function* () {
          const search = yield* Deferred.await(deferredParams)
          yield* Fiber.interrupt(serverFiber)

          if (state !== search.state) {
            return yield* new OAuthError({
              reason: "state_mismatch",
              message: "Invalid state parameter. Possible CSRF attack.",
            })
          }

          const result = yield* Effect.tryPromise({
            try: () =>
              client.getToken({
                code: search.code,
                redirect_uri: redirectUri,
              }),
            catch: (cause) =>
              new OAuthError({
                reason: "token_exchange",
                message: "Failed to exchange authorization code for tokens",
                cause,
              }),
          })

          return result.tokens
        })

        return {
          authUrl,
          callback,
        }
      }, Effect.scoped),

      refresh: Effect.fn(function* (tokens: Credentials) {
        client.setCredentials(tokens)

        const result = yield* Effect.tryPromise({
          try: () => client.getAccessToken(),
          catch: (cause) =>
            new OAuthError({
              reason: "token_refresh",
              message: "Failed to refresh access token",
              cause,
            }),
        })

        if (result.token) return result.token

        return yield* new OAuthError({
          reason: "token_refresh",
          message: "Failed to get access token - no token returned",
        })
      }),
    }
  }),
}) {}
