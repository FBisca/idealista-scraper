import { log } from '@workspace/logger'
import { PDFParse } from 'pdf-parse'
import { ScrapedContent } from './types.js'
import { WebContentParser } from '../types.js'

export class PdfScraper extends WebContentParser<unknown, ScrapedContent> {
  public async extract({ url, data }: { url: string; data: unknown }): Promise<ScrapedContent> {
    try {
      if (typeof data !== 'string' && !Array.isArray(data)) {
        throw new Error('Data is not a string or array')
      }

      const buffer = Buffer.from(data)

      log.info('Extracting PDF from buffer', { url, sizeKB: Math.round(buffer.length / 1024) })

      const domain = new URL(url).hostname
      const parser = new PDFParse({ data: buffer })
      const info = await parser.getInfo()
      const text = await parser.getText()

      await parser.destroy()

      log.info('PDF extraction successful', {
        url,
        pages: info.total,
        textLength: text.text.length
      })

      return {
        url,
        title: info.info?.Title ?? 'PDF Document',
        text: text.text,
        metadata: {
          domain,
          scrapedAt: new Date().toISOString(),
          textLength: text.text.length
        }
      } satisfies ScrapedContent
    } catch (error) {
      log.error('Failed to extract PDF from buffer', { url, error })
      throw new Error(`PDF extraction failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }
}
