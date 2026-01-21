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
  readonly skipRequestTransform?: boolean
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
      npm: "cloudassist-ai-provider",
      models: filteredModels as Record<string, OpenCodeModel>,
    }
  },
  skipRequestTransform: false,
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

    const models: Record<
      string,
      OpenCodeModel & {
        variants?: Record<string, Record<string, unknown>>
      }
    > = {
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
        name: "Claude Sonnet 4.5 (Thinking)",
        options: {
          thinkingConfig: {
            includeThoughts: true,
            thinkingBudget: 31999,
          },
        } satisfies GoogleGenerativeAIProviderOptions,
        variants: {
          high: {
            thinkingConfig: {
              includeThoughts: true,
              thinkingBudget: 16000,
            },
          } satisfies GoogleGenerativeAIProviderOptions,
          max: {
            thinkingConfig: {
              includeThoughts: true,
              thinkingBudget: 31999,
            },
          } satisfies GoogleGenerativeAIProviderOptions,
        },
      },
      "claude-opus-4-5-thinking": {
        ...claudeOpus,
        id: "claude-opus-4-5-thinking",
        name: "Claude Opus 4.5 (Thinking)",
        options: {
          thinkingConfig: {
            includeThoughts: true,
            thinkingBudget: 31999,
          },
        } satisfies GoogleGenerativeAIProviderOptions,
        variants: {
          high: {
            thinkingConfig: {
              includeThoughts: true,
              thinkingBudget: 16000,
            },
          } satisfies GoogleGenerativeAIProviderOptions,
          max: {
            thinkingConfig: {
              includeThoughts: true,
              thinkingBudget: 31999,
            },
          } satisfies GoogleGenerativeAIProviderOptions,
        },
      },
    }

    return {
      ...googleProvider,
      id: antigravityConfig().SERVICE_NAME,
      name: antigravityConfig().DISPLAY_NAME,
      npm: "cloudassist-ai-provider",
      models,
    }
  },
})
