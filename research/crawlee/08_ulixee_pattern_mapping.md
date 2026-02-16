# Crawlee → Ulixee Pattern Mapping

> **This is the most important file in the knowledge base.** It directly maps Crawlee's abstractions to the equivalents in this repository's Ulixee-based scraper, identifying gaps and migration opportunities.

## Master Mapping Table

| Crawlee Concept                   | Ulixee Equivalent                          | Location                                   | Gap Analysis                                                                                                                       |
| --------------------------------- | ------------------------------------------ | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `BasicCrawler` / `CheerioCrawler` | `WebEngine` (abstract class)               | `web-engine/types.ts`                      | Crawlee bundles queue + pool + handler + retry. WebEngine only handles single-URL fetch.                                           |
| `PlaywrightCrawler`               | `UlixeeWebEngine`                          | `web-engine/ulixee-engine.ts`              | UlixeeWebEngine uses Hero (Ulixee browser). Similar role: browser-based scraping with anti-detection.                              |
| `CheerioCrawler` (HTTP-only)      | `AxiosWebEngine`                           | `web-engine/axios-engine.ts`               | Both do HTTP fetch + Cheerio parsing. AxiosWebEngine lacks TLS fingerprinting, session management.                                 |
| `RequestQueue`                    | **No equivalent**                          | —                                          | Queue is implicit in action files (sequential `while` loop + `listedIds` array). No persistence, no dedup, no crash recovery.      |
| `AutoscaledPool`                  | Manual worker pool                         | `actions/crawl.ts`                         | `crawl.ts` uses `Promise.all` with N workers sharing `nextIndex` counter. No CPU/memory awareness, no dynamic scaling.             |
| `SessionPool`                     | `UlixeeProfileManager` (partial)           | `web-engine/ulixee-profile-manager.ts`     | ProfileManager handles cookie/storage persistence per domain. No proxy rotation, no health tracking, no session retirement.        |
| `Router`                          | Action files (implicit)                    | `actions/crawl.ts`, `list.ts`, `detail.ts` | Each action file acts as a "route handler" for a specific page type. No formal router dispatch — routing is call-site determined.  |
| `Dataset`                         | `console.log` / `writeFile`                | `actions/crawl.ts`, `list.ts`              | Data is either printed to stdout or written to a single JSON file. No append-only store, no crash recovery, no incremental writes. |
| `KeyValueStore`                   | **No equivalent**                          | —                                          | No general-purpose key-value storage for snapshots, state, or debugging artifacts.                                                 |
| `enqueueLinks()`                  | Manual pagination following                | `actions/list.ts`, `crawl.ts`              | Pagination is followed via `nextPageUrl` from parser output. No general link discovery/enqueuing.                                  |
| `CrawlingContext`                 | `ParseContext` / `InteractiveParseContext` | `web-engine/types.ts`                      | ParseContext carries engine name, URLs, page data, response info, runtime state. Similar purpose, narrower scope.                  |
| `WebContentParser`                | `WebContentParser` (abstract)              | `web-engine/types.ts`                      | Same name, same role. Crawlee calls it `requestHandler`, this repo has a formal parser abstraction.                                |
| `ContentParserPlugin`             | `ContentParserPlugin`                      | `web-engine/types.ts`                      | URL-based plugin resolution via `applies()` method. Very similar to Crawlee's router label matching.                               |
| `InteractiveWebContentParser`     | `InteractiveWebContentParser`              | `web-engine/types.ts`                      | Parsers that need browser interaction (click, wait, evaluate). No Crawlee equivalent — Crawlee gives full `page` object.           |
| `InteractionAdapter`              | `InteractionAdapter`                       | `web-engine/types.ts`                      | Abstraction over browser interaction (click, isVisible, waitForSelector, evaluate). Crawlee exposes raw Playwright/Puppeteer API.  |
| `ProxyConfiguration`              | **No equivalent**                          | —                                          | No proxy management. UlixeeWebEngine uses Hero's built-in connection handling.                                                     |
| `maxRequestRetries`               | Hardcoded retry loop                       | `web-engine/ulixee-engine.ts`              | UlixeeWebEngine retries up to 2 times in a `for` loop. No exponential backoff, no session rotation on retry.                       |
| `maxRequestsPerMinute`            | **No equivalent**                          | —                                          | Rate limiting is implicit via `waitHumanDelay()` (350-1000ms random pause between sequential requests).                            |
| `useFingerprints`                 | Hero's built-in fingerprinting             | `web-engine/ulixee-engine.ts`              | Hero (Ulixee) has its own browser fingerprint management. No explicit fingerprint configuration.                                   |
| `failedRequestHandler`            | Error threshold + log                      | `actions/crawl.ts`                         | Failed details increment `errorCount`. After `maxErrors`, crawl stops. No individual failure persistence.                          |
| `errorHandler`                    | `log.warn`                                 | `actions/crawl.ts`                         | Errors logged but not stored for post-mortem analysis.                                                                             |

