import { regex } from "arkregex"
import { Effect, pipe } from "effect"
import {
  CODE_ASSIST_VERSION,
  ProviderConfig,
  type RequestContext,
} from "../services/config"
import { Session } from "../services/session"

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

  // Wrap and transform request
  const isJson = typeof init?.body === "string"
  const parsedBody = yield* pipe(
    Effect.try(() => (isJson ? JSON.parse(init.body as string) : null)),
    Effect.orElseSucceed(() => null),
  )

  const wrappedBody = {
    model,
    project: projectId,
    request: parsedBody ?? {},
  }

  const {
    body: transformedBody,
    headers: finalHeaders,
    url: finalUrl,
  } =
    config.transformRequest ?
      yield* config.transformRequest({
        body: wrappedBody,
        headers,
        url,
      } satisfies RequestContext)
    : { body: wrappedBody, headers, url }

  const finalBody =
    isJson && parsedBody ? JSON.stringify(transformedBody) : init?.body

  return {
    input: finalUrl.toString(),
    init: {
      ...init,
      headers: finalHeaders,
      body: finalBody,
    },
    streaming,
  }
})
