import * as cheerio from 'cheerio'
import { SearchResult } from './types.js'
import { WebContent, WebContentParser } from '../types.js'
import { log } from '@workspace/logger'

/**
 * DuckDuckGo search result extractor
 */
export class DuckDuckGoSearchParser extends WebContentParser<string, SearchResult[]> {
  constructor(private readonly maxResults: number = 10) {
    super()
  }

  getSearchUrl(query: string): string {
    const encodedQuery = encodeURIComponent(query)
    return `https://html.duckduckgo.com/html/?q=${encodedQuery}`
  }

  async extract(content: WebContent<string>): Promise<SearchResult[]> {
    const $ = cheerio.load(content.data)
    const results: SearchResult[] = []

    $('.result').each((_, element) => {
      if (results.length >= this.maxResults) return false

      const titleEl = $(element).find('.result__title')
      const snippetEl = $(element).find('.result__snippet')
      const urlEl = $(element).find('.result__url')

      const title = titleEl.text().trim()
      const snippet = snippetEl.text().trim()
      const urlText = urlEl.text().trim()

      if (title && urlText) {
        try {
          const url = new URL(urlText.startsWith('http') ? urlText : `https://${urlText}`)
          results.push({
            title,
            url: url.href,
            snippet
          })
        } catch {
          log.debug(`Invalid URL skipped: ${urlText}`)
        }
      }
    })

    log.info(`[DuckDuckGo] Extracted ${results.length} search results`)
    return results
  }
}
