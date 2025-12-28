import {
  HttpRouter,
  HttpServer,
  HttpServerRequest,
  HttpServerResponse,
} from "@effect/platform"
import {
  Console,
  Data,
  Deferred,
  Effect,
  Schema,
} from "effect"
import { OAuth2Client } from "google-auth-library"
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer"
import open from "open"
import * as crypto from "node:crypto"
import {
  GEMINI_CLIENT_ID,
  GEMINI_CLIENT_SECRET,
  GEMINI_SCOPES,
  SIGN_IN_FAILURE_URL,
  SIGN_IN_SUCCESS_URL,
  HEADLESS_REDIRECT_URI
} from "../constants"

export interface AuthOptions {
  /** Force headless mode (auto-detected from NO_BROWSER env if not set) */
  readonly headless?: boolean
  /** Timeout in milliseconds (default: 5 minutes) */
  readonly timeout?: number
}

export interface Tokens {
  readonly accessToken: string
  readonly refreshToken: string
  /** Expiration timestamp */
  readonly expiresAt: Date
}

export class OAuthError extends Data.TaggedError("OAuthError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

export class OAuthStateMismatch extends Data.TaggedError("OAuthStateMismatch")<{
  readonly message: string
}> {}

export class OAuthCallbackError extends Data.TaggedError("OAuthCallbackError")<{
  readonly message: string
  readonly error: string
  readonly description?: string
}> {}

export class OAuthTokenExchangeFailed extends Data.TaggedError(
  "OAuthTokenExchangeFailed",
)<{
  readonly message: string
  readonly cause?: unknown
}> {}

export class OAuthTimeout extends Data.TaggedError("OAuthTimeout")<{
  readonly message: string
}> {}

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

export class GeminiOAuth extends Effect.Service<GeminiOAuth>()("GeminiOAuth", {
  effect: Effect.gen(function* () {
    const detectHeadless = () => {
      return process.env.NO_BROWSER === "true"
    }

    const exchangeCode = (
      client: OAuth2Client,
      code: string,
      redirectUri: string,
      codeVerifier?: string,
    ) =>
      Effect.tryPromise({
        try: async () => {
          const { tokens } = await client.getToken({
            code,
            redirect_uri: redirectUri,
            codeVerifier,
          })
          return tokens
        },
        catch: (error) =>
          new OAuthTokenExchangeFailed({
            message: "Failed to exchange code for tokens",
            cause: error,
          }),
      }).pipe(
        Effect.flatMap((tokens) => {
          if (!tokens.access_token || !tokens.refresh_token) {
            return Effect.fail(
              new OAuthTokenExchangeFailed({
                message: "Missing access or refresh token",
              }),
            )
          }
          return Effect.succeed({
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token,
            expiresAt: new Date(tokens.expiry_date ?? Date.now() + 3600 * 1000),
          })
        }),
      )

    const browserFlow = (client: OAuth2Client, timeout: number) =>
      Effect.gen(function* () {
        const deferredParams = yield* Deferred.make<
          typeof SuccessParamsSchema.Type,
          OAuthCallbackError | OAuthStateMismatch
        >()

        const state = crypto.randomUUID()

        const router = HttpRouter.empty.pipe(
          HttpRouter.get(
            "/oauth2callback",
            Effect.gen(function* () {
              const params =
                yield* HttpServerRequest.schemaSearchParams(ParamsSchema)

              if (isFailureParams(params)) {
                const error = new OAuthCallbackError({
                  message: "OAuth callback returned error",
                  error: params.error,
                  description: params.error_description,
                })
                yield* Deferred.fail(deferredParams, error)
                return yield* HttpServerResponse.redirect(SIGN_IN_FAILURE_URL)
              }

              if (params.state !== state) {
                const error = new OAuthStateMismatch({
                  message: "State parameter mismatch",
                })
                yield* Deferred.fail(deferredParams, error)
                return yield* HttpServerResponse.redirect(SIGN_IN_FAILURE_URL)
              }

              yield* Deferred.succeed(deferredParams, params)
              return yield* HttpServerResponse.redirect(SIGN_IN_SUCCESS_URL)
            }).pipe(Effect.tapError(Effect.logError)),
          ),
        )

        // Force host to 127.0.0.1 for strict redirect URI matching
        const ServerLive = NodeHttpServer.layer(
          () => import("http").then((m) => m.createServer()),
          { port: 0, host: "127.0.0.1" },
        )

        return yield* Effect.gen(function* () {
          yield* router.pipe(HttpServer.serveEffect(), Effect.forkScoped)

          const redirectUri = yield* HttpServer.addressFormattedWith((address) => {
             const url = new URL(address)
             url.hostname = "localhost"
             return Effect.succeed(`${url.toString()}oauth2callback`)
          })

          const authUrl = client.generateAuthUrl({
            state,
            redirect_uri: redirectUri,
            access_type: "offline",
            scope: GEMINI_SCOPES,
            prompt: "consent",
          })

          yield* Effect.tryPromise({
            try: () => open(authUrl),
            catch: (error) =>
              new OAuthError({
                message: "Failed to open browser",
                cause: error,
              }),
          })

          const params = yield* Deferred.await(deferredParams).pipe(
            Effect.timeoutFail({
              duration: timeout,
              onTimeout: () =>
                new OAuthTimeout({ message: "Authentication timed out" }),
            }),
          )

          return { code: params.code, redirectUri }
        }).pipe(
            Effect.provide(ServerLive),
            Effect.scoped // Ensure server is shutdown after flow completes
        )
      }).pipe(
        Effect.flatMap(({ code, redirectUri }) =>
          exchangeCode(client, code, redirectUri),
        ),
      )

    const headlessFlow = (client: OAuth2Client, timeout: number) =>
      Effect.gen(function* () {
        const codeVerifier = crypto.randomBytes(32).toString("base64url")
        const codeChallenge = crypto
          .createHash("sha256")
          .update(codeVerifier)
          .digest("base64url")
        const state = crypto.randomUUID()

        const authUrl = client.generateAuthUrl({
          state,
          redirect_uri: HEADLESS_REDIRECT_URI,
          access_type: "offline",
          scope: GEMINI_SCOPES,
          code_challenge: codeChallenge,
          code_challenge_method: "S256",
          prompt: "consent",
        })

        yield* Console.log("Please visit the following URL to authorize:")
        yield* Console.log(authUrl)
        yield* Console.log("Enter the authorization code:")

        const readLine = Effect.tryPromise(
          () =>
            new Promise<string>((resolve) => {
              import("readline").then((readline) => {
                const iface = readline.createInterface({
                  input: process.stdin,
                  output: process.stdout,
                })
                iface.question("", (answer) => {
                  iface.close()
                  resolve(answer.trim())
                })
              })
            }),
        )

        const code = yield* readLine.pipe(
          Effect.timeoutFail({
            duration: timeout,
            onTimeout: () =>
              new OAuthTimeout({ message: "Authentication timed out" }),
          }),
        )

        if (!code) {
          return yield* Effect.fail(
            new OAuthError({ message: "No code provided" }),
          )
        }

        return yield* exchangeCode(
          client,
          code,
          HEADLESS_REDIRECT_URI,
          codeVerifier,
        )
      })

    const refreshTokens = (client: OAuth2Client, refreshToken: string) =>
        Effect.tryPromise({
            try: async () => {
                client.setCredentials({ refresh_token: refreshToken })
                const { tokens } = await client.refreshAccessToken()
                return tokens
            },
            catch: (error) => new OAuthTokenExchangeFailed({
                message: "Failed to refresh token",
                cause: error
            })
        }).pipe(
            Effect.flatMap((tokens) => {
                if (!tokens.access_token) {
                     return Effect.fail(new OAuthTokenExchangeFailed({ message: "No access token returned from refresh" }))
                }
                return Effect.succeed({
                    accessToken: tokens.access_token,
                    refreshToken: tokens.refresh_token ?? refreshToken,
                    expiresAt: new Date(tokens.expiry_date ?? Date.now() + 3600 * 1000)
                })
            })
        )

    return {
      authenticate: (options?: AuthOptions) =>
        Effect.gen(function* () {
          const client = new OAuth2Client({
            clientId: GEMINI_CLIENT_ID,
            clientSecret: GEMINI_CLIENT_SECRET,
          })

          const isHeadless = options?.headless ?? detectHeadless()
          const timeout = options?.timeout ?? 5 * 60 * 1000

          if (isHeadless) {
            return yield* headlessFlow(client, timeout)
          } else {
            return yield* browserFlow(client, timeout)
          }
        }),
      refresh: (refreshToken: string) =>
        Effect.gen(function*() {
             const client = new OAuth2Client({
                clientId: GEMINI_CLIENT_ID,
                clientSecret: GEMINI_CLIENT_SECRET,
            })
            return yield* refreshTokens(client, refreshToken)
        })
    }
  }),
}) {}
