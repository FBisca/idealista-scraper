import * as cheerio from 'cheerio';
import { gotScraping } from 'got-scraping';
import type {
  FetchContentOptions,
  FetchResponse,
  InteractiveWebContentParser,
  ParseContext,
  WebContentParser,
} from './types.js';
import { resolveParserWithPlugins } from './parser-resolver.js';

type CrawleeHttpEngineConfig = {
  headers?: Record<string, string>;
  timeoutMs?: number;
};

async function fetchWithHttp<T>(
  url: string,
  options: FetchContentOptions<
    T,
    WebContentParser<string, T> | InteractiveWebContentParser<string, T>
  >,
  config?: CrawleeHttpEngineConfig,
): Promise<FetchResponse<T>> {
  const startTime = Date.now();
  const timeoutMs = config?.timeoutMs ?? 30_000;

  try {
    const response = await gotScraping({
      url,
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
        ...config?.headers,
      },
      timeout: { request: timeoutMs },
      responseType: 'text',
      followRedirect: true,
      throwHttpErrors: false,
    });

    const statusCode = response.statusCode;

    if (statusCode === 403 || statusCode === 429) {
      return {
        success: false,
        error: `HTTP ${statusCode}`,
        errorCode: 'blocked',
        metadata: {
          duration: Date.now() - startTime,
          method: 'crawlee-http',
          statusCode,
        },
      };
    }

    if (statusCode >= 400) {
      return {
        success: false,
        error: `HTTP ${statusCode}`,
        errorCode: 'unexpected',
        metadata: {
          duration: Date.now() - startTime,
          method: 'crawlee-http',
          statusCode,
        },
      };
    }

    const html =
      typeof response.body === 'string'
        ? response.body
        : String(response.body);

    const $ = cheerio.load(html);
    const title = $('title').first().text() || '';
    const finalUrl = response.url ?? url;

    const parseContext: ParseContext = {
      engine: 'crawlee-http',
      requestUrl: url,
      finalUrl,
      page: {
        title,
        html,
      },
      response: {
        statusCode,
      },
    };

    const { content, pluginName } = await resolveParserWithPlugins(
      { url: finalUrl, data: html },
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
        statusCode,
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

export { fetchWithHttp };
export type { CrawleeHttpEngineConfig };
