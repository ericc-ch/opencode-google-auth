import type { GoogleGenerativeAIProviderOptions } from "@ai-sdk/google"
import { Context, Effect, pipe } from "effect"
import type {
  ModelsDev,
  OpenCodeModel,
  OpenCodeProvider,
  Provider,
} from "../types"

export interface WrappedBody {
  readonly project: string
  readonly request: unknown
  readonly model: string
}

export interface RequestContext {
  readonly body: WrappedBody
  readonly headers: Headers
  readonly url: URL
}

export interface ProviderConfigShape {
  readonly SERVICE_NAME: string
  readonly DISPLAY_NAME: string
  readonly ENDPOINTS: readonly string[]
  readonly HEADERS: Readonly<Record<string, string>>
  readonly SCOPES: readonly string[]
  readonly CLIENT_ID: string
  readonly CLIENT_SECRET: string
  readonly getConfig: (modelsDev: ModelsDev) => OpenCodeProvider
  readonly transformRequest?: (context: RequestContext) => Effect.Effect<{
    body: Record<string, unknown>
    headers: Headers
    url: URL
  }>
}

export class ProviderConfig extends Context.Tag("ProviderConfig")<
  ProviderConfig,
  ProviderConfigShape
>() {}

export const PLUGIN_NAME = "opencode-google-auth"
export const CODE_ASSIST_VERSION = "v1internal"
export const CLIENT_METADATA = {
  ideType: "IDE_UNSPECIFIED",
  platform: "PLATFORM_UNSPECIFIED",
  pluginType: "GEMINI",
} as const

export const GEMINI_CLI_MODELS = [
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-3-pro-preview",
  "gemini-3-flash-preview",
] as const

export const ANTIGRAVITY_MODELS = [
  "gemini-3-flash",
  "gemini-3-pro-low",
  "gemini-3-pro-high",
  "claude-sonnet-4-5",
  "claude-sonnet-4-5-thinking",
  "claude-opus-4-5-thinking",
] as const

export const geminiCliConfig = (): ProviderConfigShape => ({
  SERVICE_NAME: "gemini-cli",
  DISPLAY_NAME: "Gemini CLI",
  CLIENT_ID:
    "681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com",
  CLIENT_SECRET: "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",
  SCOPES: [
    "https://www.googleapis.com/auth/cloud-platform",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
  ],
  ENDPOINTS: ["https://cloudcode-pa.googleapis.com"],
  HEADERS: {
    "User-Agent": "google-api-nodejs-client/9.15.1",
    "X-Goog-Api-Client": "gl-node/22.17.0",
    "Client-Metadata":
      "ideType=IDE_UNSPECIFIED,platform=PLATFORM_UNSPECIFIED,pluginType=GEMINI",
  },
  getConfig: (modelsDev) => {
    const provider = modelsDev.google as Provider
    const filteredModels = pipe(
      provider.models,
      (models) => Object.entries(models),
      (entries) =>
        entries.filter(([key]) =>
          (GEMINI_CLI_MODELS as readonly string[]).includes(key),
        ),
      (filtered) => Object.fromEntries(filtered),
    )

    return {
      ...provider,
      id: geminiCliConfig().SERVICE_NAME,
      name: geminiCliConfig().DISPLAY_NAME,
      api: geminiCliConfig().ENDPOINTS.at(0) as string,
      models: filteredModels as Record<string, OpenCodeModel>,
    }
  },
})

