import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { log } from "@workspace/logger";
import { z } from "zod";
import {
  type IdealistaAveragePricePerSquareMeter,
  IdealistaListParserPlugin,
  type IdealistaListParseResult
} from "../plugins/idealista-list-parser.js";
import { UlixeeWebEngine } from "../web-engine/ulixee-engine.js";
import type { FetchResponse } from "../web-engine/types.js";
import { formatJson } from "../utils/json.js";

const booleanFromCliSchema = z.enum(["true", "false"]).transform((value) => value === "true");

const listSortSchema = z.enum([
  "relevance",
  "lowest-price",
  "highest-price",
  "newest",
  "oldest",
  "biggest-price-drop",
  "lowest-price-per-sqm",
  "highest-price-per-sqm",
  "largest-area",
  "smallest-area",
  "highest-floor",
  "lowest-floor"
]);

const sortByToQueryValue: Record<z.infer<typeof listSortSchema>, string | undefined> = {
  relevance: undefined,
  "lowest-price": "precios-asc",
  "highest-price": "precios-desc",
  newest: "fecha-publicacion-desc",
  oldest: "fecha-publicacion-asc",
  "biggest-price-drop": "rebajas-desc",
  "lowest-price-per-sqm": "precio-metro-cuadrado-asc",
  "highest-price-per-sqm": "precio-metro-cuadrado-desc",
  "largest-area": "area-desc",
  "smallest-area": "area-asc",
  "highest-floor": "planta-desc",
  "lowest-floor": "planta-asc"
};

const allSortQueryValues = Object.values(sortByToQueryValue).filter((value): value is string =>
  Boolean(value)
);

const listActionOptionsSchema = z.object({
  outputFile: z
    .preprocess(
      (value) => {
        if (value === undefined) {
          return undefined;
        }

        if (typeof value === "string") {
          const trimmed = value.trim();
          return trimmed.length ? trimmed : undefined;
        }

        return value;
      },
      z.string().min(1, "Invalid --outputFile path")
    )
    .optional(),
  maxPages: z
    .preprocess(
      (value) => {
        if (value === undefined) {
          return 1;
        }

        if (typeof value === "string") {
          const parsedValue = Number(value);
          return Number.isFinite(parsedValue) ? parsedValue : value;
        }

        return value;
      },
      z.number().int().min(1, "Invalid --maxItems. Provide a positive integer.")
    )
    .default(1),
  sortBy: z
    .preprocess((value) => {
      if (value === undefined) {
        return "relevance";
      }

      if (typeof value === "string") {
        return value.trim().toLowerCase();
      }

      return value;
    }, listSortSchema)
    .default("relevance"),
  skipPages: z
    .preprocess(
      (value) => {
        if (value === undefined) {
          return 0;
        }

        if (typeof value === "string") {
          const parsedValue = Number(value);
          return Number.isFinite(parsedValue) ? parsedValue : value;
        }

        return value;
      },
      z.number().int().min(0, "Invalid --skipPages. Provide an integer >= 0.")
    )
    .default(0),
  headless: z
    .preprocess((value) => {
      if (value === undefined) {
        return "false";
      }

      if (typeof value === "string") {
        return value.toLowerCase();
      }

      return value;
    }, booleanFromCliSchema)
    .default(false),
  pretty: z
    .preprocess((value) => {
      if (value === undefined) {
        return "false";
      }

      if (typeof value === "string") {
        return value.toLowerCase();
      }

      return value;
    }, booleanFromCliSchema)
    .default(false)
});

const listArgsSchema = z.object({
  url: z.string().trim().min(1, "Missing required option: --url"),
  ...listActionOptionsSchema.shape
});

type ListArgs = z.infer<typeof listArgsSchema>;
type RunListActionOptions = Omit<ListArgs, "url">;

function applySkipPages(pathname: string, skipPages: number): string {
  if (skipPages <= 0) {
    return pathname;
  }

  const targetPage = `pagina-${skipPages + 1}.htm`;

  if (/\/pagina-\d+\.htm$/i.test(pathname)) {
    return pathname.replace(/\/pagina-\d+\.htm$/i, `/${targetPage}`);
  }

  return `${pathname.replace(/\/?$/, "/")}${targetPage}`;
}

