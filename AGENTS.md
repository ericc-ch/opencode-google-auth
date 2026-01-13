# OpenCode Google Auth Plugin

OpenCode plugin providing OAuth authentication for Google AI services. Supports two providers:

- **Gemini CLI** - production Google AI via `cloudcode-pa.googleapis.com`
- **Antigravity** - internal Google AI via `daily-cloudcode-pa.sandbox.googleapis.com`

## Development Commands

- Build: `bun run build` (uses tsdown)
- Lint: `bun run lint` (uses oxlint)
- Typecheck: `bun run typecheck` (uses tsc)
- Format: `bun run format` (uses prettier)
- Test: `bun test`
- Single Test: `bun test <path>` (e.g., `bun test src/lib/auth/gemini.test.ts`)

IMPORTANT: Always run `bun run lint`, `bun run typecheck`, and `bun test` after completing code tasks.

## Code Style & Guidelines

- Avoid `else` and `let`; favor early returns and `const`
- Avoid destructuring where it reduces clarity
- Use Bun APIs (e.g., `Bun.file()`) over Node.js equivalents
- Commits: conventional commits, all lowercase (e.g., `feat: add google auth`)

## Architecture

- **Effect-TS** for functional effects, dependency injection, and runtime
- **Bun** as the runtime (not Node.js)
- Provider configs in `src/lib/services/config.ts` define OAuth credentials, endpoints, headers, and `getConfig()` functions

### Key Files

- `src/main.ts` - plugin entry point, defines `geminiCli` and `antigravity` plugins
- `src/transform/request.ts` - transforms requests (URL pathname, headers, body wrapping)
- `src/lib/services/config.ts` - provider configurations with `getConfig()` for model fetching

## Provider-Specific Gotchas

### Model Names

Model names differ between providers. Do NOT assume they are the same.

| Source      | Model Name                                                |
| ----------- | --------------------------------------------------------- |
| Gemini CLI  | `gemini-3-flash-preview`, `gemini-3-pro-preview`          |
| Antigravity | `gemini-3-flash`, `gemini-3-pro-low`, `gemini-3-pro-high` |

- The `antigravity-` prefix in reference code is internal routing only, not what the API expects

### Request Transformation

- Base URL is set at plugin registration via config hook, NOT in `transformRequest`
- `transformRequest` only modifies pathname (e.g., `/v1internal:streamGenerateContent`)
- Antigravity requires wrapped body: `{ project, model, request, requestType, userAgent, requestId }`
