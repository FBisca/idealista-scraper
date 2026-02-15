# AGENTS Playbook

This file defines common guidance for AI coding agents (Copilot, Cursor, Claude Code, etc.) in this repository.

## Mission
Deliver minimal, production-ready changes for this monorepo while preserving existing architecture and conventions.

## Repository map
- `packages/logger`: shared logging package.
- `packages/scraper`: scraping engines, parsers, URL utilities, and tests.
- Native/runtime helper scripts:
  - `packages/scraper/scripts/ensure-ulixee-native.mjs`

## Working agreement
- Make the smallest useful change that solves the requested problem.
- Keep changes localized; avoid broad refactors unless explicitly requested.
- Prefer existing abstractions over introducing new frameworks/patterns.
- Update docs/tests together with behavior changes.

## Implementation checklist
1. Understand impacted package(s) and API surface.
2. Implement root-cause fix (not superficial patch).
3. Run focused checks first, then broader checks:
   - package-level test/lint/typecheck
   - root `pnpm lint`, `pnpm typecheck`, `pnpm test` if needed
4. Summarize:
   - what changed
   - why
   - validation performed

## Style expectations
- TypeScript-first with explicit exported types.
- Avoid `any` and unnecessary casting.
- Keep functions small and composable.
- Avoid changing formatting conventions beyond touched code.

## Dependency policy
- Prefer zero new dependencies.
- If adding one, justify necessity and keep it well-maintained.
- Ensure new dependencies are compatible with Node 22 and pnpm workspace usage.

## Native dependency caveats
When touching install/runtime scripts, preserve the current native reliability flow:
- `better-sqlite3` rebuild path via `pnpm native:rebuild`
- Ulixee MitmSocket binary checks through `ensure-ulixee-native.mjs`
