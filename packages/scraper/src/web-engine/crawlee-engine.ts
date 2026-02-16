import * as cheerio from 'cheerio';
import { EngineAdapter } from './engine-adapter.js';
import type {
  FetchContentOptions,
  FetchResponse,
  InteractiveWebContentParser,
  ParseContext,
  WebContentParser,
} from './types.js';
import { resolveParserWithPlugins } from './parser-resolver.js';

type CrawleeEngineConfig = {
  userAgent?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
};

export class CrawleeEngineAdapter extends EngineAdapter {
  readonly engineType = 'crawlee' as const;
  private readonly config: CrawleeEngineConfig;

  constructor(config?: CrawleeEngineConfig) {
    super();
    this.config = {
      timeoutMs: 30_000,
      ...config,
    };
  }

  async fetch<T>(
    url: string,
    options: FetchContentOptions<
      T,
      WebContentParser<string, T> | InteractiveWebContentParser<string, T>
    >,
  ): Promise<FetchResponse<T>> {
    const startTime = Date.now();

    try {
      const { default: axios } = await import('axios');

      const response = await axios.get<string>(url, {
        headers: {
          'User-Agent':
            this.config.userAgent ??
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9',
          ...this.config.headers,
        },
        timeout: this.config.timeoutMs,
        responseType: 'text',
        validateStatus: (status) => status < 500,
      });

      if (response.status === 403) {
        return {
          success: false,
          error: `HTTP ${response.status}`,
          errorCode: 'blocked',
          metadata: {
            duration: Date.now() - startTime,
            method: 'crawlee-http',
          },
        };
      }

      if (response.status === 429) {
        return {
          success: false,
          error: `HTTP ${response.status} Too Many Requests`,
          errorCode: 'blocked',
          metadata: {
            duration: Date.now() - startTime,
            method: 'crawlee-http',
          },
        };
      }

      if (response.status >= 400) {
        return {
          success: false,
          error: `HTTP ${response.status}`,
          errorCode: 'unexpected',
          metadata: {
            duration: Date.now() - startTime,
            method: 'crawlee-http',
          },
        };
      }

      const html =
        typeof response.data === 'string'
          ? response.data
          : String(response.data);

      const $ = cheerio.load(html);
      const title = $('title').first().text() || '';

      const parseContext: ParseContext = {
        engine: 'crawlee-http',
        requestUrl: url,
        finalUrl: url,
        page: {
          title,
          html,
        },
      };

      const { content, pluginName } = await resolveParserWithPlugins(
        { url, data: html },
        options,
        parseContext,
      );

      return {
        success: true,
        title,
        content,
        metadata: {
          duration: Date.now() - startTime,
          method: 'crawlee-http',
          parserPlugin: pluginName,
          statusCode: response.status,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      return {
        success: false,
        error: message,
        errorCode: 'unexpected',
        metadata: {
          duration: Date.now() - startTime,
          method: 'crawlee-http',
        },
      };
    }
  }

  async cleanup(): Promise<void> {
    // HTTP client has no persistent resources to clean up.
  }
}
