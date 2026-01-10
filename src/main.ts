import type { GoogleGenerativeAIProviderSettings } from "@ai-sdk/google"
import { HttpClient } from "@effect/platform"
import type { Plugin } from "@opencode-ai/plugin"
import { Effect, Layer, pipe } from "effect"
import type { Credentials } from "google-auth-library"
import { loadCodeAssist } from "./lib/project"
import { makeProviderRuntime } from "./lib/runtime"
import {
  ANTIGRAVITY_CONFIG,
  ANTIGRAVITY_MODELS,
  AntigravityConfigLive,
  GEMINI_CLI_CONFIG,
  GEMINI_CLI_MODELS,
  GeminiCliConfigLive,
  ProviderConfig,
} from "./lib/services/config"
import { makeOAuthLive, OAuth } from "./lib/services/oauth"
import {
  AntigravityRequestTransformerLive,
  GeminiRequestTransformerLive,
  RequestTransformer,
} from "./lib/services/transform"
import fallbackModels from "./models.json"
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
  GeminiRequestTransformerLive,
)

const AntigravityLayer = Layer.mergeAll(
  AntigravityConfigLive,
  makeOAuthLive(ANTIGRAVITY_CONFIG),
  AntigravityRequestTransformerLive,
)

export const geminiCli: Plugin = async (context) => {
  const runtime = makeProviderRuntime(context, GeminiLayer)

  // Get config from the runtime environment
  const configService = await runtime.runPromise(ProviderConfig)

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
    config: async (config) => {
      config.provider ??= {}
      config.provider[configService.SERVICE_NAME] = {
        ...googleConfig,
        id: configService.SERVICE_NAME,
        name: configService.DISPLAY_NAME,
        api: configService.ENDPOINTS[0] ?? "",
        models: filteredModels as Record<string, OpenCodeModel>,
      }
    },
    auth: {
      provider: configService.SERVICE_NAME,
      loader: async (getAuth) => {
        const auth = await getAuth()
        if (auth.type !== "oauth") return {}

        const credentials: Credentials = {
          access_token: auth.access,
          refresh_token: auth.refresh,
          expiry_date: auth.expires,
        }

        const codeAssist = await pipe(
          loadCodeAssist(credentials),
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

            const transformer = await runtime.runPromise(RequestTransformer)
            const transformed = transformer.transformRequest({
              input,
              init,
              accessToken: currentAuth.access,
              projectId,
            })

            const response = await fetch(transformed.input, transformed.init)
            return transformer.transformResponse({
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
            const result = await runtime.runPromise(
              pipe(
                OAuth,
                Effect.flatMap((oauth) => oauth.authenticate()),
              ),
            )

            return {
              url: result.authUrl,
              method: "auto",
              instructions: "Complete the authentication in your browser.",
              callback: async () => {
                const callbackResult = await runtime.runPromise(
                  result.callback(),
                )

                const accessToken = callbackResult.access_token
                const refreshToken = callbackResult.refresh_token
                const expiryDate = callbackResult.expiry_date

                if (!accessToken || !refreshToken || !expiryDate) {
                  return { type: "failed" }
                }

                return {
                  type: "success",
                  provider: configService.SERVICE_NAME,
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

export const antigravity: Plugin = async (context) => {
  const runtime = makeProviderRuntime(context, AntigravityLayer)

  const configService = await runtime.runPromise(ProviderConfig)

  // Antigravity supports both Gemini and Claude models
  const googleConfig = await runtime.runPromise(fetchModels)
  const filteredModels = pipe(
    googleConfig.models,
    (models) => Object.entries(models),
    (entries) =>
      entries.filter(([key]) =>
        (ANTIGRAVITY_MODELS as readonly string[]).includes(key),
      ),
    (filtered) => Object.fromEntries(filtered),
  )

  return {
    config: async (config) => {
      config.provider ??= {}
      config.provider[configService.SERVICE_NAME] = {
        ...googleConfig,
        id: configService.SERVICE_NAME,
        name: configService.DISPLAY_NAME,
        api: configService.ENDPOINTS[0] ?? "", // Default to first endpoint
        models: filteredModels as Record<string, OpenCodeModel>,
      }
    },
    auth: {
      provider: configService.SERVICE_NAME,
      loader: async (getAuth) => {
        const auth = await getAuth()
        if (auth.type !== "oauth") return {}

        const credentials: Credentials = {
          access_token: auth.access,
          refresh_token: auth.refresh,
          expiry_date: auth.expires,
        }

        const codeAssist = await pipe(
          loadCodeAssist(credentials),
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

            const transformer = await runtime.runPromise(RequestTransformer)
            const transformed = transformer.transformRequest({
              input,
              init,
              accessToken: currentAuth.access,
              projectId,
            })

            const response = await fetch(transformed.input, transformed.init)

            return transformer.transformResponse({
              response,
              streaming: transformed.streaming,
            })
          }) as typeof fetch,
        } satisfies GoogleGenerativeAIProviderSettings
      },
      methods: [
        {
          type: "oauth",
          label: "OAuth with Antigravity",
          authorize: async () => {
            const result = await runtime.runPromise(
              pipe(
                OAuth,
                Effect.flatMap((oauth) => oauth.authenticate()),
              ),
            )

            return {
              url: result.authUrl,
              method: "auto",
              instructions: "Complete the authentication in your browser.",
              callback: async () => {
                const callbackResult = await runtime.runPromise(
                  result.callback(),
                )

                const accessToken = callbackResult.access_token
                const refreshToken = callbackResult.refresh_token
                const expiryDate = callbackResult.expiry_date

                if (!accessToken || !refreshToken || !expiryDate) {
                  return { type: "failed" }
                }

                return {
                  type: "success",
                  provider: configService.SERVICE_NAME,
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