## Detailed Concept Mapping

### 1. Request Queue → Sequential Loop + Array

**Crawlee**:

```
RequestQueue (persistent, deduped, concurrent-safe)
  ├── addRequest(url) → deduplicate → enqueue
  ├── fetchNextRequest() → lock → return
  ├── markRequestHandled() → persist status
  └── reclaimRequest() → unlock for retry
```

**This Repository**:

```
actions/list.ts:
  while (currentUrl) {              ← sequential iteration
    fetch(currentUrl)                ← no queue, no persistence
    currentUrl = nextPageUrl         ← no dedup
  }

actions/crawl.ts:
  listedIds: string[]               ← in-memory array
  nextIndex counter                  ← shared mutable index
  visitedIds = new Set<string>()    ← dedup for list phase only
```

**Gap**: If the process crashes mid-crawl, all progress is lost. There's no way to resume from where it stopped. The `listedIds` array and `nextIndex` counter exist only in memory.

### 2. AutoscaledPool → Manual Worker Pool

**Crawlee**:

```
AutoscaledPool:
  ├── Monitors CPU and memory usage
  ├── Dynamically adjusts concurrency (min → desired → max)
  ├── Applies backpressure when resources are constrained
  ├── Integrates with request queue for work distribution
  └── Handles graceful shutdown
```

**This Repository** (`crawl.ts`):

```typescript
const workerCount = Math.min(workers, targetIds.length || 1);
await Promise.all(Array.from({ length: workerCount }, () => runWorker()));

async function runWorker(): Promise<void> {
  while (!thresholdReached) {
    const taskIndex = nextIndex;
    nextIndex += 1; // ← Not atomic, but safe in single-threaded JS
    // ...fetch and process
  }
}
```

**Gap**: Fixed concurrency, no resource awareness, no backpressure. If all workers hit slow responses simultaneously, memory can spike. No graceful ramp-up period.

### 3. SessionPool → UlixeeProfileManager

**Crawlee SessionPool**:

```
SessionPool:
  ├── maxPoolSize: 100
  ├── Random session selection
  ├── Session health tracking (good/bad/retired)
  ├── Proxy ↔ session binding
  ├── Cookie persistence per session
  ├── Automatic rotation on block
  └── Statistics per session (usage count, error count)
```

**UlixeeProfileManager**:

```
UlixeeProfileManager:
  ├── Global profile (shared across all domains)
  ├── Domain-specific profiles
  ├── Cookie persistence (with dedup and merge)
  ├── Storage origin management
  └── Smart merging (domain overrides global)
```

**Overlap**: Both persist cookies and manage identity state across requests.

**Gap**: UlixeeProfileManager has no concept of:

