/**
 * Session service
 *
 * Manages the authenticated session lifecycle:
 * - Holds stable data (projectId, endpoint)
 * - Provides getAccessToken() with automatic refresh
 */

import { HttpClient, HttpClientRequest } from "@effect/platform"
import { Data, Effect, Ref, Schema } from "effect"
import { OAuth2Client, type Credentials } from "google-auth-library"
import { ProviderConfig } from "./config"
import { CODE_ASSIST_VERSION } from "../config"
import { OpenCodeContext } from "./opencode"

// --- Errors ---

export class SessionError extends Data.TaggedError("SessionError")<{
  readonly reason:
    | "project_fetch"
    | "token_refresh"
    | "no_tokens"
    | "unauthorized"
  readonly message: string
  readonly cause?: unknown
}> {}

// --- Response Schema ---

const CodeAssistTier = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.String,
  userDefinedCloudaicompanionProject: Schema.Boolean,
  isDefault: Schema.optional(Schema.Boolean),
})

const LoadCodeAssistResponse = Schema.Struct({
  currentTier: CodeAssistTier,
  allowedTiers: Schema.Array(CodeAssistTier),
  cloudaicompanionProject: Schema.String,
  gcpManaged: Schema.Boolean,
  manageSubscriptionUri: Schema.String,
})

export type LoadCodeAssistResponse = typeof LoadCodeAssistResponse.Type

// --- Session Interface ---

export interface SessionShape {
  readonly projectId: string
  readonly endpoint: string
  readonly getAccessToken: () => Effect.Effect<string, SessionError>
}

// --- Session Initialization ---

/**
 * Initialize a session from credentials.
 *
 * - Fetches project info via loadCodeAssist
 * - Creates internal OAuth2Client for refresh
 * - Returns session with getAccessToken() that handles refresh
 */
export const initSession = (
  credentials: Credentials,
): Effect.Effect<
  SessionShape,
  SessionError,
  ProviderConfig | OpenCodeContext | HttpClient.HttpClient
> =>
  Effect.gen(function* () {
    const config = yield* ProviderConfig
    const openCode = yield* OpenCodeContext
    const httpClient = yield* HttpClient.HttpClient

    const endpoint = config.ENDPOINTS[0] ?? ""

    // Create OAuth2Client for refresh operations (internal to session)
    const oauthClient = new OAuth2Client({
      clientId: config.CLIENT_ID,
      clientSecret: config.CLIENT_SECRET,
    })

    // State: current credentials (mutable via Ref)
    const credentialsRef = yield* Ref.make(credentials)

    // --- Internal: Refresh tokens ---
    const refreshTokens = (): Effect.Effect<Credentials, SessionError> =>
      Effect.gen(function* () {
        const current = yield* Ref.get(credentialsRef)
        oauthClient.setCredentials(current)

        const result = yield* Effect.tryPromise({
          try: () => oauthClient.refreshAccessToken(),
          catch: (cause) =>
            new SessionError({
              reason: "token_refresh",
              message: "Failed to refresh access token",
              cause,
            }),
        })

        const newCredentials = result.credentials
        yield* Ref.set(credentialsRef, newCredentials)

        // Persist to OpenCode
        const accessToken = newCredentials.access_token
        const refreshToken = newCredentials.refresh_token
        const expiryDate = newCredentials.expiry_date

        if (accessToken && refreshToken && expiryDate) {
          yield* Effect.promise(() =>
            openCode.client.auth.set({
              path: { id: config.SERVICE_NAME },
              body: {
                type: "oauth",
                access: accessToken,
                refresh: refreshToken,
                expires: expiryDate,
              },
            }),
          )
        }

        return newCredentials
      })

    // --- Internal: Fetch project ---
    const fetchProject = (accessToken: string) =>
      Effect.gen(function* () {
        const request = yield* HttpClientRequest.post(
          `${endpoint}/${CODE_ASSIST_VERSION}:loadCodeAssist`,
        ).pipe(
          HttpClientRequest.setHeader("Authorization", `Bearer ${accessToken}`),
          HttpClientRequest.bodyJson({
            metadata: {
              ideType: "IDE_UNSPECIFIED",
              platform: "PLATFORM_UNSPECIFIED",
              pluginType: "GEMINI",
            },
          }),
        )

        const response = yield* httpClient.execute(request).pipe(Effect.scoped)

        // Handle status codes
        if (response.status === 401) {
          return yield* Effect.fail(
            new SessionError({
              reason: "unauthorized",
              message: "Token expired",
            }),
          )
        }

        if (response.status >= 400) {
          return yield* Effect.fail(
            new SessionError({
              reason: "project_fetch",
              message: `HTTP error: ${response.status}`,
            }),
          )
        }

        // Parse response
        const json = yield* response.json

        const body = yield* Schema.decodeUnknown(LoadCodeAssistResponse)(json)

        return body
      }).pipe(
        Effect.catchAll((cause) => {
          if (cause instanceof SessionError) {
            return Effect.fail(cause)
          }
          return Effect.fail(
            new SessionError({
              reason: "project_fetch",
              message: "Failed to fetch project",
              cause,
            }),
          )
        }),
      )

    // --- Fetch project with retry on 401 ---
    const fetchProjectWithRetry = (accessToken: string) =>
      fetchProject(accessToken).pipe(
        Effect.catchAll((e) => {
          if (e._tag === "SessionError" && e.reason === "unauthorized") {
            return Effect.gen(function* () {
              yield* Effect.log("Token expired, refreshing...")
              const refreshed = yield* refreshTokens()
              if (!refreshed.access_token) {
                return yield* Effect.fail(
                  new SessionError({
                    reason: "token_refresh",
                    message: "Refresh did not return access token",
                  }),
                )
              }
              return yield* fetchProject(refreshed.access_token)
            })
          }
          return Effect.fail(e)
        }),
      )

    // Initial fetch
    const creds = yield* Ref.get(credentialsRef)
    if (!creds.access_token) {
      return yield* Effect.fail(
        new SessionError({
          reason: "no_tokens",
          message: "No access token available",
        }),
      )
    }

    const project = yield* fetchProjectWithRetry(creds.access_token)

    // --- Public: Get fresh access token ---
    const getAccessToken = (): Effect.Effect<string, SessionError> =>
      Effect.gen(function* () {
        const currentCreds = yield* Ref.get(credentialsRef)

        if (!currentCreds.access_token) {
          return yield* Effect.fail(
            new SessionError({
              reason: "no_tokens",
              message: "No access token available",
            }),
          )
        }

        // Check if expired (with 5 min buffer)
        const buffer = 5 * 60 * 1000
        const isExpired = (currentCreds.expiry_date ?? 0) < Date.now() + buffer

        if (isExpired) {
          yield* Effect.log("Access token expired, refreshing...")
          const refreshed = yield* refreshTokens()
          if (!refreshed.access_token) {
            return yield* Effect.fail(
              new SessionError({
                reason: "token_refresh",
                message: "Refresh did not return access token",
              }),
            )
          }
          return refreshed.access_token
        }

        return currentCreds.access_token
      })

    return {
      projectId: project.cloudaicompanionProject,
      endpoint,
      getAccessToken,
    } satisfies SessionShape
  })
