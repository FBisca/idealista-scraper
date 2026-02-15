import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'
import {
  type IdealistaAveragePricePerSquareMeter,
  IdealistaListParserPlugin,
  type IdealistaListParseResult
} from '../plugins/idealista-list-parser.js'
import { UlixeeWebEngine } from '../web-engine/ulixee-engine.js'
import type { FetchResponse } from '../web-engine/types.js'
import { formatJson } from '../utils/json.js'

const booleanFromCliSchema = z
  .enum(['true', 'false'])
  .transform(value => value === 'true')

const listActionOptionsSchema = z.object({
  outputFile: z
    .preprocess(value => {
      if (value === undefined) {
        return undefined
      }

      if (typeof value === 'string') {
        const trimmed = value.trim()
        return trimmed.length ? trimmed : undefined
      }

      return value
    }, z.string().min(1, 'Invalid --outputFile path'))
    .optional(),
  maxPages: z
    .preprocess(
      value => {
        if (value === undefined) {
          return 1
        }

        if (typeof value === 'string') {
          const parsedValue = Number(value)
          return Number.isFinite(parsedValue) ? parsedValue : value
        }

        return value
      },
      z.number().int().min(1, 'Invalid --maxItems. Provide a positive integer.')
    )
    .default(1),
  headless: z
    .preprocess(
      value => {
        if (value === undefined) {
          return 'false'
        }

        if (typeof value === 'string') {
          return value.toLowerCase()
        }

        return value
      },
      booleanFromCliSchema
    )
    .default(false),
  pretty: z
    .preprocess(
      value => {
        if (value === undefined) {
          return 'false'
        }

        if (typeof value === 'string') {
          return value.toLowerCase()
        }

        return value
      },
      booleanFromCliSchema
    )
    .default(false)
})

const listArgsSchema = z.object({
  url: z.string().trim().min(1, 'Missing required option: --url'),
  ...listActionOptionsSchema.shape
})

type ListArgs = z.infer<typeof listArgsSchema>
type RunListActionOptions = Omit<ListArgs, 'url'>

function normalizeUrl(inputUrl: string): string {
  const trimmed = inputUrl.trim()

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed
  }

  const normalizedPath = trimmed.replace(/^\/+/, '')
  return `https://www.idealista.com/${normalizedPath}`
}

export async function runListAction(
  inputUrl: string,
  options?: RunListActionOptions
): Promise<number> {
  const targetUrl = normalizeUrl(inputUrl)
  const pretty = options?.pretty ?? false
  const maxPages = Math.max(1, options?.maxPages ?? 1)
  const headless = options?.headless ?? true
  const outputFile = options?.outputFile
  
  const engine = new UlixeeWebEngine()

  const collectedListings: IdealistaListParseResult['listings'] = []
  const visitedIds = new Set<string>()
  
  let currentUrl: string | undefined = targetUrl
  let pagesFetched = 0
  let totalItems: number | undefined
  let averagePricePerSquareMeter: IdealistaAveragePricePerSquareMeter | undefined

  try {
    while (currentUrl && pagesFetched < maxPages) {
      const response: FetchResponse<IdealistaListParseResult> = await engine.fetchContent<IdealistaListParseResult>(
        currentUrl,
        {
          showBrowser: !headless,
          htmlParser: new IdealistaListParserPlugin()
        }
      )

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
        )
        return 1
      }

      pagesFetched += 1

      if (!totalItems && response.content.totalItems) {
        totalItems = response.content.totalItems
      }

      if (!averagePricePerSquareMeter && response.content.averagePricePerSquareMeter) {
        averagePricePerSquareMeter = response.content.averagePricePerSquareMeter
      }

      for (const listing of response.content.listings) {
        if (visitedIds.has(listing.id)) {
          continue
        }

        visitedIds.add(listing.id)
        collectedListings.push(listing)
      }

      const nextPageUrl: string | undefined = response.content.pagination.nextPageUrl
      if (!nextPageUrl || pagesFetched >= maxPages) {
        break
      }

      await waitHumanDelay()
      currentUrl = nextPageUrl
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
    )

    if (outputFile) {
      await mkdir(dirname(outputFile), { recursive: true })
      await writeFile(outputFile, output, 'utf-8')
    } else {
      console.log(output)
    }
    return 0
  } finally {
    await engine.cleanup()
  }
}

async function waitHumanDelay(): Promise<void> {
  const minDelayMs = 350
  const maxDelayMs = 1000
  const delayMs = Math.floor(Math.random() * (maxDelayMs - minDelayMs + 1)) + minDelayMs

  await new Promise(resolve => setTimeout(resolve, delayMs))
}

export { listArgsSchema }
export type { ListArgs, RunListActionOptions }