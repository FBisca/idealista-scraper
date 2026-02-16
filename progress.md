# Crawler Platform — Implementation Progress

> Task tracker for the architecture plan defined in [`plan.md`](plan.md).
> Updated as tasks are completed. Each task maps to a milestone and module from the plan.

---

## Status Legend

- [ ] Not started
- [~] In progress
- [x] Completed

---

## Milestone 1 — Foundation Infrastructure

> **Goal:** Eliminate data loss on crash and add request-rate governance.
> **Risk:** Low — additive modules, no existing code modified.
> **Patterns:** P7 Streaming Pipeline, P3 Rate Limiting, P10 Observability.

### 1.1 Pipeline Types

- [ ] Create `pipeline/types.ts` with `CrawlStateSnapshot` and `ProgressEntry<T>` type definitions. These types define the shape of persistent crawl state (discovered/completed/failed IDs, page counters, timestamps) and the per-item JSONL entry format (id + timestamp + data payload) used by the progress writer.

### 1.2 Progress Writer

- [ ] Create `pipeline/progress-writer.ts` implementing `ProgressWriter<T>`. This is the JSONL append-only data persistence layer that replaces the in-memory `detailsByIndex` array. Each extracted item is written to a `.tmp` file immediately after extraction (one JSON object per line). On crawl completion the tmp file is renamed to the final output path. On crash, the tmp file preserves all previously written items. Supports `initialize()` (create or resume from existing tmp), `append(id, data)` (atomic line write), `finalize()` (rename tmp → output), `readCompletedIds()` (extract already-done IDs for resume), and `readAll()` (parse all entries). Memory stays O(1) per item regardless of crawl size.

### 1.3 Progress Writer Tests

- [ ] Create `pipeline/progress-writer.test.ts` with unit tests covering: append and read round-trip, crash recovery (read from existing tmp file), completed ID extraction for resume, finalize renames tmp to output, empty file handling, and line count tracking.

### 1.4 Anti-Blocking Types

- [ ] Create `anti-blocking/types.ts` with `ErrorClass` (discriminated union: `'hard-block' | 'soft-block' | 'network' | 'parse' | 'system'`), `RetryDecision` (whether to retry, delay, session rotation flag, error class), and `RateLimiterConfig` (max requests per minute). These types are shared between the rate limiter and retry strategy modules.

### 1.5 Rate Limiter

- [ ] Create `anti-blocking/rate-limiter.ts` implementing a token-bucket rate limiter. Replaces `waitHumanDelay()` with predictable, configurable request-rate governance. Distributes tokens evenly per second (e.g., 30 req/min = 0.5 req/s) to prevent burst patterns that trigger anti-bot detection. Exposes `acquire()` which resolves when a token is available (blocking the caller until the rate allows), `tryAcquire()` for non-blocking check, and `reset()`. Internally tracks token balance and refill rate using high-resolution timestamps. Configurable via `maxRequestsPerMinute`.

### 1.6 Rate Limiter Tests

- [ ] Create `anti-blocking/rate-limiter.test.ts` with unit tests covering: token acquisition at configured rate, burst prevention (multiple rapid calls are spaced), tryAcquire returns false when no tokens available, reset restores full capacity, and per-second distribution accuracy.

### 1.7 Error Snapshot Writer

- [ ] Create `observability/error-snapshot.ts` implementing `ErrorSnapshotWriter`. When a request fails after all retries, this module saves the full failure context to disk for post-mortem debugging: URL, HTTP status, response headers, page HTML at failure time, CAPTCHA selector if detected, error message, and error class. Files are written to a configurable directory (default `tmp/errors/`) as `{id}-{timestamp}.json` with an optional companion `.html` file. A configurable cap (default 100) prevents disk exhaustion during catastrophic failure cascades. This eliminates the need to re-run crawls to debug intermittent blocks.

### 1.8 Error Snapshot Tests

