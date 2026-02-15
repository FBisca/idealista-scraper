export interface ScrapedContent {
  url: string
  title: string
  text: string
  links?: URL[]
  metadata: {
    domain: string
    scrapedAt: string
    textLength: number
    isPDF?: boolean
    pdfPages?: number
  }
}
