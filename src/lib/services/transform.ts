import { Context, Layer } from "effect"
import { CODE_ASSIST_VERSION } from "../config"

const STREAM_ACTION = "streamGenerateContent"

export type TransformRequestParams = {
  input: string | URL | Request
  init: RequestInit | undefined
  accessToken: string
  projectId: string
}

export type TransformRequestResult = {
  input: string
  init: RequestInit
  streaming: boolean
}

export type TransformResponseParams = {
  response: Response
  streaming: boolean
}

export interface RequestTransformerShape {
  readonly transformRequest: (
    params: TransformRequestParams,
  ) => TransformRequestResult
  readonly transformResponse: (
    params: TransformResponseParams,
  ) => Promise<Response>
}

export class RequestTransformer extends Context.Tag("RequestTransformer")<
  RequestTransformer,
  RequestTransformerShape
>() {}

// --- Shared Utils ---

function getUrlString(input: string | URL | Request): string {
  if (typeof input === "string") return input
  if (input instanceof URL) return input.toString()
  return input.url
}

// --- Gemini Implementation ---

const transformGeminiRequest = (
  params: TransformRequestParams,
): TransformRequestResult => {
  const url = getUrlString(params.input)
  const parsedUrl = new URL(url)

  // match /v1beta/models/{model}:{action}
  const match = parsedUrl.pathname.match(/\/v1beta\/models\/([^:]+):(\w+)/)
  if (!match) {
    return {
      input: url,
      init: params.init ?? {},
      streaming: false,
    }
  }

  const [, model, action] = match
  const streaming = action === STREAM_ACTION

  // build new path: /v1internal:{action}
  parsedUrl.pathname = `/${CODE_ASSIST_VERSION}:${action}`
  if (streaming) {
    parsedUrl.searchParams.set("alt", "sse")
  }

  // transform headers
  const headers = new Headers(params.init?.headers)
  headers.set("Authorization", `Bearer ${params.accessToken}`)
  headers.delete("x-api-key")
  headers.delete("x-goog-api-key")

  if (streaming) {
    headers.set("Accept", "text/event-stream")
  }

  // wrap body
  let body = params.init?.body
  if (typeof body === "string" && body) {
    try {
      const parsed = JSON.parse(body) as Record<string, unknown>
      const wrapped = {
        project: params.projectId,
        model,
        request: parsed,
      }
      body = JSON.stringify(wrapped)
    } catch {
      // keep original body if parse fails
    }
  }

  return {
    input: parsedUrl.toString(),
    init: {
      ...params.init,
      headers,
      body,
    },
    streaming,
  }
}

const transformGeminiResponse = async (
  params: TransformResponseParams,
): Promise<Response> => {
  const { response, streaming } = params

  // streaming SSE response
  if (streaming && response.ok && response.body) {
    const contentType = response.headers.get("content-type") ?? ""
    if (contentType.includes("text/event-stream")) {
      return response
    }
  }

  // non-streaming JSON response
  const contentType = response.headers.get("content-type") ?? ""
  if (!contentType.includes("application/json")) {
    return response
  }

  const text = await response.text()
  try {
    const parsed = JSON.parse(text) as { response?: unknown }
    if (parsed.response !== undefined) {
      return new Response(JSON.stringify(parsed.response), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      })
    }
  } catch {
    // return original response if parse fails
  }

  return new Response(text, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}

export const GeminiRequestTransformerLive = Layer.succeed(RequestTransformer, {
  transformRequest: transformGeminiRequest,
  transformResponse: transformGeminiResponse,
})

// --- Antigravity Implementation ---

const transformAntigravityRequest = (
  params: TransformRequestParams,
): TransformRequestResult => {
  const url = getUrlString(params.input)
  const parsedUrl = new URL(url)

  // match /v1beta/models/{model}:{action}
  const match = parsedUrl.pathname.match(/\/v1beta\/models\/([^:]+):(\w+)/)
  if (!match) {
    return {
      input: url,
      init: params.init ?? {},
      streaming: false,
    }
  }

  const [, model, action] = match
  const streaming = action === STREAM_ACTION

  parsedUrl.pathname = `/${CODE_ASSIST_VERSION}:${action}`

  if (streaming) {
    parsedUrl.searchParams.set("alt", "sse")
  }

  // transform headers
  const headers = new Headers(params.init?.headers)
  headers.set("Authorization", `Bearer ${params.accessToken}`)
  headers.set("User-Agent", "antigravity/1.104.0 darwin/arm64")
  headers.set(
    "X-Goog-Api-Client",
    "google-cloud-sdk vscode_cloudshelleditor/0.1",
  )
  headers.set(
    "Client-Metadata",
    '{"ideType":"IDE_UNSPECIFIED","platform":"PLATFORM_UNSPECIFIED","pluginType":"GEMINI"}',
  )

  headers.delete("x-api-key")
  headers.delete("x-goog-api-key")

  if (streaming) {
    headers.set("Accept", "text/event-stream")
  }

  // wrap body
  let body = params.init?.body
  if (typeof body === "string" && body) {
    try {
      const parsed = JSON.parse(body) as Record<string, unknown>

      const requestId = `agent-${crypto.randomUUID()}`
      // Generate a stable session ID or random one. For simplicity: random.
      const sessionId = `-${Math.floor(Math.random() * 9000000000000000000)}`

      const wrapped = {
        project: params.projectId,
        model,
        userAgent: "antigravity",
        requestType: "agent",
        requestId,
        request: {
          ...parsed,
          sessionId,
        },
      }
      body = JSON.stringify(wrapped)
    } catch {
      // keep original body if parse fails
    }
  }

  return {
    input: parsedUrl.toString(),
    init: {
      ...params.init,
      headers,
      body,
    },
    streaming,
  }
}

export const AntigravityRequestTransformerLive = Layer.succeed(
  RequestTransformer,
  {
    transformRequest: transformAntigravityRequest,
    transformResponse: transformGeminiResponse,
  },
)
