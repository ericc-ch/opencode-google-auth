import type { Hooks, PluginInput } from "@opencode-ai/plugin"

export type OpenCodeConfigHook = NonNullable<Hooks["config"]>
export type OpenCodeConfig = Parameters<OpenCodeConfigHook>[0]
export type OpenCodeProvider = NonNullable<OpenCodeConfig["provider"]>[string]
export type OpenCodeModel = NonNullable<OpenCodeProvider["models"]>[string]

export type OpenCodeAuthHook = NonNullable<Hooks["auth"]>
export type OpenCodeAuthLoader = NonNullable<OpenCodeAuthHook["loader"]>
export type OpenCodeAuthMethod = NonNullable<
  OpenCodeAuthHook["methods"]
>[number]

export type OpenCodeLogLevel = NonNullable<
  NonNullable<Parameters<PluginInput["client"]["app"]["log"]>[0]>["body"]
>["level"]

export type BunServeOptions = Partial<Bun.Serve.Options<undefined, never>>

/**
 * Subset of google-auth-library Credentials type.
 *
 * Why don't they fucking use object union instead of making everything nullable.
 */
export interface Credentials {
  access_token: string
  refresh_token: string
  expiry_date: number
}

/**
 * Types for models.dev, simplified
 */

interface InterleavedConfig {
  field: string
}

export interface Model {
  id: string
  name: string
  family: string
  attachment: boolean
  reasoning: boolean
  tool_call: boolean
  temperature: boolean
  knowledge?: string
  release_date?: string
  last_updated?: string
  open_weights: boolean
  structured_output?: boolean
  interleaved?: boolean | InterleavedConfig
  status?: string
}

export interface Provider {
  id: string
  env: string[]
  npm: string
  name: string
  doc: string
  models: Record<string, Model>
  api?: string
}

export type ModelsDev = Record<string, Provider>