- Multiple simultaneous sessions (it's one profile per domain, not a pool).
- Session health tracking (no `markBad()` / `retire()`).
- Proxy binding (no proxy management at all).
- Session rotation on detection (same profile reused even after being blocked).

### 4. Router → Action Files

**Crawlee Router**:

```typescript
const router = createPlaywrightRouter();

router.addHandler('LIST', async ({ page, enqueueLinks }) => {
  // Handle list pages
  await enqueueLinks({ selector: 'a.detail', label: 'DETAIL' });
});

router.addHandler('DETAIL', async ({ page, pushData }) => {
  // Handle detail pages
});
```

**This Repository**:

```
actions/
  ├── list.ts    → runListAction()     ← handles list pages
  ├── detail.ts  → runDetailAction()   ← handles detail pages
  └── crawl.ts   → runCrawlAction()   ← orchestrates list → detail
```

**Similarity**: Both achieve separation of concerns by page type. Both support different parsing logic per page type.

**Difference**: Crawlee's router is **dynamic** — a request carries a label and the router dispatches at runtime. This repo's routing is **static** — the calling code decides which action to invoke. The Crawlee pattern is more flexible for crawls where page types are discovered dynamically.

### 5. CrawlingContext → ParseContext

**Crawlee CrawlingContext**:

```typescript
{
  request: Request,          // URL, method, headers, userData
  session: Session,          // Identity context
  proxyInfo: ProxyInfo,      // Proxy details
  log: Log,                  // Scoped logger
  pushData: Function,        // Dataset writer
  enqueueLinks: Function,    // Link discovery
  addRequests: Function,     // Queue management
  // + crawler-specific: $, page, body, json, etc.
}
```

**ParseContext**:

```typescript
{
  engine: string,            // Engine name
  requestUrl: string,        // Original request URL
  finalUrl?: string,         // After redirects
  metadata?: Record<string, unknown>,
  page?: {
    title?: string,
    html?: string,
    domain?: string,
    captchaSelector?: string,
  },
  request?: { headers?: Record<string, string> },
  response?: { statusCode?: number, headers?: Record<string, unknown> },
  runtime?: { showBrowser?: boolean, retry?: number, sessionId?: string },
}
```

**Gap**: ParseContext is **read-only** — it provides information about the current request but doesn't offer actions (no `pushData`, no `enqueueLinks`, no `addRequests`). Side effects happen outside the parser, in the action code.

### 6. CAPTCHA Handling

**Crawlee**: Sessions retired on block. No built-in CAPTCHA solving. Camoufox for Cloudflare challenges.

**This Repository**: `CaptchaDectector` class uses Cheerio to detect Cloudflare, reCAPTCHA, hCaptcha, DuckDuckGo challenges via HTML inspection. Detection is a first-class output (not an exception). The `InteractiveWebContentParser` pattern allows CAPTCHA-aware parsers to handle challenges.

**This repo is ahead** on CAPTCHA detection taxonomy. Crawlee treats CAPTCHAs as generic blocks. This repo distinguishes between Cloudflare, reCAPTCHA, hCaptcha, and DuckDuckGo challenges with specific selectors.

### 7. Data Output

**Crawlee**:

```
pushData() → Dataset (persistent, append-only, per-item files)
  ├── Crash-safe (each item written individually)
  ├── Exportable (CSV, JSON)
  ├── Named datasets for separation
  └── Automatic ID generation
```

**This Repository**:

```
// list.ts
console.log(formatJson(result, pretty));
// or
writeFile(outputFile, output, "utf-8");

// crawl.ts
const detailsByIndex: Array<...> = Array.from({ length: targetIds.length });
// ... fill array ...
const output = formatJson(details, pretty);
writeFile(outputFile, output, 'utf-8');
```

**Gap**: Data is accumulated in memory (`detailsByIndex` array) and written once at the end. If the process crashes after collecting 49,000 of 50,000 details, all data is lost. No incremental persistence.

## Architecture Strength Assessment

### Where This Repository Is Stronger Than Crawlee's Default Patterns

| Area                               | Advantage                                                                                                                                                          |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| **Parser Plugin System**           | `ContentParserPlugin` with `applies()` is more structured than Crawlee's handler labels. URL-based routing with fallback is elegant.                               |
| **Interactive Parser Abstraction** | `InteractiveWebContentParser` + `InteractionAdapter` provides a clean abstraction over browser interaction that Crawlee lacks (Crawlee exposes raw `page` object). |
| **CAPTCHA Detection Taxonomy**     | Multi-provider CAPTCHA detection with specific selectors is more sophisticated than Crawlee's generic block detection.                                             |
| **Type Safety**                    | `FetchResponse<T>` discriminated union (`success                                                                                                                   | error`) with typed error codes is more rigorous than Crawlee's exception-based error model. |
| **Profile Management**             | Domain-specific profile persistence with smart cookie merging is well-designed for single-site crawling.                                                           |

### Where Crawlee Is Significantly Stronger

| Area                   | Gap                                                                                    |
| ---------------------- | -------------------------------------------------------------------------------------- |
| **Crash Recovery**     | No persistent queue, no incremental data writes. Crash = total data loss.              |
| **Scaling**            | Fixed concurrency, no resource awareness, no backpressure.                             |
| **Session Management** | Single profile per domain, no pool, no health tracking, no rotation.                   |
| **Proxy Management**   | No proxy support at all.                                                               |
| **Rate Limiting**      | Only `waitHumanDelay()` (random 350-1000ms). No request-per-minute enforcement.        |
| **Link Discovery**     | Manual pagination following only. No general `enqueueLinks` equivalent.                |
| **Observability**      | Minimal logging. No request statistics, no session statistics, no performance metrics. |

## Migration Opportunity Matrix

| Priority | Crawlee Pattern                           | Implementation Effort | Impact                                            |
| -------- | ----------------------------------------- | --------------------- | ------------------------------------------------- |
| **P0**   | Persistent data writes (progressive save) | Low                   | Eliminates data loss risk on crash                |
| **P0**   | Request queue with dedup + resume         | Medium                | Enables resumable crawls                          |
| **P1**   | Session pool with health tracking         | Medium                | Reduces block rate, enables proxy rotation        |
| **P1**   | Rate limiting (requests/minute)           | Low                   | Prevents aggressive crawling that triggers blocks |
| **P2**   | Resource-aware autoscaling                | High                  | Better resource utilization at scale              |
| **P2**   | Proxy configuration                       | Medium                | Enables IP rotation for anti-blocking             |
| **P3**   | Named datasets                            | Low                   | Better data organization                          |
| **P3**   | Error snapshots to KV store               | Low                   | Better debugging for failed requests              |
