import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { log } from '@workspace/logger';
import { z } from 'zod';
import { CloudNode } from '@ulixee/cloud';
import {
  IdealistaDetailParserPlugin,
  type IdealistaDetailParseResult,
} from '../plugins/idealista-detail-parser.js';
import { UlixeeWebEngine } from '../web-engine/ulixee-engine.js';
import type { FetchResponse } from '../web-engine/types.js';
import { formatJson } from '../utils/json.js';

const booleanFromCliSchema = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true');

const detailActionOptionsSchema = z.object({
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

const detailArgsSchema = z.object({
  id: z
    .string()
    .trim()
    .min(1, 'Missing required option: --id')
    .regex(/^\d+$/, 'Invalid --id. Must be a numeric Idealista property ID.'),
  ...detailActionOptionsSchema.shape,
});

type DetailArgs = z.infer<typeof detailArgsSchema>;
type RunDetailActionOptions = Omit<DetailArgs, 'id'>;

function buildDetailUrl(propertyId: string): string {
  return `https://www.idealista.com/inmueble/${propertyId}/`;
}

export async function runDetailAction(
  propertyId: string,
  options?: RunDetailActionOptions,
): Promise<number> {
  const cloudNode = new CloudNode({
    shouldShutdownOnSignals: true,
  });
  await cloudNode.listen();

  const cloudAddress = await cloudNode.address;
  const startTime = Date.now();

  const pretty = options?.pretty ?? false;
  const headless = options?.headless ?? true;
  const outputFile = options?.outputFile;
  const targetUrl = buildDetailUrl(propertyId);

  const engine = new UlixeeWebEngine({
    blockedResourceTypes: [
      'BlockAssets',
      'BlockCssResources',
      'BlockFonts',
      'BlockIcons',
      'BlockImages',
      'BlockMedia',
    ],
    connectionToCore: {
      host: cloudAddress,
    },
  });

  log.info('Starting detail action', JSON.stringify({ targetUrl, options }));
  try {
    const response: FetchResponse<IdealistaDetailParseResult> =
      await engine.fetchContent<IdealistaDetailParseResult>(targetUrl, {
        showBrowser: !headless,
        htmlParser: new IdealistaDetailParserPlugin(),
      });

    if (!response.success) {
      console.error(
        formatJson(
          {
            success: false,
            error: response.error,
            errorCode: response.errorCode,
            metadata: response.metadata,
          },
          pretty,
        ),
      );
      return 1;
    }

    const output = formatJson(response.content, pretty);

    if (outputFile) {
      await mkdir(dirname(outputFile), { recursive: true });
      await writeFile(outputFile, output, 'utf-8');
    } else {
      console.log(output);
    }

    log.info(`Execution finished in ${Date.now() - startTime}ms`);
    return 0;
  } finally {
    await engine.cleanup();
    await cloudNode.close();
  }
}

export { detailArgsSchema };
export type { DetailArgs, RunDetailActionOptions };
