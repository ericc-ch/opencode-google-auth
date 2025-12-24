import {
  HttpRouter,
  HttpServer,
  HttpServerRequest,
  HttpServerResponse,
} from "@effect/platform"
import {} from "eff"
import { Effect, pipe, Schema } from "effect"
import { OAuth2Client } from "google-auth-library"

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

const client = new OAuth2Client({
  clientId: OAUTH_CLIENT_ID,
  clientSecret: OAUTH_CLIENT_SECRET,
})

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

const router = HttpRouter.empty.pipe(
  HttpRouter.get(
    "/",
    Effect.gen(function* () {
      const query = yield* HttpServerRequest.schemaSearchParams(ParamsSchema)

      if (isSuccessParams(query)) {
        Effect.log("Success:", query)
      } else if (isFailureParams(query)) {
        Effect.log("Failure:", query)
      } else {
        // What the fuck is wrong with the query params???
      }

      return HttpServerResponse.text("Ok")
    }),
  ),
)

const main = Effect.gen(function* () {})

const tonot = HttpServer.serveEffect(router)
