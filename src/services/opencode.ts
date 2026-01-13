import type { PluginInput } from "@opencode-ai/plugin"
import { Context } from "effect"

export class OpenCodeContext extends Context.Tag("OpenCodeContext")<
  OpenCodeContext,
  PluginInput
>() {}
