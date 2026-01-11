import type { PluginInput } from "@opencode-ai/plugin"
import { Context, Effect, Inspectable, Logger, LogLevel, pipe } from "effect"
import path from "node:path"
import type { OpenCodeLogLevel } from "../types"
import { ProviderConfig } from "./services/config"
import { PlatformLogger } from "@effect/platform"

export class OpenCodeContext extends Context.Tag("OpenCodeContext")<
  OpenCodeContext,
  PluginInput
>() {}

const makeOpenCodeLogger = Effect.gen(function* () {
  const openCode = yield* OpenCodeContext
  const config = yield* ProviderConfig

  return Logger.make((log) => {
    let level: OpenCodeLogLevel = "debug"

    if (LogLevel.greaterThanEqual(log.logLevel, LogLevel.Error)) {
      level = "error"
    } else if (LogLevel.greaterThanEqual(log.logLevel, LogLevel.Warning)) {
      level = "warn"
    } else if (LogLevel.greaterThanEqual(log.logLevel, LogLevel.Info)) {
      level = "info"
    }

    const message = Inspectable.toStringUnknown(log.message)

    void openCode.client.app.log({
      body: {
        level,
        message,
        service: config.SERVICE_NAME,
      },
    })
  })
})

export const combinedLogger = Effect.gen(function* () {
  const fileLogger = yield* pipe(
    Logger.jsonLogger,
    PlatformLogger.toFile(path.join(import.meta.dir, "plugin.log")),
  )
  const openCodeLogger = yield* makeOpenCodeLogger

  return Logger.zip(openCodeLogger, fileLogger)
})
