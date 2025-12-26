Development Commands

- Build: bun run build (uses tsdown)
- Lint: bun run lint (uses oxlint)
- Typecheck: bun run typecheck (uses tsc)
- Format: bun run format (uses prettier)
- Test: bun test
- Single Test: bun test <path> (e.g., bun test src/lib/auth/gemini.test.ts)

IMPORTANT: Always run bun run lint and bun run typecheck after completing a task to ensure code quality.

Code Style & Guidelines

IMPORTANT: Context: Always check inside .context/ for reference before starting. Do not assume; double-check against existing implementations to ensure consistency.

- Avoid else and let; favor early returns and const.
- Avoid destructuring where it reduces clarity.
- Use Bun APIs (e.g., Bun.file()) over Node.js equivalents.
- Commits: Use conventional commits with concise, all lowercase messages (e.g., feat: add google auth).
