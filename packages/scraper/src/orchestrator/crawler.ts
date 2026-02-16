import { log } from '@workspace/logger';
import { RateLimiter } from '../anti-blocking/rate-limiter.js';
import { RetryStrategy } from '../anti-blocking/retry-strategy.js';
import { CrawlMetrics } from '../observability/metrics.js';
import { ErrorSnapshotWriter } from '../observability/error-snapshot.js';
import { ProgressWriter } from '../pipeline/progress-writer.js';
import { CrawlState } from '../pipeline/crawl-state.js';
import { RequestQueue } from '../queue/request-queue.js';
import { SessionPool } from '../session/session-pool.js';
import { EnginePool } from '../web-engine/engine-pool.js';
import type { FetchResponse } from '../web-engine/types.js';
import type { CrawlContext, OrchestratorConfig } from './types.js';
import { Router } from './router.js';

type SeedUrl = {
  url: string;
  label?: string;
  userData?: Record<string, unknown>;
};

export class CrawlOrchestrator {
  private readonly config: OrchestratorConfig;
  private readonly router: Router;
  private shutdownRequested: boolean;

  constructor(config: OrchestratorConfig, router: Router) {
    this.config = config;
    this.router = router;
    this.shutdownRequested = false;
  }

  async run(seedUrls: SeedUrl[]): Promise<void> {
    const queue = new RequestQueue({
      persistPath: this.config.queuePath,
      resume: this.config.resume,
    });

    const progressWriter = new ProgressWriter(this.config.outputPath);
    progressWriter.initialize();

    const crawlState = new CrawlState(
      this.config.statePath,
      this.config.sourceUrl,
    );

    if (this.config.resume) {
      crawlState.load();
    }

    const rateLimiter = new RateLimiter({
      maxRequestsPerMinute: this.config.maxRequestsPerMinute,
    });
    const metrics = new CrawlMetrics();
    const retryStrategy = new RetryStrategy({
      maxRetries: this.config.maxRetries,
    });
    const sessionPool = new SessionPool();
    const enginePool = new EnginePool(this.config.engineFactory, {
      maxSize: this.config.maxConcurrency,
    });
    const errorSnapshotWriter = new ErrorSnapshotWriter({
      directory: this.config.errorSnapshotDir,
    });
    errorSnapshotWriter.initialize();

    const completedIds = progressWriter.readCompletedIds();
    for (const seed of seedUrls) {
      if (!completedIds.has(seed.url)) {
        queue.enqueue(seed.url, seed.label, seed.userData);
      }
    }

    const onShutdown = () => {
      this.shutdownRequested = true;
    };
    process.on('SIGINT', onShutdown);
    process.on('SIGTERM', onShutdown);

    const metricsInterval = setInterval(() => {
      metrics.log(log);
    }, 30_000);

    try {
      const workerCount = Math.min(
        this.config.maxConcurrency,
        Math.max(seedUrls.length, 1),
      );

      const workerFn = () =>
        this.runWorker(
          queue,
          enginePool,
          sessionPool,
          rateLimiter,
          retryStrategy,
          metrics,
          progressWriter,
          crawlState,
          errorSnapshotWriter,
        );

      await Promise.all(Array.from({ length: workerCount }, () => workerFn()));
    } finally {
      clearInterval(metricsInterval);
      process.removeListener('SIGINT', onShutdown);
      process.removeListener('SIGTERM', onShutdown);

      crawlState.save();
      progressWriter.finalize();
      await enginePool.cleanup();
      sessionPool.cleanup();

      metrics.log(log);
    }
  }

  private async runWorker(
    queue: RequestQueue,
    enginePool: EnginePool,
    sessionPool: SessionPool,
    rateLimiter: RateLimiter,
    retryStrategy: RetryStrategy,
    metrics: CrawlMetrics,
    progressWriter: ProgressWriter<unknown>,
    crawlState: CrawlState,
    errorSnapshotWriter: ErrorSnapshotWriter,
  ): Promise<void> {
    while (!this.shutdownRequested) {
      const entry = queue.dequeue();
      if (!entry) {
        break;
      }

      await rateLimiter.acquire();
      const engine = await enginePool.acquire();
      const session = sessionPool.acquire();

      let lastFetchResponse: FetchResponse<unknown> | undefined;

      try {
        const handler = this.router.route({
          url: entry.url,
          label: entry.label,
          uniqueKey: entry.uniqueKey,
          retryCount: entry.retryCount,
          userData: entry.userData,
        });

        const context: CrawlContext = {
          request: {
            url: entry.url,
            label: entry.label,
            uniqueKey: entry.uniqueKey,
            retryCount: entry.retryCount,
            userData: entry.userData,
          },
          fetchPage: async (options) => {
            const startTime = performance.now();
            const response = await engine.fetch(entry.url, options);
            const duration = performance.now() - startTime;

            metrics.recordDuration(duration);
            metrics.increment('requests.total');
            lastFetchResponse = response;

            if (response.success) {
              metrics.increment('requests.success');
            } else {
              metrics.increment('requests.failed');
            }

            return response;
          },
          pushData: (id, data) => {
            progressWriter.append(id, data);
            crawlState.markCompleted(id);
            metrics.increment('items.saved');
          },
          enqueue: (url, label?, userData?) => {
            const added = queue.enqueue(url, label, userData);
            if (added) {
              crawlState.addDiscoveredIds([url]);
            }
            return added;
          },
          log,
        };

        await handler(context);

        queue.markHandled(entry.uniqueKey);
        session?.markGood();
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);

        const errorClass = retryStrategy.classify({
          response: lastFetchResponse,
          errorMessage,
        });

        const decision = retryStrategy.decide(errorClass, entry.retryCount);

        if (decision.rotateSession && session) {
          session.retire();
        } else if (session) {
          session.markBad();
        }

        if (decision.shouldRetry) {
          if (decision.delayMs > 0) {
            await new Promise((resolve) =>
              setTimeout(resolve, decision.delayMs),
            );
          }
          queue.requeue(entry.uniqueKey);
          log.warn(
            'Request will be retried',
            JSON.stringify({
              url: entry.url,
              retryCount: entry.retryCount + 1,
              errorClass,
              delayMs: decision.delayMs,
            }),
          );
        } else {
          queue.markFailed(entry.uniqueKey, errorMessage);
          crawlState.markFailed(entry.uniqueKey);

          errorSnapshotWriter.write(entry.uniqueKey, {
            url: entry.url,
            errorMessage,
            errorClass,
            timestamp: Date.now(),
          });

          log.error(
            'Request failed permanently',
            JSON.stringify({
              url: entry.url,
              retryCount: entry.retryCount,
              errorClass,
              error: errorMessage,
            }),
          );
        }
      } finally {
        enginePool.release(engine);
        if (session) {
          sessionPool.release(session);
        }
      }

      metrics.gauge('queue.pending', queue.size('pending'));
      metrics.gauge('queue.inProgress', queue.size('in-progress'));
    }
  }
}

export type { SeedUrl };
