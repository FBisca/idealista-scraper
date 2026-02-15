import axios from 'axios'
import https from 'https'
import http from 'http'
import { log } from '@workspace/logger'
import { ParserInteractionUnsupportedError, resolveParserWithPlugins } from './parser-resolver.js'
import { FetchContentOptions, FetchResponse, ParseContext, WebContentParser, WebEngine } from './types.js'

/**
 * Axios-based web search implementation
 * Fast and lightweight, but susceptible to rate limiting/CAPTCHA
 */
export class AxiosWebEngine extends WebEngine {
  private readonly browserHeaders: Record<string, string>
  private readonly axiosInstance: ReturnType<typeof axios.create>

  constructor() {
    super()
    // Real Chrome browser user agent (Chrome 120 on macOS)

    // Complete browser-like headers matching real Chrome requests
    this.browserHeaders = {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br, zstd',
      'Cache-Control': 'max-age=0',
      'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"macOS"',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1',
      Connection: 'keep-alive',
      Referer: 'https://www.google.com/'
    }

    // Create axios instance with cookie support and better TLS handling
    this.axiosInstance = axios.create({
      timeout: 10000,
      maxRedirects: 5,
      validateStatus: status => status < 500, // Accept 4xx but retry on 5xx
      headers: this.browserHeaders,
      // Enable cookie handling
      withCredentials: false, // Set to false as we don't need cross-origin cookies
      // Improve TLS fingerprint by using default Node.js TLS settings
      httpsAgent: new https.Agent({
        keepAlive: true,
        keepAliveMsecs: 1000,
        maxSockets: 5,
        maxFreeSockets: 2,
        timeout: 10000
        // Use default cipher suites for better compatibility
      }),
      // Add httpAgent for consistency
      httpAgent: new http.Agent({
        keepAlive: true,
        keepAliveMsecs: 1000,
        maxSockets: 5,
        maxFreeSockets: 2,
        timeout: 10000
      })
    })
  }

  async fetchContent<T>(
    url: string,
    options: FetchContentOptions<T, WebContentParser<string, T>>
  ): Promise<FetchResponse<T>> {
    const startTime = Date.now()

    try {
      log.info(`[Axios Engine] Fetching content: ${url}`)

      // Update headers based on the URL being fetched
      const urlObj = new URL(url)
      const updatedHeaders: Record<string, string> = {
        ...this.browserHeaders,
        Referer: urlObj.origin + '/',
        Origin: urlObj.origin
      }

      const response = await this.axiosInstance.get(url, {
        headers: updatedHeaders
      })

      if (response.status >= 400) {
        return {
          success: false,
          errorCode: response.status === 403 ? 'blocked' : 'unexpected',
          error: `[Axios Engine] Failed to fetch content: ${response.status}`,
          metadata: {
            duration: Date.now() - startTime,
            method: 'axios',
            responseStatus: response.status
          }
        }
      }

      const parseContext: ParseContext = {
        engine: 'axios',
        requestUrl: url,
        finalUrl: response.request?.res?.responseUrl ?? url,
        request: {
          headers: updatedHeaders
        },
        response: {
          statusCode: response.status,
          headers: response.headers
        }
      }

      const { content, pluginName } = await resolveParserWithPlugins(
        {
          url,
          data: response.data
        },
        options,
        parseContext
      )

      return {
        success: true,
        title: response.data.title,
        content: content,
        metadata: {
          duration: Date.now() - startTime,
          method: 'axios',
          responseStatus: response.status,
          parserPlugin: pluginName
        }
      }
    } catch (error) {
      if (error instanceof ParserInteractionUnsupportedError) {
        return {
          success: false,
          errorCode: 'unsupported-interaction',
          error: error.message,
          metadata: {
            duration: Date.now() - startTime,
            method: 'axios',
            parserName: error.parserName,
            engine: error.engine
          }
        }
      }

      const errorMessage = error instanceof Error ? error.message : String(error)
      log.error('[Axios Engine] Fetch content failed:', errorMessage)

      return {
        success: false,
        errorCode: 'unexpected',
        error: errorMessage,
        metadata: {
          duration: Date.now() - startTime,
          method: 'axios'
        }
      }
    }
  }

  async cleanup(): Promise<void> {
    // Axios doesn't need cleanup
  }
}
