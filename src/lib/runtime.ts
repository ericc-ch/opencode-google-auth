import { FetchHttpClient } from "@effect/platform"
import { BunFileSystem } from "@effect/platform-bun"
import type { PluginInput } from "@opencode-ai/plugin"
import { Layer, Logger, ManagedRuntime, pipe } from "effect"
import { combinedLogger } from "./logger"
import { ProviderConfig, type ProviderConfigShape } from "./services/config"
import { OAuth } from "./services/oauth"
import { OpenCodeContext } from "./services/opencode"
import { Session } from "./services/session"

export const makeRuntime = ({
  providerConfig,
  openCodeCtx,
}: {
  providerConfig: ProviderConfigShape
  openCodeCtx: PluginInput
}) => {
  const LoggerLive = Logger.replaceScoped(Logger.defaultLogger, combinedLogger)
  const ProviderConfigLive = Layer.succeed(ProviderConfig, providerConfig)
  const OpenCodeLive = Layer.succeed(OpenCodeContext, openCodeCtx)

  const MainLive = pipe(
    Layer.empty,
    Layer.provide(LoggerLive),
    Layer.provide(BunFileSystem.layer),
    Layer.merge(OAuth.Default),
    Layer.merge(Session.Default),
    Layer.provideMerge(OpenCodeLive),
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(ProviderConfigLive),
  )

  return ManagedRuntime.make(MainLive)
}
