import { FetchHttpClient, PlatformLogger } from "@effect/platform"
import { BunFileSystem } from "@effect/platform-bun"
import type { PluginInput } from "@opencode-ai/plugin"
import { Effect, Layer, Logger, ManagedRuntime, pipe } from "effect"
import path from "node:path"
import type { ProviderConfig } from "./services/config"
import type { OAuth } from "./services/oauth"
import { makeOpenCodeLogger, OpenCodeContext } from "./services/opencode"
import type { RequestTransformer } from "./services/transform"

export type ProviderLayer = Layer.Layer<
  ProviderConfig | OAuth | RequestTransformer,
  never,
  never
>

export const makeProviderRuntime = (
  context: PluginInput,
  ProviderLayer: ProviderLayer,
) => {
  const OpenCodeLive = Layer.succeed(OpenCodeContext, context)

  const combinedLogger = Effect.gen(function* () {
    const fileLogger = yield* pipe(
      Logger.jsonLogger,
      PlatformLogger.toFile(path.join(import.meta.dir, "plugin.log")),
    )
    const openCodeLogger = yield* makeOpenCodeLogger

    return Logger.zip(openCodeLogger, fileLogger)
  })

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
