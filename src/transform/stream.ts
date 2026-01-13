import {
  encoder,
  type Event,
  makeChannel,
  Retry,
} from "@effect/experimental/Sse"
import { pipe, Stream } from "effect"

const parseAndMerge = (event: Event): string => {
  if (!event.data) {
    return encoder.write(event)
  }

  try {
    const parsed = JSON.parse(event.data) as {
      response?: Record<string, unknown>
    }
    if (parsed.response) {
      const { response, ...rest } = parsed
      return encoder.write({
        ...event,
        data: JSON.stringify({ ...rest, ...response }),
      })
    }

    return encoder.write(event)
  } catch {
    return encoder.write(event)
  }
}

const parseSSE = (body: ReadableStream<Uint8Array>) =>
  pipe(
    Stream.fromReadableStream(
      () => body,
      (error) => error,
    ),
    Stream.decodeText,
    Stream.pipeThroughChannel(makeChannel()),
    Stream.map((event) =>
      Retry.is(event) ? encoder.write(event) : parseAndMerge(event),
    ),
    Stream.encodeText,
  )

export const transformStreamingResponse = (response: Response) => {
  if (!response.body) {
    return response
  }

  const transformed = parseSSE(response.body)
  const readable = Stream.toReadableStream(
    transformed as Stream.Stream<Uint8Array, never, never>,
  )

  return new Response(readable, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}
