import { FetchHttpClient, HttpClient } from "@effect/platform"
import { BunHttpServer } from "@effect/platform-bun"
import type { Plugin } from "@opencode-ai/plugin"
import { Effect, Exit, Layer, pipe, Scope } from "effect"
import { GeminiOAuth } from "./lib/auth/gemini"
import { Runtime } from "./lib/runtime"
import fallbackModels from "./models.json"

const PROVIDER_NAME = "gemini-cli"

const SUPPORTED_MODELS = [
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-3-pro-preview",
  "gemini-3-flash-preview",
]

const fetchModels = Effect.gen(function* () {
  const client = yield* HttpClient.HttpClient
  const response = yield* client.get("https://models.dev/api.json")
  const data = (yield* response.json) as Record<string, unknown>

  return data.google as typeof fallbackModels
}).pipe(
  Effect.provide(FetchHttpClient.layer),
  Effect.catchAll(() => Effect.succeed(fallbackModels)),
)

export const main: Plugin = async (_ctx) => {
  const googleConfig = await Runtime.runPromise(fetchModels)

  const filteredModels = Object.fromEntries(
    Object.entries(googleConfig.models).filter(([key]) =>
      SUPPORTED_MODELS.includes(key),
    ),
  )

  return {
    config: async (config) => {
      config.provider ??= {}

      config.provider[PROVIDER_NAME] = {
        ...googleConfig,
        name: "Gemini CLI",
        id: PROVIDER_NAME,
        api: "https://cloudcode-pa.googleapis.com",
        models: filteredModels as any,
      }
    },
    auth: {
      provider: "gemini-cli",
      loader: async (getAuth, provider) => {
        const auth = await getAuth()
        if (auth.type !== "oauth") return {}

        // I imagine we're gonna get the persisted tokens here
        // Check expiry, refresh if needed, etc.

        return {} satisfies Partial<typeof provider>
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

            const result = await Runtime.runPromise(
              Effect.gen(function* () {
                const googleOAuth = yield* GeminiOAuth

                return yield* googleOAuth.authenticate({
                  openBrowser: true,
                })
              }).pipe(Effect.provide(Server)),
            )

            return {
              url: result.authUrl,
              method: "auto",
              instructions: "Open that, dipshit",
              callback: async () => {
                const callbackResult = await Runtime.runPromise(
                  result.callback(),
                ).finally(() => Scope.close(serverScope, Exit.void))

                const accessToken = callbackResult.access_token
                const refreshToken = callbackResult.refresh_token
                const expiryDate = callbackResult.expiry_date

                if (!accessToken || !refreshToken || !expiryDate) {
                  return { type: "failed" }
                }

                return {
                  type: "success",
                  provider: PROVIDER_NAME,
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
