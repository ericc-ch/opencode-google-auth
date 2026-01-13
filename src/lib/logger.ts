import { PlatformLogger } from "@effect/platform"
import { Effect, Inspectable, Logger, LogLevel, pipe } from "effect"
import path from "node:path"
import type { OpenCodeLogLevel } from "../types"
import { PLUGIN_NAME, ProviderConfig } from "../services/config"
import { OpenCodeContext } from "../services/opencode"
import { xdgData } from "xdg-basedir"

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

const LOG_DIR = xdgData ? path.join(xdgData, "opencode") : import.meta.dir

export const combinedLogger = Effect.gen(function* () {
  const openCodeLogger = yield* makeOpenCodeLogger
  const fileLogger = yield* pipe(
    Logger.jsonLogger,
    PlatformLogger.toFile(path.join(LOG_DIR, `${PLUGIN_NAME}.log`)),
  )

  return Logger.zip(openCodeLogger, fileLogger)
})
