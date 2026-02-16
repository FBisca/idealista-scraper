# Crawlee — Core Architecture

## Request Lifecycle Model

Every URL processed by Crawlee follows a deterministic lifecycle managed by the framework. Understanding this lifecycle reveals the framework's reliability guarantees.

```
                          ┌─────────────┐
                          │  Seed URLs  │
                          └──────┬──────┘
                                 │
                                 ▼
                      ┌──────────────────┐
                      │  RequestQueue    │
                      │  (persistent,    │
                      │   deduplicating) │
                      └────────┬─────────┘
                               │ dequeue
                               ▼
                    ┌────────────────────┐
                    │  AutoscaledPool    │
                    │  (concurrency      │
                    │   governor)        │
                    └────────┬───────────┘
                             │ task slot available
                             ▼
               ┌──────────────────────────┐
               │  Pre-navigation hooks    │
               │  (session bind, proxy    │
               │   selection, headers)    │
               └────────────┬─────────────┘
                            │
                            ▼
               ┌──────────────────────────┐
               │  HTTP request / Browser  │
               │  navigation              │
               └────────────┬─────────────┘
                            │
                            ▼
               ┌──────────────────────────┐
               │  Post-navigation hooks   │
               │  (Cloudflare handling,   │
               │   content validation)    │
               └────────────┬─────────────┘
                            │
                            ▼
               ┌──────────────────────────┐
               │  requestHandler()        │
               │  - extract data          │
               │  - enqueueLinks()        │
               │  - pushData()            │
               └────────────┬─────────────┘
                            │
                  ┌─────────┴──────────┐
                  │                    │
              success              failure
                  │                    │
                  ▼                    ▼
          ┌──────────────┐   ┌───────────────────┐
          │ Mark handled │   │ Retry logic       │
          │ Session OK   │   │ - mark session    │
          └──────────────┘   │ - requeue         │
                             │ - exponential     │
                             │   backoff         │
                             └───────────────────┘
```

### Key Design Decisions in the Lifecycle

1. **Request deduplication is queue-level** — the `RequestQueue` rejects duplicate URLs before any processing. This moves dedup from user code to infrastructure.

2. **Session binding happens pre-navigation** — each request is bound to a `Session` (proxy + cookies + fingerprint) before execution. This ensures identity consistency per request, not per page load.

3. **Hooks are positional, not event-based** — `preNavigationHooks` and `postNavigationHooks` run in sequence, not as event emitters. This guarantees ordering (e.g., Cloudflare challenge resolution must happen post-navigation but before handler).

4. **Failure is always retriable** — unless `maxRetries` is exhausted, failed requests go back into the queue. The retry count travels with the `Request` object, persisted across restarts.

## Queue Architecture

### RequestQueue — The URL Frontier

The `RequestQueue` is Crawlee's most architecturally significant abstraction. It is:

- **Persistent** — serialized to disk (or cloud storage). A crawler can crash and resume from exactly where it stopped.
- **Deduplicating** — uses `uniqueKey` (derived from URL by default) to reject re-enqueued URLs.
- **Dynamic** — URLs can be added during crawling via `enqueueLinks()` or `addRequests()`.
- **Lockable** — `RequestQueueV2` supports distributed locking for parallel consumption by multiple processes.

#### Batching Optimization

When seeding many URLs (e.g., 100K start URLs), `crawler.run(urls)` batches them in groups of 1,000 and adds them asynchronously. Processing begins after the first batch resolves, while remaining batches are added in the background (one batch per second). This prevents memory spikes and startup latency.

#### Locking for Parallelism

`RequestQueueV2` extends the queue with distributed locking semantics:

- A process **locks** a request before processing.
- If the process crashes before marking completion, the lock expires and the request becomes available to other consumers.
- This enables multiple `crawler.run()` instances to share a single queue without double-processing.

### Data Flow: Request vs RequestQueue Separation

```
Request {
  url: string
  uniqueKey: string         // dedup key (auto-derived from URL)
  label: string             // routing discriminant
  userData: Record           // arbitrary payload
  retryCount: number        // managed by framework
  loadedUrl: string         // post-redirect actual URL
}
```

The `Request` carries both addressing (URL) and metadata (label, userData). This design choice means routing decisions (which handler to invoke) travel with the URL, not with the crawler configuration. This enables clean multi-page-type crawlers without complex URL-matching logic.

## Router / Handler Pattern

Crawlee provides two handler models:

### 1. Single-handler with label dispatch

```typescript
requestHandler: async ({ request, page }) => {
  if (request.label === 'DETAIL') {
    /* ... */
  } else if (request.label === 'CATEGORY') {
    /* ... */
  } else {
    /* default / start page */
  }
};
```