function applySortQuery(url: URL, sortBy: z.infer<typeof listSortSchema>): void {
  for (const queryValue of allSortQueryValues) {
    url.searchParams.delete(queryValue);
  }

  const targetQueryValue = sortByToQueryValue[sortBy];
  if (!targetQueryValue) {
    return;
  }

  const currentValue = url.searchParams.get(targetQueryValue);
  if (currentValue === null) {
    url.searchParams.set(targetQueryValue, "");
  }
}

function normalizeUrl(
  inputUrl: string,
  skipPages = 0,
  sortBy: z.infer<typeof listSortSchema> = "relevance"
): string {
  const trimmed = inputUrl.trim();
  const url = /^https?:\/\//i.test(trimmed)
    ? new URL(trimmed)
    : new URL(trimmed.replace(/^\/+/, ""), "https://www.idealista.com/");

  url.pathname = applySkipPages(url.pathname, skipPages);
  applySortQuery(url, sortBy);
  return url.toString();
}

export async function runListAction(
  inputUrl: string,
  options?: RunListActionOptions
): Promise<number> {
  const startTime = Date.now();

  // Apply defaults
  const pretty = options?.pretty ?? false;
  const maxPages = Math.max(1, options?.maxPages ?? 1);
  const sortBy = options?.sortBy ?? "relevance";
  const skipPages = Math.max(0, options?.skipPages ?? 0);
  const targetUrl = normalizeUrl(inputUrl, skipPages, sortBy);
  const headless = options?.headless ?? true;
  const outputFile = options?.outputFile;

  const engine = new UlixeeWebEngine();

  const collectedListings: IdealistaListParseResult["listings"] = [];
  const visitedIds = new Set<string>();

  let currentUrl: string | undefined = targetUrl;
  let pagesFetched = 0;
  let totalItems: number | undefined;
  let averagePricePerSquareMeter: IdealistaAveragePricePerSquareMeter | undefined;

  log.info("Starting list action", JSON.stringify({ targetUrl, options }));
  try {
    while (currentUrl && pagesFetched < maxPages) {
      const response: FetchResponse<IdealistaListParseResult> =
        await engine.fetchContent<IdealistaListParseResult>(currentUrl, {
          showBrowser: !headless,
          htmlParser: new IdealistaListParserPlugin()
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
                maxPages,
                failedUrl: currentUrl
              }
            },
            pretty
          )
        );
        return 1;
      }

      pagesFetched += 1;

      if (!totalItems && response.content.totalItems) {
        totalItems = response.content.totalItems;
      }

      if (!averagePricePerSquareMeter && response.content.averagePricePerSquareMeter) {
        averagePricePerSquareMeter = response.content.averagePricePerSquareMeter;
      }

      for (const listing of response.content.listings) {
        if (visitedIds.has(listing.id)) {
          continue;
        }

        visitedIds.add(listing.id);
        collectedListings.push(listing);
      }

      const nextPageUrl: string | undefined = response.content.pagination.nextPageUrl;
      if (!nextPageUrl || pagesFetched >= maxPages) {
        break;
      }

      await waitHumanDelay();
      currentUrl = nextPageUrl;
    }

    const output = formatJson(
      {
        sourceUrl: targetUrl,
        listings: collectedListings,
        pagination: {
          pagesFetched,
          maxPages
        },
        ...(totalItems ? { totalItems } : {}),
        ...(averagePricePerSquareMeter ? { averagePricePerSquareMeter } : {})
      },
      pretty
    );

    if (outputFile) {
      await mkdir(dirname(outputFile), { recursive: true });
      await writeFile(outputFile, output, "utf-8");
    } else {
      console.log(output);
    }
    log.info(
      `Execution finished in ${Date.now() - startTime}ms with ${collectedListings.length} unique listings collected.`
    );
    return 0;
  } finally {
    await engine.cleanup();
  }
}

async function waitHumanDelay(): Promise<void> {
  const minDelayMs = 350;
  const maxDelayMs = 1000;
  const delayMs = Math.floor(Math.random() * (maxDelayMs - minDelayMs + 1)) + minDelayMs;

  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

export { listArgsSchema };
export type { ListArgs, RunListActionOptions };
