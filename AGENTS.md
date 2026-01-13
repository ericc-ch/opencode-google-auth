# OpenCode Google Auth Plugin

OpenCode plugin providing OAuth authentication for Google AI services. Supports two providers:

- **Gemini CLI** - production Google AI via `cloudcode-pa.googleapis.com`
- **Antigravity** - internal Google AI via `daily-cloudcode-pa.sandbox.googleapis.com`

## Development Commands

- **Build**: `bun run build` (Pre-fetching models and bundling via tsdown)
- **Lint**: `bun run lint` (Uses oxlint for high-performance linting)
- **Typecheck**: `bun run typecheck` (Uses tsgo/tsc for type safety)
- **Format**: `bun run format` (Uses prettier)
- **Test All**: `bun test`
- **Single Test**: `bun test <path>` (e.g., `bun test src/services/config.test.ts`)

**Workflow**: Always run `bun run lint`, `bun run typecheck`, and `bun test` before committing.

## Code Style & Guidelines

This project heavily utilizes **Effect-TS** for functional programming, dependency injection, and error handling. Adherence to these patterns is mandatory.

### 1. Functional Programming (Effect-TS)

- **Favor Immutability**: Use `const` over `let`. Avoid mutations.
- **Effect.gen**: Use generator functions (`Effect.gen` and `yield*`) for linear-looking async/effectful code.
- **Piping**: Use `pipe(value, fn1, fn2)` for complex data transformations.
- **Error Handling**: Use `Data.TaggedError` for custom errors. Avoid `try/catch`; use `Effect.tryPromise` or `Effect.catchTag`.
- **Services**: Define shared logic as `Effect.Service`. Access them via `yield* ServiceName`.

### 2. Naming Conventions

- **Files**: Use `kebab-case` for all files (e.g., `request-transformer.ts`).
- **Classes/Services/Interfaces**: Use `PascalCase` (e.g., `OAuth`, `ProviderConfig`).
- **Variables/Functions**: Use `camelCase`.
- **Constants**: Use `SCREAMING_SNAKE_CASE` for global constants.
- **Effect Tags**: Use `PascalCase` matching the service name.

### 3. Imports & Types

- **Imports**: Group imports (Built-ins, Third-party, Internal).
- **TypeScript**: Use `strict` mode. Leverage `satisfies` for type-checking literals without losing specific type info.
- **Readonly**: Prefer `readonly` for interface properties and arrays to enforce immutability.
- **Schemas**: Use `Schema` from `effect` for runtime validation and type inference.

### 4. General Best Practices

- **Early Returns**: Favor early returns over nested `if/else` blocks.
- **Bun APIs**: Prefer Bun native APIs (e.g., `Bun.file()`, `crypto.randomUUID()`) over Node.js equivalents where possible.
- **Logging**: Use `Effect.log`, `Effect.logDebug`, `Effect.logError` instead of `console.log`.
- **No Semicolons**: Follow the project's semicolon-free style.

## Architecture

The project is structured around Effect Layers and Services:

- **`src/main.ts`**: Plugin entry points.
- **`src/lib/runtime.ts`**: Manages the `ManagedRuntime` and Layer composition.
- **`src/services/`**: Core business logic (Auth, Session, Config).
- **`src/transform/`**: Logic for mapping OpenCode requests/responses to Google AI APIs.

### Service Pattern Example

```typescript
export class MyService extends Effect.Service<MyService>()("MyService", {
  effect: Effect.gen(function* () {
    // service implementation
    return {
      doWork: () => Effect.succeed("done"),
    }
  }),
}) {}
```

## Provider-Specific Details

### Model Names

Model names are strictly mapped in `src/services/config.ts`. Do NOT assume standard Gemini names work across both providers.

| Source      | Primary Models                                            |
| ----------- | --------------------------------------------------------- |
| Gemini CLI  | `gemini-3-flash-preview`, `gemini-3-pro-preview`          |
| Antigravity | `gemini-3-flash`, `gemini-3-pro-low`, `gemini-3-pro-high` |

### Antigravity Transformation

- **Base URL**: Set at plugin registration via config hook.
- **Body Wrapping**: Antigravity requires a specific wrapper:
  ```json
  {
    "project": "...",
    "model": "...",
    "request": { ... },
    "requestType": "agent",
    "userAgent": "antigravity",
    "requestId": "..."
  }
  ```
- **Claude Models**: Require special handling for `thinkingConfig` (converting camelCase to snake_case) and setting `anthropic-beta` headers.

## Git & Commits

- **Conventional Commits**: Use `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`.
- **Casing**: All commit messages should be lowercase (e.g., `feat: implement oauth flow`).
- **Hooks**: Ensure linting and typechecking pass before pushing.

## Context & Reference Material

The `.context/` directory contains reference source code and documentation for the technologies and ecosystems this project integrates with. Agents should consult these when they need examples or technical specifications.

- **`.context/effect/`**: Full reference for **Effect-TS**. Use this to understand advanced patterns, internal service implementations, and library conventions.
- **`.context/opencode/`**: Reference for the **OpenCode SDK** and core infrastructure. Use this to understand how plugins are registered, context objects, and available tool definitions.
- **`.context/opencode-google-antigravity-auth/`**: Reference for similar auth implementations or related antigravity logic.

## Verification Checklist

1. `bun run format` - code is pretty
2. `bun run lint` - no lint errors
3. `bun run typecheck` - no type errors
4. `bun test` - all tests pass
5. Verify `antigravity` vs `gemini-cli` logic if modifying shared transformers.
