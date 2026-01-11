import type { GoogleGenerativeAIProviderSettings } from "@ai-sdk/google"
import { HttpClient } from "@effect/platform"
import type { Plugin } from "@opencode-ai/plugin"
import { Effect, Layer, pipe } from "effect"
import type { Credentials } from "google-auth-library"
import { makeRuntime } from "./lib/runtime"
import {
  GEMINI_CLI_CONFIG,
  GEMINI_CLI_MODELS,
  GeminiCliConfigLive,
  ProviderConfig,
} from "./lib/services/config"
import { makeOAuthLive, OAuth } from "./lib/services/oauth"
import fallbackModels from "./models.json"
import { transformRequest } from "./transform/request"
import { transformNonStreamingResponse } from "./transform/response"
import { transformStreamingResponse } from "./transform/stream"
import type { OpenCodeModel } from "./types"

const fetchModels = Effect.gen(function* () {
  const client = yield* HttpClient.HttpClient
  const response = yield* client.get("https://models.dev/api.json")
  const data = (yield* response.json) as Record<string, unknown>
  return data.google as typeof fallbackModels
}).pipe(Effect.catchAll(() => Effect.succeed(fallbackModels)))

const GeminiLayer = Layer.mergeAll(
  GeminiCliConfigLive,
  makeOAuthLive(GEMINI_CLI_CONFIG),
)

export const geminiCli: Plugin = async (context) => {
  const runtime = makeRuntime(context, GeminiLayer)
  const config = await runtime.runPromise(ProviderConfig)

  const googleConfig = await runtime.runPromise(fetchModels)
  const filteredModels = pipe(
    googleConfig.models,
    (models) => Object.entries(models),
    (entries) =>
      entries.filter(([key]) =>
        (GEMINI_CLI_MODELS as readonly string[]).includes(key),
      ),
    (filtered) => Object.fromEntries(filtered),
  )

  return {
    config: async (cfg) => {
      cfg.provider ??= {}
      cfg.provider[config.SERVICE_NAME] = {
        ...googleConfig,
        id: config.SERVICE_NAME,
        name: config.DISPLAY_NAME,
        api: config.ENDPOINTS[0] ?? "",
        models: filteredModels as Record<string, OpenCodeModel>,
      }
    },
    auth: {
      provider: config.SERVICE_NAME,
      loader: async (getAuth) => {
        const auth = await getAuth()
        if (auth.type !== "oauth") return {}

        const credentials: Credentials = {
          access_token: auth.access,
          refresh_token: auth.refresh,
          expiry_date: auth.expires,
        }

        const session = await runtime.runPromise(
          makeSession(credentials).pipe(Effect.provide(runtime.context)),
        )

        return {
          apiKey: "",
          fetch: (async (input, init) => {
            const accessToken = await runtime.runPromise(
              session.getAccessToken().pipe(Effect.provide(runtime.context)),
            )

            const result = transformRequest(
              { input, init, accessToken, projectId: session.projectId },
              config,
            )

            const response = await fetch(result.input, result.init)

            return result.streaming ?
                await Effect.runPromise(transformStreamingResponse(response))
              : await transformNonStreamingResponse(response)
          }) as typeof fetch,
        } satisfies GoogleGenerativeAIProviderSettings
      },
      methods: [
        {
          type: "oauth",
          label: "OAuth with Google",
          authorize: async () => {
            const result = await runtime.runPromise(
              pipe(
                OAuth,
                Effect.flatMap((oauth) => oauth.authenticate()),
              ),
            )

            return {
              url: "Authentication complete",
              method: "auto",
              instructions: "You are now authenticated!",
              callback: async () => {
                const accessToken = result.access_token
                const refreshToken = result.refresh_token
                const expiryDate = result.expiry_date

                if (!accessToken || !refreshToken || !expiryDate) {
                  return { type: "failed" }
                }

                return {
                  type: "success",
                  provider: config.SERVICE_NAME,
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
