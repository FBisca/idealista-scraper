# idealista-scraper

TypeScript monorepo for scraping and parsing real-estate listing pages (focused on Idealista), with a CLI entrypoint and pluggable parser architecture.

## Architecture overview

### Engines

- **Ulixee engine**: browser-backed fetch, better for dynamic/anti-bot-sensitive pages.
- **Axios engine**: lightweight HTTP fetch path for simpler cases. (Idealista might block it)

## Requirements

- Node.js `>=22` (recommended).
- pnpm `10.x`.

## Install

```bash
pnpm install
```

## Runtime setup

Start local browser/cloud runtime before scraping:

```bash
pnpm browser:start
```

## CLI usage

Show help:

```bash
pnpm cli:help
```

Basic scrape:

```bash
pnpm cli list --url="https://www.idealista.com/venta-viviendas/madrid-madrid/"
```

More examples:

```bash
pnpm cli list --url="venta-viviendas/madrid-madrid/con-precio-hasta_360000,precio-desde_175000,metros-cuadrados-mas-de_40,solo-pisos,ascensor,plantas-intermedias,buen-estado/"
pnpm cli list --url="https://www.idealista.com/venta-viviendas/madrid-madrid/" --maxPages=3
pnpm cli list --url="https://www.idealista.com/venta-viviendas/madrid-madrid/" --sortBy=lowest-price
pnpm cli list --url="https://www.idealista.com/venta-viviendas/madrid-madrid/" --skipPages=2
pnpm cli list --url="https://www.idealista.com/venta-viviendas/madrid-madrid/" --headless=false
pnpm cli list --url="https://www.idealista.com/venta-viviendas/madrid-madrid/" --outputFile="./tmp/listings.json"
pnpm cli list --url="https://www.idealista.com/venta-viviendas/madrid-madrid/" --pretty
pnpm cli crawl --url="https://www.idealista.com/venta-viviendas/madrid-madrid/"
pnpm cli crawl --url="https://www.idealista.com/venta-viviendas/madrid-madrid/" --maxItems=30 --workers=4
pnpm cli crawl --url="https://www.idealista.com/venta-viviendas/madrid-madrid/" --maxItems=30 --maxErrors=5
pnpm cli crawl --url="https://www.idealista.com/venta-viviendas/madrid-madrid/" --outputFile="./tmp/crawl-details.json" --pretty
```

### List command options

- `--url` Required. Full URL or Idealista path.
- `--outputFile` Optional. Writes JSON output to file.
- `--sortBy` Optional sort mode:
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
- `--maxPages` Optional. Maximum pages to fetch (default: `1`).
- `--skipPages` Optional. Starts at `pagina-(skipPages+1).htm` (default: `0`).
- `--headless` Optional. Use `false` to show browser (default: `true`).
- `--pretty` Optional. Pretty-print JSON output.

### Crawl command options

- `--url` Required. Full URL or Idealista path.
- `--workers` Optional. Parallel workers used for detail requests (default: `4`).
- `--maxErrors` Optional. Stop scheduling new detail requests after this many errors (default: `5`).
- `--maxItems` Optional. Maximum number of listed flats to detail.
- `--outputFile` Optional. Writes JSON output to file.
- `--sortBy` Optional. Same values as list command.
- `--skipPages` Optional. Starts at `pagina-(skipPages+1).htm` (default: `0`).
- `--headless` Optional. Use `false` to show browser (default: `true`).
- `--pretty` Optional. Pretty-print JSON output.

## Typical output shape

The list parser returns structured JSON with listing-level and page-level information, including:

- `items`: normalized listing objects (id, url, label/title, price info, tags, details, agency).
- `pagination`: page navigation metadata.
- `totalItems`: total number of matches (when present in page).
- `averagePriceByArea`: average €/m² summary (when present in page).

## Important native/runtime dependencies

Some dependencies require native artifacts at install/runtime:

- Build approval is preconfigured in [pnpm-workspace.yaml](pnpm-workspace.yaml) via `onlyBuiltDependencies`:
  - `better-sqlite3`
  - `@ulixee/unblocked-agent-mitm-socket`
  - `@ulixee/chrome-139-0`
  - `@ulixee/chrome-143-0`

- `@ulixee/unblocked-agent-mitm-socket`
  - Requires a platform binary at `dist/<platform>/connect`.
  - Auto-check/auto-install is handled by:
    - `packages/scraper/scripts/ensure-ulixee-native.mjs`
    - `@workspace/scraper` `postinstall` script.

- `better-sqlite3`
  - Uses prebuilt binaries when possible (falls back to local toolchain).
  - Recovery script is available at root: `pnpm native:rebuild`.

## Quality checks

```bash
pnpm lint
pnpm typecheck
pnpm test
```

## Troubleshooting

### Ulixee MitmSocket binary missing

If you see a missing file under:

`@ulixee/unblocked-agent-mitm-socket/dist/<platform>/connect`

Run:

```bash
pnpm --filter @workspace/scraper exec node ./scripts/ensure-ulixee-native.mjs
```

If needed, force reinstall + rebuild:

```bash
rm -rf node_modules pnpm-lock.yaml
pnpm install
pnpm rebuild @ulixee/unblocked-agent-mitm-socket
```

### better-sqlite3 native binding issues

```bash
pnpm native:rebuild
```

This rebuilds `better-sqlite3` and re-checks the Ulixee MitmSocket native binary.

## AI enablement

This repository includes AI-agent guidance:

- Copilot instructions: `.github/copilot-instructions.md`
- Cross-agent playbook: `AGENTS.md`
- Claude entrypoint: `CLAUDE.md`
- Cursor entrypoint: `.cursorrules`
- AI contributor context: `docs/ai/context.md`
- Prompt templates: `docs/ai/prompt-templates.md`

Recommended workflow:

1. Read `AGENTS.md` and `docs/ai/context.md`.
2. Start from `docs/ai/prompt-templates.md`.
3. Keep edits minimal and package-scoped.
4. Run `pnpm lint`, `pnpm typecheck`, and `pnpm test`.
