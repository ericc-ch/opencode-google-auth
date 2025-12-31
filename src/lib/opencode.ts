import type { PluginInput } from "@opencode-ai/plugin"
import { Context, Effect, Logger, LogLevel } from "effect"
import { SERVICE_NAME } from "./config"

export class OpenCodeContext extends Context.Tag("OpenCodeContext")<
  OpenCodeContext,
  PluginInput
>() {}

type OpenCodeLogLevel =
  // NonNullable for the body
  NonNullable<
    // NonNullable for the parameter [0]
    NonNullable<Parameters<PluginInput["client"]["app"]["log"]>[0]>["body"]
  >["level"]

export const makeOpenCodeLogger = Effect.gen(function* () {
  const opencode = yield* OpenCodeContext

  return Logger.make((log) => {
    let level: OpenCodeLogLevel = "debug"

    // Effect: All, Fatal, Error, Warning, Info, Debug, Trace, None
    // Opencode: debug, info, warn, error
    // So yeah can't really use switch here
    if (LogLevel.greaterThanEqual(log.logLevel, LogLevel.Info)) {
      level = "info"
    } else if (LogLevel.greaterThanEqual(log.logLevel, LogLevel.Warning)) {
      level = "warn"
    } else if (LogLevel.greaterThanEqual(log.logLevel, LogLevel.Error)) {
      level = "error"
    }

    void opencode.client.app.log({
      body: {
        level,
        message: String(log.message),
        service: SERVICE_NAME,
      },
    })
  })
})