- [ ] Create `observability/error-snapshot.test.ts` with unit tests covering: snapshot write creates JSON file with expected fields, HTML companion file written when HTML provided, cap enforcement (101st snapshot is not written), directory auto-creation, and graceful handling of write errors.

### 1.9 Observability Metrics

- [ ] Create `observability/metrics.ts` implementing `CrawlMetrics`. Tracks counters (requests total, success, failed, blocked), gauges (active workers, queue depth, memory usage MB), and timing (request durations for min/max/avg). Exposes `increment(counter)`, `gauge(name, value)`, `recordDuration(ms)`, `snapshot()` (returns current metric state as plain object), and `log(logger)` (emits structured metric line). The orchestrator calls `snapshot()` periodically (default 30s) during crawl execution to provide visibility into long-running operations.

### 1.10 Observability Metrics Tests

- [ ] Create `observability/metrics.test.ts` with unit tests covering: counter increment, gauge set/get, duration recording (min/max/avg), snapshot returns all metrics, and reset clears state.

---

## Milestone 2 — Queue + Crawl State

> **Goal:** Persistent URL frontier with deduplication and resume capability.
> **Risk:** Medium — new abstractions, no existing code changed.
> **Patterns:** P2 Queue-Driven URL Frontier.
> **Depends on:** Milestone 1.

### 2.1 Queue Types

- [ ] Create `queue/types.ts` with `RequestState` enum (`'pending' | 'in-progress' | 'handled' | 'failed'`), `QueueEntry` (URL + uniqueKey + label + state + retryCount + userData + error history), and `QueueOptions` (persistence path, auto-resume flag). These types define the three-partition state model where every URL is tracked through its full lifecycle.

### 2.2 Request Queue

- [ ] Create `queue/request-queue.ts` implementing `RequestQueue`. This is the persistent, deduplicating URL frontier that replaces the in-memory `listedIds` array and `nextIndex` counter. URLs are deduplicated via `uniqueKey` (derived from URL by default, customizable). Queue state is persisted to JSONL on disk. On startup with resume enabled, loads existing state and moves any `in-progress` entries back to `pending` (crash recovery). Exposes `enqueue(url, label?, userData?)` (dedup + persist), `dequeue()` (returns next pending entry, marks in-progress), `markHandled(key)`, `markFailed(key, error)`, `size()` (by state), and `isEmpty()`. Supports batch enqueue for large seed sets.

### 2.3 Request Queue Tests

- [ ] Create `queue/request-queue.test.ts` with unit tests covering: enqueue and dequeue ordering (FIFO), deduplication rejects same uniqueKey, state transitions (pending → in-progress → handled), persist and reload preserves state, crash recovery moves in-progress back to pending, markFailed records error, batch enqueue, and size/isEmpty reporting by state partition.

### 2.4 Crawl State

- [ ] Create `pipeline/crawl-state.ts` implementing `CrawlState`. Higher-level state tracker that coordinates queue and progress writer for resume capability. Persists a JSON checkpoint with: source URL, all discovered IDs, completed IDs, failed IDs, last list page number, and timestamps. On startup, `load()` reads existing state file and returns whether resume is available. Provides `addDiscoveredIds()`, `markCompleted()`, `markFailed()`, `setLastListPage()`, and computed `pendingIds` (discovered minus completed minus failed). State file is saved after each list page and periodically during detail phase. `cleanup()` removes state file after successful crawl completion.

### 2.5 Crawl State Tests

- [ ] Create `pipeline/crawl-state.test.ts` with unit tests covering: save and load round-trip, pendingIds computation (discovered minus completed minus failed), addDiscoveredIds deduplicates, load returns false for mismatched source URL, cleanup removes state file, and setLastListPage persists correctly.

---

## Milestone 3 — Session Pool + Retry Strategy

> **Goal:** Identity management with health tracking and classified retry with session rotation.
> **Risk:** Medium — extends `UlixeeProfileManager` without replacing it.
> **Patterns:** P4 Session Pool, P9 Classified Errors, P5 Anti-Detection L1.
> **Depends on:** Milestone 1.

