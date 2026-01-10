import { HttpClient, HttpClientRequest } from "@effect/platform"
import { Data, Effect, pipe, Ref } from "effect"
import type { Credentials } from "google-auth-library"
import { ProviderConfig } from "./config"
import { OAuth, OAuthError } from "./oauth"
import { OpenCodeContext } from "./opencode"

export class NoTokensError extends Data.TaggedError("NoTokensError")<{}> {}

export class TokenRefreshError extends Data.TaggedError("TokenRefreshError")<{
  readonly cause: OAuthError
}> {}

export class TokenManager extends Effect.Service<TokenManager>()(
  "TokenManager",
  {
    effect: Effect.gen(function* () {
      const tokensRef = yield* Ref.make<Credentials | null>(null)
      const baseClient = yield* HttpClient.HttpClient
      const oauth = yield* OAuth
      const config = yield* ProviderConfig
      const openCode = yield* OpenCodeContext

      const refresh = Effect.gen(function* () {
        const current = yield* Ref.get(tokensRef)
        if (!current) {
          return yield* new NoTokensError()
        }

        const newTokens = yield* oauth
          .refresh(current)
          .pipe(Effect.mapError((e) => new TokenRefreshError({ cause: e })))

        yield* Ref.set(tokensRef, newTokens)
        yield* Effect.promise(() =>
          openCode.client.auth.set({
            path: { id: config.SERVICE_NAME },
            body: {
              type: "oauth",
              access: newTokens.access_token!,
              refresh: newTokens.refresh_token!,
              expires: newTokens.expiry_date!,
            },
          }),
        )

        return newTokens
      })

      const client = pipe(
        baseClient,
        HttpClient.mapRequestInputEffect((req) =>
          Effect.gen(function* () {
            const tokens = yield* Ref.get(tokensRef)
            if (tokens?.access_token) {
              return HttpClientRequest.bearerToken(req, tokens.access_token)
            }
            return yield* new NoTokensError()
          }),
        ),
      )

      return {
        get: Ref.get(tokensRef),
        set: (tokens: Credentials) => Ref.set(tokensRef, tokens),
        refresh,
        client,
      }
    }),
  },
) {}
