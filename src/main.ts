import { HttpClient } from "@effect/platform"
import type { Plugin } from "@opencode-ai/plugin"
import type {
  GoogleGenerativeAIProviderOptions,
  GoogleGenerativeAIProviderSettings,
} from "cloudassist-ai-provider"
import { Effect } from "effect"
import { makeRuntime } from "./lib/runtime"
import { geminiCliConfig, ProviderConfig } from "./services/config"
import { OAuth } from "./services/oauth"
import { Session } from "./services/session"
import type { Credentials, FetchInit, FetchInput, ModelsDev } from "./types"

const fetchModelsDev = Effect.gen(function* () {
  const client = yield* HttpClient.HttpClient
  const response = yield* client.get("https://models.dev/api.json")
  return (yield* response.json) as ModelsDev
})

const customFetch = Effect.fn(function* (input: FetchInput, init: FetchInit) {
  const config = yield* ProviderConfig
  const session = yield* Session

  let lastResponse: Response | null = null

  for (const endpoint of config.ENDPOINTS) {
    yield* Effect.log("Trying endpoint", endpoint)
    yield* Effect.log("Input", input)
    yield* Effect.log("Init", init)

    let finalInitObj: FetchInit
    const [finalInput, finalInit0] = config.requestTransform?.(input, init) ?? [
      input,
      init,
    ]
    if (finalInit0 !== undefined) {
      finalInitObj = finalInit0
    } else if (init !== undefined) {
      finalInitObj = init
    } else {
      finalInitObj = {}
    }

    const accessToken = yield* session.getAccessToken

    const authHeaders: Record<string, string> = {}
    if (finalInitObj.headers) {
      for (const [key, value] of Object.entries(finalInitObj.headers)) {
        authHeaders[key] = value as string
      }
    }
    authHeaders.Authorization = `Bearer ${accessToken}`

    const authInit: FetchInit = {
      ...finalInitObj,
      headers: authHeaders,
    }

    const response = yield* Effect.promise(() => fetch(finalInput, authInit))

    // On 429 or 403, try next endpoint
    if (response.status === 429 || response.status === 403) {
      lastResponse = response
      continue
    }

    if (!response.ok) {
      const cloned = response.clone()
      const clonedJson = yield* Effect.promise(() => cloned.json())

      yield* Effect.logWarning(
        "Received response:",
        cloned.status,
        clonedJson,
        cloned.headers,
      )
    }

    return response
  }

  yield* Effect.logError("All endpoints are rate limited (429)")
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
          apiKey: auth.access,
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
    "chat.params": async (input, output) => {
      const options = await runtime.runPromise(
        Effect.gen(function* () {
          const session = yield* Session
          const project = yield* session.ensureProject
          const projectId = project.cloudaicompanionProject

          return {
            projectId,
          }
        }),
      )

      if (config.id === input.model.providerID) {
        output.options = {
          ...output.options,
          projectId: options.projectId,
        } satisfies GoogleGenerativeAIProviderOptions
      }

      await runtime.runPromise(
        Effect.log("chat.params", config.id, input.model, output),
      )
    },
  }
}

// export const antigravity: Plugin = async (context) => {
//   const runtime = makeRuntime({
//     openCodeCtx: context,
//     providerConfig: antigravityConfig(),
//   })

//   const config = await runtime.runPromise(
//     Effect.gen(function* () {
//       const providerConfig = yield* ProviderConfig
//       const modelsDev = yield* fetchModelsDev

//       const config = providerConfig.getConfig(modelsDev)
//       yield* Effect.log("Config initialized", config.id)

//       return config
//     }),
//   )

//   return {
//     config: async (cfg) => {
//       cfg.provider ??= {}
//       cfg.provider[config.id as string] = config
//     },
//     auth: {
//       provider: config.id as string,
//       loader: async (getAuth) => {
//         const auth = await getAuth()
//         if (auth.type !== "oauth") return {}

//         const credentials: Credentials = {
//           access_token: auth.access,
//           refresh_token: auth.refresh,
//           expiry_date: auth.expires,
//         }

//         await runtime.runPromise(
//           Effect.gen(function* () {
//             const session = yield* Session
//             yield* session.setCredentials(credentials)
//           }),
//         )

//         return {
//           apiKey: auth.access,
//           fetch: (async (input, init) => {
//             const response = await runtime.runPromise(customFetch(input, init))
//             return response
//           }) as typeof fetch,
//         } satisfies GoogleGenerativeAIProviderSettings
//       },
//       methods: [
//         {
//           type: "oauth",
//           label: "OAuth with Google",
//           authorize: async () => {
//             const result = await runtime.runPromise(
//               Effect.gen(function* () {
//                 const oauth = yield* OAuth
//                 return yield* oauth.authenticate
//               }),
//             )

//             return {
//               url: "",
//               method: "auto",
//               instructions: "You are now authenticated!",
//               callback: async () => {
//                 const accessToken = result.access_token
//                 const refreshToken = result.refresh_token
//                 const expiryDate = result.expiry_date

//                 if (!accessToken || !refreshToken || !expiryDate) {
//                   return { type: "failed" }
//                 }

//                 return {
//                   type: "success",
//                   provider: config.id as string,
//                   access: accessToken,
//                   refresh: refreshToken,
//                   expires: expiryDate,
//                 }
//               },
//             }
//           },
//         },
//       ],
//     },
//     "experimental.chat.system.transform": async (input, output) => {
//       output.system.unshift(antigravitySpoof)
//     },
//     "chat.params": async (input, output) => {
//       const requestId = crypto.randomUUID()

//       const options = await runtime.runPromise(
//         Effect.gen(function* () {
//           const session = yield* Session
//           const project = yield* session.ensureProject
//           const projectId = project.cloudaicompanionProject

//           return {
//             projectId,
//           }
//         }),
//       )

//       if (config.id === input.model.providerID) {
//         output.options = {
//           ...output.options,
//           userAgent: "antigravity",
//           requestType: "agent",
//           requestId: `agent-${requestId}`,
//           sessionId: input.sessionID,
//           projectId: options.projectId,
//         } satisfies GoogleGenerativeAIProviderOptions
//       }

//       await runtime.runPromise(
//         Effect.log("chat.params", config.id, input.model, output),
//       )
//     },
//   }
// }
