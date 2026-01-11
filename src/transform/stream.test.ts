import { describe, expect, it } from "bun:test"
import { Effect } from "effect"
import { transformStreamingResponse } from "./stream"

describe("transformStreamingResponse", () => {
  const createSSEStream = (events: string[]) => {
    const encoder = new TextEncoder()
    return new ReadableStream({
      start(controller) {
        for (const event of events) {
          controller.enqueue(encoder.encode(event))
        }
        controller.close()
      },
    })
  }

  it("unwraps response wrapper from SSE events", async () => {
    const stream = createSSEStream([
      'data: {"response":{"text":"Hello"}}\n\n',
      'data: {"response":{"text":" World"}}\n\n',
    ])

    const response = new Response(stream, {
      headers: { "content-type": "text/event-stream" },
    })

    const result = await Effect.runPromise(transformStreamingResponse(response))
    const text = await result.text()

    expect(text).toContain('data: {"text":"Hello"}')
    expect(text).toContain('data: {"text":" World"}')
  })

  it("handles responses without wrapper", async () => {
    const stream = createSSEStream(['data: {"text":"Direct"}\n\n'])

    const response = new Response(stream, {
      headers: { "content-type": "text/event-stream" },
    })

    const result = await Effect.runPromise(transformStreamingResponse(response))
    const text = await result.text()

    expect(text).toContain('data: {"text":"Direct"}')
  })

  it("returns original response if no body", async () => {
    const response = new Response(null, { status: 204 })

    const result = await Effect.runPromise(transformStreamingResponse(response))

    expect(result.status).toBe(204)
  })

  it("preserves status and headers", async () => {
    const stream = createSSEStream(['data: {"response":{}}\n\n'])

    const response = new Response(stream, {
      status: 200,
      statusText: "OK",
      headers: {
        "content-type": "text/event-stream",
        "x-custom": "value",
      },
    })

    const result = await Effect.runPromise(transformStreamingResponse(response))

    expect(result.status).toBe(200)
    expect(result.headers.get("x-custom")).toBe("value")
  })

  it("handles chunked SSE data", async () => {
    // Simulate data split across chunks
    const stream = createSSEStream([
      'data: {"resp',
      'onse":{"part":"1"}}\n\ndata: {"response":{"part":"2"}}\n\n',
    ])

    const response = new Response(stream, {
      headers: { "content-type": "text/event-stream" },
    })

    const result = await Effect.runPromise(transformStreamingResponse(response))
    const text = await result.text()

    expect(text).toContain('data: {"part":"1"}')
    expect(text).toContain('data: {"part":"2"}')
  })

  it("filters out non-data lines", async () => {
    const stream = createSSEStream([
      ": comment\n",
      "event: message\n",
      'data: {"response":{"valid":"data"}}\n\n',
    ])

    const response = new Response(stream, {
      headers: { "content-type": "text/event-stream" },
    })

    const result = await Effect.runPromise(transformStreamingResponse(response))
    const text = await result.text()

    expect(text).toContain('data: {"valid":"data"}')
    expect(text).not.toContain("comment")
  })
})
