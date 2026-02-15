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

```bash
pnpm browser:start
```

## Quality checks

```bash
pnpm lint
pnpm typecheck
pnpm test
```

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
