## Development Commands

- Build/Lint: `bun run build`, `bun run lint`
- Typecheck: `bun run typecheck`
- Format: `bun run format` (uses `prettier` with `semi: false`)
- Test: `bun test`
- Single Test: `bun test <path>` (e.g., `bun test src/plugin/token.test.ts`)
- Dev: `bun run src/cli.ts`

> [!IMPORTANT]
> Always run `bun run lint` and `bun run typecheck` after completing a task to ensure code quality.

## Code Style & Guidelines

- **Context:** Check inside `.context/` for reference. Do not assume; double-check against existing implementations.
- **Imports:** Group by (1) built-in, (2) external, (3) internal. Use relative paths.
- **Types:** Strict TypeScript; avoid `any`. Prefer explicit return types.
- **Logic:**
  - Keep logic in one function unless it is clearly reusable.
  - Avoid `else` and `let`; favor early returns and `const`.
  - Avoid `try/catch` and destructuring where possible.
  - Use Bun APIs (e.g., `Bun.file()`) over Node.js equivalents.
- **Naming:** CamelCase. Prefer concise/single-word internal variable names.
- **Formatting:** Prettier is used. Follow the existing `semi: false` convention.
- **Commits:** Use conventional commits with concise, all lowercase messages (e.g., `feat: add google auth`).
