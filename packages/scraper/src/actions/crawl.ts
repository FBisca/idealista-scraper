import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
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
import type { FetchResponse } from '../web-engine/types.js';
import { UlixeeWebEngine } from '../web-engine/ulixee-engine.js';

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

async function fetchDetailById(
  propertyId: string,
  headless: boolean,
): Promise<
  | { success: true; content: IdealistaDetailParseResult }
  | {
      success: false;
      propertyId: string;
      error: string;
      errorCode?: string;
    }
> {
  const engine = new UlixeeWebEngine();

  try {
    const response: FetchResponse<IdealistaDetailParseResult> =
      await engine.fetchContent<IdealistaDetailParseResult>(
        buildDetailUrl(propertyId),
        {
          showBrowser: !headless,
          htmlParser: new IdealistaDetailParserPlugin(),
        },
      );

    if (!response.success) {
      return {
        success: false,
        propertyId,
        error: response.error,
        errorCode: response.errorCode,
      };
    }

    return { success: true, content: response.content };
  } finally {
    await engine.cleanup();
  }
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
  const maxErrors = Math.max(1, options?.maxErrors ?? 5);
  const maxItems =
    options?.maxItems === undefined ? undefined : Math.max(1, options.maxItems);
  const headless = options?.headless ?? true;
  const outputFile = options?.outputFile;
  const targetUrl = normalizeUrl(inputUrl, skipPages, sortBy);

  const listEngine = new UlixeeWebEngine();
  const listedIds: string[] = [];
  const visitedIds = new Set<string>();

  let currentUrl: string | undefined = targetUrl;
  let pagesFetched = 0;

  log.info('Starting crawl action', JSON.stringify({ targetUrl, options }));
  try {
    while (currentUrl) {
      const response: FetchResponse<IdealistaListParseResult> =
        await listEngine.fetchContent<IdealistaListParseResult>(currentUrl, {
          showBrowser: !headless,
          htmlParser: new IdealistaListParserPlugin(),
        });

      if (!response.success) {
        console.error(
          formatJson(
            {
              success: false,
              error: response.error,
              errorCode: response.errorCode,
              metadata: response.metadata,
              pagination: {
                pagesFetched,
                failedUrl: currentUrl,
              },
            },
            pretty,
          ),
        );
        return 1;
      }

      pagesFetched += 1;

      for (const listing of response.content.listings) {
        if (visitedIds.has(listing.id)) {
          continue;
        }

        visitedIds.add(listing.id);
        listedIds.push(listing.id);

        if (maxItems !== undefined && listedIds.length >= maxItems) {
          break;
        }
      }

      if (maxItems !== undefined && listedIds.length >= maxItems) {
        break;
      }

      const nextPageUrl: string | undefined =
        response.content.pagination.nextPageUrl;
      if (!nextPageUrl) {
        break;
      }

      await waitHumanDelay();
      currentUrl = nextPageUrl;
    }
  } finally {
    await listEngine.cleanup();
  }

  const targetIds =
    maxItems === undefined ? listedIds : listedIds.slice(0, maxItems);

  const detailsByIndex: Array<IdealistaDetailParseResult | undefined> =
    Array.from({ length: targetIds.length });
  let nextIndex = 0;
  let errorCount = 0;
  let thresholdReached = false;

  async function runWorker(): Promise<void> {
    while (!thresholdReached) {
      const taskIndex = nextIndex;
      if (taskIndex >= targetIds.length) {
        return;
      }

      nextIndex += 1;
      const propertyId = targetIds[taskIndex];
      if (!propertyId) {
        return;
      }

      const detailResult = await fetchDetailById(propertyId, headless);
      if (detailResult.success) {
        detailsByIndex[taskIndex] = detailResult.content;
        continue;
      }

      errorCount += 1;
      log.warn(
        'Detail fetch failed during crawl',
        JSON.stringify({
          propertyId: detailResult.propertyId,
          error: detailResult.error,
          errorCode: detailResult.errorCode,
          errorCount,
          maxErrors,
        }),
      );

      if (errorCount >= maxErrors) {
        thresholdReached = true;
      }
    }
  }

  const workerCount = Math.min(workers, targetIds.length || 1);
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));

  const details = detailsByIndex.filter(
    (detail): detail is IdealistaDetailParseResult => detail !== undefined,
  );

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
      pagesFetched,
      listed: targetIds.length,
      detailed: details.length,
      errors: errorCount,
      workers: workerCount,
      durationMs,
      thresholdReached,
    }),
  );

  if (thresholdReached && errorCount >= maxErrors) {
    console.error(
      `Reached --maxErrors=${maxErrors}. Stopped scheduling new detail tasks.`,
    );
  }

  if (details.length === 0) {
    return 1;
  }

  return thresholdReached ? 1 : 0;
}

async function waitHumanDelay(): Promise<void> {
  const minDelayMs = 350;
  const maxDelayMs = 1000;
  const delayMs =
    Math.floor(Math.random() * (maxDelayMs - minDelayMs + 1)) + minDelayMs;

  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

export { crawlArgsSchema };
export type { CrawlArgs, RunCrawlActionOptions };
