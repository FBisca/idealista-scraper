# Crawlee — Conceptual Overview

## What Crawlee Is

Crawlee is an opinionated, batteries-included crawling and scraping framework for Node.js, built and maintained by Apify. It is **not** a browser automation library — it is an **orchestration layer** that sits on top of browser automation (Playwright, Puppeteer) and HTTP clients (got-scraping, Impit) and solves the engineering problems that appear **between** making a request and getting clean data out.

Core identity: **a request lifecycle manager with built-in resilience, storage, and anti-detection**.

## Where It Fits in the Crawler Ecosystem

```
┌────────────────────────────────────────────────────────┐
│  Orchestration / Platform       Apify Platform         │
├────────────────────────────────────────────────────────┤
│  Framework Layer                Crawlee                │
│  (lifecycle, queue, storage,    ← THIS LAYER           │
│   scaling, sessions, retries)                          │
├────────────────────────────────────────────────────────┤
│  Execution Layer                Playwright / Puppeteer  │
│                                 got-scraping / Impit    │
│                                 Cheerio / JSDOM         │
├────────────────────────────────────────────────────────┤
│  Transport                      HTTP/1.1, HTTP/2, H3   │
│                                 WebSocket, TLS          │
└────────────────────────────────────────────────────────┘
```

Crawlee competes with Scrapy (Python), Colly (Go), and bespoke Node.js scraping setups. Its differentiator is that it treats **HTTP scraping and browser scraping as interchangeable strategies** behind a unified API, and it ships production concerns (retries, sessions, proxies, storage, concurrency) as first-class primitives rather than plugins.

## Design Philosophy

### 1. Two Questions, Everything Else Is Default

Crawlee reduces crawler setup to two decisions:

- **Where** — the URL(s) to visit (`Request` / `RequestQueue`)
- **What** — what to do at each page (`requestHandler`)

Everything else — queue management, concurrency, retries, storage, error handling — has sensible defaults. This philosophy forces the framework to internalize complexity rather than exposing it.

### 2. Crawler-Type Polymorphism

The same `requestHandler` pattern works across `CheerioCrawler`, `PlaywrightCrawler`, and `PuppeteerCrawler`. The difference is the `CrawlingContext` shape injected into the handler. This allows **strategy swaps** (HTTP → browser) without rewriting business logic.

### 3. Anti-Detection as Infrastructure, Not Afterthought

Session pools, proxy rotation, fingerprint generation, TLS mimicry — these are wired into the framework defaults, not bolted on. The assumption: if you need a crawler, you probably need anti-detection.

### 4. Storage as a Primitive

Data persistence (`Dataset.pushData()`) and request state (`RequestQueue`) are first-class abstractions with swappable backends (local filesystem, Apify cloud). This decouples crawling logic from I/O concerns.

### 5. Scale Through Autoscaling, Not Configuration

Instead of requiring users to pick a concurrency number, Crawlee autoscales based on system resource utilization (CPU, memory). The user sets bounds (`minConcurrency`, `maxConcurrency`); the framework finds the optimal operating point.

## Key Differentiators vs Other Frameworks

| Dimension                    | Crawlee               | Scrapy                        | Bespoke Node.js |
| ---------------------------- | --------------------- | ----------------------------- | --------------- |
| HTTP + Browser unified API   | Yes                   | No (Splash/Playwright plugin) | No              |
| Built-in autoscaling         | Yes (resource-aware)  | Limited (CONCURRENT_REQUESTS) | Manual          |
| Session/proxy management     | First-class           | Middleware-based              | Custom          |
| TLS fingerprinting           | Impit (native binary) | No                            | Manual          |
| Request queue persistence    | Built-in (resumable)  | Built-in                      | Custom          |
| Dataset abstraction          | Built-in              | Item pipelines                | Custom          |
| Browser fingerprinting       | Automatic             | N/A                           | Manual          |
| Retry with session awareness | Built-in              | Middleware                    | Custom          |

## What Crawlee Intentionally Does Not Solve

1. **Distributed crawling across machines** — parallelization guide uses `child_process.fork()` on a single machine. True distributed crawling is delegated to the Apify Platform.
2. **Data transformation pipelines** — `Dataset.pushData()` is append-only; ETL is out of scope.
3. **Browser farm management** — it creates/destroys browser instances per request or session, but does not pool long-lived browsers.
4. **CAPTCHA solving** — it detects and rotates around blocks, but does not integrate CAPTCHA-solving services.
5. **Rate limiting negotiation** — it provides `maxRequestsPerMinute` but does not adaptively learn rate limits from server responses.

## Infrastructure Assumptions

- **Single-machine deployment** for the open-source version. Horizontal scaling requires external orchestration (Apify, Kubernetes, etc.).
- **Node.js ≥ 16** with ESM support.
- **Filesystem-based storage** by default. Cloud storage via Apify SDK adapters.
- **Ephemeral browser instances** — browsers are launched and destroyed frequently, not kept warm.

## Scale Tier

Crawlee is designed for **startup to mid-scale** crawling:

- Single-machine: tens of thousands to low millions of pages per run.
- With Apify Platform: mid-scale distributed crawling.
- Not designed for hyperscale (billions of pages) — that requires custom infrastructure (e.g., purpose-built C++ crawlers, distributed URL frontier servers).

## Engineering Values Crawlee Optimizes For

1. **Developer velocity** — get a working crawler in minutes, production-harden it incrementally.
2. **Resilience over throughput** — retry, session rotation, and state persistence are privileged over raw speed.
3. **Composability** — swappable crawlers, HTTP clients, storage backends, proxy providers.
4. **Observability** — structured logging with autoscaler state reporting at configurable intervals.
5. **Correctness** — prefer crashing on ambiguous selectors over silently returning bad data (documented design choice in the scraping guide).