### 3.1 Session Types

- [ ] Create `session/types.ts` with `SessionState` enum (`'healthy' | 'degraded' | 'blocked'`), `SessionConfig` (max pool size, max usage count, max age, cooldown duration), and `SessionInfo` (session ID, proxy URL, state, usage count, consecutive errors, creation time, last used time). These types model the three-state health lifecycle where sessions transition from healthy to degraded (temporary penalty) to blocked (permanent retirement).

### 3.2 Session Entity

- [ ] Create `session/session.ts` implementing `Session`. Represents a single crawling identity that bundles proxy URL (optional), cookies (via `UlixeeProfileManager` integration), health state, and usage statistics. Exposes `markGood()` (reset consecutive errors), `markBad()` (increment errors, transition to degraded after threshold), `retire()` (transition to blocked, non-recoverable), `isUsable()` (not blocked and not in cooldown), and `info` (readonly snapshot). Tracks: total usage count, consecutive error count, creation time, last used time. Automatic retirement when `maxUsageCount` or `maxAge` exceeded.

### 3.3 Session Pool

- [ ] Create `session/session-pool.ts` implementing `SessionPool`. Manages a pool of N `Session` instances with random selection (not round-robin, to prevent timing-based detection). `acquire()` returns a random usable session. When a session is retired, pool automatically creates a replacement to maintain target pool size. Integrates with `UlixeeProfileManager` as the cookie/profile backend for each session. Exposes `acquire()`, `release(session)`, `getStats()` (active/degraded/blocked counts), and `cleanup()`. Configurable: max pool size (default 1 for single-identity crawls, scales up for proxy rotation), cooldown duration for degraded sessions.

### 3.4 Session Pool Tests

- [ ] Create `session/session-pool.test.ts` with unit tests covering: acquire returns a session, markBad transitions session state, retire removes and replaces session, pool maintains target size after retirement, random selection distributes across sessions, degraded session skipped during cooldown, getStats reports correct counts, and cleanup releases all sessions.

### 3.5 Retry Strategy

- [ ] Create `anti-blocking/retry-strategy.ts` implementing `RetryStrategy`. Classifies errors from `FetchResponse` and `CaptchaDectector` output into `ErrorClass` categories and determines retry behavior. Classification rules: CAPTCHA detected or HTTP 403 → `hard-block` (retire session, acquire new session, retry with 2-4s delay); HTTP 429 → `soft-block` (keep session, exponential backoff 1s→2s→4s); timeout or connection error → `network` (keep session, retry immediately); parse/extraction error → `parse` (no retry, this is a bug); other → `system` (no retry). Exposes `classify(response, captchaResult?) → ErrorClass` and `decide(errorClass, retryCount, maxRetries) → RetryDecision`. Max retries configurable (default 3).

### 3.6 Retry Strategy Tests

- [ ] Create `anti-blocking/retry-strategy.test.ts` with unit tests covering: CAPTCHA response classified as hard-block, 403 classified as hard-block, 429 classified as soft-block, timeout classified as network, parse error classified as parse (no retry), exponential backoff delay calculation, retry decision respects maxRetries, hard-block decision includes rotateSession=true, and soft-block decision includes rotateSession=false.

---

## Milestone 4 — Engine Adapter + Engine Pool

> **Goal:** Unified engine interface and instance reuse across requests.
> **Risk:** Medium — wraps existing engines without modifying them.
> **Patterns:** P8 Hybrid Crawler Selection, P3 Resource Pool.
> **Depends on:** Milestone 3.

### 4.1 Engine Adapter Interface

- [ ] Create `web-engine/engine-adapter.ts` defining the `EngineAdapter` abstract class. This is the unified interface that all engines implement, allowing the orchestrator to select engines per request without knowing internals. Interface: `fetch<T>(url, options) → Promise<FetchResponse<T>>`, `cleanup() → Promise<void>`, readonly `engineType: 'ulixee' | 'crawlee'`. Includes concrete `UlixeeEngineAdapter` wrapping existing `UlixeeWebEngine.fetchContent` and preserving all existing behavior (CAPTCHA detection, profile management, interactive parsing). The adapter delegates, it does not modify engine behavior.

