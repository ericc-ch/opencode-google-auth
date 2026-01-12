import { regex } from "arkregex"
import {
  CODE_ASSIST_VERSION,
  type ProviderConfigShape,
} from "../lib/services/config"

const STREAM_ACTION = "streamGenerateContent"
const PATH_PATTERN = regex("/models/(?<model>[^:]+):(?<action>\\w+)")

interface TransformRequestParams {
  readonly input: Parameters<typeof fetch>[0]
  readonly init: Parameters<typeof fetch>[1]
  readonly accessToken: string
  readonly projectId: string
}

export const transformRequest = async (
  params: TransformRequestParams,
  config: ProviderConfigShape,
) => {
  const url = new URL(
    params.input instanceof Request ? params.input.url : params.input,
  )

  const match = PATH_PATTERN.exec(url.pathname)
  if (!match) {
    return {
      input: url.toString(),
      init: params.init ?? {},
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
  const headers = new Headers(params.init?.headers)
  headers.delete("x-api-key")
  headers.delete("x-goog-api-key")
  headers.set("Authorization", `Bearer ${params.accessToken}`)

  for (const [key, value] of Object.entries(config.HEADERS)) {
    headers.set(key, value)
  }

  if (streaming) {
    headers.set("Accept", "text/event-stream")
  }

  // Wrap request body
  let body = params.init?.body
  if (typeof body === "string") {
    try {
      const parsed = JSON.parse(body)
      const wrapped = {
        project: params.projectId,
        request: parsed,
        model,
      }
      const finalBody = config.transformBody
        ? await config.transformBody(wrapped)
        : wrapped
      body = JSON.stringify(finalBody)
    } catch {
      // Keep original body if parse fails
    }
  }

  return {
    input: url.toString(),
    init: {
      ...params.init,
      headers,
      body,
    },
    streaming,
  }
}
