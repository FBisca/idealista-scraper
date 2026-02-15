import * as cheerio from 'cheerio'
import { SearchResult } from './types.js'
import { WebContent, WebContentParser } from '../types.js'
import { log } from '@workspace/logger'

/**
 * Google search result extractor
 */
export class GoogleSearchParser extends WebContentParser<string, SearchResult[]> {
  constructor(private readonly maxResults: number = 10) {
    super()
  }

  async extract(content: WebContent<string>): Promise<SearchResult[]> {
    const $ = cheerio.load(content.data)
    const results: SearchResult[] = []

    // Google search results can be in multiple container types
    // Try multiple selectors to catch different Google layouts
    const resultSelectors = [
      'div.g', // Standard Google results
      'div[data-sokoban-container]', // Alternative container
      'div.tF2Cxc', // Another result container type
      'div.rc', // Results container
      'div#search div.g' // Search results within #search
    ]

    for (const selector of resultSelectors) {
      if (results.length >= this.maxResults) break

      $(selector).each((_, element) => {
        if (results.length >= this.maxResults) return false

        // Try multiple selectors for title (h3 is most common)
        const titleEl = $(element).find('h3').first()
        if (!titleEl.length) {
          // Fallback to other title selectors
          const altTitle = $(element).find('a h3, .LC20lb, .DKV0Md').first()
          if (!altTitle.length) return true // Skip if no title found
        }

        // Find link - can be direct <a> or nested
        const linkEl = $(element).find('a[href*="http"], a[href^="/url"]').first()
        if (!linkEl.length) return true

        // Snippet can be in multiple locations
        const snippetEl = $(element).find('div[data-sncf], div.VwiC3b, span.aCOpRe, .IsZvec, .st').first()

        const title = titleEl.text().trim() || $(element).find('.LC20lb, .DKV0Md').first().text().trim()
        const href = linkEl.attr('href') || ''
        const snippet = snippetEl.text().trim()

        if (title && href) {
          try {
            // Google sometimes uses /url?q= redirects
            let cleanUrl = href
            if (href.startsWith('/url?q=')) {
              const urlParams = new URLSearchParams(href.slice(6))
              cleanUrl = urlParams.get('q') || href
            } else if (href.startsWith('/url?') || href.startsWith('/search?') || href.startsWith('/')) {
              // Skip Google internal links
              return true
            }

            // Only process valid http/https URLs
            if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
              return true
            }

            const url = new URL(cleanUrl)
            results.push({
              title,
              url: url.href,
              snippet
            })
          } catch (error) {
            log.debug(`Invalid URL skipped: ${href} - ${error instanceof Error ? error.message : String(error)}`)
          }
        }
      })
    }

    log.info(`[Google] Extracted ${results.length} search results`)

    // Debug: log if no results found
    if (results.length === 0) {
      log.debug(`[Google] No results found. Page might not have loaded results yet or structure changed.`)
      log.debug(`[Google] Checking for common Google elements...`)
      const hasSearchForm = $('form[action="/search"]').length > 0
      const hasMainContent = $('#main, #search, .main').length > 0
      log.debug(`[Google] Search form present: ${hasSearchForm}, Main content present: ${hasMainContent}`)
    }

    return results
  }

  getSearchUrl(query: string): string {
    const encodedQuery = encodeURIComponent(query)
    return `https://www.google.com/search?q=${encodedQuery}`
  }
}
