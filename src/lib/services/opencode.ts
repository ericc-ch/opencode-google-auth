import type { PluginInput } from "@opencode-ai/plugin"
import { Context, Effect, Inspectable, Logger, LogLevel } from "effect"
import { ProviderConfig } from "./config"
import type { OpenCodeLogLevel } from "../../types"

export class OpenCodeContext extends Context.Tag("OpenCodeContext")<
  OpenCodeContext,
  PluginInput
>() {}

export const makeOpenCodeLogger = Effect.gen(function* () {
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
