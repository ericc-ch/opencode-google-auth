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
