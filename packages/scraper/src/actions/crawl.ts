import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { log } from '@workspace/logger';
import { z } from 'zod';
import {
  IdealistaDetailParserPlugin,
  type IdealistaDetailParseResult,
} from '../plugins/idealista-detail-parser.js';
import {
  IdealistaListParserPlugin,
  type IdealistaListParseResult,
} from '../plugins/idealista-list-parser.js';
import { formatJson } from '../utils/json.js';
import { CrawlOrchestrator } from '../orchestrator/crawler.js';
import { Router } from '../orchestrator/router.js';
import { UlixeeEngineAdapter } from '../web-engine/engine-adapter.js';
import { ProgressWriter } from '../pipeline/progress-writer.js';

const booleanFromCliSchema = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true');

const listSortSchema = z.enum([
  'relevance',
  'lowest-price',
  'highest-price',
  'newest',
  'oldest',
  'biggest-price-drop',
  'lowest-price-per-sqm',
  'highest-price-per-sqm',
  'largest-area',
  'smallest-area',
  'highest-floor',
  'lowest-floor',
]);

const sortByToQueryValue: Record<
  z.infer<typeof listSortSchema>,
  string | undefined
> = {
  relevance: undefined,
  'lowest-price': 'precios-asc',
  'highest-price': 'precios-desc',
  newest: 'fecha-publicacion-desc',
  oldest: 'fecha-publicacion-asc',
  'biggest-price-drop': 'rebajas-desc',
  'lowest-price-per-sqm': 'precio-metro-cuadrado-asc',
  'highest-price-per-sqm': 'precio-metro-cuadrado-desc',
  'largest-area': 'area-desc',
  'smallest-area': 'area-asc',
  'highest-floor': 'planta-desc',
  'lowest-floor': 'planta-asc',
};

const allSortQueryValues = Object.values(sortByToQueryValue).filter(
  (value): value is string => Boolean(value),
);

const crawlActionOptionsSchema = z.object({
  outputFile: z
    .preprocess(
      (value) => {
        if (value === undefined) {
          return undefined;
        }

        if (typeof value === 'string') {
          const trimmed = value.trim();
          return trimmed.length ? trimmed : undefined;
        }

        return value;
      },
      z.string().min(1, 'Invalid --outputFile path'),
    )
    .optional(),
  sortBy: z
    .preprocess((value) => {
      if (value === undefined) {
        return 'relevance';
      }

      if (typeof value === 'string') {
        return value.trim().toLowerCase();
      }

      return value;
    }, listSortSchema)
    .default('relevance'),
  skipPages: z
    .preprocess(
      (value) => {
        if (value === undefined) {
          return 0;
        }

        if (typeof value === 'string') {
          const parsedValue = Number(value);
          return Number.isFinite(parsedValue) ? parsedValue : value;
        }

        return value;
      },
      z.number().int().min(0, 'Invalid --skipPages. Provide an integer >= 0.'),
    )
    .default(0),
  workers: z
    .preprocess(
      (value) => {
        if (value === undefined) {
          return 4;
        }

        if (typeof value === 'string') {
          const parsedValue = Number(value);
          return Number.isFinite(parsedValue) ? parsedValue : value;
        }

        return value;
      },
      z.number().int().min(1, 'Invalid --workers. Provide a positive integer.'),
    )
    .default(4),
  maxErrors: z
    .preprocess(
      (value) => {
        if (value === undefined) {
          return 5;
        }

        if (typeof value === 'string') {
          const parsedValue = Number(value);
          return Number.isFinite(parsedValue) ? parsedValue : value;
        }

        return value;
      },
      z
        .number()
        .int()
        .min(1, 'Invalid --maxErrors. Provide a positive integer.'),
    )
    .default(5),
  maxItems: z
    .preprocess(
      (value) => {
        if (value === undefined) {
          return undefined;
        }

        if (typeof value === 'string') {
          const parsedValue = Number(value);
          return Number.isFinite(parsedValue) ? parsedValue : value;
        }

        return value;
      },
      z
        .number()
        .int()
        .min(1, 'Invalid --maxItems. Provide a positive integer.'),
    )
    .optional(),
  headless: z
    .preprocess((value) => {
      if (value === undefined) {
        return 'false';
      }

      if (typeof value === 'string') {
        return value.toLowerCase();
      }

      return value;
    }, booleanFromCliSchema)
    .default(false),
  pretty: z
    .preprocess((value) => {
      if (value === undefined) {
        return 'false';
      }

      if (typeof value === 'string') {
        return value.toLowerCase();
      }

      return value;
    }, booleanFromCliSchema)
    .default(false),
  resume: z
    .preprocess((value) => {
      if (value === undefined) {
        return 'false';
      }

      if (typeof value === 'string') {
        return value.toLowerCase();
      }

      return value;
    }, booleanFromCliSchema)
    .default(false),
  fresh: z
    .preprocess((value) => {
      if (value === undefined) {
        return 'false';
      }

      if (typeof value === 'string') {
        return value.toLowerCase();
      }

      return value;
    }, booleanFromCliSchema)
    .default(false),
});

const crawlArgsSchema = z.object({
  url: z.string().trim().min(1, 'Missing required option: --url'),
  ...crawlActionOptionsSchema.shape,
});

type CrawlArgs = z.infer<typeof crawlArgsSchema>;
type RunCrawlActionOptions = Omit<CrawlArgs, 'url'>;

