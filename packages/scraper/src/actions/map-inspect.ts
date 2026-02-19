import { log } from '@workspace/logger';
import {
  UlixeeCrawler,
  type UlixeeCrawlingContext,
} from '@workspace/ulixee-crawler';
import { Configuration, Router } from 'crawlee';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import polyline from 'google-polyline';
import { formatJson } from '../utils/json.js';
import { z } from 'zod';
import { CloudNode } from '@ulixee/cloud';

const booleanFromCliSchema = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true');

const mapInspectActionOptionsSchema = z.object({
  outputDir: z
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
      z.string().min(1, 'Invalid --outputDir path'),
    )
    .optional(),
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
  search: z
    .preprocess(
      (value) => {
        if (value === undefined) {
          return 'Madrid';
        }

        if (typeof value === 'string') {
          const trimmed = value.trim();
          return trimmed.length ? trimmed : 'Madrid';
        }

        return value;
      },
      z.string().min(1, 'Invalid --search value'),
    )
    .default('Madrid'),
  headless: z
    .preprocess((value) => {
      if (value === undefined) {
        return 'true';
      }

      if (typeof value === 'string') {
        return value.toLowerCase();
      }

      return value;
    }, booleanFromCliSchema)
    .default(true),
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

const mapInspectConstructionTypeSchema = z.enum(['99', '7', '9']).default('99');

const mapInspectPropertyTypeSchema = z.enum(['99', '14', '15']).default('99');

const mapInspectLocationTypeSchema = z
  .enum(['PA', 'CA', 'PR', 'MN', 'CP'])
  .default('PA');

const mapInspectLocaleSchema = z
  .enum(['en', 'es', 'ca', 'gl', 'eu'])
  .default('en');

const withStatisticsSchema = z
  .preprocess((value) => {
    if (value === undefined) {
      return 'true';
    }

    if (typeof value === 'string') {
      return value.toLowerCase();
    }

    return value;
  }, booleanFromCliSchema)
  .default(true);

const mapInspectArgsSchema = z.object({
  constructionType: mapInspectConstructionTypeSchema,
  propertyType: mapInspectPropertyTypeSchema,
  locationType: mapInspectLocationTypeSchema,
  locationCode: z
    .preprocess(
      (value) => {
        if (value === undefined) {
          return 'null';
        }

        if (typeof value === 'string') {
          const trimmed = value.trim();
          return trimmed.length ? trimmed : 'null';
        }

        return value;
      },
      z.string().min(1, 'Invalid --locationCode value'),
    )
    .default('null'),
  withStatistics: withStatisticsSchema,
  locale: mapInspectLocaleSchema,
  ...mapInspectActionOptionsSchema.shape,
});

type MapInspectArgs = z.infer<typeof mapInspectArgsSchema>;
type RunMapInspectActionOptions = Omit<
  MapInspectArgs,
  | 'constructionType'
  | 'propertyType'
  | 'locationType'
  | 'locationCode'
  | 'withStatistics'
  | 'locale'
>;

type ProbeEndpointResult = {
  endpoint: string;
  ok: boolean;
  status?: number;
  error?: string;
  featureCount?: number;
  sample?: unknown;
  rows?: number;
};

type PlacePriceRow = Record<string, unknown> & {
  sourceLayer: number;
  level: 'autonomous-community' | 'province' | 'municipality' | 'postal-code';
  placeName: string;
  pricePerSqm: number;
  geometry?: unknown;
};

type ArcgisProbeResult = {
  searchTerm: string;
  baseFilter: string;
  endpoints: ProbeEndpointResult[];
  rows: PlacePriceRow[];
};

type InspectSummary = {
  sourceUrl: string;
  frameUrl?: string;
  generatedAt: string;
  artifacts: {
    rootHtmlFile: string;
    frameHtmlFile?: string;
    rootScreenshotFile: string;
    frameScreenshotFile?: string;
    reportFile: string;
  };
  arcgisProbe: ArcgisProbeResult;
};

const PRICE_M2_FEATURE_SERVER =
  'https://services-eu1.arcgis.com/UpPGybwp9RK4YtZj/arcgis/rest/services/agol_precio_m2/FeatureServer';

const DEFAULT_BASE_FILTER =
  '(tipo_construccion_id = 99) AND (clase_finca_urbana_id = 99)';

const BASE_PRICE_FILTER = `${DEFAULT_BASE_FILTER} AND precio_m2 > 0`;
const MAX_QUERY_PAGES = 50;
const DEFAULT_MAP_INSPECT_KPI = 'pricePerSqm';

const layerConfigs = [
  {
    layer: 1,
    level: 'autonomous-community' as const,
    fields: ['name_ccaa2', 'name_ccaa'] as const,
  },
  {
    layer: 2,
    level: 'province' as const,
    fields: ['name_prov2', 'name_prov'] as const,
  },
  {
    layer: 3,
    level: 'municipality' as const,
    fields: ['name_muni2', 'name_muni'] as const,
  },
  {
    layer: 4,
    level: 'postal-code' as const,
    fields: ['cp'] as const,
  },
];

async function writeTextFile(filePath: string, content: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content, 'utf-8');
}

