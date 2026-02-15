# AI Context for Contributors

## Purpose
Quick context for AI-assisted development in this repository.

## Monorepo essentials
- Package manager: `pnpm`
- Language: TypeScript (ES modules)
- Root quality scripts:
  - `pnpm lint`
  - `pnpm typecheck`
  - `pnpm test`

## Key paths
- Logger package: `packages/logger/src`
- Scraper package: `packages/scraper/src`
- Scraper tests: `packages/scraper/src/**/*.test.ts`
- Native setup script: `packages/scraper/scripts/ensure-ulixee-native.mjs`

## Scraper architecture patterns
- Engine contract: `WebEngine`
- Parsing contract: `WebContentParser<InputType, OutputType>`
- Result pattern: discriminated union fetch response with:
  - success branch (`success: true`, `content`, `metadata`)
  - error branch (`success: false`, `errorCode`, `metadata`)

## Typical change types
1. Add/improve parser logic in `web-engine/scraper`.
2. Add/improve search provider logic in `web-engine/search`.
3. Improve URL/util parsing in `src/utils` with tests.
4. Tighten typing and metadata handling in web-engine interfaces.

## Done criteria
- Type-safe code compiles.
- Existing tests pass.
- New behavior includes tests when applicable.
- No unrelated refactors mixed into the change.
