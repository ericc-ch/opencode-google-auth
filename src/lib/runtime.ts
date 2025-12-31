import { Effect, Layer, Logger, ManagedRuntime, pipe } from "effect"
import { GeminiOAuth } from "./auth/gemini"
import type { PluginInput } from "@opencode-ai/plugin"
import { makeOpenCodeLogger, OpenCodeContext } from "./opencode"
import { SERVICE_NAME } from "./config"
import path from "node:path"
import { PlatformLogger } from "@effect/platform"
import { BunFileSystem } from "@effect/platform-bun"

const logPath = path.join(import.meta.dir, `${SERVICE_NAME}.txt`)

export const makeRuntime = (context: PluginInput) => {
  const OpenCodeLive = Layer.succeed(OpenCodeContext, context)

  const combinedLogger = Effect.gen(function* () {
    const fileLogger = yield* pipe(
      Logger.stringLogger,
      PlatformLogger.toFile(logPath),
    )
    const openCodeLogger = yield* makeOpenCodeLogger

    return Logger.zip(openCodeLogger, fileLogger)
  })

  const LoggerLive = Logger.replaceScoped(Logger.defaultLogger, combinedLogger)

  const MainLive = pipe(
    GeminiOAuth.Default,
    Layer.merge(LoggerLive),
    Layer.provide(OpenCodeLive),
    Layer.provide(BunFileSystem.layer),
  )

  return ManagedRuntime.make(MainLive)
}