async function writeBinaryFile(
  filePath: string,
  content: Buffer,
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
}

function resolveIframeUrl(sourceUrl: string, html: string): string | undefined {
  const iframeMatch = html.match(/<iframe[^>]*src=["']([^"']+)["'][^>]*>/i);
  const iframeSrc = iframeMatch?.[1];
  if (!iframeSrc) {
    return undefined;
  }

  try {
    return new URL(iframeSrc, sourceUrl).toString();
  } catch {
    return undefined;
  }
}

function transformGeometryToPolyline(geometry: unknown): unknown {
  if (!geometry || typeof geometry !== 'object') {
    return geometry;
  }

  const value = geometry as {
    rings?: unknown;
    paths?: unknown;
    spatialReference?: unknown;
  };

  const sourcePaths = Array.isArray(value.paths)
    ? value.paths
    : Array.isArray(value.rings)
      ? value.rings
      : undefined;

  if (!sourcePaths) {
    return geometry;
  }

  const firstPath = sourcePaths.find((candidate) => Array.isArray(candidate));
  if (!Array.isArray(firstPath)) {
    return geometry;
  }

  const coordinates: Array<[number, number]> = firstPath
    .filter(
      (point): point is [number, number] =>
        Array.isArray(point) &&
        point.length >= 2 &&
        typeof point[0] === 'number' &&
        typeof point[1] === 'number',
    )
    .map(([x, y]): [number, number] => [y, x]);

  if (coordinates.length === 0) {
    return geometry;
  }

  return {
    paths: polyline.encode(coordinates),
    spatialReference: value.spatialReference,
  };
}

async function fetchArcgisQuery(endpoint: URL): Promise<
  ProbeEndpointResult & {
    features: Array<{
      attributes: Record<string, unknown>;
      geometry?: unknown;
    }>;
  }
> {
  try {
    const response = await fetch(endpoint);
    const status = response.status;
    if (!response.ok) {
      return {
        endpoint: endpoint.toString(),
        ok: false,
        status,
        error: `HTTP ${status}`,
        features: [],
      };
    }

    const parsed = (await response.json()) as {
      features?: Array<{ attributes?: Record<string, unknown> }>;
      error?: { message?: string };
    };

    if (parsed.error?.message) {
      return {
        endpoint: endpoint.toString(),
        ok: false,
        status,
        error: parsed.error.message,
        features: [],
      };
    }

    const features = (parsed.features ?? [])
      .map((feature) => ({
        attributes: feature.attributes ?? {},
        geometry: (feature as { geometry?: unknown }).geometry,
      }))
      .filter((feature) => Object.keys(feature.attributes).length > 0);

    const featureCount = features.length;
    const sample = features[0]?.attributes;

    return {
      endpoint: endpoint.toString(),
      ok: true,
      status,
      featureCount,
      sample,
      features,
    };
  } catch (error) {
    return {
      endpoint: endpoint.toString(),
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      features: [],
    };
  }
}

