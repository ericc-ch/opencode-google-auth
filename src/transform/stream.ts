import { Effect, Option, Stream } from "effect"

const unwrapResponse = (data: { response?: unknown }): unknown =>
  data.response ?? data

const parseSSE = (body: ReadableStream<Uint8Array>) =>
  Stream.fromReadableStream(
    () => body,
    (e) => e as Error,
  ).pipe(
    Stream.decodeText,
    Stream.splitLines,
    Stream.filterMap((line) =>
      line.startsWith("data: ") ? Option.some(line.slice(6)) : Option.none(),
    ),
    Stream.filter((json) => json.trim().length > 0),
    Stream.mapEffect((json) =>
      Effect.try({
        try: () => JSON.parse(json) as { response?: unknown },
        catch: () => ({ response: json }),
      }),
    ),
  )

const encodeSSE = (data: unknown): Uint8Array =>
  new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`)

export const transformStreamingResponse = (
  response: Response,
): Effect.Effect<Response, Error> =>
  Effect.sync(() => {
    if (!response.body) {
      return response
    }

    const transformed = parseSSE(response.body).pipe(
      Stream.map(unwrapResponse),
      Stream.map(encodeSSE),
    )

    const readable = Stream.toReadableStream(transformed)

    return new Response(readable, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    })
  })
