/**
 * Reproduction: Effect matchStatus + schemaBodyJson type issue
 *
 * When using HttpClientResponse.schemaBodyJson inside matchStatus "2xx" handler
 * alongside Data.TaggedError returns in error handlers, the types break and
 * Effect.catchTag no longer works.
 */

import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from "@effect/platform"
import { NodeRuntime } from "@effect/platform-node"
import { Data, Effect, pipe, Schema } from "effect"

const Todo = Schema.Struct({
  userId: Schema.Number,
  id: Schema.Number,
  title: Schema.String,
  completed: Schema.Boolean,
})

class NotFoundError extends Data.TaggedError("NotFoundError")<{
  readonly message: string
}> {}

class ServerError extends Data.TaggedError("ServerError")<{
  readonly message: string
}> {}

// ❌ BROKEN: Using schemaBodyJson in matchStatus breaks catchTag
// Hover over _brokenRequest - error channel is `unknown`
const _brokenRequest = pipe(
  HttpClientRequest.get("https://jsonplaceholder.typicode.com/todos/1"),
  HttpClient.execute,
  Effect.andThen(
    HttpClientResponse.matchStatus({
      "2xx": HttpClientResponse.schemaBodyJson(Todo),
      404: () => new NotFoundError({ message: "Todo not found" }),
      "5xx": () => new ServerError({ message: "Server error" }),
      orElse: () => new ServerError({ message: "Unknown error" }),
    }),
  ),
  // ❌ Uncommenting this line causes type error:
  // Effect.catchTag("NotFoundError", () => Effect.succeed({ userId: 0, id: 0, title: "fallback", completed: false })),
)

// ✅ WORKAROUND: Decode after matchStatus instead of inside it
const workingRequest = pipe(
  HttpClientRequest.get("https://jsonplaceholder.typicode.com/todos/1"),
  HttpClient.execute,
  Effect.andThen(
    HttpClientResponse.matchStatus({
      "2xx": (res) => res.json,
      404: () => new NotFoundError({ message: "Todo not found" }),
      "5xx": () => new ServerError({ message: "Server error" }),
      orElse: () => new ServerError({ message: "Unknown error" }),
    }),
  ),
  Effect.andThen(Schema.decodeUnknown(Todo)),
  // ✅ This works
  Effect.catchTag("NotFoundError", () =>
    Effect.succeed({ userId: 0, id: 0, title: "fallback", completed: false }),
  ),
)

const program = Effect.gen(function* () {
  const todo = yield* workingRequest
  yield* Effect.log("Got todo:", todo)
}).pipe(Effect.withSpan("program", { attributes: { source: "Playground" } }))

program.pipe(Effect.provide(FetchHttpClient.layer), NodeRuntime.runMain)
