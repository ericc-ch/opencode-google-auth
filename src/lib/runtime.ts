import { Effect, Layer, Logger, ManagedRuntime, pipe } from "effect"
import { GeminiOAuth } from "./auth/gemini"
import type { PluginInput } from "@opencode-ai/plugin"
import { makeOpenCodeLogger, OpenCodeContext } from "./opencode"
import { SERVICE_NAME } from "./config"
import path from "node:path"
import { FetchHttpClient, PlatformLogger } from "@effect/platform"
import { BunFileSystem } from "@effect/platform-bun"

const logPath = path.join(import.meta.dir, `${SERVICE_NAME}.txt`)

export const makeRuntime = (context: PluginInput) => {
  const OpenCodeLive = Layer.succeed(OpenCodeContext, context)

  const combinedLogger = Effect.gen(function* () {
    const fileLogger = yield* pipe(
      Logger.jsonLogger,
      PlatformLogger.toFile(logPath),
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
    Layer.merge(GeminiOAuth.Default),
    Layer.merge(FetchHttpClient.layer),
  )

  return ManagedRuntime.make(MainLive)
}
