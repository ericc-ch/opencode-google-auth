import { FetchHttpClient } from "@effect/platform"
import { BunFileSystem } from "@effect/platform-bun"
import type { PluginInput } from "@opencode-ai/plugin"
import { Layer, Logger, ManagedRuntime, pipe } from "effect"
import { combinedLogger } from "./logger"
import type { ProviderConfig } from "./services/config"
import type { OAuth } from "./services/oauth"
import { OpenCodeContext } from "./services/opencode"

export type ProviderLayer = Layer.Layer<ProviderConfig | OAuth, never, never>

export const makeProviderRuntime = (
  context: PluginInput,
  ProviderLayer: ProviderLayer,
) => {
  const OpenCodeLive = Layer.succeed(OpenCodeContext, context)
  const LoggerLive = Logger.replaceScoped(Logger.defaultLogger, combinedLogger)

  const Services = Layer.mergeAll(
    ProviderLayer,
    OpenCodeLive,
    BunFileSystem.layer,
    FetchHttpClient.layer,
  )

  const MainLive = pipe(LoggerLive, Layer.provideMerge(Services))

  return ManagedRuntime.make(MainLive)
}
