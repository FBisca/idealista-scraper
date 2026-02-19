#!/usr/bin/env node
import { z } from 'zod';
import { crawlArgsSchema, runCrawlAction } from './actions/crawl.js';
import { detailArgsSchema, runDetailAction } from './actions/detail.js';
import { listArgsSchema, runListAction } from './actions/list.js';
import {
  mapInspectArgsSchema,
  resolveMapInspectTargetUrl,
  runMapInspectAction,
} from './actions/map-inspect.js';

type ParsedArgs = {
  command: string;
  options: Record<string, string>;
};

const cliInputSchema = z.discriminatedUnion('command', [
  z.object({
    command: z.literal('help'),
    options: z.record(z.string(), z.string()),
  }),
  z.object({
    command: z.literal('list'),
    options: z.record(z.string(), z.string()),
  }),
  z.object({
    command: z.literal('detail'),
    options: z.record(z.string(), z.string()),
  }),
  z.object({
    command: z.literal('crawl'),
    options: z.record(z.string(), z.string()),
  }),
  z.object({
    command: z.literal('map-inspect'),
    options: z.record(z.string(), z.string()),
  }),
]);

function parseArgs(argv: string[]): ParsedArgs {
  const [rawCommand, ...rest] = argv;
  const command = normalizeCommand(rawCommand);
  const options: Record<string, string> = {};

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (!arg?.startsWith('--')) {
      continue;
    }

    const [key, maybeValue] = arg.slice(2).split('=', 2);
    if (!key) {
      continue;
    }

    if (maybeValue !== undefined) {
      options[key] = maybeValue;
      continue;
    }

    const next = rest[index + 1];
    if (next && !next.startsWith('--')) {
      options[key] = next;
      index += 1;
      continue;
    }

    options[key] = 'true';
  }

  return { command, options };
}

function normalizeCommand(command?: string): string {
  if (
    !command ||
    command === 'help' ||
    command === '--help' ||
    command === '-h'
  ) {
    return 'help';
  }

  return command;
}

function printHelp(): void {
  console.log(`idealista-scraper CLI

Usage:
  cli help
  cli list --url="venta-viviendas/madrid-madrid/con-precio-hasta_360000,precio-desde_175000,metros-cuadrados-mas-de_40,solo-pisos,ascensor,plantas-intermedias,buen-estado/"
  cli list --url="https://www.idealista.com/venta-viviendas/madrid-madrid/"
  cli list --url="https://www.idealista.com/venta-viviendas/madrid-madrid/" --maxPages=3
  cli list --url="https://www.idealista.com/venta-viviendas/madrid-madrid/" --sortBy=lowest-price
  cli list --url="https://www.idealista.com/venta-viviendas/madrid-madrid/" --skipPages=2
  cli list --url="https://www.idealista.com/venta-viviendas/madrid-madrid/" --headless=false
  cli list --url="https://www.idealista.com/venta-viviendas/madrid-madrid/" --outputFile="./tmp/listings.json"
  cli list --url="https://www.idealista.com/venta-viviendas/madrid-madrid/" --pretty
  cli detail --id=110641394
  cli detail --id=110641394 --pretty
  cli detail --id=110641394 --headless=false
  cli detail --id=110641394 --outputFile="./tmp/detail.json"
  cli crawl --url="https://www.idealista.com/venta-viviendas/madrid-madrid/"
  cli crawl --url="https://www.idealista.com/venta-viviendas/madrid-madrid/" --maxItems=30 --workers=4
  cli crawl --url="https://www.idealista.com/venta-viviendas/madrid-madrid/" --maxItems=30 --maxErrors=5
  cli crawl --url="https://www.idealista.com/venta-viviendas/madrid-madrid/" --outputFile="./tmp/crawl-details.json" --pretty
  cli crawl --url="https://www.idealista.com/venta-viviendas/madrid-madrid/" --resume
  cli crawl --url="https://www.idealista.com/venta-viviendas/madrid-madrid/" --fresh
  cli map-inspect
  cli map-inspect --constructionType=7 --propertyType=14 --locationType=CA --locationCode=08 --withStatistics=true --locale=en
  cli map-inspect --search="Madrid" --outputDir="./tmp/map-inspect"

Commands:
  help    Show this help message
  list    Scrape an Idealista listing page and print parsed JSON
  detail  Scrape an Idealista property detail page by ID
  crawl   List flats then fetch detail pages in parallel workers
  map-inspect  Extract Penotariado placeName/pricePerSqm rows and save inspection artifacts

List options:
  --url   Required for list. Accepts full URL or idealista path.
  --outputFile Optional for list. Writes JSON output to the given file path.
  --sortBy Optional for list. One of: relevance, lowest-price, highest-price, newest,
           oldest, biggest-price-drop, lowest-price-per-sqm, highest-price-per-sqm,
           largest-area, smallest-area, highest-floor, lowest-floor.
  --maxPages Optional for list. Maximum number of pages to fetch (default: 1).
  --skipPages Optional for list. Starts at pagina-(skipPages+1).htm (default: 0).
  --headless Optional for list. Use false to show browser (default: true).
  --pretty Optional for list. Pretty-print JSON output.

Detail options:
  --id       Required for detail. Numeric Idealista property ID.
  --outputFile Optional for detail. Writes JSON output to the given file path.
  --headless Optional for detail. Use false to show browser (default: true).
  --pretty   Optional for detail. Pretty-print JSON output.

Crawl options:
  --url       Required for crawl. Accepts full URL or idealista path.
  --workers   Optional for crawl. Parallel detail workers (default: 4).
  --maxErrors Optional for crawl. Stop scheduling details after this many errors (default: 5).
  --maxItems  Optional for crawl. Cap how many listed flats are detailed.
  --outputFile Optional for crawl. Writes JSON output to the given file path.
  --sortBy    Optional for crawl. Same accepted values as list.
  --skipPages Optional for crawl. Starts at pagina-(skipPages+1).htm (default: 0).
  --headless  Optional for crawl. Use false to show browser (default: true).
  --pretty    Optional for crawl. Pretty-print JSON output.
  --resume    Optional for crawl. Resume from existing crawl state.
  --fresh     Optional for crawl. Force restart, delete existing state.

Map-inspect options:
  --constructionType Optional. One of: 99 (all), 7 (new), 9 (second-hand). Default: 99.
  --propertyType Optional. One of: 99 (all), 14 (multi-family), 15 (single-family). Default: 99.
  --locationType Optional. One of: PA (country), CA (autonomous community), PR (province), MN (municipality), CP (postal code). Default: PA.
  --locationCode Optional. Location code for selected location type, or null. Default: null.
  --withStatistics Optional. true/false. Default: true.
  --locale     Optional. One of: en, es, ca, gl, eu. Default: en.
  --search     Optional search term for ArcGIS full-text probes (default: Madrid).
  --outputDir  Optional output directory for artifacts (default: ./tmp/map-inspect).
  --outputFile Optional extracted rows JSON output file path.
  --headless   Optional for map-inspect. Use false to show browser (default: true).
  --pretty     Optional for map-inspect. Pretty-print summary JSON output.
`);
}

