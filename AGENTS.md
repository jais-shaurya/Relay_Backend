# Repository Guidelines

## Project Structure & Module Organization

`src/app.ts` is the Express application entry point. Keep HTTP routes in `src/routes/`, request middleware in `src/middleware/`, infrastructure integrations in `src/services/`, shared types in `src/types/`, and helpers in `src/utils/`. Firebase setup belongs in `src/config/`. The Prisma 8 database contract and client are under `src/prisma/`; migration plans and snapshots are under `migrations/`. Generated JavaScript and declarations go to `dist/`.

## Build, Test, and Development Commands

- `npm install` installs dependencies from the lockfile.
- `npm run dev` compiles TypeScript with `tsc -b` and starts `dist/app.js`. Configure required environment variables first.
- `npm run contract:emit` emits Prisma contract artifacts after changing `src/prisma/contract.prisma`.
- `npx prisma migration plan --name <change>` creates a migration plan; review its output and artifacts before applying database changes.
- `npx prisma db migrate --advance-ref db` advances the configured database reference. Use only when intentionally applying migrations to that database.

There are currently no test, lint, or formatting scripts in `package.json`.

## Coding Style & Naming Conventions

Use TypeScript with strict compiler settings and ES module imports. Follow the existing two-space indentation and single-quoted strings. Use descriptive `camelCase` names for variables, functions, and files; use `PascalCase` for types and classes. Keep route handlers focused on HTTP concerns and put external system logic in services. Do not hand-edit generated Prisma contract outputs; regenerate them from the contract.

## Testing Guidelines

No test framework or test suite is currently configured. For changes, at minimum run `npm run dev` to check compilation and startup; add focused tests when introducing a test framework or testable business logic. Do not claim test coverage where none exists.

## Commit & Pull Request Guidelines

The existing history uses short, imperative summaries (for example, `feat: Added Github 0auth using firebase auth`). Prefer conventional prefixes such as `feat:`, `fix:`, and `docs:` with a concise description. Pull requests should explain the change and its motivation, note validation performed, link related issues, and call out schema or migration effects. Include request/response examples for API changes.

## Security & Configuration

Keep credentials and local secrets in environment configuration; never commit real tokens, service account keys, or database URLs. Use `.env.example` to document required variable names without secret values. Verify `DATABASE_URL` and target environment before running migration commands.
