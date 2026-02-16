# Repository Improvement Recommendations

> Actionable recommendations for the idealista-scraper repository, informed by Crawlee's architecture patterns and the gap analysis in `08_ulixee_pattern_mapping.md`.

## Priority Framework

Recommendations are prioritized by:

- **Impact**: How much the change improves reliability, scalability, or maintainability.
- **Effort**: Implementation complexity and risk.
- **Dependency**: Whether other improvements depend on this one.

---

## P0 — Critical Reliability Improvements

### 1. Progressive Data Persistence

**Problem**: `crawl.ts` accumulates all detail results in `detailsByIndex` (in-memory array) and writes once at the end. A crash after scraping 49,000 of 50,000 details results in total data loss.

**Recommendation**: Write each detail result to disk immediately after extraction.

```
Current flow:
  fetch detail → store in memory → ... → write all at end

Proposed flow:
  fetch detail → append to JSONL file → ... → (already persisted)
```

**Design approach**:

- Use JSONL (newline-delimited JSON) for append-only writes. Each line is a complete JSON object.
- Write to a temporary file during crawl, rename to final output on completion.
- On resume, read existing JSONL file to determine which IDs are already fetched.

**Effort**: Low. Requires changing ~20 lines in `crawl.ts`. No new dependencies.

**Impact**: Eliminates the most catastrophic failure mode. Crawl results survive process crashes.

### 2. Resumable Crawl State

**Problem**: If a crawl is interrupted, the entire crawl must restart from scratch. There's no way to pick up where it stopped.

**Recommendation**: Persist crawl state (discovered IDs, current page, completed IDs) to a state file.

```
State file: .crawl-state.json
{
  "sourceUrl": "https://...",
  "discoveredIds": ["id1", "id2", ...],
  "completedIds": ["id1", "id2", ...],
  "failedIds": ["id3"],
  "lastListPage": 5,
  "startedAt": "2024-01-01T00:00:00Z"
}
```

**Design approach**:

- Save state after each list page completes and after each detail batch.
- On startup, check for existing state file matching the target URL.
- If found, skip list pages already crawled and detail IDs already fetched.
- Allow `--resume` flag to opt into resume behavior, `--fresh` to force restart.

**Effort**: Medium. Requires state file read/write logic and ID reconciliation.

**Impact**: Large crawls become practical. A 50,000-item crawl that fails at item 40,000 only needs to fetch the remaining 10,000.

---

## P1 — Anti-Blocking and Resilience

### 3. Session Health Tracking

**Problem**: `UlixeeProfileManager` persists cookies but has no concept of session health. If a session gets blocked, the same profile is reused — sending the blocked session's cookies back to the same IP.

**Recommendation**: Add session health states and rotation logic.

```
Proposed Session States:
  HEALTHY  → normal operation
  DEGRADED → slow responses or soft blocks, apply cooldown
  BLOCKED  → hard block (CAPTCHA, 403), retire and create new session
```

**Design approach**:

- Track consecutive errors per domain in `UlixeeProfileManager`.
- After N consecutive errors (e.g., 3), mark the session as degraded.
- After a hard block (CAPTCHA detected), retire the session and create a fresh profile.
- Expose `markBad()` and `retire()` methods on the profile manager.

**Effort**: Medium. Requires adding state tracking to `UlixeeProfileManager` and integrating with `UlixeeWebEngine`'s retry logic.

**Impact**: Reduces cascading failures when a session gets flagged. Currently, a blocked session stays blocked forever.

### 4. Configurable Rate Limiting

**Problem**: Rate limiting is only `waitHumanDelay()` — a random 350-1000ms pause between sequential requests. There's no way to set a target rate, and the rate changes based on how long each request takes.

**Recommendation**: Implement explicit rate limiting with configurable requests-per-minute.

```
Proposed API:
  runCrawlAction(url, {
    maxRequestsPerMinute: 30,  // ← new option
    // replaces waitHumanDelay() with token-bucket rate limiter
  });
```

**Design approach**:

