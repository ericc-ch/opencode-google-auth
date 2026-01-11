import type { GoogleGenerativeAIProviderSettings } from "@ai-sdk/google"
import { HttpClient } from "@effect/platform"
import type { Plugin } from "@opencode-ai/plugin"
import { Effect, pipe } from "effect"
import { makeRuntime } from "./lib/runtime"
import { GEMINI_CLI_CONFIG, GEMINI_CLI_MODELS } from "./lib/services/config"
import { OAuth } from "./lib/services/oauth"
import { Session } from "./lib/services/session"
import fallbackModels from "./models.json"
import { transformRequest } from "./transform/request"
import { transformNonStreamingResponse } from "./transform/response"
import { transformStreamingResponse } from "./transform/stream"
import type { Credentials, OpenCodeModel } from "./types"

const fetchModels = Effect.gen(function* () {
  const client = yield* HttpClient.HttpClient
  const response = yield* client.get("https://models.dev/api.json")
  const data = (yield* response.json) as Record<string, unknown>
  return data.google as typeof fallbackModels
}).pipe(Effect.catchAll(() => Effect.succeed(fallbackModels)))

export const geminiCli: Plugin = async (context) => {
  const runtime = makeRuntime({
    openCodeCtx: context,
    providerConfig: GEMINI_CLI_CONFIG,
  })

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
      cfg.provider[GEMINI_CLI_CONFIG.SERVICE_NAME] = {
        ...googleConfig,
        id: GEMINI_CLI_CONFIG.SERVICE_NAME,
        name: GEMINI_CLI_CONFIG.DISPLAY_NAME,
        api: GEMINI_CLI_CONFIG.ENDPOINTS[0] ?? "",
        models: filteredModels as Record<string, OpenCodeModel>,
      }
    },
    auth: {
      provider: GEMINI_CLI_CONFIG.SERVICE_NAME,
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
            const { accessToken, project } = await runtime.runPromise(
              Effect.gen(function* () {
                const session = yield* Session
                const accessToken = yield* session.getAccessToken
                const project = yield* session.ensureProject

                return {
                  accessToken,
                  project,
                }
              }),
            )
            await context.client.app.log({
              body: {
                level: "info",
                message: JSON.stringify({ accessToken, project, input, init }),
                service: GEMINI_CLI_CONFIG.SERVICE_NAME,
              },
            })

            const result = transformRequest(
              {
                accessToken,
                projectId: project.cloudaicompanionProject,
                input,
                init,
              },
              GEMINI_CLI_CONFIG,
            )

            await context.client.app.log({
              body: {
                level: "info",
                message: JSON.stringify(result),
                service: GEMINI_CLI_CONFIG.SERVICE_NAME,
              },
            })
            const response = await fetch(result.input, result.init)

            return result.streaming ?
                await runtime.runPromise(transformStreamingResponse(response))
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
                  provider: GEMINI_CLI_CONFIG.SERVICE_NAME,
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
