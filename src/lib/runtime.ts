import { FetchHttpClient, PlatformLogger } from "@effect/platform"
import { BunFileSystem } from "@effect/platform-bun"
import type { PluginInput } from "@opencode-ai/plugin"
import { Effect, Layer, Logger, ManagedRuntime, pipe } from "effect"
import path from "node:path"
import { GeminiOAuth } from "./auth/gemini"
import { GeminiCliConfigLive } from "./services/config"
import { makeOpenCodeLogger, OpenCodeContext } from "./services/opencode"

export const makeRuntime = (context: PluginInput) => {
  const OpenCodeLive = Layer.succeed(OpenCodeContext, context)

  const combinedLogger = Effect.gen(function* () {
    const fileLogger = yield* pipe(
      Logger.jsonLogger,
      PlatformLogger.toFile(path.join(import.meta.dir, "gemini-cli.txt")),
    )
    const openCodeLogger = yield* makeOpenCodeLogger

    return Logger.zip(openCodeLogger, fileLogger)
  })

  const LoggerLive = Logger.replaceScoped(Logger.defaultLogger, combinedLogger)

  const MainLive = pipe(
    Layer.empty,
    Layer.provide(LoggerLive),
    Layer.provide(BunFileSystem.layer),
    Layer.provideMerge(OpenCodeLive),
    Layer.provideMerge(GeminiCliConfigLive),
    Layer.merge(GeminiOAuth.Default),
    Layer.merge(FetchHttpClient.layer),
  )

  return ManagedRuntime.make(MainLive)
}
