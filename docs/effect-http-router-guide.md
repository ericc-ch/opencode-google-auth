# Effect HTTP Server Guide

A comprehensive guide to building HTTP servers with Effect, covering both the imperative **HttpRouter** approach (similar to Express) and the declarative **HttpApi** approach (schema-first with auto-generated clients).

---

## Table of Contents

1. [Overview](#overview)
2. [Quick Start](#quick-start)
3. [Part 1: HttpRouter (Imperative)](#part-1-httprouter-imperative)
4. [Part 2: HttpApi (Declarative)](#part-2-httpapi-declarative)
5. [Part 3: HTTP Client](#part-3-http-client)
6. [Part 4: Testing](#part-4-testing)
7. [Part 5: Temporary Servers & Lifecycle Management](#part-5-temporary-servers--lifecycle-management)
8. [Part 6: Advanced & Experimental](#part-6-advanced--experimental)
9. [Quick Reference](#quick-reference)

---

## Overview

Effect provides two primary ways to build HTTP servers, both strictly typed and built on the Effect runtime.

### Two Approaches

| Aspect             | HttpRouter                                  | HttpApi                                     |
| ------------------ | ------------------------------------------- | ------------------------------------------- |
| **Style**          | Imperative (Express-like)                   | Declarative (Schema-first)                  |
| **Best for**       | Simple APIs, microservices, specific routes | Complex APIs, public SDKs, strict contracts |
| **Validation**     | Manual (via Schema in handlers)             | Automatic (built-in endpoint schemas)       |
| **Docs (OpenAPI)** | Manual                                      | Auto-generated                              |
| **Client**         | Manual `fetch` / `HttpClient`               | Auto-derived typed client                   |
| **Learning Curve** | Lower                                       | Higher                                      |

### When to use which?

- **Use HttpRouter** if you are migrating from Express, need a simple WebSocket server, or are building a small internal service where shared types aren't critical.
- **Use HttpApi** for production-grade APIs where you want "free" OpenAPI documentation, a type-safe client SDK for your frontend/consumers, and centralized schema management.

---

## Quick Start

### Minimal HttpRouter Server

_Express-like style: define routes, handle requests._

```typescript
import { HttpRouter, HttpServer, HttpServerResponse } from "@effect/platform"
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node"
import { Layer } from "effect"
import { createServer } from "node:http"

// Define router
const router = HttpRouter.empty.pipe(
  HttpRouter.get("/", HttpServerResponse.text("Hello World")),
  HttpRouter.get("/json", HttpServerResponse.json({ message: "Hello" })),
)

// Create server layer
const HttpLive = router.pipe(
  HttpServer.serve(),
  HttpServer.withLogAddress, // Log "Listening on..."
  Layer.provide(NodeHttpServer.layer(createServer, { port: 3000 })),
)

// Run
NodeRuntime.runMain(Layer.launch(HttpLive))
```

### Minimal HttpApi Server

_Schema-first style: define interface, implement it, auto-generate docs._

```typescript
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSwagger,
} from "@effect/platform"
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node"
import { Effect, Layer, Schema } from "effect"
import { createServer } from "node:http"

// 1. Define API Definition
class MyApi extends HttpApi.make("my-api").add(
  HttpApiGroup.make("root").add(
    HttpApiEndpoint.get("hello", "/").addSuccess(Schema.String),
  ),
) {}

// 2. Implement Logic
const MyApiLive = HttpApiBuilder.api(MyApi).pipe(
  Layer.provide(
    HttpApiBuilder.group(MyApi, "root", (handlers) =>
      handlers.handle("hello", () => Effect.succeed("Hello World")),
    ),
  ),
)

// 3. Serve with Swagger
const HttpLive = HttpApiBuilder.serve(HttpApiSwagger.layer()).pipe(
  Layer.provide(MyApiLive),
  Layer.provide(NodeHttpServer.layer(createServer, { port: 3000 })),
)

NodeRuntime.runMain(Layer.launch(HttpLive))
```

---

## Part 1: HttpRouter (Imperative)

The `HttpRouter` is the foundational routing system. It feels very similar to Express or Fastify but uses functional composition.

### Basic Routing

> **Coming from Express?**
>
> | Express                           | Effect HttpRouter                  |
> | --------------------------------- | ---------------------------------- |
> | `app.get('/', (req, res) => ...)` | `HttpRouter.get('/', Effect...)`   |
> | `req.params`                      | `HttpRouter.schemaPathParams`      |
> | `req.body`                        | `HttpServerRequest.schemaBodyJson` |
> | `res.send()`                      | `HttpServerResponse.text()`        |

#### Defining Routes

Routes are defined by piping a router (starting with `HttpRouter.empty`) through route methods.

```typescript
const router = HttpRouter.empty.pipe(
  HttpRouter.get(
    "/users",
    Effect.succeed(HttpServerResponse.text("Get Users")),
  ),
  HttpRouter.post(
    "/users",
    Effect.succeed(HttpServerResponse.text("Create User")),
  ),
  // Supports: get, post, put, patch, del, head, options, all
)
```

#### Path Parameters

Path parameters uses the standard `:param` syntax. You access them via the `HttpRouter.RouteContext` service or helper schemas.

```typescript
import { HttpRouter, HttpServerResponse } from "@effect/platform"
import { Effect, Schema } from "effect"

const router = HttpRouter.empty.pipe(
  HttpRouter.get(
    "/users/:id",
    Effect.gen(function* () {
      // Option 1: Low-level context access
      const context = yield* HttpRouter.RouteContext
      const id = context.params.id

      return HttpServerResponse.text(`User ${id}`)
    }),
  ),

  // Option 2: Validation with Schema (Recommended)
  HttpRouter.get(
    "/items/:itemId",
    HttpRouter.schemaPathParams(
      Schema.Struct({ itemId: Schema.NumberFromString }),
    ).pipe(
      Effect.andThen((params) =>
        HttpServerResponse.text(`Item ID: ${params.itemId}`),
      ),
    ),
  ),
)
```

### Request Handling

Accessing the request details is done via the `HttpServerRequest.HttpServerRequest` service.

#### Reading the Body

```typescript
import { HttpServerRequest } from "@effect/platform"

// JSON Body
const jsonRoute = HttpRouter.post(
  "/json",
  Effect.gen(function* () {
    const body = yield* HttpServerRequest.schemaBodyJson(
      Schema.Struct({
        name: Schema.String,
        age: Schema.Number,
      }),
    )
    return HttpServerResponse.json({ received: body })
  }),
)

// Form Data
const formRoute = HttpRouter.post(
  "/submit",
  Effect.gen(function* () {
    const data = yield* HttpServerRequest.schemaBodyForm(
      Schema.Struct({
        username: Schema.String,
      }),
    )
    return HttpServerResponse.text(`Submitted by ${data.username}`)
  }),
)
```

#### Query Parameters

```typescript
// GET /search?q=effect&page=1
const searchRoute = HttpRouter.get(
  "/search",
  Effect.gen(function* () {
    const query = yield* HttpServerRequest.schemaSearchParams(
      Schema.Struct({
        q: Schema.String,
        page: Schema.optionalWith(Schema.NumberFromString, {
          default: () => 1,
        }),
      }),
    )

    return HttpServerResponse.text(
      `Searching for ${query.q} on page ${query.page}`,
    )
  }),
)
```

### Response Methods

The `HttpServerResponse` module provides helper methods to create responses.

| Method           | Description                                      |
| ---------------- | ------------------------------------------------ |
| `text(string)`   | Plain text response (Content-Type: text/plain)   |
| `json(object)`   | JSON response (Content-Type: application/json)   |
| `html(string)`   | HTML response (Content-Type: text/html)          |
| `empty()`        | 204 No Content                                   |
| `file(path)`     | Serves a file from disk                          |
| `stream(stream)` | Streams data to the client                       |
| `raw`            | Create a raw response with custom headers/status |

```typescript
HttpServerResponse.json(
  { id: 1 },
  { status: 201, headers: { "X-Custom": "Value" } },
)
```

### Middleware

Middleware in Effect are layers or functions that transform an `HttpApp`.

#### Built-in Middleware

```typescript
import { HttpMiddleware, HttpServer } from "@effect/platform"

const app = router.pipe(
  // Logs every request (method, url, status, duration)
  HttpServer.serve(HttpMiddleware.logger),

  // Handles X-Forwarded-For headers (if behind proxy)
  HttpMiddleware.xForwardedHeaders,
)
```

#### Custom Middleware

Middleware is defined using `HttpMiddleware.make`.

```typescript
const myAuthMiddleware = HttpMiddleware.make((app) =>
  Effect.gen(function* () {
    const req = yield* HttpServerRequest.HttpServerRequest
    if (req.headers["authorization"] !== "secret") {
      return HttpServerResponse.text("Unauthorized", { status: 401 })
    }
    return yield* app
  }),
)

// Apply to specific routes
const protectedRouter = HttpRouter.empty.pipe(
  HttpRouter.get("/secrets", HttpServerResponse.text("Secrets!")),
  HttpRouter.use(myAuthMiddleware), // Applies to all routes in this router
)
```

### Error Handling

Use standard Effect error handling (`catchTag`, `catchAll`).

```typescript
const router = HttpRouter.empty.pipe(
  HttpRouter.get("/risky", Effect.fail(new Error("Boom!"))),
)

const app = router.pipe(
  Effect.catchAll((error) =>
    HttpServerResponse.text(error.message, { status: 500 }),
  ),
  HttpServer.serve(),
)
```

### Dependency Injection

You can provide services to your routes just like any other Effect program.

```typescript
// Define a service
class Database extends Context.Tag("Database")<
  Database,
  { getUsers: Effect.Effect<string[]> }
>() {}

// Use in route
const router = HttpRouter.get(
  "/users",
  Effect.gen(function* () {
    const db = yield* Database
    const users = yield* db.getUsers
    return HttpServerResponse.json(users)
  }),
)

// Provide at the server level
const HttpLive = router.pipe(
  HttpServer.serve(),
  Layer.provide(Database.Live), // Provide the implementation
)
```

---

## Part 2: HttpApi (Declarative)

The `HttpApi` system allows you to define your API shape (endpoints, schemas, errors) separately from the implementation. This enables **auto-generated OpenAPI documentation** and **type-safe clients**.

### Core Concepts

1.  **HttpApiEndpoint**: A single route definition (path, method, schemas).
2.  **HttpApiGroup**: A collection of related endpoints (e.g., "users", "posts").
3.  **HttpApi**: The top-level container for all groups.

### 1. Defining the API

```typescript
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
} from "@effect/platform"
import { Schema } from "effect"

// Define Schemas
const User = Schema.Struct({
  id: Schema.Number,
  name: Schema.String,
})

// Define API
export class MyApi extends HttpApi.make("my-api").add(
  // Create a Group
  HttpApiGroup.make("users")
    .prefix("/users") // All routes in this group start with /users
    .add(
      // Define Endpoint: GET /users/:id
      HttpApiEndpoint.get("getUser", "/:id")
        .addSuccess(User) // Response Schema
        .addError(Schema.String, { status: 404 }), // Error Schema
    )
    .add(
      // Define Endpoint: POST /users
      HttpApiEndpoint.post("createUser", "/")
        .setPayload(Schema.Struct({ name: Schema.String })) // Request Body
        .addSuccess(User, { status: 201 }),
    ),
) {}
```

### 2. Implementing the Server

You implement the API by providing handlers for each group using `HttpApiBuilder`.

```typescript
import { HttpApiBuilder } from "@effect/platform"

// Implement the "users" group
const UsersLive = HttpApiBuilder.group(MyApi, "users", (handlers) =>
  handlers
    .handle("getUser", ({ path }) => {
      // 'path' is typed as { id: string } automatically based on the route
      const id = Number(path.id)
      return id === 1 ?
          Effect.succeed({ id: 1, name: "Alice" })
        : Effect.fail("User not found")
    })
    .handle("createUser", ({ payload }) => {
      // 'payload' is typed as { name: string }
      return Effect.succeed({ id: 2, name: payload.name })
    }),
)

// Combine implementations
const ApiLive = HttpApiBuilder.api(MyApi).pipe(Layer.provide(UsersLive))
```

### 3. Serving with Swagger

`HttpApi` makes adding Swagger UI incredibly easy.

```typescript
import { HttpApiSwagger } from "@effect/platform"

const HttpLive = HttpApiBuilder.serve(HttpMiddleware.logger).pipe(
  Layer.provide(HttpApiSwagger.layer()), // Adds /docs endpoint
  Layer.provide(ApiLive),
  Layer.provide(NodeHttpServer.layer(createServer, { port: 3000 })),
)
```

### 4. Deriving a Client

You can generate a fully typed client for your frontend or other services without writing any fetch code.

```typescript
import { HttpApiClient } from "@effect/platform"

const program = Effect.gen(function* () {
  // Create Client
  const client = yield* HttpApiClient.make(MyApi, {
    baseUrl: "http://localhost:3000",
  })

  // Use Client (Fully Typed!)
  const user = yield* client.users.getUser({ path: { id: 1 } })
  console.log(user.name) // "Alice"

  // Error handling is also typed
  const result = yield* client.users
    .getUser({ path: { id: 999 } })
    .pipe(Effect.catchTag("Fail", (e) => Effect.log(`Error: ${e.error}`)))
})
```

### Advanced HttpApi Features

#### Path Parameters (Schema)

For stricter validation of path parameters, use `HttpApiSchema.param` with a tagged template literal.

```typescript
const idParam = HttpApiSchema.param("id", Schema.NumberFromString)

HttpApiEndpoint.get("getUser")`/users/${idParam}`
```

#### Headers & Query Params

Use `setHeaders` and `setUrlParams` to define schemas for headers and query strings.

```typescript
HttpApiEndpoint.get("search", "/search")
  .setUrlParams(Schema.Struct({ q: Schema.String }))
  .setHeaders(Schema.Struct({ "x-api-key": Schema.String }))
```

#### Security

Define security requirements (Bearer, Basic, API Key) for groups or the whole API.

```typescript
import { HttpApiSecurity } from "@effect/platform"

const ProtectedGroup = HttpApiGroup.make("protected")
  .add(HttpApiEndpoint.get("secret", "/").addSuccess(Schema.String))
  .middleware(HttpApiSecurity.bearer) // Requires Bearer token
```

---

## Part 3: HTTP Client

Effect includes a robust HTTP client for making requests to external APIs.

### Basic Usage

```typescript
import { HttpClient, HttpBody, FetchHttpClient } from "@effect/platform"

const program = Effect.gen(function* () {
  const client = yield* HttpClient.HttpClient

  // Simple GET
  const response = yield* client.get("https://api.github.com/users/effect-ts")
  const data = yield* response.json

  // POST with JSON body
  const postRes = yield* client.post("https://api.example.com/data", {
    body: HttpBody.unsafeJson({ key: "value" }),
  })
}).pipe(
  Effect.provide(FetchHttpClient.layer), // Provide 'fetch' implementation
)
```

### Schema Validation

You can validate responses directly against a schema.

```typescript
import { HttpClientResponse } from "@effect/platform"

const UserSchema = Schema.Struct({ login: Schema.String })

const program = Effect.gen(function* () {
  const client = yield* HttpClient.HttpClient
  const response = yield* client.get("https://api.github.com/users/effect-ts")

  // Validates JSON body against schema
  const user = yield* HttpClientResponse.schemaBodyJson(UserSchema)(response)
})
```

---

## Part 4: Testing

Effect makes testing servers easy because `NodeHttpServer` can be swapped for a test layer that bypasses the network stack, or you can run a real server.

### Testing HttpRouter / HttpApi

Use `NodeHttpServer.layerTest` to create a server that listens on a random port and cleans up automatically, or use `makeHandler` for unit tests.

```typescript
// test/main.test.ts
import { describe, it, expect } from "vitest"
import { Effect, Layer } from "effect"
import { HttpClient, FetchHttpClient } from "@effect/platform"
import { NodeHttpServer } from "@effect/platform-node"
import { createServer } from "node:http"
import { appLayer } from "../src/main" // Your app layer

describe("Server", () => {
  it("responds to hello", () =>
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient
      const response = yield* client.get("/")
      const text = yield* response.text
      expect(text).toBe("Hello World")
    }).pipe(
      Effect.provide(FetchHttpClient.layer),
      // Uses a real server on a random port for testing
      Effect.provide(NodeHttpServer.layerTest(createServer, { port: 0 })),
      Effect.provide(appLayer),
      Effect.runPromise,
    ))
})
```

---

## Part 5: Temporary Servers & Lifecycle Management

Sometimes you need a server that starts, waits for something to happen, and then shuts down automatically. Common use cases:

- **OAuth callbacks** - Start server, wait for auth redirect, shut down
- **CLI tools** - Temporarily serve content during a command
- **Webhooks** - Receive a single webhook, then exit
- **One-shot APIs** - Serve a request, then terminate

### Key Concepts

| Concept              | Description                                                              |
| -------------------- | ------------------------------------------------------------------------ |
| `HttpServer.serve()` | Returns a `Layer` - designed for long-running servers via `Layer.launch` |
| `serveEffect()`      | Returns an `Effect` requiring `Scope` - designed for temporary servers   |
| `Effect.scoped`      | Manages resource lifecycle - server shuts down when scope closes         |
| `Deferred`           | A one-time signal to coordinate when to stop waiting                     |

### What is Deferred?

`Deferred<A, E>` is an asynchronous variable that can be set **exactly once**. It allows multiple fibers (Effect's lightweight threads) to suspend by calling `Deferred.await` and automatically resume when the value is set.

Think of it as a "promise you can complete from the outside" — but integrated with Effect's type system and fiber model.

#### Core Methods

| Method                       | Returns            | Description                                     |
| ---------------------------- | ------------------ | ----------------------------------------------- |
| `Deferred.make<A, E>()`      | `Effect<Deferred>` | Creates a new empty Deferred                    |
| `Deferred.await(d)`          | `Effect<A, E>`     | Suspends the fiber until completed, returns `A` |
| `Deferred.succeed(d, value)` | `Effect<boolean>`  | Completes with a success value                  |
| `Deferred.fail(d, error)`    | `Effect<boolean>`  | Completes with an error                         |
| `Deferred.complete(d, eff)`  | `Effect<boolean>`  | Completes with the result of another Effect     |
| `Deferred.isDone(d)`         | `Effect<boolean>`  | Checks if already completed (non-blocking)      |

The `boolean` return indicates whether the completion was successful (`true`) or if the Deferred was already completed (`false`).

#### Deferred vs JavaScript Promise

| Aspect               | `Promise<A>`                      | `Deferred<A, E>`                              |
| -------------------- | --------------------------------- | --------------------------------------------- |
| **Completion**       | Resolved inside executor          | Completed externally via `succeed`/`fail`     |
| **Type Safety**      | Single type, errors are `unknown` | Separate `A` (success) and `E` (error) types  |
| **Multiple Waiters** | Typically one consumer            | Multiple fibers can `await` the same Deferred |
| **Interruption**     | No built-in support               | Supports `Deferred.interrupt`                 |
| **Execution**        | Eager (runs immediately)          | Lazy (nothing happens until Effects run)      |

#### Why Use Deferred?

Deferred is essential when you need **coordination between concurrent operations**:

```typescript
// Example: One fiber waits, another completes
const program = Effect.gen(function* () {
  const signal = yield* Deferred.make<string>()

  // Fork a fiber that waits for the signal
  const waiter = yield* Effect.fork(
    Effect.gen(function* () {
      yield* Effect.log("Waiting for signal...")
      const value = yield* Deferred.await(signal)
      yield* Effect.log(`Received: ${value}`)
    }),
  )

  // Complete the signal after a delay
  yield* Effect.sleep("1 second")
  yield* Deferred.succeed(signal, "Hello!")

  // Wait for the waiter to finish
  yield* Fiber.join(waiter)
})
```

In the context of temporary servers, `Deferred` lets us:

1. **Start a server** that listens for requests
2. **Wait** (`Deferred.await`) until a specific request arrives
3. **Signal** (`Deferred.succeed`) from the request handler with captured data
4. **Shut down** automatically when the scope closes after `await` returns

### Basic Temporary Server

The simplest temporary server that runs for a fixed duration:

```typescript
import { HttpRouter, HttpServer, HttpServerResponse } from "@effect/platform"
import { NodeHttpServer } from "@effect/platform-node"
import { Effect } from "effect"
import { createServer } from "node:http"

const router = HttpRouter.empty.pipe(
  HttpRouter.get("/", HttpServerResponse.text("Hello!")),
)

const program = Effect.gen(function* () {
  // Start serving (runs until scope closes)
  yield* router.pipe(HttpServer.serveEffect())

  yield* Effect.log("Server is running...")

  // Server stays alive for 10 seconds, then shuts down
  yield* Effect.sleep("10 seconds")

  yield* Effect.log("Shutting down...")
}).pipe(
  // CRITICAL: Effect.scoped manages the server lifecycle
  Effect.scoped,
  Effect.provide(NodeHttpServer.layer(createServer, { port: 3000 })),
)

Effect.runPromise(program)
```

**How it works:**

1. `HttpServer.serveEffect()` starts the server but requires a `Scope`
2. The server runs while the `Effect.gen` block executes
3. When the scope closes (after `Effect.sleep` completes), the server automatically shuts down
4. `Effect.scoped` provides and manages that scope

### Wait for Specific Request, Then Shut Down

Use `Deferred` to wait for a specific event before shutting down:

```typescript
import { HttpRouter, HttpServer, HttpServerResponse } from "@effect/platform"
import { NodeHttpServer } from "@effect/platform-node"
import { Deferred, Effect } from "effect"
import { createServer } from "node:http"

const waitForPing = Effect.gen(function* () {
  // Create a signal that will be triggered when /ping is hit
  const pinged = yield* Deferred.make<string>()

  const router = HttpRouter.empty.pipe(
    HttpRouter.get(
      "/ping",
      Effect.gen(function* () {
        // Signal that we received the ping
        yield* Deferred.succeed(pinged, "pong")
        return HttpServerResponse.text("Pong! Server shutting down...")
      }),
    ),
    HttpRouter.get(
      "/",
      HttpServerResponse.text("Hit /ping to stop the server"),
    ),
  )

  // Start the server
  yield* router.pipe(HttpServer.serveEffect())

  yield* Effect.log("Server running on http://localhost:3000")
  yield* Effect.log("Visit /ping to shut it down")

  // Wait until someone hits /ping
  const result = yield* Deferred.await(pinged)

  yield* Effect.log(`Received: ${result}. Shutting down...`)

  return result
}).pipe(
  Effect.scoped,
  Effect.provide(NodeHttpServer.layer(createServer, { port: 3000 })),
)

Effect.runPromise(waitForPing).then(console.log)
```

**Flow:**

1. Server starts and listens on port 3000
2. `Deferred.await(pinged)` blocks until the deferred is completed
3. When `/ping` is hit, `Deferred.succeed(pinged, "pong")` completes the deferred
4. The `await` unblocks, the scope closes, and the server shuts down

### Returning Data from Callback

A more practical example that captures data from the request:

```typescript
import {
  HttpRouter,
  HttpServer,
  HttpServerRequest,
  HttpServerResponse,
} from "@effect/platform"
import { NodeHttpServer } from "@effect/platform-node"
import { Deferred, Effect, Schema } from "effect"
import { createServer } from "node:http"

// Schema for expected callback parameters
const CallbackParams = Schema.Struct({
  token: Schema.String,
  userId: Schema.String,
})
type CallbackData = typeof CallbackParams.Type

const waitForCallback = (port: number) =>
  Effect.gen(function* () {
    const callback = yield* Deferred.make<CallbackData>()

    const router = HttpRouter.empty.pipe(
      HttpRouter.get(
        "/callback",
        Effect.gen(function* () {
          const params =
            yield* HttpServerRequest.schemaSearchParams(CallbackParams)

          // Capture the data
          yield* Deferred.succeed(callback, params)

          return HttpServerResponse.html(`
            <html>
              <body>
                <h1>Success!</h1>
                <p>You can close this window.</p>
              </body>
            </html>
          `)
        }),
      ),
    )

    yield* router.pipe(HttpServer.serveEffect())

    yield* Effect.log(
      `Waiting for callback on http://localhost:${port}/callback`,
    )

    // Wait for and return the callback data
    return yield* Deferred.await(callback)
  }).pipe(
    Effect.scoped,
    Effect.provide(NodeHttpServer.layer(createServer, { port })),
  )

// Usage
const program = Effect.gen(function* () {
  yield* Effect.log("Starting callback server...")

  const data = yield* waitForCallback(8080)

  yield* Effect.log(`Received token: ${data.token}`)
  yield* Effect.log(`User ID: ${data.userId}`)

  // Continue with the captured data...
  return data
})

Effect.runPromise(program)
```

### Adding a Timeout

Combine with `Effect.timeout` to avoid waiting forever:

```typescript
import { HttpRouter, HttpServer, HttpServerResponse } from "@effect/platform"
import { NodeHttpServer } from "@effect/platform-node"
import { Deferred, Duration, Effect, Option } from "effect"
import { createServer } from "node:http"

const waitForCallbackWithTimeout = Effect.gen(function* () {
  const received = yield* Deferred.make<string>()

  const router = HttpRouter.empty.pipe(
    HttpRouter.get(
      "/callback",
      Effect.gen(function* () {
        yield* Deferred.succeed(received, "data")
        return HttpServerResponse.text("OK")
      }),
    ),
  )

  yield* router.pipe(HttpServer.serveEffect())

  // Wait with timeout
  const result = yield* Deferred.await(received).pipe(
    Effect.timeout(Duration.seconds(30)),
  )

  // result is Option<string> - None if timed out
  if (Option.isNone(result)) {
    return yield* Effect.fail(new Error("Callback timed out after 30 seconds"))
  }

  return result.value
}).pipe(
  Effect.scoped,
  Effect.provide(NodeHttpServer.layer(createServer, { port: 3000 })),
)
```

### Comparison: `serve()` vs `serveEffect()`

| Aspect          | `HttpServer.serve()`            | `HttpServer.serveEffect()`              |
| --------------- | ------------------------------- | --------------------------------------- |
| **Returns**     | `Layer`                         | `Effect` (requires `Scope`)             |
| **Lifecycle**   | Runs forever via `Layer.launch` | Runs until scope closes                 |
| **Use case**    | Long-running production servers | Temporary servers, CLI tools, tests     |
| **Shutdown**    | Process termination / signal    | Automatic when scope ends               |
| **Composition** | Layer composition               | Effect composition with `Effect.scoped` |

```typescript
// Long-running server (Layer approach)
const HttpLive = router.pipe(
  HttpServer.serve(),
  Layer.provide(NodeHttpServer.layer(createServer, { port: 3000 })),
)
NodeRuntime.runMain(Layer.launch(HttpLive))

// Temporary server (Effect approach)
const temporary = router.pipe(
  HttpServer.serveEffect(),
  Effect.scoped,
  Effect.provide(NodeHttpServer.layer(createServer, { port: 3000 })),
)
Effect.runPromise(temporary)
```

---

## Part 6: Advanced & Experimental

### HttpLayerRouter (Experimental)

A simplified way to declare routes and services using Layers directly, useful for modular architectures.

```typescript
import { HttpLayerRouter, HttpServerResponse } from "@effect/platform"
import { Layer, Effect } from "effect"

// Define a route as a Layer
const HelloRoute = HttpLayerRouter.add(
  "GET",
  "/hello",
  HttpServerResponse.text("Hello")
)

// Serve
HttpLayerRouter.serve(HelloRoute).pipe(...)
```

### RPC (Remote Procedure Call)

Effect has a dedicated `@effect/rpc` package that integrates seamlessly with `HttpRouter`. It allows you to define functions on the server and call them from the client as if they were local functions, handling all serialization/deserialization automatically.

---

## Quick Reference

### HttpRouter vs Express

| Task               | Express                          | Effect HttpRouter                              |
| ------------------ | -------------------------------- | ---------------------------------------------- |
| **Create router**  | `express.Router()`               | `HttpRouter.empty`                             |
| **GET route**      | `app.get(path, fn)`              | `HttpRouter.get(path, effect)`                 |
| **Get path param** | `req.params.id`                  | `HttpRouter.RouteContext` / `schemaPathParams` |
| **Get body**       | `req.body`                       | `HttpServerRequest.schemaBodyJson(Schema)`     |
| **JSON response**  | `res.json(data)`                 | `HttpServerResponse.json(data)`                |
| **Mount router**   | `app.use('/api', router)`        | `HttpRouter.mount('/api', router)`             |
| **Middleware**     | `app.use(fn)`                    | `HttpRouter.use(fn)` or `HttpServer.serve(fn)` |
| **Error handling** | `app.use((err, req, res, next))` | `Effect.catchTag` / `catchAll`                 |

### HttpApi Cheat Sheet

```typescript
// 1. Definition
HttpApiEndpoint.get("name", "/path")
  .setPayload(Schema)      // Request Body
  .addSuccess(Schema)      // Response Body
  .addError(Schema)        // Error Response

// 2. Implementation
HttpApiBuilder.group(Api, "group", handlers =>
  handlers.handle("name", ({ payload }) => ...)
)

// 3. Client
const client = yield* HttpApiClient.make(Api, { baseUrl: "..." })
const result = yield* client.group.name({ payload: ... })
```
