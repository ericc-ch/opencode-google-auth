import type { GoogleGenerativeAIProviderSettings } from "@ai-sdk/google"
import { FetchHttpClient, HttpClient } from "@effect/platform"
import { BunHttpServer } from "@effect/platform-bun"
import type { Plugin } from "@opencode-ai/plugin"
import { Effect, Exit, Layer, pipe, Scope } from "effect"
import { GeminiOAuth } from "./lib/auth/gemini"
import { SERVICE_NAME, SUPPORTED_MODELS } from "./lib/config"
import { makeRuntime } from "./lib/runtime"
import fallbackModels from "./models.json"
import { makeFetch } from "./lib/fetch"

const fetchModels = Effect.gen(function* () {
  const client = yield* HttpClient.HttpClient
  const response = yield* client.get("https://models.dev/api.json")
  const data = (yield* response.json) as Record<string, unknown>

  return data.google as typeof fallbackModels
}).pipe(
  Effect.provide(FetchHttpClient.layer),
  Effect.catchAll(() => Effect.succeed(fallbackModels)),
)

export const main: Plugin = async (context) => {
  const runtime = makeRuntime(context)
  const googleConfig = await runtime.runPromise(fetchModels)

  const filteredModels: typeof googleConfig.models = pipe(
    googleConfig.models,
    Object.entries,
    (entries) => entries.filter(([key]) => SUPPORTED_MODELS.includes(key)),
    Object.fromEntries,
  )

  return {
    config: async (config) => {
      config.provider ??= {}

      config.provider[SERVICE_NAME] = {
        ...googleConfig,
        id: SERVICE_NAME,
        name: "Gemini CLI",
        api: "https://cloudcode-pa.googleapis.com",
        models: filteredModels as any,
      }
    },
    auth: {
      provider: SERVICE_NAME,
      loader: async (getAuth) => {
        const auth = await getAuth()
        if (auth.type !== "oauth") return {}

        // I imagine we're gonna get the persisted tokens here
        // Check expiry, refresh if needed, etc.

        return {
          fetch: (async (input, init) => {
            const response = await runtime.runPromise(makeFetch(input, init))
            return response
          }) as typeof fetch,
        } satisfies GoogleGenerativeAIProviderSettings
      },
      methods: [
        {
          type: "oauth",
          label: "OAuth with Google",
          authorize: async () => {
            const serverOptions = { port: 0 } satisfies Partial<
              Bun.Serve.Options<undefined, never>
            >
            const serverScope = Effect.runSync(Scope.make())

            const Server = await pipe(
              BunHttpServer.layerServer(serverOptions),
              Layer.buildWithScope(serverScope),
              Effect.runPromise,
            )

            const result = await pipe(
              GeminiOAuth,
              Effect.andThen((oauth) => oauth.authenticate()),
              Effect.provide(Server),
              runtime.runPromise,
            )

            return {
              url: result.authUrl,
              method: "auto",
              instructions: "Open that, dipshit",
              callback: async () => {
                const callbackResult = await runtime
                  .runPromise(result.callback())
                  .finally(() => Scope.close(serverScope, Exit.void))

                const accessToken = callbackResult.access_token
                const refreshToken = callbackResult.refresh_token
                const expiryDate = callbackResult.expiry_date

                if (!accessToken || !refreshToken || !expiryDate) {
                  return { type: "failed" }
                }

                return {
                  type: "success",
                  provider: SERVICE_NAME,
                  access: accessToken,
                  refresh: refreshToken,
                  expires: expiryDate,
                }
              },
            }
          },
        },
      ],
    },
  }
}
