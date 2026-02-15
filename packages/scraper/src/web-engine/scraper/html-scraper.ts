import * as cheerio from 'cheerio'
import { log } from '@workspace/logger'
import { ScrapedContent } from './types.js'
import { WebContentParser } from '../types.js'

export class HtmlScraper extends WebContentParser<string, ScrapedContent> {
  public async extract({ url, data }: { url: string; data: string }): Promise<ScrapedContent> {
    log.info('[HtmlContentExtractor] Extracting content from HTML', url)

    const domain = new URL(url).hostname
    const $ = cheerio.load(data)

    // --- Extract links early ---
    const links = $('a[href]')
      .map((_, el) => $(el).attr('href'))
      .get()
      .filter(Boolean)
      .map(href => {
        try {
          return new URL(href, url)
        } catch {
          return null
        }
      })
      .filter((u): u is URL => u !== null)
      .filter(u => u.protocol.startsWith('http'))

    // --- Remove obvious noise ---
    $(
      `
      script,
      style,
      nav,
      footer,
      header,
      aside,
      iframe,
      svg,
      video,
      audio,
      canvas,
      form,
      button,
      noscript,
      .cookie,
      .cookie-banner,
      .advertisement,
      .ads,
      .promo
      `
    ).remove()

    // --- Select best content root ---
    const contentRoot = $('main').first().length
      ? $('main').first()
      : $('article').first().length
        ? $('article').first()
        : $('[role="main"]').first().length
          ? $('[role="main"]').first()
          : $('body')

    // --- Title ---
    const title =
      $('meta[property="og:title"]').attr('content')?.trim() ||
      $('title').text().trim() ||
      $('h1').first().text().trim() ||
      'No title'

    // --- Structured text extraction ---
    const sections: string[] = []

    contentRoot.find('h1, h2, h3, h4, p, ul, a, ol, span, table').each((_, el) => {
      const tag = el.tagName.toLowerCase()

      if (tag.startsWith('h')) {
        const level = Number(tag[1])
        const heading = $(el).text().trim()
        if (heading) sections.push(`${'#'.repeat(level)} ${heading}`)
        return
      }

      if (tag === 'p' || tag === 'a' || tag === 'span') {
        const text = $(el).text().replace(/\s+/g, ' ').trim()
        sections.push(text)
        return
      }

      if (tag === 'ul' || tag === 'ol') {
        const items = $(el)
          .find('li')
          .map((_, li) => `- ${$(li).text().trim()}`)
          .get()
          .filter(i => i.length > 10)

        if (items.length) sections.push(items.join('\n'))
        return
      }

      if (tag === 'table') {
        const rows = $(el)
          .find('tr')
          .map((_, row) =>
            $(row)
              .find('th, td')
              .map((_, cell) => $(cell).text().trim())
              .get()
              .join(' | ')
          )
          .get()

        if (rows.length) sections.push(rows.join('\n'))
      }
    })

    const text = sections.join('\n\n').replace(/\n{3,}/g, '\n\n')

    return {
      url,
      title,
      text,
      links: this.removeDuplicateLinks(links),
      metadata: {
        domain,
        scrapedAt: new Date().toISOString(),
        textLength: text.length
      }
    } satisfies ScrapedContent
  }

  private removeDuplicateLinks(links: URL[]): URL[] {
    const seen = new Set<string>()

    const uniqueLinks: URL[] = []
    for (const link of links) {
      if (!seen.has(link.toString())) {
        seen.add(link.toString())
        uniqueLinks.push(link)
      }
    }

    return uniqueLinks
  }
}
