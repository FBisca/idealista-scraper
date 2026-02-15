type FetchContentOptions<T> = {
  showBrowser?: boolean
  htmlParser: WebContentParser<string, T>
  plugins?: ContentParserPlugin<string, T>[]
}

type DefaultMetadata = {
  duration: number
  method: string
}

type Metadata = DefaultMetadata & Record<string, unknown>

type FetchSuccess<T> = {
  success: true
  title: string
  content: T
  metadata: Metadata
}

type FetchError = {
  success: false
  error: string
  errorCode: 'unexpected' | 'blocked'
  metadata: Metadata
}

type FetchResponse<T> = FetchSuccess<T> | FetchError

type WebContent<T> = {
  url: string
  data: T
}

type ParseContext = {
  engine: string
  requestUrl: string
  finalUrl?: string
  metadata?: Record<string, unknown>
  page?: {
    title?: string
    html?: string
    domain?: string
    captchaSelector?: string
  }
  request?: {
    headers?: Record<string, string>
  }
  response?: {
    statusCode?: number
    headers?: Record<string, unknown>
  }
  runtime?: {
    showBrowser?: boolean
    retry?: number
    sessionId?: string
  }
}

type PluginEvaluation<InputType> = {
  content: WebContent<InputType>
  context: ParseContext
}

abstract class WebEngine {
  abstract fetchContent<T>(url: string, options: FetchContentOptions<T>): Promise<FetchResponse<T>>
  abstract cleanup(): Promise<void>
}

abstract class WebContentParser<InputType, OutputType> {
  abstract extract(content: WebContent<InputType>, context?: ParseContext): Promise<OutputType>
}


abstract class ContentParserPlugin<InputType, OutputType> extends WebContentParser<InputType, OutputType> {
  abstract readonly name: string
  abstract applies(input: PluginEvaluation<InputType>): boolean | Promise<boolean>
}


export type { FetchContentOptions, FetchResponse, ParseContext, PluginEvaluation, WebContent }
export { ContentParserPlugin, WebEngine, WebContentParser }
