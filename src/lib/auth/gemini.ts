import {
  HttpRouter,
  HttpServer,
  HttpServerRequest,
  HttpServerResponse,
} from "@effect/platform"
import { BunHttpServer } from "@effect/platform-bun"
import {
  Context,
  Data,
  Deferred,
  Duration,
  Effect,
  Layer,
  Schema,
} from "effect"
import { OAuth2Client } from "google-auth-library"
import open from "open"
import {
  GEMINI_CLIENT_ID,
  GEMINI_CLIENT_SECRET,
  GEMINI_SCOPES,
} from "../../constants"

const SIGN_IN_SUCCESS_URL =
  "https://developers.google.com/gemini-code-assist/auth_success_gemini"
const SIGN_IN_FAILURE_URL =
  "https://developers.google.com/gemini-code-assist/auth_failure_gemini"

const HEADLESS_REDIRECT_URI = "https://codeassist.google.com/authcode"

export interface Tokens {
  accessToken: string
  refreshToken: string
  expiresAt: Date
}

export interface AuthOptions {
  headless?: boolean
  timeout?: number
}

export class OAuthStateMismatch extends Data.TaggedError("OAuthStateMismatch") {
  readonly message = "State parameter does not match"
}

export class OAuthCallbackError extends Data.TaggedError("OAuthCallbackError")<{
  readonly error: string
  readonly description?: string
}> {}

export class OAuthTokenExchangeFailed extends Data.TaggedError(
  "OAuthTokenExchangeFailed",
)<{
  readonly cause: unknown
}> {}

export class OAuthTimeout extends Data.TaggedError("OAuthTimeout") {
  readonly message = "Authentication timed out"
}

export class OAuthUserCancelled extends Data.TaggedError("OAuthUserCancelled") {
  readonly message = "User cancelled the authentication flow"
}

export type OAuthError =
  | OAuthStateMismatch
  | OAuthCallbackError
  | OAuthTokenExchangeFailed
  | OAuthTimeout
  | OAuthUserCancelled

const SuccessParamsSchema = Schema.Struct({
  code: Schema.String,
  state: Schema.String,
})

const FailureParamsSchema = Schema.Struct({
  error: Schema.String,
  error_description: Schema.optional(Schema.String),
  state: Schema.optional(Schema.String),
})

const ParamsSchema = Schema.Union(SuccessParamsSchema, FailureParamsSchema)

