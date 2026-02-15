# Copilot Instructions for `idealista-scraper`

## Project overview
- Monorepo managed with `pnpm` workspaces.
- Main packages:
  - `@workspace/logger` (`packages/logger`)
  - `@workspace/scraper` (`packages/scraper`)
- Runtime focus: web scraping and content extraction through Axios and Ulixee engines.

## Tech stack
- TypeScript (ESM)
- Node.js `>=22`
- pnpm `10.x`
- Vitest for tests (`packages/scraper`)
- ESLint + Prettier

## Required workflow for code changes
1. Prefer minimal, targeted edits.
2. Keep public APIs stable unless explicitly requested.
3. Preserve existing naming and file layout patterns.
4. For new behavior, update or add focused tests when a nearby test pattern exists.
5. Run relevant checks before finishing:
   - `pnpm lint`
   - `pnpm typecheck`
   - `pnpm test`

## Coding conventions
- Use explicit TypeScript types for exported APIs.
- Avoid `any`; prefer generics and narrow unions.
- Keep pure logic in small reusable functions under `src/utils` or feature-local modules.
- Avoid one-letter variable names.
- Do not add inline comments unless requested.
- Prefer descriptive error messages and discriminated unions for result types.

## Scraper-specific guidance
- Use existing abstractions in `packages/scraper/src/web-engine`:
  - `WebEngine`
  - `WebContentParser`
  - fetch response union types (`success` / `errorCode`).
- New engines/parsers should follow existing folder structure:
  - `web-engine/scraper/*`
  - `web-engine/search/*`
- Preserve metadata fields and include method/duration where applicable.
- Treat blocked/captcha flows as first-class outcomes, not generic failures.

## Safety and reliability
- Never hardcode secrets, tokens, or credentials.
- Keep network retries/timeouts explicit and bounded.
- Fail gracefully with typed errors (`'blocked' | 'unexpected'` when applicable).
- Do not introduce dependencies unless justified by clear value.

## PR quality bar
- Scope is small and coherent.
- Behavior change is documented in README or relevant doc when user-facing.
- No unrelated refactors bundled in the same change.
