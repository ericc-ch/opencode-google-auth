import {
  HttpRouter,
  HttpServer,
  HttpServerRequest,
  HttpServerResponse,
} from "@effect/platform"
import { BunHttpServer, BunRuntime } from "@effect/platform-bun"
import { Deferred, Effect, pipe, Schema } from "effect"
import { OAuth2Client } from "google-auth-library"
import open from "open"

const OAUTH_CLIENT_ID =
  "681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com"

const OAUTH_CLIENT_SECRET = "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"

// OAuth Scopes for Cloud Code authorization.
const OAUTH_SCOPE = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
]

const HTTP_REDIRECT = 301
const SIGN_IN_SUCCESS_URL =
  "https://developers.google.com/gemini-code-assist/auth_success_gemini"
const SIGN_IN_FAILURE_URL =
  "https://developers.google.com/gemini-code-assist/auth_failure_gemini"

const SuccessParamsSchema = Schema.Struct({
  code: Schema.String,
  state: Schema.String,
})
const isSuccessParams = Schema.is(SuccessParamsSchema)

const FailureParamsSchema = Schema.Struct({
  error: Schema.String,
  error_description: Schema.optional(Schema.String),
  state: Schema.optional(Schema.String),
})
const isFailureParams = Schema.is(FailureParamsSchema)

const ParamsSchema = Schema.Union(SuccessParamsSchema, FailureParamsSchema)

const main = Effect.gen(function* () {
  yield* HttpServer.logAddress

  const deferredSearch = yield* Deferred.make<typeof ParamsSchema.Type>()
  const redirectUri = yield* HttpServer.addressFormattedWith((address) =>
    Effect.succeed(`${address}/oauth2callback`),
  )

  const client = new OAuth2Client({
    clientId: OAUTH_CLIENT_ID,
    clientSecret: OAUTH_CLIENT_SECRET,
  })

  const state = crypto.randomUUID()
  const authUrl = client.generateAuthUrl({
    redirect_uri: redirectUri,
    access_type: "offline",
    scope: OAUTH_SCOPE,
    state,
  })

  yield* Effect.promise(() => open(authUrl))

  yield* pipe(
    HttpRouter.empty,
    HttpRouter.get(
      "/oauth2callback",
      Effect.gen(function* () {
        const search = yield* HttpServerRequest.schemaSearchParams(ParamsSchema)
        yield* Deferred.succeed(deferredSearch, search)
        return yield* HttpServerResponse.text("Ok")
      }),
    ),
    HttpServer.serveEffect(),
  )

  yield* Deferred.await(deferredSearch)
})

const serveOptions = {
  port: 0,
} satisfies Partial<Bun.Serve.Options<undefined, never>>
const ServerLive = BunHttpServer.layer(serveOptions)

BunRuntime.runMain(pipe(main, Effect.scoped, Effect.provide(ServerLive)))