async function fetchAllArcgisQueryPages(endpoint: URL): Promise<
  ProbeEndpointResult & {
    features: Array<{
      attributes: Record<string, unknown>;
      geometry?: unknown;
    }>;
  }
> {
  const pageSizeRaw = Number(endpoint.searchParams.get('resultRecordCount'));
  const pageSize =
    Number.isFinite(pageSizeRaw) && pageSizeRaw > 0 ? pageSizeRaw : 500;

  const features: Array<{
    attributes: Record<string, unknown>;
    geometry?: unknown;
  }> = [];

  for (let page = 0; page < MAX_QUERY_PAGES; page += 1) {
    const pageUrl = new URL(endpoint.toString());
    pageUrl.searchParams.set('resultOffset', String(page * pageSize));

    const pageResult = await fetchArcgisQuery(pageUrl);
    if (!pageResult.ok) {
      return {
        endpoint: pageUrl.toString(),
        ok: false,
        status: pageResult.status,
        error: pageResult.error,
        featureCount: features.length,
        sample: features[0]?.attributes,
        features,
      };
    }

    features.push(...pageResult.features);

    if (pageResult.features.length < pageSize) {
      break;
    }
  }

  return {
    endpoint: endpoint.toString(),
    ok: true,
    status: 200,
    featureCount: features.length,
    sample: features[0]?.attributes,
    features,
  };
}

function buildLayerProbeUrl(
  layer: number,
  fields: readonly string[],
  searchTerm: string,
): URL {
  const endpoint = new URL(`${PRICE_M2_FEATURE_SERVER}/${layer}/query`);
  endpoint.searchParams.set('f', 'json');
  endpoint.searchParams.set('where', BASE_PRICE_FILTER);
  endpoint.searchParams.set('returnGeometry', 'true');
  endpoint.searchParams.set('resultRecordCount', '500');
  endpoint.searchParams.set('outFields', '*');

  if (layer === 4) {
    endpoint.searchParams.set('orderByFields', 'cp ASC');
    endpoint.searchParams.set('returnDistinctValues', 'false');
    if (searchTerm.length > 0) {
      endpoint.searchParams.set(
        'where',
        `${BASE_PRICE_FILTER} AND cp LIKE '${searchTerm.replace(/'/g, "''")}%'`,
      );
    }
    return endpoint;
  }

  endpoint.searchParams.set('orderByFields', 'precio_m2 DESC');
  endpoint.searchParams.set('returnDistinctValues', 'false');

  if (searchTerm.length > 0) {
    endpoint.searchParams.set(
      'fullText',
      JSON.stringify([
        {
          onFields: fields,
          searchTerm,
          searchType: 'prefix',
        },
      ]),
    );
  }

  return endpoint;
}

async function runArcgisProbes(searchTerm: string): Promise<ArcgisProbeResult> {
  const normalizedSearchTerm = searchTerm.trim();
  const endpoints: ProbeEndpointResult[] = [];
  const rows: PlacePriceRow[] = [];
  const rowKeys = new Set<string>();

  for (const config of layerConfigs) {
    const probeUrl = buildLayerProbeUrl(
      config.layer,
      config.fields,
      normalizedSearchTerm,
    );
    const probe = await fetchAllArcgisQueryPages(probeUrl);

    let extractedCount = 0;
    for (const feature of probe.features) {
      const attributes = feature.attributes;
      const priceCandidate = attributes.precio_m2;
      const pricePerSqm =
        typeof priceCandidate === 'number'
          ? priceCandidate
          : Number(priceCandidate);

      if (!Number.isFinite(pricePerSqm) || pricePerSqm <= 0) {
        continue;
      }

      const placeName = config.fields
        .map((field) => attributes[field])
        .find((value) => typeof value === 'string' && value.trim().length > 0);

      if (typeof placeName !== 'string' || placeName.trim().length === 0) {
        continue;
      }

      const normalizedPlaceName = placeName.trim();
      const objectIdCandidate = attributes.objectid ?? attributes.oid;
      const objectId =
        typeof objectIdCandidate === 'number' ||
        typeof objectIdCandidate === 'string'
          ? String(objectIdCandidate)
          : undefined;
      const rowKey = objectId
        ? `${config.level}:${objectId}`
        : `${config.level}:${normalizedPlaceName}:${pricePerSqm}`;
      if (rowKeys.has(rowKey)) {
        continue;
      }

      rowKeys.add(rowKey);
      rows.push({
        ...attributes,
        sourceLayer: config.layer,
        level: config.level,
        placeName: normalizedPlaceName,
        pricePerSqm,
        geometry: transformGeometryToPolyline(feature.geometry),
      });
      extractedCount += 1;
    }

    endpoints.push({
      endpoint: probe.endpoint,
      ok: probe.ok,
      status: probe.status,
      error: probe.error,
      featureCount: probe.featureCount,
      sample: probe.sample,
      rows: extractedCount,
    });
  }

  return {
    searchTerm: normalizedSearchTerm,
    baseFilter: DEFAULT_BASE_FILTER,
    endpoints,
    rows,
  };
}

