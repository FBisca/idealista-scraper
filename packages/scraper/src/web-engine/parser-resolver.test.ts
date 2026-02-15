import { describe, it, expect } from 'vitest'
import { resolveParserWithPlugins } from './parser-resolver.js'
import { ContentParserPlugin, type ParseContext, type WebContent, WebContentParser } from './types.js'

class StaticParser extends WebContentParser<string, string> {
  constructor(private readonly output: string) {
    super()
  }

  async extract(): Promise<string> {
    return this.output
  }
}

class MatchByDomainPlugin extends ContentParserPlugin<string, string> {
  readonly name = 'match-by-domain'

  constructor(private readonly expectedDomain: string, private readonly output: string) {
    super()
  }

  applies({ context }: { context: ParseContext }): boolean {
    return context.page?.domain === this.expectedDomain
  }

  async extract(content: WebContent<string>): Promise<string> {
    return `${this.output}:${content.url}`
  }
}

class AsyncTitlePlugin extends ContentParserPlugin<string, string> {
  readonly name = 'async-title'

  applies({ context }: { context: ParseContext }): Promise<boolean> {
    return Promise.resolve(Boolean(context.page?.title?.includes('match-me')))
  }

  async extract(content: WebContent<string>, context?: ParseContext): Promise<string> {
    return `title:${context?.page?.title ?? 'n/a'}:${content.url}`
  }
}

describe('resolveParserWithPlugins', () => {
  it('uses first matching plugin', async () => {
    const content = { url: 'https://example.com', data: '<html></html>' }
    const context: ParseContext = {
      engine: 'ulixee-hero',
      requestUrl: content.url,
      finalUrl: content.url,
      page: { domain: 'example.com', title: 'page title' }
    }

    const first = new MatchByDomainPlugin('example.com', 'first')
    const second = new MatchByDomainPlugin('example.com', 'second')

    const result = await resolveParserWithPlugins(
      content,
      {
        htmlParser: new StaticParser('fallback'),
        plugins: [first, second]
      },
      context
    )

    expect(result.pluginName).toBe('match-by-domain')
    expect(result.content).toBe('first:https://example.com')
  })

  it('falls back to htmlParser when no plugin matches', async () => {
    const content = { url: 'https://nomatch.dev', data: '<html></html>' }
    const context: ParseContext = {
      engine: 'axios',
      requestUrl: content.url,
      finalUrl: content.url,
      page: { domain: 'nomatch.dev' }
    }

    const result = await resolveParserWithPlugins(
      content,
      {
        htmlParser: new StaticParser('fallback-output'),
        plugins: [new MatchByDomainPlugin('example.com', 'plugin')]
      },
      context
    )

    expect(result.pluginName).toBeUndefined()
    expect(result.content).toBe('fallback-output')
  })

  it('supports async plugin conditions and context-aware extraction', async () => {
    const content = { url: 'https://async.dev', data: '<html></html>' }
    const context: ParseContext = {
      engine: 'ulixee-hero',
      requestUrl: content.url,
      finalUrl: content.url,
      page: { title: 'please match-me' }
    }

    const result = await resolveParserWithPlugins(
      content,
      {
        htmlParser: new StaticParser('fallback-output'),
        plugins: [new AsyncTitlePlugin()]
      },
      context
    )

    expect(result.pluginName).toBe('async-title')
    expect(result.content).toBe('title:please match-me:https://async.dev')
  })
})