### 2. Router-based dispatch (recommended)

```typescript
const router = createPlaywrightRouter();

router.addDefaultHandler(async ({ enqueueLinks }) => {
  await enqueueLinks({ selector: '.category', label: 'CATEGORY' });
});

router.addHandler('CATEGORY', async ({ enqueueLinks }) => {
  await enqueueLinks({ selector: '.product', label: 'DETAIL' });
});

router.addHandler('DETAIL', async ({ page, pushData }) => {
  const title = await page.locator('h1').textContent();
  await pushData({ title });
});
```

**Why the router exists**: The label-based if/else pattern works but violates single-responsibility. The router pattern maps labels to handlers declaratively, making each handler independently testable and composable.

**Architectural implication**: The router is a **discriminated dispatcher** where `request.label` is the discriminant. This pattern generalizes to any crawler that processes multiple page types (list pages, detail pages, search pages, API endpoints).

## Context Abstraction

The `CrawlingContext` is the core abstraction that enables crawler-type polymorphism. Every `requestHandler` receives a context object whose shape varies by crawler type:

| Property            | BasicCrawler | CheerioCrawler | PlaywrightCrawler |
| ------------------- | ------------ | -------------- | ----------------- |
| `request`           | ✓            | ✓              | ✓                 |
| `session`           | ✓            | ✓              | ✓                 |
| `log`               | ✓            | ✓              | ✓                 |
| `enqueueLinks`      | ✓            | ✓              | ✓                 |
| `pushData`          | ✓            | ✓              | ✓                 |
| `sendRequest`       | ✓            | ✓              | ✓                 |
| `$` (Cheerio)       | —            | ✓              | —                 |
| `page` (Playwright) | —            | —              | ✓                 |
| `body` (raw)        | —            | ✓              | —                 |

**Design intent**: The context is a **capability injection pattern**. Each crawler type injects the capabilities it provides. User code depends on the context interface, not on the underlying engine. This is why switching from `CheerioCrawler` to `PlaywrightCrawler` only requires changing the constructor and updating context destructuring — the `enqueueLinks`, `pushData`, and routing logic remain identical.

**Hidden design value**: `enqueueLinks()` adapts its implementation per crawler type. In `CheerioCrawler`, it parses the already-loaded HTML. In `PlaywrightCrawler`, it queries the live DOM. Same API, different execution strategy.

## Storage Model

Crawlee provides two storage primitives:

### Dataset — Append-Only Data Store

- `Dataset.pushData(object)` appends a row.
- Default storage: `{PROJECT}/storage/datasets/default/` with numbered JSON files.
- Each `pushData()` call creates one file (one row).
- Named datasets are supported via `Dataset.open('my-dataset')`.
- **No update or delete** — this is append-only by design. The assumption: crawled data is immutable once extracted.

### KeyValueStore — Generic Blob Store

- Key-value pairs for arbitrary data (HTML snapshots, screenshots, state checkpoints).
- Used internally for crawler state persistence.

### Storage Backend Pluggability

The local filesystem backend is the default. When deployed on Apify, a cloud storage adapter replaces it transparently. This is the **repository pattern** applied to crawl data.

## Execution Model — AutoscaledPool

The AutoscaledPool is the concurrency governor. It is not a thread pool — Node.js is single-threaded. It manages the count of **concurrent async tasks** (Promise chains).

### Autoscaling Algorithm

```
Every autoscaleIntervalSecs (default 10s):
  1. Measure system load (CPU %, memory %)
  2. If load < threshold:
     desired_concurrency += current * scaleUpStepRatio
  3. If load > threshold:
     desired_concurrency -= current * scaleDownStepRatio
  4. Clamp to [minConcurrency, maxConcurrency]
```

### Rate Limiting

`maxRequestsPerMinute` is enforced by counting requests per second (not per minute), spreading them evenly. This prevents burst patterns that would trigger anti-bot systems.

```
Effective rate = min(maxConcurrency throughput, maxRequestsPerMinute / 60)
```

### Backpressure

When the queue empties faster than URLs are enqueued (common in link-discovery crawlers), the pool naturally reduces active tasks. When the queue refills, it scales back up. This is implicit backpressure through queue depth, not explicit flow control.

## Implicit Design Philosophy

1. **Convention over configuration** — defaults are production-ready. Most crawlers work with zero configuration beyond URLs and a handler.
2. **State is external** — request state lives in the queue, data lives in datasets. The crawler process is stateless and recoverable.
3. **Failure is normal** — every component assumes failures will happen (network errors, blocks, crashes) and provides recovery paths.
4. **The queue is the source of truth** — what's been crawled and what remains is determined entirely by queue state, not by application logic.