function applySkipPages(pathname: string, skipPages: number): string {
  if (skipPages <= 0) {
    return pathname;
  }

  const targetPage = `pagina-${skipPages + 1}.htm`;

  if (/\/pagina-\d+\.htm$/i.test(pathname)) {
    return pathname.replace(/\/pagina-\d+\.htm$/i, `/${targetPage}`);
  }

  return `${pathname.replace(/\/?$/, '/')}${targetPage}`;
}

function applySortQuery(
  url: URL,
  sortBy: z.infer<typeof listSortSchema>,
): void {
  for (const queryValue of allSortQueryValues) {
    url.searchParams.delete(queryValue);
  }

  const targetQueryValue = sortByToQueryValue[sortBy];
  if (!targetQueryValue) {
    return;
  }

  const currentValue = url.searchParams.get(targetQueryValue);
  if (currentValue === null) {
    url.searchParams.set(targetQueryValue, '');
  }
}

function normalizeUrl(
  inputUrl: string,
  skipPages = 0,
  sortBy: z.infer<typeof listSortSchema> = 'relevance',
): string {
  const trimmed = inputUrl.trim();
  const url = /^https?:\/\//i.test(trimmed)
    ? new URL(trimmed)
    : new URL(trimmed.replace(/^\/+/, ''), 'https://www.idealista.com/');

  url.pathname = applySkipPages(url.pathname, skipPages);
  applySortQuery(url, sortBy);
  return url.toString();
}

function buildDetailUrl(propertyId: string): string {
  return `https://www.idealista.com/inmueble/${propertyId}/`;
}

function resolveOutputDir(outputFile: string | undefined): string {
  if (outputFile) {
    return dirname(outputFile);
  }
  return join('tmp', 'crawl');
}

export async function runCrawlAction(
  inputUrl: string,
  options?: RunCrawlActionOptions,
): Promise<number> {
  const startTime = Date.now();

  const pretty = options?.pretty ?? false;
  const sortBy = options?.sortBy ?? 'relevance';
  const skipPages = Math.max(0, options?.skipPages ?? 0);
  const workers = Math.max(1, options?.workers ?? 4);
  const maxItems = options?.maxItems;
  const headless = options?.headless ?? true;
  const outputFile = options?.outputFile;
  const resume = options?.resume ?? false;
  const targetUrl = normalizeUrl(inputUrl, skipPages, sortBy);

  const outputDir = resolveOutputDir(outputFile);
  const progressPath = join(outputDir, 'progress.jsonl');

  log.info('Starting crawl action', JSON.stringify({ targetUrl, options }));

  const router = new Router();
  let itemsEnqueued = 0;

  router.addHandler('LIST', async (context) => {
    const response = await context.fetchPage<IdealistaListParseResult>({
      htmlParser: new IdealistaListParserPlugin(),
      showBrowser: !headless,
    });

    if (!response.success) {
      throw new Error(response.error);
    }

    for (const listing of response.content.listings) {
      if (maxItems !== undefined && itemsEnqueued >= maxItems) {
        break;
      }

      const detailUrl = buildDetailUrl(listing.id);
      const added = context.enqueue(detailUrl, 'DETAIL', {
        propertyId: listing.id,
      });
      if (added) {
        itemsEnqueued += 1;
      }
    }

    const nextPageUrl = response.content.pagination.nextPageUrl;
    if (nextPageUrl && (maxItems === undefined || itemsEnqueued < maxItems)) {
      context.enqueue(nextPageUrl, 'LIST');
    }
  });

  router.addHandler('DETAIL', async (context) => {
    const response = await context.fetchPage<IdealistaDetailParseResult>({
      htmlParser: new IdealistaDetailParserPlugin(),
      showBrowser: !headless,
    });

    if (!response.success) {
      throw new Error(response.error);
    }

    const propertyId =
      (context.request.userData?.propertyId as string | undefined) ??
      context.request.uniqueKey;
    context.pushData(propertyId, response.content);
  });

  const orchestrator = new CrawlOrchestrator(
    {
      maxConcurrency: workers,
      maxRequestsPerMinute: 30,
      maxRetries: 3,
      outputPath: progressPath,
      statePath: join(outputDir, 'crawl-state.json'),
      queuePath: join(outputDir, 'queue.jsonl'),
      errorSnapshotDir: join(outputDir, 'errors'),
      sourceUrl: targetUrl,
      resume,
      engineFactory: () => new UlixeeEngineAdapter(),
    },
    router,
  );

  await orchestrator.run([{ url: targetUrl, label: 'LIST' }]);

  const progressWriter = new ProgressWriter<IdealistaDetailParseResult>(
    progressPath,
  );
  const entries = progressWriter.readAll();
  const details = entries.map((entry) => entry.data);

  const output = formatJson(details, pretty);
  if (outputFile) {
    await mkdir(dirname(outputFile), { recursive: true });
    await writeFile(outputFile, output, 'utf-8');
  } else {
    console.log(output);
  }

  const durationMs = Date.now() - startTime;
  log.info(
    'Crawl action finished',
    JSON.stringify({
      detailed: details.length,
      durationMs,
    }),
  );

  return details.length === 0 ? 1 : 0;
}

export { crawlArgsSchema };
export type { CrawlArgs, RunCrawlActionOptions };