const make = Effect.gen(function* () {
  const detectHeadless = () => {
    return process.env.NO_BROWSER === "true"
  }

  // Revised Browser Flow
  const browserFlowRevised = (client: OAuth2Client, options?: AuthOptions) =>
    Effect.gen(function* () {
      const deferredCode = yield* Deferred.make<string, OAuthError>()
      const state = crypto.randomUUID()
      const deferredRedirectUri = yield* Deferred.make<string>()

      const router = HttpRouter.empty.pipe(
        HttpRouter.get(
          "/oauth2callback",
          Effect.gen(function* () {
            const params = yield* HttpServerRequest.schemaSearchParams(
              ParamsSchema,
            )

            if (params.state && params.state !== state) {
              yield* Deferred.fail(deferredCode, new OAuthStateMismatch())
              return yield* HttpServerResponse.empty({
                status: 301,
                headers: { Location: SIGN_IN_FAILURE_URL },
              })
            }

            if ("error" in params) {
              yield* Deferred.fail(
                deferredCode,
                new OAuthCallbackError({
                  error: params.error,
                  description: params.error_description,
                }),
              )
              return yield* HttpServerResponse.empty({
                status: 301,
                headers: { Location: SIGN_IN_FAILURE_URL },
              })
            }

            yield* Deferred.succeed(deferredCode, params.code)
            return yield* HttpServerResponse.empty({
              status: 301,
              headers: { Location: SIGN_IN_SUCCESS_URL },
            })
          }),
        ),
      )

      const serverEffect = Effect.gen(function* () {
        yield* HttpServer.logAddress
        const address = yield* HttpServer.address
        let redirectUri: string
        if (address._tag === "UnixAddress") {
          redirectUri = "http://localhost/oauth2callback"
        } else {
          redirectUri = `http://localhost:${address.port}/oauth2callback`
        }
        yield* Deferred.succeed(deferredRedirectUri, redirectUri)
        yield* router.pipe(HttpServer.serveEffect())
      })

      yield* serverEffect.pipe(
        Effect.provide(BunHttpServer.layer({ port: 0 })),
        Effect.forkScoped,
      )

      const redirectUri = yield* Deferred.await(deferredRedirectUri)

      const authUrl = client.generateAuthUrl({
        redirect_uri: redirectUri,
        access_type: "offline",
        scope: GEMINI_SCOPES,
        state,
      })

      yield* Effect.tryPromise(() => open(authUrl)).pipe(
        Effect.catchAll((e) => Effect.log("Failed to open browser: " + e)),
      )

      const code = yield* Deferred.await(deferredCode).pipe(
        Effect.timeoutFail({
          duration: Duration.millis(options?.timeout ?? 5 * 60 * 1000),
          onTimeout: () => new OAuthTimeout(),
        }),
      )

      const { tokens } = yield* Effect.tryPromise({
        try: () =>
          client.getToken({
            code,
            redirect_uri: redirectUri,
          }),
        catch: (e) => new OAuthTokenExchangeFailed({ cause: e }),
      })

      if (
        !tokens.access_token ||
        !tokens.refresh_token ||
        !tokens.expiry_date
      ) {
        return yield* Effect.fail(
          new OAuthTokenExchangeFailed({ cause: "Missing tokens" }),
        )
      }

      return {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: new Date(tokens.expiry_date),
      } as Tokens
    })

  const headlessFlow = (
    client: OAuth2Client,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    options?: AuthOptions,
  ): Effect.Effect<Tokens, OAuthError> =>
    Effect.gen(function* () {
      const codes = yield* Effect.promise(() =>
        client.generateCodeVerifierAsync(),
      )
      const state = crypto.randomUUID()

      const authUrl = client.generateAuthUrl({
        access_type: "offline",
        scope: GEMINI_SCOPES,
        state,
        redirect_uri: HEADLESS_REDIRECT_URI,
        code_challenge_method: "S256" as const,
        code_challenge: codes.codeChallenge,
      })

      // Prompt user
      yield* Effect.log("Please open the following URL in your browser:")
      yield* Effect.log(authUrl)
      yield* Effect.log("Enter the code from the page:")

      const readCode = Effect.async<string, OAuthUserCancelled>((resume) => {
        import("node:readline").then((readline) => {
          const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
          })
          rl.question("Code: ", (answer) => {
            rl.close()
            if (!answer.trim()) {
              resume(Effect.fail(new OAuthUserCancelled()))
            } else {
              resume(Effect.succeed(answer.trim()))
            }
          })
        })
      })

      const code = yield* readCode

      const { tokens } = yield* Effect.tryPromise({
        try: () =>
          client.getToken({
            code,
            redirect_uri: HEADLESS_REDIRECT_URI,
            codeVerifier: codes.codeVerifier,
          }),
        catch: (e) => new OAuthTokenExchangeFailed({ cause: e }),
      })

      if (
        !tokens.access_token ||
        !tokens.refresh_token ||
        !tokens.expiry_date
      ) {
        return yield* Effect.fail(
          new OAuthTokenExchangeFailed({ cause: "Missing tokens" }),
        )
      }

      return {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: new Date(tokens.expiry_date),
      }
    })

  return {
    authenticate: (options?: AuthOptions): Effect.Effect<Tokens, OAuthError> =>
      Effect.gen(function* () {
        const isHeadless = options?.headless ?? detectHeadless()
        const client = new OAuth2Client({
          clientId: GEMINI_CLIENT_ID,
          clientSecret: GEMINI_CLIENT_SECRET,
        })

        return yield* isHeadless ?
            headlessFlow(client, options)
          : browserFlowRevised(client, options)
      }).pipe(Effect.scoped), // Scope for server shutdown
  }
})

export class GeminiOAuth extends Context.Tag("GeminiOAuth")<
  GeminiOAuth,
  {
    authenticate: (options?: AuthOptions) => Effect.Effect<Tokens, OAuthError>
  }
>() {
  static Live = Layer.effect(GeminiOAuth, make)
}
