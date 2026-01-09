import type { GoogleGenerativeAIProviderSettings } from "@ai-sdk/google"
import { HttpClient } from "@effect/platform"
import { BunHttpServer } from "@effect/platform-bun"
import type { Plugin } from "@opencode-ai/plugin"
import { Effect, Exit, Layer, pipe, Scope } from "effect"
import { GeminiOAuth } from "./lib/auth/gemini"
import { SERVICE_NAME, SUPPORTED_MODELS } from "./lib/config"
import { transformRequest, transformResponse } from "./lib/fetch"
import { loadCodeAssist } from "./lib/project"
import { makeRuntime } from "./lib/runtime"
import fallbackModels from "./models.json"
import type { Credentials } from "google-auth-library"

const fetchModels = Effect.gen(function* () {
  const client = yield* HttpClient.HttpClient
  const response = yield* client.get("https://models.dev/api.json")
  const data = (yield* response.json) as Record<string, unknown>

  return data.google as typeof fallbackModels
}).pipe(Effect.catchAll(() => Effect.succeed(fallbackModels)))

export const main: Plugin = async (context) => {
  const runtime = makeRuntime(context)
  const googleConfig = await runtime.runPromise(fetchModels)

  const filteredModels = pipe(
    googleConfig.models,
    (models) => Object.entries(models),
    (entries) => entries.filter(([key]) => SUPPORTED_MODELS.includes(key)),
    (filtered) => Object.fromEntries(filtered),
  )

  return {
    config: async (config) => {
      config.provider ??= {}

      config.provider[SERVICE_NAME] = {
        ...googleConfig,
        id: SERVICE_NAME,
        name: "Gemini CLI",
        api: "https://cloudcode-pa.googleapis.com",
        // oxlint-disable-next-line typescript/no-explicit-any
        models: filteredModels as any,
      }
    },
    auth: {
      provider: SERVICE_NAME,
      loader: async (getAuth) => {
        const auth = await getAuth()
        if (auth.type !== "oauth") return {}

        const credentials: Credentials = {
          access_token: auth.access,
          refresh_token: auth.refresh,
          expiry_date: auth.expires,
        }

        const codeAssist = await pipe(
          credentials,
          loadCodeAssist,
          Effect.tapError(Effect.logError),
          runtime.runPromise,
        )
        const projectId = codeAssist.cloudaicompanionProject

        return {
          apiKey: "",
          fetch: (async (input, init) => {
            const currentAuth = await getAuth()
            if (currentAuth.type !== "oauth") {
              return fetch(input, init)
            }

            const transformed = transformRequest({
              input,
              init,
              accessToken: currentAuth.access,
              projectId,
            })

            const response = await fetch(transformed.input, transformed.init)
            return transformResponse({
              response,
              streaming: transformed.streaming,
            })
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
