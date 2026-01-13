/**
 * OAuth service
 *
 * Handles initial OAuth authentication flow only.
 * Token refresh is handled by the Session service.
 */

import {
  HttpRouter,
  HttpServer,
  HttpServerRequest,
  HttpServerResponse,
} from "@effect/platform"
import { BunHttpServer } from "@effect/platform-bun"
import { Data, Deferred, Effect, Fiber, Schema } from "effect"
import { OAuth2Client } from "google-auth-library"
import type { BunServeOptions } from "../types"
import { ProviderConfig } from "./config"
import open from "open"

export class OAuthError extends Data.TaggedError("OAuthError")<{
  readonly reason: "browser" | "callback" | "state_mismatch" | "token_exchange"
  readonly message: string
  readonly cause?: unknown
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

class OAuth extends Effect.Service<OAuth>()("OAuth", {
  effect: Effect.gen(function* () {
    const config = yield* ProviderConfig

    const client = new OAuth2Client({
      clientId: config.CLIENT_ID,
      clientSecret: config.CLIENT_SECRET,
    })
    const serverOptions: BunServeOptions = { port: 0 }
    const ServerLive = BunHttpServer.layerServer(serverOptions)

    const authenticate = Effect.gen(function* () {
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
        scope: config.SCOPES as unknown as string[],
        prompt: "consent",
      })

      yield* Effect.log(`OAuth2 authorization URL: ${authUrl}`)
      yield* Effect.tryPromise({
        try: () => open(authUrl),
        catch: (cause) =>
          new OAuthError({
            reason: "browser",
            message: "Failed to open browser",
            cause,
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
                  reason: "callback",
                  message: `${params.error} - ${params.error_description ?? "No additional details provided"}`,
                }),
              )
            } else {
              yield* Deferred.succeed(deferredParams, params)
            }

            return yield* HttpServerResponse.text("You may now close this tab.")
          }).pipe(Effect.tapError(Effect.logError)),
        ),
        HttpServer.serveEffect(),
        Effect.fork,
      )

      yield* Effect.log("Started OAuth2 callback server")

      const search = yield* Deferred.await(deferredParams)
      yield* Effect.log("Received OAuth2 callback with params", search)

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
    }).pipe(Effect.provide(ServerLive), Effect.scoped)

    return { authenticate }
  }),
}) {}

export { OAuth }
