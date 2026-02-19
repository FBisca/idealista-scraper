import { log } from '@workspace/logger';
import {
  UlixeeCrawler,
  UlixeeCrawlingContext,
} from '@workspace/ulixee-crawler';
import { Configuration, Dataset, Router } from 'crawlee';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { RetryStrategy } from '../anti-blocking/retry-strategy.js';
import { ErrorSnapshotWriter } from '../observability/error-snapshot.js';
import {
  IdealistaDetailParserPlugin,
  type IdealistaDetailParseResult,
} from '../plugins/idealista-detail-parser.js';
import { IdealistaListParserPlugin } from '../plugins/idealista-list-parser.js';
import { formatJson } from '../utils/json.js';
import { InteractiveParseContext } from 'web-engine/types.js';
import { UlixeeWebEngine } from 'web-engine/ulixee-engine.js';
import { UlixeeProfileManager } from 'web-engine/ulixee-profile-manager.js';

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

function resolveStorageDir(outputFile: string | undefined): string {
  if (outputFile) {
    return join(dirname(outputFile), '.crawlee-storage');
  }
  return join('tmp', 'crawl', '.crawlee-storage');
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
  const maxErrors = options?.maxErrors ?? 5;
  const maxItems = options?.maxItems;
  const headless = options?.headless ?? true;
  const outputFile = options?.outputFile;
  const resume = options?.resume ?? false;
  const fresh = options?.fresh ?? false;
  const targetUrl = normalizeUrl(inputUrl, skipPages, sortBy);

  const storageDir = resolveStorageDir(outputFile);
  const outputDir = resolveOutputDir(outputFile);
  const errorSnapshotDir = join(outputDir, 'errors');

  log.info('Starting crawl action', JSON.stringify({ targetUrl, options }));

  if (fresh) {
    const { rm } = await import('node:fs/promises');
    await rm(storageDir, { recursive: true, force: true }).catch(() => {});
  }

  const config = new Configuration({
    storageClientOptions: { localDataDirectory: storageDir },
    persistStorage: resume || !fresh,
  });

  const retryStrategy = new RetryStrategy({ maxRetries: 3 });
  const errorSnapshot = new ErrorSnapshotWriter({
    directory: errorSnapshotDir,
    maxSnapshots: 50,
  });
  errorSnapshot.initialize();

  let itemsEnqueued = 0;
  let errorCount = 0;

  const router = Router.create<UlixeeCrawlingContext>();

  router.addHandler('LIST', async (context) => {
    const { request, crawler, page } = context;
    log.info(`[LIST] Fetching: ${request.url}`);

    const parser = new IdealistaListParserPlugin();
    const response = await parser.extract({
      url: request.url,
      data: await page.html(),
    });

    const detailRequests: Array<{
      url: string;
      label: string;
      userData: Record<string, string>;
    }> = [];

    for (const listing of response.listings) {
      if (maxItems !== undefined && itemsEnqueued >= maxItems) {
        break;
      }

      const detailUrl = buildDetailUrl(listing.id);
      detailRequests.push({
        url: detailUrl,
        label: 'DETAIL',
        userData: { propertyId: listing.id },
      });
      itemsEnqueued += 1;
    }

    if (detailRequests.length > 0) {
      await crawler.addRequests(detailRequests);
    }

    const nextPageUrl = response.pagination.nextPageUrl;
    if (nextPageUrl && (maxItems === undefined || itemsEnqueued < maxItems)) {
      await crawler.addRequests([{ url: nextPageUrl, label: 'LIST' }]);
    }
  });

  router.addHandler('DETAIL', async (context) => {
    const { request, page } = context;
    const propertyId =
      (request.userData?.propertyId as string | undefined) ?? request.uniqueKey;

    log.info(`[DETAIL] Fetching: ${request.url} (id: ${propertyId})`);
    const parser = new IdealistaDetailParserPlugin();
    const parseContext: InteractiveParseContext = {
      engine: 'ulixee',
      interaction: UlixeeWebEngine.createInteractionAdapter(page.tab),
      requestUrl: request.url,
    };
    const response = await parser.extract(
      {
        url: request.url,
        data: await page.html(),
      },
      parseContext,
    );

    log.info(`[DETAIL] Success: ${propertyId}`);
    await Dataset.pushData({ ...response, id: propertyId });
  });

  const profileManager = new UlixeeProfileManager();
  const profile = await profileManager.loadGlobalProfile();

  const crawler = new UlixeeCrawler(
    {
      launchContext: {
        heroOptions: {
          userProfile: profile,
        },
      },
      maxConcurrency: workers,
      maxRequestRetries: 3,
      headless,
      maxRequestsPerMinute: 30,
      requestHandlerTimeoutSecs: 120,
      requestHandler: router,
      failedRequestHandler: ({ request }, error) => {
        const message = error instanceof Error ? error.message : String(error);
        log.error(
          `[CRAWL] Request permanently failed: ${request.url} — ${message}`,
        );
      },
    },
    config,
  );

  await crawler.run([{ url: targetUrl, label: 'LIST' }]);

  const dataset = await Dataset.open(undefined, { config });
  const datasetContent = await dataset.getData();
  const details = datasetContent.items as IdealistaDetailParseResult[];

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
