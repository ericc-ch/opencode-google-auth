import { regex } from "arkregex"
import { Effect, pipe } from "effect"
import { CODE_ASSIST_VERSION, ProviderConfig } from "../lib/services/config"
import { Session } from "../lib/services/session"

const STREAM_ACTION = "streamGenerateContent"
const PATH_PATTERN = regex("/models/(?<model>[^:]+):(?<action>\\w+)")

export const transformRequest = Effect.fn("transformRequest")(function* (
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1],
  endpoint: string,
) {
  const config = yield* ProviderConfig
  const session = yield* Session
  const accessToken = yield* session.getAccessToken
  const project = yield* session.ensureProject
  const projectId = project.cloudaicompanionProject

  const url = new URL(input instanceof Request ? input.url : input)

  // Rewrite the URL to use the specified endpoint
  const endpointUrl = new URL(endpoint)
  url.protocol = endpointUrl.protocol
  url.host = endpointUrl.host

  const match = PATH_PATTERN.exec(url.pathname)
  if (!match) {
    return {
      input: url.toString(),
      init: init ?? {},
      streaming: false,
    }
  }

  const { model, action } = match.groups
  const streaming = action === STREAM_ACTION

  // Transform URL to internal endpoint
  url.pathname = `/${CODE_ASSIST_VERSION}:${action}`
  if (streaming) {
    url.searchParams.set("alt", "sse")
  }

  // Transform headers
  const headers = new Headers(init?.headers)
  headers.delete("x-api-key")
  headers.delete("x-goog-api-key")
  headers.set("Authorization", `Bearer ${accessToken}`)

  for (const [key, value] of Object.entries(config.HEADERS)) {
    headers.set(key, value)
  }

  if (streaming) {
    headers.set("Accept", "text/event-stream")
  }

  // Wrap request body
  let body = init?.body
  if (typeof body === "string") {
    body = yield* pipe(
      Effect.try(() => JSON.parse(body as string)),
      Effect.flatMap((parsed) => {
        const wrapped = {
          project: projectId,
          request: parsed,
          model,
        }
        return config.transformBody ?
            Effect.promise(() => config.transformBody!(wrapped))
          : Effect.succeed(wrapped)
      }),
      Effect.map((finalBody) => JSON.stringify(finalBody)),
      Effect.orElseSucceed(() => body as string),
    )
  }

  return {
    input: url.toString(),
    init: {
      ...init,
      headers,
      body,
    },
    streaming,
  }
})
