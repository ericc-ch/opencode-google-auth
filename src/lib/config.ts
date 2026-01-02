export const SERVICE_NAME = "gemini-cli"

export const SUPPORTED_MODELS = [
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-3-pro-preview",
  "gemini-3-flash-preview",
]

export const CODE_ASSIST_ENDPOINT = "https://cloudcode-pa.googleapis.com"
export const CODE_ASSIST_VERSION = "v1internal"

export const CLIENT_METADATA = {
  ideType: "IDE_UNSPECIFIED",
  platform: "PLATFORM_UNSPECIFIED",
  pluginType: "GEMINI",
} as const
