import { describe, expect, it } from "bun:test"
import { transformRequest } from "./request"
import { antigravityConfig, ProviderConfig } from "../lib/services/config"
import { Session } from "../lib/services/session"
import { Effect, Layer, pipe } from "effect"
import { generateText } from "ai"
import { createGoogleGenerativeAI } from "@ai-sdk/google"

describe("Antigravity transformRequest", () => {
  const baseParams = {
    accessToken: "test-token",
    projectId: "test-project-123",
  }

  const config = antigravityConfig()

  const MockSession = Layer.succeed(
    Session,
    Session.of({
      getAccessToken: Effect.succeed(baseParams.accessToken),
      ensureProject: Effect.succeed({
        cloudaicompanionProject: baseParams.projectId,
        currentTier: {
          id: "free",
          name: "Free",
          description: "",
          userDefinedCloudaicompanionProject: false,
          userDefinedProjectId: "test-project-123",
        },
        allowedTiers: [],
        gcpManaged: false,
        manageSubscriptionUri: "",
      }),
      setCredentials: () => Effect.void,
    } as unknown as Session),
  ).pipe(Layer.provideMerge(Layer.succeed(ProviderConfig, config)))

  const setupTest = () => {
    let capturedBody: unknown = null

    const mockFetch = async (input: string | Request, init?: RequestInit) => {
      const result = await pipe(
        transformRequest(
          input,
          init as unknown as Parameters<typeof fetch>[1],
          "https://example.com",
        ),
        Effect.provide(MockSession),
        Effect.runPromise,
      )
      capturedBody = JSON.parse(result.init.body as string)

      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: "Hello" }],
                role: "model",
              },
              finishReason: "STOP",
            },
          ],
          usageMetadata: {
            promptTokenCount: 1,
            candidatesTokenCount: 1,
            totalTokenCount: 2,
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      )
    }

    const google = createGoogleGenerativeAI({
      apiKey: "test-key",
      fetch: mockFetch as typeof fetch,
    })

    return {
      google,
      getCapturedBody: () => capturedBody as Record<string, unknown>,
    }
  }

  it("propagates sessionId from labels and cleans up labels", async () => {
    const { google, getCapturedBody } = setupTest()

    await generateText({
      model: google("gemini-1.5-flash"),
      prompt: "Hello",
      providerOptions: {
        google: {
          labels: {
            sessionId: "test-session-id",
            otherLabel: "keep-me",
          },
        },
      },
    })

    const body = getCapturedBody()
    const innerRequest = body.request as Record<string, unknown>
    const labels = innerRequest.labels as Record<string, unknown>

    // sessionId should be moved to innerRequest
    expect(innerRequest.sessionId).toBe("test-session-id")

    // labels should be cleaned up (sessionId removed)
    expect(labels.sessionId).toBeUndefined()
    expect(labels.otherLabel).toBe("keep-me")

    // Metadata should be present
    expect(body.requestType).toBe("agent")
    expect(body.userAgent).toBe("antigravity")
    expect(body.requestId).toBeDefined()
  })

  it("removes labels object if it becomes empty after sessionId extraction", async () => {
    const { google, getCapturedBody } = setupTest()

    await generateText({
      model: google("gemini-1.5-flash"),
      prompt: "Hello",
      providerOptions: {
        google: {
          labels: {
            sessionId: "test-session-id",
          },
        },
      },
    })

    const body = getCapturedBody()
    const innerRequest = body.request as Record<string, unknown>

    expect(innerRequest.sessionId).toBe("test-session-id")
    expect(innerRequest.labels).toBeUndefined()
  })
})
