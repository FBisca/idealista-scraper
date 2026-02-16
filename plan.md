# Crawler Platform — Architecture & Implementation Plan

> Derived from Crawlee research knowledge base (`research/crawlee/`)
> and gap analysis against the current `idealista-scraper` repository.

---

## Table of Contents

1. [Research Pattern Summary](#1-research-pattern-summary)
2. [Current Repository Gap Analysis](#2-current-repository-gap-analysis)
3. [Target Repository Architecture](#3-target-repository-architecture)
4. [Migration Strategy](#4-migration-strategy)
5. [Implementation Milestones](#5-implementation-milestones)
6. [Code Rules & Quality Bar](#6-code-rules--quality-bar)

---

## 1. Research Pattern Summary

Each pattern extracted from the Crawlee research knowledge base, generalized for cross-engine use.

### Pattern 1 — Request Lifecycle Management

| Field                       | Detail                                                                                                                                                                                                                                    |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Problem Solved**          | Uncontrolled request execution with no retry, no state tracking, no crash recovery.                                                                                                                                                       |
| **Crawlee Mechanism**       | `RequestQueue` → `AutoscaledPool` → pre-navigation hooks → fetch → post-navigation hooks → `requestHandler` → success/failure → retry or mark handled.                                                                                    |
| **Generalized Version**     | A deterministic state machine where every URL transitions through `pending → locked → processing → handled/failed`. State persists to disk. Retry decisions are informed by error classification. Session identity rotates on each retry. |
| **Production Risk Reduced** | Data loss on crash (queue persistence), duplicate work (deduplication via `uniqueKey`), cascading failures from unclassified errors.                                                                                                      |

### Pattern 2 — Queue-Driven URL Frontier

| Field                       | Detail                                                                                                                                                                                                                  |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Problem Solved**          | In-memory URL lists lose all progress on crash; no deduplication; no resume capability.                                                                                                                                 |
| **Crawlee Mechanism**       | `RequestQueue` — persistent, deduplicating, lockable. `RequestQueueV2` adds distributed locking. Batching (1K) for large seed sets.                                                                                     |
| **Generalized Version**     | A persistent work queue with unique-key deduplication, three-partition state (`pending`/`in-progress`/`handled`), and lock-based checkout for parallel consumers. Crash recovery moves `in-progress` back to `pending`. |
| **Production Risk Reduced** | Total data loss on crash, duplicate crawling, inability to resume interrupted crawls.                                                                                                                                   |

### Pattern 3 — Resource-Aware Autoscaling

| Field                       | Detail                                                                                                                                                                                                         |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Problem Solved**          | Fixed concurrency either wastes resources or causes OOM depending on page complexity.                                                                                                                          |
| **Crawlee Mechanism**       | `AutoscaledPool` — feedback controller measuring CPU/memory every 10s, scaling concurrency within `[min, max]` bounds. Rate limiting via `maxRequestsPerMinute` enforced per-second.                           |
| **Generalized Version**     | A concurrency governor that periodically samples system resource usage and adjusts active tasks. Combined with a token-bucket rate limiter. Implicit backpressure through bounded queue + bounded concurrency. |
| **Production Risk Reduced** | OOM crashes, CPU saturation, burst request patterns triggering bans, idle resource waste.                                                                                                                      |

### Pattern 4 — Session Pool with Health Tracking

| Field                       | Detail                                                                                                                                                                                                            |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Problem Solved**          | Blocked identities keep retrying with the same burned credentials; no proxy rotation; inconsistent fingerprint signals.                                                                                           |
| **Crawlee Mechanism**       | `SessionPool` — pool of linked identities (proxy + cookies + fingerprint + headers). Random selection, three health states (`good`/`bad`/`retired`). Session ↔ proxy binding ensures IP + cookie consistency.     |
| **Generalized Version**     | An identity pool where each session bundles all signals (IP, cookies, fingerprint, headers) as a coherent unit. Health tracking retires burned sessions, penalizes degraded ones, replaces with fresh identities. |
| **Production Risk Reduced** | Cascading blocks from reusing burned sessions, TLS/cookie/IP inconsistency, entire crawl stalling from one blocked identity.                                                                                      |

### Pattern 5 — Layered Anti-Detection (Defense in Depth)

| Field                       | Detail                                                                                                                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Problem Solved**          | Anti-bot systems detect crawlers at multiple layers; fixing one layer alone still fails.                                                                                              |
| **Crawlee Mechanism**       | 5-layer model: L1 IP/proxy, L2 TLS fingerprint (Impit), L3 HTTP fingerprint (header ordering), L4 browser fingerprint (Fingerprint Suite), L5 behavioral (Camoufox + natural pacing). |
| **Generalized Version**     | A defense-in-depth stack where each layer addresses a specific detection surface. Engines escalate based on detection encountered. Each layer independently configurable.             |
| **Production Risk Reduced** | Blocks from TLS/HTTP/browser fingerprinting, behavioral analysis.                                                                                                                     |

### Pattern 6 — Discriminated Router Dispatch

| Field                       | Detail                                                                                                                                                                                              |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Problem Solved**          | Multi-page-type crawlers become monolithic if-else chains.                                                                                                                                          |
| **Crawlee Mechanism**       | `Router` + `request.label` — labels travel with URLs. `router.addHandler('LABEL', handler)` maps labels to isolated handlers.                                                                       |
| **Generalized Version**     | A label-based dispatcher where URLs carry routing metadata. The orchestrator dispatches each URL to the handler matching its label. Handlers are composable, testable, single-responsibility units. |
| **Production Risk Reduced** | Handler coupling, untestable crawl logic, difficulty adding new page types.                                                                                                                         |

### Pattern 7 — Streaming Data Pipeline

| Field                       | Detail                                                                                                                                 |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **Problem Solved**          | Batch accumulation loses all results on crash; memory grows with crawl size.                                                           |
| **Crawlee Mechanism**       | `Dataset.pushData()` — append-only, per-item persistence. Each handler is a micro-ETL: extract → transform → persist → discover links. |
| **Generalized Version**     | Immediate persistence of each item (JSONL append). O(1) memory per item. Crash-safe by design. Handler = complete ETL micro-pipeline.  |
| **Production Risk Reduced** | Total data loss, memory exhaustion on large crawls, no partial result visibility.                                                      |

### Pattern 8 — Hybrid Crawler Type Selection

| Field                       | Detail                                                                                                                                                                        |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Problem Solved**          | Browser for all requests is 10-50x more expensive; HTTP for all misses JS content.                                                                                            |
| **Crawlee Mechanism**       | HTTP-first principle: `CheerioCrawler` first, escalate to `PlaywrightCrawler` on failure. Two-phase crawl (HTTP lists, browser details). Cascading fallback for blocked URLs. |
| **Generalized Version**     | Tiered execution: cheapest viable engine per request. Failures escalate to higher-capability engines. Selection per URL-pattern, per page-type, or adaptive.                  |
| **Production Risk Reduced** | Excessive compute cost, slow throughput, missing JS-rendered data.                                                                                                            |

### Pattern 9 — Classified Error Handling with Retry Intelligence

| Field                       | Detail                                                                                                                                                                                    |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Problem Solved**          | Naive retries use same identity and no backoff, hitting the same block repeatedly.                                                                                                        |
| **Crawlee Mechanism**       | Error classification: hard block → `session.retire()` + new session; soft block → `markBad()` + backoff; network → immediate retry; parse → no retry. Session rotation per retry attempt. |
| **Generalized Version**     | Error taxonomy maps to recovery actions: identity rotation, exponential backoff, immediate retry, or abort. Retries with fresh identity + delay avoid the "retry into same block" loop.   |
| **Production Risk Reduced** | Retry storms, wasted retries on non-transient errors, cascading session failures.                                                                                                         |

### Pattern 10 — Crawl Observability

| Field                       | Detail                                                                                                                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Problem Solved**          | Long-running crawls are opaque; problems only discovered post-mortem.                                                                                                                 |
| **Crawlee Mechanism**       | Structured logging with autoscaler state, session pool stats, request counters, error snapshots to `KeyValueStore`.                                                                   |
| **Generalized Version**     | Metrics: counters (requests total/success/failed/blocked), gauges (workers, queue depth, memory), histograms (duration). Periodic snapshots. Error snapshots preserve HTML + context. |
| **Production Risk Reduced** | Undetected stalls, silent blocks, debugging requiring re-runs, inability to tune parameters.                                                                                          |

---

## 2. Current Repository Gap Analysis

### Strengths to Preserve

| Area                                       | Why It's Strong                                                                                                                              |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **`ContentParserPlugin` system**           | `applies()` + `extract()` pattern is more structured than Crawlee's handler labels. URL-based routing with fallback is elegant.              |
| **`InteractionAdapter` abstraction**       | Decouples parsers from browser APIs. Crawlee exposes raw `page`; this repo abstracts it.                                                     |
| **`FetchResponse<T>` discriminated union** | Typed `success \| error` with error codes is more rigorous than Crawlee's exception model.                                                   |
| **`CaptchaDectector` taxonomy**            | Multi-provider CAPTCHA detection (Cloudflare, reCAPTCHA, hCaptcha, DuckDuckGo) is more sophisticated than Crawlee's generic block detection. |
| **`UlixeeProfileManager`**                 | Domain-specific profile persistence with global + domain cookie merge is well-designed.                                                      |

### Critical Gaps

| Gap                   | Current State                                               | Risk                                             |
| --------------------- | ----------------------------------------------------------- | ------------------------------------------------ |
| **Crash recovery**    | In-memory `detailsByIndex` array, `writeFile` at end        | 49,999/50,000 details lost on crash              |
| **Resume capability** | No persistent crawl state                                   | Interrupted crawls restart from scratch          |
| **Request queue**     | Sequential `while` loop + `listedIds` array                 | No dedup across runs, no persistence             |
| **Engine reuse**      | New `UlixeeWebEngine` per detail request                    | 1-3s startup overhead × N requests               |
| **Session health**    | Single profile per domain, no health tracking               | Blocked session reused indefinitely              |
| **Rate limiting**     | `waitHumanDelay()` (random 350-1000ms)                      | No request-rate governance, unpredictable pacing |
| **Retry strategy**    | Hardcoded `retry < 2` loop, no backoff, no session rotation | Retries hit same block with same identity        |
| **Concurrency**       | Fixed `Promise.all` workers, no resource awareness          | OOM risk at high worker counts                   |
| **Observability**     | Minimal logging, no metrics during crawl                    | Long crawls are opaque                           |
| **Error snapshots**   | `log.warn` only, HTML discarded                             | Post-mortem requires re-running crawl            |

---

## 3. Target Repository Architecture

### Directory Structure

```
packages/scraper/src/
  index.ts
  cli.ts

  ── ORCHESTRATION LAYER ──────────────────────────────
  orchestrator/
    crawler.ts                 CrawlOrchestrator: lifecycle manager
    router.ts                  Label-based handler dispatch
    types.ts                   CrawlContext, CrawlRequest, HandlerFn

  ── QUEUE LAYER ─────────────────────────────────────
  queue/
    request-queue.ts           Persistent, dedup, resumable queue
    types.ts                   RequestState, QueueEntry

  ── ENGINE LAYER (existing + new adapter) ────────────
  web-engine/
    types.ts                   (preserved)
    engine-adapter.ts          NEW: unified engine adapter interface
    axios-engine.ts            (removed)
    ulixee-engine.ts           (preserved)
    crawlee-engine.ts          NEW: Crawlee CheerioCrawler adapter
    engine-pool.ts             NEW: engine instance pooling
    captcha-detector.ts        (preserved)
    parser-resolver.ts         (preserved)
    ulixee-profile-manager.ts  (preserved)
    scraper/                   (preserved)
    search/                    (preserved)

  ── SESSION / IDENTITY LAYER ────────────────────────
  session/
    session-pool.ts            Session pool with health tracking
    session.ts                 Session entity (proxy + cookies + state)
    types.ts                   SessionState, SessionConfig

  ── ANTI-BLOCKING LAYER ─────────────────────────────
  anti-blocking/
    rate-limiter.ts            Token-bucket rate limiter
    retry-strategy.ts          Classified retry with backoff
    types.ts                   ErrorClass, RetryDecision

  ── DATA PIPELINE LAYER ─────────────────────────────
  pipeline/
    progress-writer.ts         JSONL append-only writer
    crawl-state.ts             Persistent crawl state (resume)
    types.ts                   DataSink, CrawlStateSnapshot

  ── OBSERVABILITY LAYER ─────────────────────────────
  observability/
    metrics.ts                 Crawl metrics (counters, gauges)
    error-snapshot.ts          Failed request snapshots to disk

  ── ACTIONS (refactored) ────────────────────────────
  actions/
    crawl.ts                   Uses orchestrator, thin wrapper
    list.ts                    (preserved)
    detail.ts                  (preserved)

  ── PLUGINS (preserved) ─────────────────────────────
  plugins/                     (no changes)

  ── UTILS (existing + new) ──────────────────────────
  utils/
    json.ts                    (preserved)
    url.ts                     (preserved)
```

### Layer Relationship Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                        CLI / Actions                             │
│   crawl.ts   list.ts   detail.ts                                │
└──────────┬───────────────────────────────────────────────────────┘
           │ delegates to
           ▼
┌──────────────────────────────────────────────────────────────────┐
│                   CrawlOrchestrator                              │
│   • owns crawl lifecycle (seed → process → done)                │
│   • coordinates all layers                                       │
│   • Router dispatches requests by label                          │
└────┬──────────┬──────────┬──────────┬──────────┬────────────────┘
     │          │          │          │          │
     ▼          ▼          ▼          ▼          ▼
┌─────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌──────────────┐
│ Request │ │ Engine │ │Session │ │ Anti-  │ │ Observability│
│ Queue   │ │ Pool   │ │ Pool   │ │ Block  │ │ (Metrics +   │
│         │ │        │ │        │ │ Layer  │ │  Snapshots)  │
└────┬────┘ └────┬───┘ └────┬───┘ └────┬───┘ └──────┬───────┘
     │          │          │          │            │
     │          ▼          │          │            │
     │    ┌──────────────┐ │          │            │
     │    │ WebEngine    │◄┘          │            │
     │    │ (Ulixee /    │◄───────────┘            │
     │    │              │                         │
     │    │  Crawlee)    │─────────────────────────┘
     │    └──────┬───────┘
     │           │
     │           ▼
     │    ┌──────────────┐
     │    │ Parser       │
     │    │ Resolver +   │
     │    │ Plugins      │
     │    └──────────────┘
     │
     ▼
┌──────────────────┐
│ Data Pipeline    │
│ ProgressWriter   │
│ CrawlState       │
└──────────────────┘
```

### Ulixee Compatibility Matrix

| Module              | Ulixee Equivalent                          | What Changes if Switching Engine                                                                         |
| ------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `CrawlOrchestrator` | No equivalent (logic in action files)      | Engine-agnostic. Switching engines only changes which `EngineAdapter` is injected.                       |
| `RequestQueue`      | No equivalent                              | Engine-agnostic. No change needed.                                                                       |
| `EnginePool`        | Hero instance management (one-per-request) | Pool wraps engine creation/reuse. For Ulixee → pools Hero instances. For Crawlee → wraps CheerioCrawler. |
| `SessionPool`       | `UlixeeProfileManager` (cookies only)      | Adds health tracking on top. Ulixee profiles become the cookie/storage backend for sessions.             |
| `RateLimiter`       | `waitHumanDelay()`                         | Engine-agnostic. Replaces per-request delay with request-rate governance.                                |
| `RetryStrategy`     | Hardcoded retry loop in `ulixee-engine.ts` | Wraps engine `fetchContent` with classified retry. CAPTCHA detection feeds error classification.         |
| `ProgressWriter`    | `writeFile` at end of crawl                | Engine-agnostic. JSONL output replaces in-memory accumulation.                                           |
| `CrawlMetrics`      | `log.info` summary at end                  | Engine-agnostic. Periodic metric snapshots during execution.                                             |

---

## 4. Migration Strategy

### Principles

1. **Wrap, don't replace.** Ulixee engine and parsers are preserved. New layers wrap them. Delete Axios since Cheerio replaces it
2. **Additive first.** New modules are created alongside existing code. No existing file is modified until the integration milestone.
3. **Test each layer independently.** Each module has its own unit tests before integration.
4. **Single integration point.** Only `crawl.ts` is refactored to use the new orchestrator. `list.ts` and `detail.ts` remain standalone.

### Migration Path

```
Current State                          Target State
──────────────────                     ──────────────────
crawl.ts (260+ lines monolith)    →   CrawlOrchestrator + thin crawl.ts
  in-memory array                 →   RequestQueue (persistent)
  Promise.all workers             →   EnginePool + concurrency governor
  writeFile at end                →   ProgressWriter (JSONL streaming)
  no resume                       →   CrawlState (persistent checkpoints)
  waitHumanDelay()                →   RateLimiter (token bucket)
  hardcoded retry(2)              →   RetryStrategy (classified)
  no metrics                      →   CrawlMetrics (counters + gauges)
  no error snapshots              →   ErrorSnapshot (html + context)

UlixeeWebEngine                   →   preserved, wrapped by EngineAdapter
AxiosWebEngine                    →   deleted
UlixeeProfileManager              →   preserved, extended by SessionPool
ContentParserPlugin system         →   preserved (no change)
InteractionAdapter                 →   preserved (no change)
FetchResponse<T> union             →   preserved (no change)
CaptchaDectector                   →   preserved, integrated w/ RetryStrategy
```

---

## 5. Implementation Milestones

### Milestone 1 — Foundation Infrastructure

**Goal:** Eliminate the two highest-impact risks: data loss on crash and uncontrolled request rates.

| Attribute        | Detail                                                                                                                                                                                   |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Patterns**     | Pattern 7 (Streaming Pipeline), Pattern 3 (Rate Limiting subset), Pattern 10 (Error Snapshots)                                                                                           |
| **Modules**      | `pipeline/progress-writer.ts`, `pipeline/types.ts`, `anti-blocking/rate-limiter.ts`, `anti-blocking/types.ts`, `observability/error-snapshot.ts`                                         |
| **Risk Level**   | Low — additive, no existing code modified.                                                                                                                                               |
| **Dependencies** | None.                                                                                                                                                                                    |
| **Validation**   | Unit tests for ProgressWriter (append, read, crash recovery), RateLimiter (token bucket, burst prevention), ErrorSnapshot (write, cap at N). `pnpm test && pnpm typecheck && pnpm lint`. |

**Deliverables:**

- `ProgressWriter` — JSONL append-only writer with tmp → final rename, crash-safe reads, completed-ID extraction.
- `RateLimiter` — Token-bucket with per-second distribution, `acquire()` that returns delay or resolves when ready.
- `ErrorSnapshot` — Writes failed request context (URL, status, headers, HTML, error) to disk, capped at configurable max.

**Research Justification:**

- ProgressWriter implements the streaming data pipeline (Pattern 7). Current `detailsByIndex` array holds all data in memory; crash at 99% = total loss.
- RateLimiter implements rate governance (Pattern 3 subset). Current `waitHumanDelay()` provides random jitter but no request-rate bound.
- ErrorSnapshot implements observability (Pattern 10). Currently failed requests are logged but HTML is discarded, preventing post-mortem analysis.

---

### Milestone 2 — Queue + Crawl State

**Goal:** Persistent URL frontier with deduplication and resume capability.

| Attribute        | Detail                                                                                                                                                           |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Patterns**     | Pattern 2 (Queue-Driven URL Frontier)                                                                                                                            |
| **Modules**      | `queue/request-queue.ts`, `queue/types.ts`, `pipeline/crawl-state.ts`                                                                                            |
| **Risk Level**   | Medium — new abstractions, but no existing code changed yet.                                                                                                     |
| **Dependencies** | Milestone 1 (ProgressWriter patterns inform state persistence).                                                                                                  |
| **Validation**   | Unit tests for RequestQueue (enqueue, dequeue, dedup, persist, resume), CrawlState (snapshot, load, reconciliation). `pnpm test && pnpm typecheck && pnpm lint`. |

**Deliverables:**

- `RequestQueue` — In-process persistent queue. Entries have states: `pending`, `in-progress`, `handled`, `failed`. Deduplication via `uniqueKey`. Serializes to JSONL for crash recovery. `in-progress` items moved back to `pending` on load.
- `CrawlState` — Tracks discovered IDs, completed IDs, failed IDs, last list page. Persists to `.crawl-state.json`. Supports resume: on startup, loads state, reconciles with queue, skips completed work.

**Research Justification:**

- RequestQueue implements the URL frontier (Pattern 2). Current `listedIds` array + `nextIndex` counter exist only in memory. Crash = restart from zero.
- CrawlState enables resumable crawls. A 50,000-item crawl that fails at 40,000 should only need the remaining 10,000.

---

### Milestone 3 — Session Pool + Retry Strategy

**Goal:** Identity management with health tracking and classified retry with session rotation.

| Attribute        | Detail                                                                                                                                                                |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Patterns**     | Pattern 4 (Session Pool), Pattern 9 (Classified Error Handling), Pattern 5 (Anti-Detection L1)                                                                        |
| **Modules**      | `session/session-pool.ts`, `session/session.ts`, `session/types.ts`, `anti-blocking/retry-strategy.ts`                                                                |
| **Risk Level**   | Medium — extends `UlixeeProfileManager` without replacing it.                                                                                                         |
| **Dependencies** | Milestone 1 (ErrorSnapshot for failed request).                                                                                                                       |
| **Validation**   | Unit tests for SessionPool (create, select, markBad, retire, replace), RetryStrategy (classification, backoff, rotation). `pnpm test && pnpm typecheck && pnpm lint`. |

**Deliverables:**

- `Session` — Entity bundling: session ID, proxy URL (optional), cookies, health state (`healthy` / `degraded` / `blocked`), usage count, consecutive errors, creation time.
- `SessionPool` — Pool of N sessions. Random selection (not round-robin). `markBad()` applies cooldown. `retire()` permanently removes and creates replacement. Integrates with `UlixeeProfileManager` as cookie backend.
- `RetryStrategy` — Error classifier: CAPTCHA/403 → `hard-block` (retire + new session + delay), 429 → `soft-block` (backoff), timeout/network → `network` (retry immediately), parse error → `parse` (no retry). Exponential backoff: 1s → 2s → 4s capped. Max retries configurable (default 3).

**Research Justification:**

- SessionPool implements Pattern 4. Current `UlixeeProfileManager` has one profile per domain with no health tracking. A blocked profile is reused forever.
- RetryStrategy implements Pattern 9. Current retry is `retry < 2` with 1s fixed delay, no session rotation, no error classification.

**Ulixee Compatibility Notes:**

- SessionPool wraps `UlixeeProfileManager`. Ulixee profile = cookie backend for session. Retiring a session clears the domain profile.
- For Crawlee engine, SessionPool would manage `Session` objects from Crawlee's SessionPool. The interface is engine-agnostic.

---

### Milestone 4 — Engine Adapter + Engine Pool

**Goal:** Unified engine interface supporting Ulixee, Axios, and future Crawlee engines. Engine instance reuse.

| Attribute        | Detail                                                                                                                                                                            |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Patterns**     | Pattern 8 (Hybrid Crawler Type Selection), Pattern 3 (Resource Pool subset)                                                                                                       |
| **Modules**      | `web-engine/engine-adapter.ts`, `web-engine/engine-pool.ts`, `web-engine/crawlee-engine.ts`                                                                                       |
| **Risk Level**   | Medium — adapter layer wraps existing engines without modifying them.                                                                                                             |
| **Dependencies** | Milestone 3 (SessionPool provides identity for requests).                                                                                                                         |
| **Validation**   | Unit tests for EnginePool (acquire, release, cleanup, max size), EngineAdapter (Ulixee and Axios adapters produce same result shape). `pnpm test && pnpm typecheck && pnpm lint`. |

**Deliverables:**

- `EngineAdapter` — Interface: `fetch(url, options) → FetchResponse<T>`, `cleanup()`, `engineType: 'ulixee' | 'axios' | 'crawlee'`. Wraps existing `WebEngine.fetchContent` for Ulixee and Axios.
- `EnginePool` — Pool of pre-created engine instances. `acquire() → EngineAdapter`, `release(engine)`, `cleanup()`. Max pool size configurable. Reuses engines across requests (eliminates 1-3s Hero startup per request).
- `CrawleeEngine` — Adapter wrapping Crawlee's `CheerioCrawler` as an `EngineAdapter`. HTTP-only, uses `ImpitHttpClient` for TLS fingerprinting when available.

**Research Justification:**

- EngineAdapter implements Pattern 8. The abstraction allows the orchestrator to select engine per request without knowing engine internals.
- EnginePool addresses the "new engine per request" problem. Current `fetchDetailById` creates + destroys a `UlixeeWebEngine` per detail. Pool amortizes startup cost.

**Ulixee Compatibility Notes:**

- `UlixeeWebEngine` is wrapped by `EngineAdapter`, not modified. Pool manages Hero instance lifecycle.
- `AxiosWebEngine` is wrapped identically. No proxy/session overhead.
- `CrawleeEngine` is additive — Crawlee dependency is optional (lazy import). Repository works without it.

---

### Milestone 5 — Orchestrator + Router

**Goal:** Central crawl lifecycle manager coordinating all layers. Label-based router for multi-page-type crawls.

| Attribute        | Detail                                                                                                                                                                                                                       |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Patterns**     | Pattern 1 (Request Lifecycle), Pattern 6 (Router Dispatch), Pattern 3 (Autoscaling/concurrency)                                                                                                                              |
| **Modules**      | `orchestrator/crawler.ts`, `orchestrator/router.ts`, `orchestrator/types.ts`                                                                                                                                                 |
| **Risk Level**   | High — integration milestone. All layers wired together.                                                                                                                                                                     |
| **Dependencies** | All previous milestones.                                                                                                                                                                                                     |
| **Validation**   | Unit tests for Router (label dispatch, default handler, unknown label), CrawlOrchestrator (lifecycle, concurrency bounds, graceful shutdown). Integration test with mock engine. `pnpm test && pnpm typecheck && pnpm lint`. |

**Deliverables:**

- `CrawlRequest` — URL + label + metadata. Label determines which handler processes it. Carries retry count, error history.
- `Router` — `addHandler(label, fn)`, `addDefaultHandler(fn)`. Dispatches `CrawlRequest` to matching handler. Handlers receive `CrawlContext` with `pushData`, `enqueue`, `session`, `metrics`.
- `CrawlContext` — Injected into handlers: `request`, `session`, `pushData(data)`, `enqueue(urls, label)`, `metrics`, `log`. Engine-specific context (page, $) available via type narrowing.
- `CrawlOrchestrator` — Owns lifecycle:
  1. Initialize queue, engine pool, session pool, metrics, progress writer.
  2. Seed initial URLs.
  3. Loop: dequeue → acquire engine → acquire session → rate-limit → fetch → route to handler → persist result → mark handled. On failure → classify → retry or fail.
  4. Concurrency governor: configurable `minConcurrency`, `maxConcurrency`. Optional resource-aware scaling (future).
  5. Graceful shutdown: finish in-progress, persist state, close engines.

**Research Justification:**

- CrawlOrchestrator implements Pattern 1 (Request Lifecycle). Current `crawl.ts` mixes URL management, fetching, parsing, error handling, and output in one function.
- Router implements Pattern 6. Current routing is static (call-site determined). Router enables dynamic dispatch for crawls discovering different page types.
- Concurrency governance implements Pattern 3. Current `Promise.all` with fixed worker count has no resource awareness.

**Ulixee Compatibility Notes:**

- Orchestrator is engine-agnostic. It delegates to `EnginePool` which returns engine adapters.
- For Ulixee: orchestrator acquires `UlixeeEngineAdapter` from pool. Handler receives `InteractiveParseContext` with `InteractionAdapter`.
- For Crawlee: orchestrator acquires `CrawleeEngineAdapter`. Handler receives `ParseContext` with Cheerio `$`.
- For Axios: same as Crawlee but without TLS fingerprinting.

---

### Milestone 6 — Action Refactoring

**Goal:** Refactor `crawl.ts` to use the orchestrator. Actions become thin configuration + delegation.

| Attribute        | Detail                                                                                                                              |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Patterns**     | Integration of all patterns into existing action API.                                                                               |
| **Modules**      | `actions/crawl.ts` (modified)                                                                                                       |
| **Risk Level**   | Medium — modifies existing public API. Must maintain backward compatibility.                                                        |
| **Dependencies** | Milestone 5.                                                                                                                        |
| **Validation**   | Existing CLI flags and behavior preserved. End-to-end test with Ulixee engine (manual). `pnpm test && pnpm typecheck && pnpm lint`. |

**Deliverables:**

- Refactored `runCrawlAction`:
  1. Parse options (preserved).
  2. Create `CrawlOrchestrator` with appropriate config.
  3. Register list handler (label: `LIST`) and detail handler (label: `DETAIL`).
  4. Seed with initial URL + `LIST` label.
  5. `await orchestrator.run()`.
  6. Output from ProgressWriter (JSONL → JSON for backward compat).
- New CLI flags: `--resume` (opt into resume), `--fresh` (force restart).
- `list.ts` and `detail.ts` remain standalone (not orchestrated) for single-page use cases.

---

## 6. Code Rules & Quality Bar

### Must

- Production architecture — no tutorials, no toy crawlers.
- Pattern implementation — every module references which research pattern it implements.
- Framework-agnostic when possible — orchestrator, queue, pipeline, metrics work with any engine.
- Crawlee pattern compatibility — architecture mirrors Crawlee concepts for familiarity and potential migration.
- Ulixee pattern compatibility — existing Ulixee integration preserved and enhanced.
- Explicit TypeScript types for all exported APIs.
- No `any` — prefer generics and narrow unions.
- Small, composable functions.
- Descriptive error messages and discriminated unions for result types.
- Unit tests for each module (nearby test pattern: `*.test.ts`).
- `pnpm lint && pnpm typecheck && pnpm test` pass before each milestone merge.

### Must Not

- Hardcode secrets, tokens, or credentials.
- Introduce dependencies without clear justification.
- Bundle unrelated refactors.
- Modify existing stable APIs (`ContentParserPlugin`, `InteractionAdapter`, `FetchResponse<T>`) unless explicitly needed.
- Replace `UlixeeProfileManager` or `CaptchaDectector` — extend them.

### Decision Justification Rule

Every major implementation decision must include:

```
Research Justification:
  Which research pattern this implements.
  Why it matters in production.
```

### Failure Mode Prevention Checklist

Before writing any module, verify:

- [ ] Does this implement a known research pattern?
- [ ] Does this reduce a crawler production risk?
- [ ] Does this improve scalability or reliability?
- [ ] Is this reusable across crawling targets?
- [ ] Does this preserve existing abstractions?
