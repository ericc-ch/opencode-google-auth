import { describe, expect, it } from "bun:test"
import { transformNonStreamingResponse } from "./response"

describe("transformNonStreamingResponse", () => {
  it("unwraps { response: X } to X", async () => {
    const original = new Response(
      JSON.stringify({ response: { text: "Hello" } }),
      { headers: { "content-type": "application/json" } },
    )

    const result = await transformNonStreamingResponse(original)
    const body = await result.json()

    expect(body).toEqual({ text: "Hello" })
  })

  it("passes through response without wrapper", async () => {
    const original = new Response(JSON.stringify({ text: "Hello" }), {
      headers: { "content-type": "application/json" },
    })

    const result = await transformNonStreamingResponse(original)
    const body = await result.json()

    expect(body).toEqual({ text: "Hello" })
  })

  it("passes through non-JSON responses", async () => {
    const original = new Response("plain text", {
      headers: { "content-type": "text/plain" },
    })

    const result = await transformNonStreamingResponse(original)
    const body = await result.text()

    expect(body).toBe("plain text")
  })

  it("preserves status code", async () => {
    const original = new Response(JSON.stringify({ response: {} }), {
      status: 201,
      statusText: "Created",
      headers: { "content-type": "application/json" },
    })

    const result = await transformNonStreamingResponse(original)

    expect(result.status).toBe(201)
    expect(result.statusText).toBe("Created")
  })

  it("preserves headers", async () => {
    const original = new Response(JSON.stringify({ response: {} }), {
      headers: {
        "content-type": "application/json",
        "x-custom-header": "value",
      },
    })

    const result = await transformNonStreamingResponse(original)

    expect(result.headers.get("x-custom-header")).toBe("value")
  })

  it("handles malformed JSON gracefully", async () => {
    const original = new Response("not-json{", {
      headers: { "content-type": "application/json" },
    })

    const result = await transformNonStreamingResponse(original)
    const body = await result.text()

    expect(body).toBe("not-json{")
  })
})
