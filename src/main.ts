import type { GoogleGenerativeAIProviderSettings } from "@ai-sdk/google"
import { HttpClient } from "@effect/platform"
import type { Plugin } from "@opencode-ai/plugin"
import { Effect } from "effect"
import { makeRuntime } from "./lib/runtime"
import {
  antigravityConfig,
  geminiCliConfig,
  ProviderConfig,
} from "./lib/services/config"
import { OAuth } from "./lib/services/oauth"
import { Session } from "./lib/services/session"
import { transformRequest } from "./transform/request"
import { transformNonStreamingResponse } from "./transform/response"
import { transformStreamingResponse } from "./transform/stream"
import type { Credentials, ModelsDev } from "./types"

const fetchModelsDev = Effect.gen(function* () {
  const client = yield* HttpClient.HttpClient
  const response = yield* client.get("https://models.dev/api.json")
  return (yield* response.json) as ModelsDev
})

const customFetch = Effect.fn(function* (
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1],
) {
  const config = yield* ProviderConfig

  let lastResponse: Response | null = null

  for (const endpoint of config.ENDPOINTS) {
    const result = yield* transformRequest(input, init, endpoint)

    const { request, ...loggedBody } = JSON.parse(result.init.body as string)
    const generationConfig = request.generationConfig

    yield* Effect.log(
      "Transformed request (Omitting request except generationConfig) :",
      result.streaming,
      result.input,
      { ...loggedBody, request: { generationConfig } },
    )

    const response = yield* Effect.promise(() =>
      fetch(result.input, result.init),
    )

    // On 429 or 403, try next endpoint
    if (response.status === 429 || response.status === 403) {
      yield* Effect.log(`${response.status} on ${endpoint}, trying next...`)
      lastResponse = response
      continue
    }

    if (!response.ok) {
      const cloned = response.clone()
      const clonedJson = yield* Effect.promise(() => cloned.json())

      yield* Effect.log(
        "Received response:",
        cloned.status,
        clonedJson,
        cloned.headers,
      )
    }

    return result.streaming ?
        yield* transformStreamingResponse(response)
      : yield* Effect.promise(() => transformNonStreamingResponse(response))
  }

  // All endpoints exhausted with 429
  yield* Effect.logWarning("All endpoints rate limited (429)")
  return lastResponse as Response
}, Effect.tapDefect(Effect.logError))

export const geminiCli: Plugin = async (context) => {
  const runtime = makeRuntime({
    openCodeCtx: context,
    providerConfig: geminiCliConfig(),
  })

  const config = await runtime.runPromise(
    Effect.gen(function* () {
      const providerConfig = yield* ProviderConfig
      const modelsDev = yield* fetchModelsDev

      return providerConfig.getConfig(modelsDev)
    }),
  )

  return {
    config: async (cfg) => {
      cfg.provider ??= {}
      cfg.provider[config.id as string] = config
    },
    auth: {
      provider: config.id as string,
      loader: async (getAuth) => {
        const auth = await getAuth()
        if (auth.type !== "oauth") return {}

        const credentials: Credentials = {
          access_token: auth.access,
          refresh_token: auth.refresh,
          expiry_date: auth.expires,
        }

        await runtime.runPromise(
          Effect.gen(function* () {
            const session = yield* Session
            yield* session.setCredentials(credentials)
          }),
        )

        return {
          apiKey: "",
          fetch: (async (input, init) => {
            const response = await runtime.runPromise(customFetch(input, init))
            return response
          }) as typeof fetch,
        } satisfies GoogleGenerativeAIProviderSettings
      },
      methods: [
        {
          type: "oauth",
          label: "OAuth with Google",
          authorize: async () => {
            const result = await runtime.runPromise(
              Effect.gen(function* () {
                const oauth = yield* OAuth
                return yield* oauth.authenticate
              }),
            )

            return {
              url: "",
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
                  provider: config.id as string,
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
  const runtime = makeRuntime({
    openCodeCtx: context,
    providerConfig: antigravityConfig(),
  })

  const config = await runtime.runPromise(
    Effect.gen(function* () {
      const providerConfig = yield* ProviderConfig
      const modelsDev = yield* fetchModelsDev

      return providerConfig.getConfig(modelsDev)
    }),
  )

  return {
    config: async (cfg) => {
      cfg.provider ??= {}
      cfg.provider[config.id as string] = config
    },
    auth: {
      provider: config.id as string,
      loader: async (getAuth) => {
        const auth = await getAuth()
        if (auth.type !== "oauth") return {}

        const credentials: Credentials = {
          access_token: auth.access,
          refresh_token: auth.refresh,
          expiry_date: auth.expires,
        }

        await runtime.runPromise(
          Effect.gen(function* () {
            const session = yield* Session
            yield* session.setCredentials(credentials)
          }),
        )

        return {
          apiKey: "",
          fetch: (async (input, init) => {
            const response = await runtime.runPromise(customFetch(input, init))
            return response
          }) as typeof fetch,
        } satisfies GoogleGenerativeAIProviderSettings
      },
      methods: [
        {
          type: "oauth",
          label: "OAuth with Google",
          authorize: async () => {
            const result = await runtime.runPromise(
              Effect.gen(function* () {
                const oauth = yield* OAuth
                return yield* oauth.authenticate
              }),
            )

            return {
              url: "",
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
                  provider: config.id as string,
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