- Implement a token bucket or leaky bucket rate limiter as a utility.
- Distribute tokens evenly across seconds (like Crawlee's per-second enforcement).
- Apply rate limiting at the engine level, not the action level, so all actions benefit.
- Keep `waitHumanDelay()` as optional additional jitter on top of rate limiting.

**Effort**: Low. ~50 lines for a rate limiter utility. Integration requires wrapping `fetchContent` calls.

**Impact**: Prevents accidental aggressive crawling. Makes the crawl rate predictable and tunable.

### 5. Retry Strategy Enhancement

**Problem**: `UlixeeWebEngine` retries up to 2 times in a simple `for` loop. No backoff, no session rotation on retry, no error classification informing retry behavior.

**Recommendation**: Implement classified retry with exponential backoff and session rotation.

```
Proposed Retry Matrix:
  CAPTCHA detected  → retire session, new profile, retry with delay
  HTTP 403          → retire session, new profile, retry with delay
  HTTP 429          → keep session, exponential backoff
  Timeout           → keep session, retry immediately
  Network error     → keep session, retry with short delay
  Parse error       → do NOT retry (bug, not transient)
```

**Design approach**:

- Classify errors in `fetchContent` before deciding retry behavior.
- Use exponential backoff: 1s → 2s → 4s (capped).
- On session-level failures (CAPTCHA, 403), clear the domain profile before retrying.
- Increase `maxRetries` from 2 to 3 (with backoff, total time is still bounded).

**Effort**: Medium. Requires refactoring the retry loop in `ulixee-engine.ts`.

**Impact**: Significantly reduces block rate during recovery. Stops the "retry into the same block" loop.

---

## P2 — Scaling and Performance

### 6. Resource-Aware Concurrency

**Problem**: `crawl.ts` uses fixed worker count. If 4 workers each open a Hero browser instance, memory can spike to 2-4GB. No feedback loop to reduce concurrency when resources are constrained.

**Recommendation**: Monitor system resources and adjust concurrency dynamically.

```
Proposed Algorithm:
  desired_concurrency = current

  if mem_usage > 80%:
    desired_concurrency = max(1, current - 1)
  elif mem_usage < 50% and cpu < 70%:
    desired_concurrency = min(max_workers, current + 1)

  Scale interval: every 10 seconds
```

**Design approach**:

- Use `process.memoryUsage()` and `os.cpus()` for resource monitoring.
- Implement as a `ConcurrencyManager` class that workers consult before starting new work.
- Workers check `canAcquire()` before fetching next item. If denied, wait and retry.

**Effort**: Medium-High. Requires a concurrency manager abstraction and worker coordination.

**Impact**: Prevents OOM crashes with high worker counts. Enables running with higher `--workers` values safely.

### 7. Engine Pool / Connection Reuse

**Problem**: `fetchDetailById` in `crawl.ts` creates a new `UlixeeWebEngine` per detail request. Each engine creates a new Hero instance (browser process). This is wasteful.

```typescript
// Current: new engine per request
async function fetchDetailById(propertyId, headless) {
  const engine = new UlixeeWebEngine();
  try {
    // ...fetch
  } finally {
    await engine.cleanup();
  }
}
```

**Recommendation**: Create an engine pool that reuses Hero instances across requests.

```
Proposed Pattern:
  EnginePool (size = workers count)
    ├── acquire() → returns available engine
    ├── release(engine) → mark as available
    └── cleanup() → close all engines
```

**Design approach**:

- Pool of pre-created `UlixeeWebEngine` instances.
- Workers acquire an engine, use it for one request, then release it.
- Engines are reused across requests within the same worker.
- Pool handles cleanup on shutdown.

**Effort**: Medium. Requires an engine pool class and refactoring `crawl.ts` worker pattern.

**Impact**: Reduces browser startup overhead. Each Hero instance takes 1-3 seconds to initialize. Reusing across 50,000 requests saves hours.

---

## P3 — Observability and Developer Experience

### 8. Structured Crawl Metrics

**Problem**: Crawl progress is opaque. The only output is a final log line with summary statistics. During a long crawl, there's no visibility into progress, error rate, or performance.

**Recommendation**: Emit structured metrics during crawl execution.

```
Proposed Metrics:
  ├── requests_total (counter)
  ├── requests_success (counter)
  ├── requests_failed (counter)
  ├── requests_blocked (counter)
  ├── request_duration_ms (histogram)
  ├── active_workers (gauge)
  ├── queue_depth (gauge)
  ├── memory_usage_mb (gauge)
  └── items_extracted (counter)
```

**Design approach**:

- Create a `CrawlMetrics` class that tracks counters/gauges.
- Log a metrics snapshot every N seconds (configurable, default 30s).
- Include metrics in the final output summary.
- Optionally write metrics to a separate file for analysis.

**Effort**: Low. ~100 lines for a metrics tracker. Integration is additive.

**Impact**: Dramatically improves debuggability. Engineers can identify problems during crawls instead of post-mortem.

### 9. Error Snapshot Storage

**Problem**: When a detail fetch fails, the error is logged with `log.warn` but the page content (HTML, URL, response headers) is discarded. Post-mortem debugging requires re-running the crawl.

**Recommendation**: Save failed request context to disk for post-mortem analysis.

```
Proposed Structure:
  tmp/errors/
    ├── {propertyId}-{timestamp}.json    ← error metadata
    └── {propertyId}-{timestamp}.html    ← page HTML at failure time
```

**Design approach**:

- When a request fails after all retries, save the HTML content and error context.
- Include: URL, response status, response headers, CAPTCHA selector (if detected), error type.
- Cap error snapshots at N (e.g., 100) to prevent disk filling on catastrophic failures.
- Use this data to improve CAPTCHA detection patterns and parser robustness.

**Effort**: Low. ~30 lines to save error context. HTML is already available in `ParseContext`.

**Impact**: Enables root-cause analysis without re-running crawls. Particularly valuable for intermittent blocks.

### 10. Separate Concerns in crawl.ts

**Problem**: `crawl.ts` is 260+ lines mixing URL normalization, CLI arg parsing, list crawling, detail crawling, worker orchestration, output formatting, and error handling.

**Recommendation**: Extract reusable components.

```
Proposed Structure:
  actions/
    crawl.ts            → orchestration only (list → detail pipeline)
    crawl-options.ts    → CLI schema + arg parsing
  utils/
    rate-limiter.ts     → token bucket rate limiter
    worker-pool.ts      → generic concurrent worker pool
    progress-writer.ts  → JSONL progressive output
  web-engine/
    engine-pool.ts      → engine instance pooling
```

**Effort**: Medium. Refactoring with test coverage.

**Impact**: Each component becomes independently testable and reusable. New crawl actions can reuse the worker pool, rate limiter, and progress writer without duplicating logic.

---

## Implementation Roadmap

```
Phase 1 (Immediate — 1-2 days):
  ├── #1 Progressive data persistence (P0)
  ├── #4 Configurable rate limiting (P1)
  └── #9 Error snapshot storage (P3)

  Rationale: Highest impact, lowest effort. Addresses data loss
  and provides debugging infrastructure.

Phase 2 (Short-term — 3-5 days):
  ├── #2 Resumable crawl state (P0)
  ├── #5 Retry strategy enhancement (P1)
  └── #8 Structured crawl metrics (P3)

  Rationale: Makes large crawls practical and observable.

Phase 3 (Medium-term — 1-2 weeks):
  ├── #3 Session health tracking (P1)
  ├── #7 Engine pool / connection reuse (P2)
  └── #10 Separate concerns in crawl.ts (P3)

  Rationale: Architecture improvements that enable scaling.

Phase 4 (When needed):
  └── #6 Resource-aware concurrency (P2)

  Rationale: Only needed when crawl scale exceeds single-machine
  resources. Depends on #7 and #10.
```

---

## What NOT to Change

Some patterns in this repository are already well-designed and should be preserved:

- **`ContentParserPlugin` system**: The `applies()` + `extract()` pattern is cleaner than Crawlee's handler labels. Keep it.
- **`InteractionAdapter` abstraction**: Decoupling parsers from browser APIs is the right design. Crawlee doesn't do this.
- **`FetchResponse<T>` discriminated union**: Typed success/error with error codes is superior to exceptions. Keep it.
- **`CaptchaDectector` taxonomy**: Multi-provider CAPTCHA detection is more sophisticated than needed for most use cases but provides genuine value for idealista. Keep it.
- **Domain-specific profile persistence**: The global + domain merge strategy in `UlixeeProfileManager` is thoughtful. Extend it with health tracking, don't replace it.
