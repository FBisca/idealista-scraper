import {
    IdealistaListParserPlugin,
    UlixeeWebEngine,
    type IdealistaListParseResult
} from '../index.js'
import { formatJson } from '../utils/json.js'

function normalizeUrl(inputUrl: string): string {
  const trimmed = inputUrl.trim()

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed
  }

  const normalizedPath = trimmed.replace(/^\/+/, '')
  return `https://www.idealista.com/${normalizedPath}`
}

export async function runListAction(inputUrl: string, options?: { pretty?: boolean }): Promise<number> {
  const targetUrl = normalizeUrl(inputUrl)
  const pretty = options?.pretty ?? false
  const engine = new UlixeeWebEngine()

  try {
    const response = await engine.fetchContent<IdealistaListParseResult>(targetUrl, {
      showBrowser: false,
      htmlParser: new IdealistaListParserPlugin(),
    })

    if (!response.success) {
      console.error(
        formatJson(
          {
            success: false,
            error: response.error,
            errorCode: response.errorCode,
            metadata: response.metadata
          },
          pretty
        )
      )
      return 1
    }

    console.log(formatJson(response.content, pretty))
    return 0
  } finally {
    await engine.cleanup()
  }
}
