import { Context } from "effect"

export interface ProviderConfigShape {
  readonly SERVICE_NAME: string
  readonly DISPLAY_NAME: string
  readonly ENDPOINTS: readonly string[]
  readonly HEADERS: Readonly<Record<string, string>>
  readonly SCOPES: readonly string[]
  readonly CLIENT_ID: string
  readonly CLIENT_SECRET: string
}

export class ProviderConfig extends Context.Tag("ProviderConfig")<
  ProviderConfig,
  ProviderConfigShape
>() {}

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
  ...GEMINI_CLI_MODELS,
  "claude-sonnet-4",
  "claude-sonnet-4-thinking",
] as const

export const GEMINI_CLI_CONFIG = {
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
  },
} as const satisfies ProviderConfigShape

export const ANTIGRAVITY_CONFIG = {
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
    "https://daily-cloudcode-pa.googleapis.com",
    "https://cloudcode-pa.googleapis.com",
  ],
  HEADERS: {
    "User-Agent": "antigravity/1.104.0 darwin/arm64",
    "X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
  },
} as const satisfies ProviderConfigShape