export const antigravityConfig = (): ProviderConfigShape => ({
  SERVICE_NAME: "antigravity",
  DISPLAY_NAME: "Antigravity",
  CLIENT_ID:
    "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com",
  CLIENT_SECRET: "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",
  SCOPES: [
    "https://www.googleapis.com/auth/cloud-platform",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
    "https://www.googleapis.com/auth/cclog",
    "https://www.googleapis.com/auth/experimentsandconfigs",
  ],
  ENDPOINTS: [
    "https://daily-cloudcode-pa.sandbox.googleapis.com",
    "https://autopush-cloudcode-pa.sandbox.googleapis.com",
    "https://cloudcode-pa.googleapis.com",
  ],
  HEADERS: {
    "User-Agent": "antigravity/1.11.5 windows/amd64",
    "X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
    "Client-Metadata":
      '{"ideType":"IDE_UNSPECIFIED","platform":"PLATFORM_UNSPECIFIED","pluginType":"GEMINI"}',
  },
  getConfig: (modelsDev) => {
    const googleProvider = modelsDev.google as Provider
    const googleVertextProvider = modelsDev[
      "google-vertex-anthropic"
    ] as Provider

    const geminiFlash = googleProvider.models[
      "gemini-3-flash-preview"
    ] as OpenCodeModel
    const geminiPro = googleProvider.models[
      "gemini-3-pro-preview"
    ] as OpenCodeModel
    const claudeSonnet = googleVertextProvider.models[
      "claude-sonnet-4-5@20250929"
    ] as OpenCodeModel
    const claudeOpus = googleVertextProvider.models[
      "claude-opus-4-5@20251101"
    ] as OpenCodeModel

    const models: Record<string, OpenCodeModel> = {
      "gemini-3-flash": {
        ...geminiFlash,
        id: "gemini-3-flash",
      },
      "gemini-3-pro-low": {
        ...geminiPro,
        id: "gemini-3-pro-low",
        name: "Gemini 3 Pro (Low)",
        options: {
          thinkingConfig: {
            thinkingLevel: "low",
          },
        } satisfies GoogleGenerativeAIProviderOptions,
      },
      "gemini-3-pro-high": {
        ...geminiPro,
        id: "gemini-3-pro-high",
        name: "Gemini 3 Pro (High)",
        temperature: false,
        options: {
          thinkingConfig: {
            thinkingLevel: "high",
          },
        } satisfies GoogleGenerativeAIProviderOptions,
      },
      "claude-sonnet-4-5": {
        ...claudeSonnet,
        id: "claude-sonnet-4-5",
        reasoning: false,
        options: {
          thinkingConfig: {
            includeThoughts: false,
          },
        } satisfies GoogleGenerativeAIProviderOptions,
      },
      "claude-sonnet-4-5-thinking": {
        ...claudeSonnet,
        id: "claude-sonnet-4-5-thinking",
        name: "Claude Sonnet 4.5 (Reasoning)",
      },
      "claude-opus-4-5-thinking": {
        ...claudeOpus,
        id: "claude-opus-4-5-thinking",
        name: "Claude Opus 4.5 (Reasoning)",
      },
    }

    return {
      ...googleProvider,
      id: antigravityConfig().SERVICE_NAME,
      name: antigravityConfig().DISPLAY_NAME,
      api: antigravityConfig().ENDPOINTS.at(2) as string,
      models,
    }
  },
  transformRequest: Effect.fn(function* (context) {
    yield* Effect.log(
      "Transforming request for: ",
      antigravityConfig().SERVICE_NAME,
    )

    const { body, headers, url } = context
    const innerRequest = body.request as Record<string, unknown>

    let sessionId: string | undefined
    if (
      innerRequest.labels
      && typeof innerRequest.labels === "object"
      && "sessionId" in innerRequest.labels
    ) {
      const labels = innerRequest.labels as Record<string, unknown>
      sessionId = labels.sessionId as string
      delete labels.sessionId
      if (Object.keys(labels).length === 0) {
        delete innerRequest.labels
      }
    }

    // Handle thinkingConfig for Claude models
    const isClaude = body.model.toLowerCase().includes("claude")
    const isThinking = body.model.toLowerCase().includes("thinking")

    if (isClaude && body.request && typeof body.request === "object") {
      const request = body.request as Record<string, unknown>
      const generationConfig = request.generationConfig as
        | Record<string, unknown>
        | undefined

      innerRequest.toolConfig = {
        functionCallingConfig: {
          mode: "VALIDATED",
        },
      }

      // For non-thinking Claude, remove thinkingConfig entirely
      if (!isThinking && generationConfig?.thinkingConfig) {
        delete generationConfig.thinkingConfig
      }

      // For thinking Claude, convert camelCase to snake_case and add default budget
      if (isThinking && generationConfig?.thinkingConfig) {
        const thinkingConfig = generationConfig.thinkingConfig as Record<
          string,
          unknown
        >

        if (thinkingConfig.includeThoughts !== undefined) {
          thinkingConfig.include_thoughts = thinkingConfig.includeThoughts
          delete thinkingConfig.includeThoughts
        }

        if (thinkingConfig.thinkingBudget !== undefined) {
          thinkingConfig.thinking_budget = thinkingConfig.thinkingBudget
          delete thinkingConfig.thinkingBudget
        }

        // Add default thinking_budget if not present (required for Claude thinking)
        if (thinkingConfig.thinking_budget === undefined) {
          thinkingConfig.thinking_budget = 32768 // Default to high tier
        }
      }

      if (isThinking) {
        headers.set("anthropic-beta", "interleaved-thinking-2025-05-14")
      }
    }

    if (sessionId) {
      innerRequest.sessionId = sessionId
    }

    return {
      headers,
      url,
      body: {
        requestType: "agent",
        userAgent: "antigravity",
        requestId: `agent-${crypto.randomUUID()}`,
        ...body,
      },
    }
  }),
})
