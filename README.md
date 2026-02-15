# idealista-scraper monorepo

pnpm + TypeScript monorepo with workspace packages under `packages/`.

## Workspace packages

- `@workspace/logger` - shared logging utilities.
- `@workspace/scraper` - scraping engines and parsers (Ulixee + Axios).

## Requirements

- Node.js `>=22` recommended.
- pnpm `10.x`.

## Install

```bash
pnpm install
```

## Important native/runtime dependencies

Some dependencies need native artifacts at install time:

- Build approval is preconfigured in [pnpm-workspace.yaml](pnpm-workspace.yaml) via `onlyBuiltDependencies` for:
  - `better-sqlite3`
  - `@ulixee/unblocked-agent-mitm-socket`
  - `@ulixee/chrome-139-0`
  - `@ulixee/chrome-143-0`

- `@ulixee/unblocked-agent-mitm-socket`
  - Needs a platform binary at `dist/<platform>/connect`.
  - This repo now auto-checks and auto-installs it via:
    - `packages/scraper/scripts/ensure-ulixee-native.mjs`
    - hooked in `@workspace/scraper` `postinstall` script.

- `better-sqlite3`
  - Uses prebuilt binaries when available (or local build toolchain if needed).
  - Explicit recovery command is included via root script: `pnpm native:rebuild`.

## Run

Necessary to start the Browser instance before scraping

```bash
pnpm browser:start
```

## CLI usage

Show help:

```bash
pnpm cli:help
```

List command examples:

```bash
pnpm cli list --url="venta-viviendas/madrid-madrid/con-precio-hasta_360000,precio-desde_175000,metros-cuadrados-mas-de_40,solo-pisos,ascensor,plantas-intermedias,buen-estado/"
pnpm cli list --url="https://www.idealista.com/venta-viviendas/madrid-madrid/"
pnpm cli list --url="https://www.idealista.com/venta-viviendas/madrid-madrid/" --maxPages=3
pnpm cli list --url="https://www.idealista.com/venta-viviendas/madrid-madrid/" --sortBy=lowest-price
pnpm cli list --url="https://www.idealista.com/venta-viviendas/madrid-madrid/" --skipPages=2
pnpm cli list --url="https://www.idealista.com/venta-viviendas/madrid-madrid/" --headless=false
pnpm cli list --url="https://www.idealista.com/venta-viviendas/madrid-madrid/" --outputFile="./tmp/listings.json"
pnpm cli list --url="https://www.idealista.com/venta-viviendas/madrid-madrid/" --pretty
```

List options:

- `--url` Required. Accepts full URL or Idealista path.
- `--outputFile` Optional. Writes JSON output to the given file path.
- `--sortBy` Optional. One of:
  - `relevance`
  - `lowest-price`
  - `highest-price`
  - `newest`
  - `oldest`
  - `biggest-price-drop`
  - `lowest-price-per-sqm`
  - `highest-price-per-sqm`
  - `largest-area`
  - `smallest-area`
  - `highest-floor`
  - `lowest-floor`
- `--maxPages` Optional. Maximum number of pages to fetch (default: `1`).
- `--skipPages` Optional. Starts at `pagina-(skipPages+1).htm` (default: `0`).
- `--headless` Optional. Use `false` to show browser (default: `true`).
- `--pretty` Optional. Pretty-print JSON output.

## Quality checks

```bash
pnpm lint
pnpm typecheck
pnpm test
```

## AI Enablement

This repository is prepared for AI-assisted development with common instruction patterns:

- Copilot repo instructions: `.github/copilot-instructions.md`
- Cross-agent playbook (Cursor/Claude/Copilot): `AGENTS.md`
- Claude-specific entrypoint: `CLAUDE.md`
- Cursor-specific entrypoint: `.cursorrules`
- AI contributor context: `docs/ai/context.md`
- Reusable prompt library: `docs/ai/prompt-templates.md`

Recommended flow when using an AI coding agent:

1. Read `AGENTS.md` and `docs/ai/context.md`.
2. Start from a template in `docs/ai/prompt-templates.md`.
3. Keep edits minimal and package-scoped.
4. Validate with:

```bash
pnpm lint
pnpm typecheck
pnpm test
```

## Parser plugins (conditional HTML parsing)

`@workspace/scraper` now supports parser plugins with conditions:

- `plugins` are evaluated in order.
- First plugin whose `applies(...)` returns `true` is used.
- If none match, `htmlParser` is used as fallback.

Plugin API is exported from the package root:

- `ContentParserPlugin`
- `WebContentParser`
- `resolveParserWithPlugins`
- `ParseContext`

Engines now pass rich context before parsing:

- Ulixee: request/final URL, title, HTML, domain, CAPTCHA signal, session/runtime metadata.
- Axios: request headers, response status/headers, request/final URL.

## Troubleshooting Ulixee MitmSocket binary

If you ever see a missing file error for:

`@ulixee/unblocked-agent-mitm-socket/dist/<platform>/connect`

run:

```bash
pnpm --filter @workspace/scraper exec node ./scripts/ensure-ulixee-native.mjs
```

If needed, force reinstall + rebuild:

```bash
rm -rf node_modules pnpm-lock.yaml
pnpm install
pnpm rebuild @ulixee/unblocked-agent-mitm-socket
```

## Troubleshooting better-sqlite3 native binding

If you get native module load/build errors for `better-sqlite3`, run:

```bash
pnpm native:rebuild
```

This rebuilds `better-sqlite3` and re-checks the Ulixee MitmSocket native binary.
