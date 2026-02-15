type FetchContentOptions<T> = {
  showBrowser?: boolean
  htmlParser: WebContentParser<string, T>
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

abstract class WebEngine {
  abstract fetchContent<T>(url: string, options: FetchContentOptions<T>): Promise<FetchResponse<T>>
  abstract cleanup(): Promise<void>
}

abstract class WebContentParser<InputType, OutputType> {
  abstract extract(content: WebContent<InputType>): Promise<OutputType>
}

export type { FetchContentOptions, FetchResponse, WebContent }
export { WebEngine, WebContentParser }
