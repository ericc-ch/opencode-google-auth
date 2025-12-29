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

class OAuthError extends Data.TaggedError("OAuthError")<{
  readonly _error?: unknown
  readonly message: string
}> {}

export class GeminiOAuth extends Effect.Service<GeminiOAuth>()("GeminiOAuth", {
  sync: () => {
    const client = new OAuth2Client({
      clientId: OAUTH_CLIENT_ID,
      clientSecret: OAUTH_CLIENT_SECRET,
    })

    return {
      authenticate: Effect.fn(function* () {
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

        yield* Effect.tryPromise({
          try: () => open(authUrl),
          catch: (error) =>
            new OAuthError({
              _error: error,
              message: "Failed to open browser",
            }),
        })

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

        const search = yield* Deferred.await(deferredParams)
        yield* Fiber.interrupt(serverFiber)

        if (state !== search.state) {
          return yield* new OAuthError({
            message: "Invalid state parameter. Possible CSRF attack.",
          })
        }

        const result = yield* Effect.tryPromise({
          try: () =>
            client.getToken({
              code: search.code,
              redirect_uri: redirectUri,
            }),
          catch: (error) =>
            new OAuthError({
              message: `Failed to get token: ${JSON.stringify(error)}`,
            }),
        })

        return result.tokens
      }, Effect.scoped),

      refresh: Effect.fn(function* (tokens: Credentials) {
        client.setCredentials(tokens)

        const result = yield* Effect.tryPromise({
          try: () => client.getAccessToken(),
          catch: (error) =>
            new OAuthError({
              message: `Failed to get token: ${JSON.stringify(error)}`,
            }),
        })

        if (result.token) return result.token

        return yield* new OAuthError({
          message: `Failed to get access token for some goddamn reason. ${JSON.stringify(result.res)}`,
        })
      }),
    }
  },
}) {}
