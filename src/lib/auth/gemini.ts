import {
  HttpRouter,
  HttpServer,
  HttpServerRequest,
  HttpServerResponse,
} from "@effect/platform"
import { Data, Deferred, Effect, Fiber, pipe, Schema } from "effect"
import { OAuth2Client } from "google-auth-library"
import open from "open"

const OAUTH_CLIENT_ID =
  "681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com"
const OAUTH_CLIENT_SECRET = "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"
const OAUTH_SCOPE = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
]

const SIGN_IN_SUCCESS_URL =
  "https://developers.google.com/gemini-code-assist/auth_success_gemini"
const SIGN_IN_FAILURE_URL =
  "https://developers.google.com/gemini-code-assist/auth_failure_gemini"

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
  readonly _error: unknown
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

        const deferredParams = yield* Deferred.make<typeof ParamsSchema.Type>()

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
              const search =
                yield* HttpServerRequest.schemaSearchParams(ParamsSchema)

              yield* Deferred.succeed(deferredParams, search)

              if (isFailureParams(search)) {
                return yield* HttpServerResponse.redirect(SIGN_IN_FAILURE_URL)
              }

              return yield* HttpServerResponse.redirect(SIGN_IN_SUCCESS_URL)
            }).pipe(
              Effect.tapError(Effect.logError),
              Effect.catchAll(() =>
                HttpServerResponse.redirect(SIGN_IN_FAILURE_URL),
              ),
            ),
          ),
          HttpServer.serveEffect(),
          Effect.forkScoped,
        )

        yield* Deferred.await(deferredParams)
        yield* Fiber.interrupt(serverFiber)
      }),
    }
  },
}) {}

// if (isFailureParams(search)) {
//   return (
//     yield
//     * new OAuthError({
//       message: `${search.error} - ${search.error_description ?? "No additional details provided"}`,
//     })
//   )
// }

// if (state !== search.state) {
//   return (
//     yield
//     * new OAuthError({
//       message: "Invalid state parameter. Possible CSRF attack.",
//     })
//   )
// }

// const result =
//   yield
//   * Effect.tryPromise({
//     try: () =>
//       client.getToken({
//         code: search.code,
//         redirect_uri: redirectUri,
//       }),
//     catch: (error) =>
//       new OAuthError({
//         message: `Failed to get token: ${JSON.stringify(error)}`,
//       }),
//   })

// yield * Effect.log(result.tokens)

// return yield * HttpServerResponse.redirect(SIGN_IN_SUCCESS_URL)