### 4.2 Engine Pool

- [ ] Create `web-engine/engine-pool.ts` implementing `EnginePool`. Manages a pool of pre-created `EngineAdapter` instances for reuse across requests. `acquire() → Promise<EngineAdapter>` returns an available instance (or creates one if pool not full). `release(adapter)` returns it to the pool. `cleanup()` closes all instances. Max pool size configurable (default matches worker count). For Ulixee, this eliminates the 1-3s Hero instance startup per detail request — instead, Hero instances are created once and reused. Pool tracks active vs idle instances and prevents exceeding max size.

### 4.3 Crawlee Engine Adapter

- [ ] Create `web-engine/crawlee-engine.ts` implementing `CrawleeEngineAdapter`. Wraps Crawlee's HTTP client (CheerioCrawler or direct `sendRequest`) as an `EngineAdapter`. HTTP-only engine with optional `ImpitHttpClient` for TLS fingerprinting. Uses Cheerio for HTML parsing (same as existing parsers expect). Crawlee dependency is optional — lazy-imported so the repository works without it installed. This adapter enables the hybrid crawling pattern: use Crawlee for fast HTTP requests on list pages, Ulixee for browser-based detail pages.

### 4.4 Engine Adapter Tests

- [ ] Create `web-engine/engine-adapter.test.ts` with unit tests covering: UlixeeEngineAdapter delegates to UlixeeWebEngine (mock), adapter returns FetchResponse shape, cleanup delegates to underlying engine, engineType returns correct value, and pool acquire/release lifecycle.

### 4.5 Engine Pool Tests

- [ ] Create `web-engine/engine-pool.test.ts` with unit tests covering: acquire returns adapter when pool has idle instance, acquire creates new instance when pool not full, acquire waits when pool full and all active, release returns instance to idle, cleanup closes all instances, and max pool size enforcement.

---

## Milestone 5 — Orchestrator + Router

> **Goal:** Central crawl lifecycle manager coordinating all layers.
> **Risk:** High — integration milestone wiring all layers together.
> **Patterns:** P1 Request Lifecycle, P6 Router Dispatch, P3 Concurrency.
> **Depends on:** All previous milestones.

### 5.1 Orchestrator Types

- [ ] Create `orchestrator/types.ts` with `CrawlRequest` (URL + label + uniqueKey + retryCount + userData + error history), `CrawlContext` (injected into handlers: request, session, pushData, enqueue, metrics, log, plus engine-specific parse context), `HandlerFn` (async function receiving CrawlContext), and `OrchestratorConfig` (minConcurrency, maxConcurrency, maxRequestsPerMinute, maxRetries, outputPath, statePath, engineType, resume flag). The `CrawlContext` is the central abstraction enabling testable handlers — it provides all side-effect capabilities (data persistence, URL discovery, metrics) as injected functions rather than global state.

### 5.2 Router

- [ ] Create `orchestrator/router.ts` implementing `Router`. Label-based handler dispatcher. `addHandler(label, handler)` registers a handler for a specific request label. `addDefaultHandler(handler)` registers the fallback for unlabeled requests. `route(request) → HandlerFn` returns the matching handler. Throws descriptive error if no handler matches and no default is set. Handlers are isolated, testable functions with single responsibility. This replaces the implicit routing done by action file call-site selection, enabling dynamic dispatch for crawls that discover different page types at runtime.

### 5.3 Crawl Orchestrator