function createFindingsMarkdown(summary: InspectSummary): string {
  const endpointLines = summary.arcgisProbe.endpoints
    .map((probe) => {
      const status = probe.ok
        ? `✅ ${probe.status ?? 'ok'}`
        : `❌ ${probe.status ?? 'failed'}`;
      const details = probe.ok
        ? `features=${probe.featureCount ?? 0}, rows=${probe.rows ?? 0}`
        : `error=${probe.error ?? 'unknown'}`;
      return `- ${status} — ${details} — ${probe.endpoint}`;
    })
    .join('\n');

  const sampleRows = summary.arcgisProbe.rows
    .slice(0, 20)
    .map((row) => `- ${row.level} | ${row.placeName} | ${row.pricePerSqm} €/m²`)
    .join('\n');

  return `# Penotariado Housing Price Finder — Technical Findings

Generated: ${summary.generatedAt}

## Scope

- Source URL: ${summary.sourceUrl}
- Iframe URL: ${summary.frameUrl ?? 'not detected'}
- Search probe term: ${summary.arcgisProbe.searchTerm}

## What is scrapable

- The rendered map is a canvas inside an ArcGIS iframe, but data is requested from ArcGIS FeatureServer endpoints.
- KPI/search data is retrievable through HTTP queries (JSON/PBF), not only through visual canvas extraction.
- Main baseline filter observed:




  ${summary.arcgisProbe.baseFilter}

## Captured artifacts

- Root HTML: ${summary.artifacts.rootHtmlFile}
- Iframe HTML: ${summary.artifacts.frameHtmlFile ?? 'not captured'}
- Root screenshot: ${summary.artifacts.rootScreenshotFile}
- Iframe screenshot: ${summary.artifacts.frameScreenshotFile ?? 'not captured'}

## ArcGIS probe results

${endpointLines}

## Extracted place/price rows

- Total rows: ${summary.arcgisProbe.rows.length}
${sampleRows || '- No rows extracted'}

## Notes

- In this implementation, search exploration is done via direct ArcGIS query probes (fullText/by-layer filtering).
- This is a reliable extraction path and usually simpler/faster than scraping pixels from canvas.
`;
}

function buildMapInspectUrl(args: MapInspectArgs): string {
  const url = new URL(
    `https://penotariado.com/inmobiliario/${args.locale}/housing-price-finder`,
  );
  url.searchParams.set('constructionType', args.constructionType);
  url.searchParams.set('propertyType', args.propertyType);
  url.searchParams.set('locationType', args.locationType);
  url.searchParams.set('kpi', DEFAULT_MAP_INSPECT_KPI);
  url.searchParams.set('locationCode', args.locationCode);
  url.searchParams.set('withStatistics', String(args.withStatistics));
  return url.toString();
}

function resolveMapInspectTargetUrl(args: MapInspectArgs): string {
  return buildMapInspectUrl(args);
}

