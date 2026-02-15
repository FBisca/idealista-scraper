type FetchContentOptions<
  T,
  ParserType extends WebContentParser<string, T> = WebContentParser<string, T>,
> = {
  showBrowser?: boolean;
  htmlParser: ParserType;
  plugins?: ContentParserPlugin<string, T>[];
};

type DefaultMetadata = {
  duration: number;
  method: string;
};

type Metadata = DefaultMetadata & Record<string, unknown>;

type FetchSuccess<T> = {
  success: true;
  title: string;
  content: T;
  metadata: Metadata;
};

type FetchError = {
  success: false;
  error: string;
  errorCode: 'unexpected' | 'blocked' | 'unsupported-interaction';
  metadata: Metadata;
};

type FetchResponse<T> = FetchSuccess<T> | FetchError;

type WebContent<T> = {
  url: string;
  data: T;
};

type InteractionAdapter = {
  click(selector: string): Promise<void>;
  isVisible(selector: string): Promise<boolean>;
  waitForSelector(selector: string, timeoutMs?: number): Promise<boolean>;
  evaluate<ResultType>(script: string): Promise<ResultType>;
  getHtml(): Promise<string>;
  getUrl(): Promise<string>;
};

type ParseContext = {
  engine: string;
  requestUrl: string;
  finalUrl?: string;
  metadata?: Record<string, unknown>;
  page?: {
    title?: string;
    html?: string;
    domain?: string;
    captchaSelector?: string;
  };
  request?: {
    headers?: Record<string, string>;
  };
  response?: {
    statusCode?: number;
    headers?: Record<string, unknown>;
  };
  runtime?: {
    showBrowser?: boolean;
    retry?: number;
    sessionId?: string;
  };
};

type InteractiveParseContext = ParseContext & {
  interaction: InteractionAdapter;
};

type PluginEvaluation<InputType> = {
  content: WebContent<InputType>;
  context: ParseContext;
};

abstract class WebEngine {
  abstract fetchContent<
    T,
    ParserType extends WebContentParser<string, T> = WebContentParser<
      string,
      T
    >,
  >(
    url: string,
    options: FetchContentOptions<T, ParserType>,
  ): Promise<FetchResponse<T>>;
  abstract cleanup(): Promise<void>;
}

abstract class WebContentParser<InputType, OutputType> {
  abstract extract(
    content: WebContent<InputType>,
    context: ParseContext,
  ): Promise<OutputType>;
}

abstract class InteractiveWebContentParser<
  InputType,
  OutputType,
> extends WebContentParser<InputType, OutputType> {
  abstract override extract(
    content: WebContent<InputType>,
    context: InteractiveParseContext,
  ): Promise<OutputType>;
}

abstract class ContentParserPlugin<
  InputType,
  OutputType,
> extends WebContentParser<InputType, OutputType> {
  abstract readonly name: string;
  abstract applies(
    input: PluginEvaluation<InputType>,
  ): boolean | Promise<boolean>;
}

abstract class InteractiveContentParserPlugin<
  InputType,
  OutputType,
> extends InteractiveWebContentParser<InputType, OutputType> {
  abstract readonly name: string;
  abstract applies(
    input: PluginEvaluation<InputType>,
  ): boolean | Promise<boolean>;
}

export type {
  FetchContentOptions,
  FetchResponse,
  ParseContext,
  InteractiveParseContext,
  PluginEvaluation,
  WebContent,
  InteractionAdapter,
};

export {
  ContentParserPlugin,
  InteractiveContentParserPlugin,
  WebEngine,
  WebContentParser,
  InteractiveWebContentParser,
};
