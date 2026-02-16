import type {
  ContentParserPlugin,
  FetchResponse,
  InteractiveWebContentParser,
  WebContentParser,
} from '../web-engine/types.js';
import type { EngineFactory } from '../web-engine/engine-pool.js';

type CrawlRequest = {
  url: string;
  label?: string;
  uniqueKey: string;
  retryCount: number;
  userData?: Record<string, unknown>;
};

type FetchPageOptions<T> = {
  htmlParser:
    | WebContentParser<string, T>
    | InteractiveWebContentParser<string, T>;
  plugins?: ContentParserPlugin<string, T>[];
  showBrowser?: boolean;
};

type CrawlLog = {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};

type CrawlContext = {
  request: CrawlRequest;
  fetchPage: <T>(options: FetchPageOptions<T>) => Promise<FetchResponse<T>>;
  pushData: (id: string, data: unknown) => void;
  enqueue: (
    url: string,
    label?: string,
    userData?: Record<string, unknown>,
  ) => boolean;
  log: CrawlLog;
};

type HandlerFn = (context: CrawlContext) => Promise<void>;

type OrchestratorConfig = {
  maxConcurrency: number;
  maxRequestsPerMinute: number;
  maxRetries: number;
  outputPath: string;
  statePath: string;
  queuePath: string;
  errorSnapshotDir: string;
  sourceUrl: string;
  resume: boolean;
  engineFactory: EngineFactory;
};

export type {
  CrawlRequest,
  CrawlContext,
  CrawlLog,
  FetchPageOptions,
  HandlerFn,
  OrchestratorConfig,
};