- [ ] Create `orchestrator/crawler.ts` implementing `CrawlOrchestrator`. The central lifecycle manager that coordinates all layers. Construction takes `OrchestratorConfig` + `Router`. `run(seedUrls)` executes the full lifecycle: (1) Initialize request queue, engine pool, session pool, rate limiter, metrics, progress writer, and crawl state. (2) Seed initial URLs into queue. (3) Main loop: dequeue request → acquire engine from pool → acquire session → wait for rate limiter → execute fetch → route response to handler → on success: persist data via progress writer, mark queue entry handled, update metrics → on failure: classify error via retry strategy, rotate session if needed, re-enqueue or mark failed. (4) Concurrency governance: runs N concurrent workers (configurable min/max). (5) Graceful shutdown on SIGINT/SIGTERM: finish in-progress requests, persist queue + crawl state, close engine pool. Emits metric snapshots periodically. Supports resume by loading existing queue and crawl state.

### 5.4 Router Tests

- [ ] Create `orchestrator/router.test.ts` with unit tests covering: addHandler registers by label, route returns correct handler for label, default handler used for unlabeled request, error thrown when no handler matches and no default, multiple handlers for different labels dispatch correctly, and handler receives CrawlContext.

### 5.5 Orchestrator Tests

- [ ] Create `orchestrator/crawler.test.ts` with unit tests covering: lifecycle (seed → process → done) with mock engine, concurrency bounds respected (min/max workers), graceful shutdown persists state, retry with session rotation on hard-block, rate limiter integrated (requests paced), progress writer receives extracted data, queue entries transition through states, and resume from existing state skips completed work.

---

## Milestone 6 — Action Refactoring + Integration

> **Goal:** Wire orchestrator into `crawl.ts`. Thin action layer.
> **Risk:** Medium — modifies existing public API, must preserve backward compatibility.
> **Patterns:** Integration of all patterns.
> **Depends on:** Milestone 5.

### 6.1 Refactor crawl.ts

- [ ] Refactor `actions/crawl.ts` to use `CrawlOrchestrator`. The 260+ line monolith becomes a thin configuration function: (1) Parse and validate CLI options (preserved, same schema). (2) Create orchestrator with config derived from CLI options. (3) Register LIST handler — receives list page response, extracts listing IDs via `IdealistaListParserPlugin`, enqueues each ID as DETAIL request, follows pagination by enqueuing next page as LIST. (4) Register DETAIL handler — receives detail page response, extracts data via `IdealistaDetailParserPlugin`, calls `pushData()` to persist via progress writer. (5) Seed with initial URL + LIST label. (6) `await orchestrator.run()`. (7) On completion, convert JSONL progress to JSON array for backward-compatible output. All orchestration logic (workers, retries, rate limiting, state persistence) is delegated to the orchestrator.

### 6.2 Add --resume and --fresh CLI Flags

- [ ] Add `--resume` flag to crawl CLI (opt into resuming from existing crawl state). Add `--fresh` flag (force restart, delete existing state/progress). Default behavior: if state file exists, prompt or default to resume. Update `crawlArgsSchema` with new options. Wire flags to `OrchestratorConfig.resume`.

### 6.3 Delete AxiosWebEngine

- [ ] Remove `web-engine/axios-engine.ts` since Crawlee's CheerioCrawler replaces it with better TLS fingerprinting via Impit. Update any imports that reference AxiosWebEngine. The Crawlee engine adapter provides the same HTTP-only capability with browser-grade TLS fingerprints.

### 6.4 End-to-End Validation

- [ ] Run full validation suite: `pnpm lint && pnpm typecheck && pnpm test`. Manual end-to-end test with Ulixee engine to verify: list crawling discovers IDs, detail crawling extracts data, progress persists to JSONL, metrics emitted during crawl, resume after interruption skips completed work, and final output matches expected JSON format. Verify existing `list` and `detail` standalone actions still work unchanged.

---

## Final Checklist

- [ ] All milestones complete
- [ ] `pnpm lint` passes
- [ ] `pnpm typecheck` passes
- [ ] `pnpm test` passes
- [ ] No existing stable APIs broken (`ContentParserPlugin`, `InteractionAdapter`, `FetchResponse<T>`)
- [ ] Every module has research pattern justification in code comments
- [ ] `plan.md` and `progress.md` reflect final state
