import { regex } from "arkregex"
import { CODE_ASSIST_VERSION } from "../lib/config"
import type { ProviderConfigShape } from "../lib/services/config"
import type { TransformRequestParams } from "./types"

const STREAM_ACTION = "streamGenerateContent"
const PATH_PATTERN = regex("/v1beta/models/(?<model>[^:]+):(?<action>\\w+)")

export const transformRequest = (
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
      body = JSON.stringify(wrapped)
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