export async function runMapInspectAction(
  inputUrl: string,
  options?: RunMapInspectActionOptions,
): Promise<number> {
  const startTime = Date.now();
  const targetUrl = inputUrl.trim();
  const outputDir = options?.outputDir ?? join('tmp', 'map-inspect');
  const outputFile = options?.outputFile;
  const headless = options?.headless ?? true;
  const pretty = options?.pretty ?? false;
  const search = options?.search ?? 'Madrid';

  const rootHtmlFile = join(outputDir, 'raw', 'root.html');
  const frameHtmlFile = join(outputDir, 'raw', 'map-frame.html');
  const rootScreenshotFile = join(outputDir, 'screenshots', 'root.png');
  const frameScreenshotFile = join(outputDir, 'screenshots', 'map-frame.png');
  const reportFile = join(outputDir, 'report.md');
  const probeJsonFile = join(outputDir, 'probes', 'arcgis-probes.json');
  const placePriceJsonFile = join(
    outputDir,
    'data',
    'place-price-per-sqm.json',
  );

  const storageDir = join(outputDir, '.crawlee-storage');
  const config = new Configuration({
    storageClientOptions: { localDataDirectory: storageDir },
    persistStorage: false,
  });

  const summary: InspectSummary = {
    sourceUrl: targetUrl,
    generatedAt: new Date().toISOString(),
    artifacts: {
      rootHtmlFile,
      rootScreenshotFile,
      reportFile,
    },
    arcgisProbe: {
      searchTerm: search,
      baseFilter: DEFAULT_BASE_FILTER,
      endpoints: [],
      rows: [],
    },
  };

  log.info(
    'Starting map-inspect action',
    JSON.stringify({ targetUrl, options }),
  );

  const cloudNode = new CloudNode();
  await cloudNode.listen();

  const router = Router.create<UlixeeCrawlingContext>();

  router.addHandler('ROOT', async (context) => {
    const html = await context.page.html();
    await writeTextFile(rootHtmlFile, html);

    const screenshot = await context.page.tab.takeScreenshot();
    await writeBinaryFile(rootScreenshotFile, screenshot);

    const iframeUrl = resolveIframeUrl(context.request.url, html);
    if (iframeUrl) {
      summary.frameUrl = iframeUrl;
      await context.crawler.addRequests([
        { url: iframeUrl, label: 'MAP_FRAME' },
      ]);
    }
  });

  router.addHandler('MAP_FRAME', async (context) => {
    const html = await context.page.html();
    await writeTextFile(frameHtmlFile, html);
    summary.artifacts.frameHtmlFile = frameHtmlFile;

    const screenshot = await context.page.tab.takeScreenshot();
    await writeBinaryFile(frameScreenshotFile, screenshot);
    summary.artifacts.frameScreenshotFile = frameScreenshotFile;
  });

  try {
    const crawler = new UlixeeCrawler(
      {
        launchContext: {
          heroOptions: {
            connectionToCore: {
              host: cloudNode.host,
            },
          },
        },
        headless,
        maxConcurrency: 1,
        maxRequestRetries: 1,
        requestHandlerTimeoutSecs: 120,
        requestHandler: router,
      },
      config,
    );

    await crawler.run([{ url: targetUrl, label: 'ROOT' }]);

    summary.arcgisProbe = await runArcgisProbes(search);
    await writeTextFile(probeJsonFile, formatJson(summary.arcgisProbe, true));
    await writeTextFile(
      placePriceJsonFile,
      formatJson(summary.arcgisProbe.rows, true),
    );

    const reportMarkdown = createFindingsMarkdown(summary);
    await writeTextFile(reportFile, reportMarkdown);

    const output = formatJson(summary.arcgisProbe.rows, pretty);
    if (outputFile) {
      await writeTextFile(outputFile, output);
    } else {
      console.log(output);
    }

    log.info(
      'Map inspect action finished',
      JSON.stringify({
        durationMs: Date.now() - startTime,
        outputDir,
        reportFile,
        probeCount: summary.arcgisProbe.endpoints.length,
        rows: summary.arcgisProbe.rows.length,
      }),
    );

    return summary.arcgisProbe.rows.length > 0 ? 0 : 1;
  } finally {
    await cloudNode.close();
  }
}

export { mapInspectArgsSchema };
export { resolveMapInspectTargetUrl };
export type { MapInspectArgs, RunMapInspectActionOptions };
