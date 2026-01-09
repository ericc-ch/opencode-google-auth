import { identity, pipe, Runtime, Stream } from "effect"

import { CODE_ASSIST_VERSION } from "./config"

const STREAM_ACTION = "streamGenerateContent"

type TransformRequestParams = {
  input: string | URL | Request
  init: RequestInit | undefined
  accessToken: string
  projectId: string
}

type TransformRequestResult = {
  input: string
  init: RequestInit
  streaming: boolean
}

function getUrlString(input: string | URL | Request): string {
  if (typeof input === "string") return input
  if (input instanceof URL) return input.toString()
  return input.url
}

export function transformRequest(
  params: TransformRequestParams,
): TransformRequestResult {
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

type TransformResponseParams = {
  response: Response
  streaming: boolean
}

function transformStreamLine(line: string): string {
  if (!line.startsWith("data:")) return line

  const json = line.slice(5).trim()
  if (!json) return line

  try {
    const parsed = JSON.parse(json) as { response?: unknown }
    if (parsed.response !== undefined) {
      return `data: ${JSON.stringify(parsed.response)}`
    }
  } catch {
    // keep original line if parse fails
  }

  return line
}

function createStreamTransformer(
  body: ReadableStream<Uint8Array>,
): ReadableStream<Uint8Array> {
  return pipe(
    Stream.fromReadableStream({
      evaluate: () => body,
      onError: identity,
    }),
    Stream.decodeText(),
    Stream.splitLines,
    Stream.map(transformStreamLine),
    Stream.map((line) => `${line}\n`),
    Stream.encodeText,
    Stream.toReadableStreamRuntime(Runtime.defaultRuntime),
  )
}

export async function transformResponse(
  params: TransformResponseParams,
): Promise<Response> {
  const { response, streaming } = params

  // streaming SSE response
  if (streaming && response.ok && response.body) {
    const contentType = response.headers.get("content-type") ?? ""
    if (contentType.includes("text/event-stream")) {
      return new Response(createStreamTransformer(response.body), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      })
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