async function main(): Promise<number> {
  const { command, options } = parseArgs(process.argv.slice(2));
  const parsedCliInput = cliInputSchema.safeParse({ command, options });

  if (!parsedCliInput.success) {
    console.error(`Unknown command: ${command}`);
    printHelp();
    return 1;
  }

  if (parsedCliInput.data.command === 'help') {
    printHelp();
    return 0;
  }

  if (parsedCliInput.data.command === 'list') {
    const parsedListArgs = listArgsSchema.safeParse(
      parsedCliInput.data.options,
    );
    if (!parsedListArgs.success) {
      console.error(
        parsedListArgs.error.issues[0]?.message ?? 'Invalid arguments',
      );
      printHelp();
      return 1;
    }

    return runListAction(parsedListArgs.data.url, {
      pretty: parsedListArgs.data.pretty,
      sortBy: parsedListArgs.data.sortBy,
      maxPages: parsedListArgs.data.maxPages,
      skipPages: parsedListArgs.data.skipPages,
      headless: parsedListArgs.data.headless,
      outputFile: parsedListArgs.data.outputFile,
    });
  }

  if (parsedCliInput.data.command === 'detail') {
    const parsedDetailArgs = detailArgsSchema.safeParse(
      parsedCliInput.data.options,
    );
    if (!parsedDetailArgs.success) {
      console.error(
        parsedDetailArgs.error.issues[0]?.message ?? 'Invalid arguments',
      );
      printHelp();
      return 1;
    }

    return runDetailAction(parsedDetailArgs.data.id, {
      pretty: parsedDetailArgs.data.pretty,
      headless: parsedDetailArgs.data.headless,
      outputFile: parsedDetailArgs.data.outputFile,
    });
  }

  if (parsedCliInput.data.command === 'crawl') {
    const parsedCrawlArgs = crawlArgsSchema.safeParse(
      parsedCliInput.data.options,
    );
    if (!parsedCrawlArgs.success) {
      console.error(
        parsedCrawlArgs.error.issues[0]?.message ?? 'Invalid arguments',
      );
      printHelp();
      return 1;
    }

    return runCrawlAction(parsedCrawlArgs.data.url, {
      pretty: parsedCrawlArgs.data.pretty,
      sortBy: parsedCrawlArgs.data.sortBy,
      skipPages: parsedCrawlArgs.data.skipPages,
      headless: parsedCrawlArgs.data.headless,
      outputFile: parsedCrawlArgs.data.outputFile,
      workers: parsedCrawlArgs.data.workers,
      maxErrors: parsedCrawlArgs.data.maxErrors,
      maxItems: parsedCrawlArgs.data.maxItems,
      resume: parsedCrawlArgs.data.resume,
      fresh: parsedCrawlArgs.data.fresh,
    });
  }

  if (parsedCliInput.data.command === 'map-inspect') {
    const parsedMapInspectArgs = mapInspectArgsSchema.safeParse(
      parsedCliInput.data.options,
    );
    if (!parsedMapInspectArgs.success) {
      console.error(
        parsedMapInspectArgs.error.issues[0]?.message ?? 'Invalid arguments',
      );
      printHelp();
      return 1;
    }

    const targetUrl = resolveMapInspectTargetUrl(parsedMapInspectArgs.data);

    return runMapInspectAction(targetUrl, {
      search: parsedMapInspectArgs.data.search,
      outputDir: parsedMapInspectArgs.data.outputDir,
      outputFile: parsedMapInspectArgs.data.outputFile,
      headless: parsedMapInspectArgs.data.headless,
      pretty: parsedMapInspectArgs.data.pretty,
    });
  }

  printHelp();
  return 0;
}

const exitCode = await main();
process.exitCode = exitCode;
