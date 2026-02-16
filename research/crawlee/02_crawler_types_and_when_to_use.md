# Crawlee — Crawler Types and When to Use Each

## The Three Execution Models

Crawlee provides three crawler classes that differ in **how they fetch and parse content**, but share the same lifecycle, queue, storage, and handler infrastructure. The choice between them is the single most impactful architectural decision in a Crawlee project.

```
                     ┌───────────────┐
                     │ BasicCrawler  │  (abstract base)
                     └───────┬───────┘
                             │
            ┌────────────────┼────────────────┐
            │                │                │
   ┌────────▼───────┐ ┌─────▼──────┐ ┌───────▼────────┐
   │ CheerioCrawler │ │ Puppeteer  │ │ Playwright     │
   │ (HTTP + parse) │ │ Crawler    │ │ Crawler        │
   └────────────────┘ └────────────┘ └────────────────┘
```

## Model 1: CheerioCrawler — HTTP-Only

### How It Works

1. Makes a raw HTTP request using the configured HTTP client (got-scraping or Impit).
2. Receives the HTML response.
3. Parses it with Cheerio (jQuery-like DOM API for Node.js).
4. Passes `$` (Cheerio object) to the handler.

No browser is launched. No JavaScript is executed. No network waterfall. No rendering.

### Performance Profile

| Metric                      | Typical Value     |
| --------------------------- | ----------------- |
| Memory per request          | ~1-5 MB           |
| Throughput (4GB RAM, 1 CPU) | 500+ pages/minute |
| Startup latency             | Near zero         |
| Cost per 1K pages           | Very low          |

### When to Use

- **Server-side rendered (SSR) sites** — content is in the initial HTML response.
- **API scraping** — REST/GraphQL endpoints that return JSON.
- **High-volume crawls** — millions of pages where browser overhead is unacceptable.
- **Sites without JavaScript-dependent content** — static HTML, traditional web apps.
- **Price-sensitive deployments** — Cheerio uses 10-100x less memory than a browser.

### When NOT to Use

- **SPA / client-side rendering** — React, Angular, Vue apps that render content via JavaScript.
- **Sites requiring interaction** — infinite scroll, button clicks, form submissions.
- **Heavy anti-bot protection** — Cloudflare, DataDome, PerimeterX that require browser execution.

### Tradeoff Analysis

```
Advantages:
  + Extremely fast and cheap
  + Low memory footprint → high concurrency
  + Simple dependency tree (no browser binaries)
  + TLS fingerprinting via Impit partially mitigates detection

Risks:
  - Missing JS-rendered content → incomplete data
  - TLS/HTTP fingerprint detection (mitigated by Impit)
  - No cookie-based session maintenance across redirects with JS
  - Cannot handle CAPTCHA challenges that require browser interaction
```

## Model 2: PlaywrightCrawler / PuppeteerCrawler — Full Browser

### How It Works

1. Launches a browser instance (Chromium, Firefox, WebKit via Playwright; Chrome/Chromium via Puppeteer).
2. Navigates to the URL.
3. Waits for network idle / DOM stability.
4. Passes the `page` object (Playwright's Page or Puppeteer's Page) to the handler.
5. Closes the page/context after handler completes.

### Performance Profile

| Metric                      | Typical Value                |
| --------------------------- | ---------------------------- |
| Memory per page             | 50-300 MB                    |
| Throughput (4GB RAM, 1 CPU) | 5-20 pages/minute            |
| Startup latency             | 1-5 seconds (browser launch) |
| Cost per 1K pages           | 10-50x CheerioCrawler        |

### When to Use

- **JavaScript-heavy sites** — SPAs, dynamically loaded content.
- **Sites requiring interaction** — clicking "Load More", scrolling, filling forms.
- **Anti-bot protected sites** — when detection relies on browser fingerprint validation.
- **Visual scraping** — screenshot capture, PDF generation.
- **Sites that serve different content to headless vs. headed browsers**.

### When NOT to Use

- **High-volume crawls** — browser overhead makes millions-of-pages crawls extremely expensive.
- **Simple API endpoints** — wasteful to launch a browser for a JSON HTTP response.
- **Environments without browser binaries** — some CI/CD or serverless environments lack browser support.

### Playwright vs Puppeteer

| Dimension             | PlaywrightCrawler            | PuppeteerCrawler                 |
| --------------------- | ---------------------------- | -------------------------------- |
| Browser support       | Chromium, Firefox, WebKit    | Chromium only                    |
| API maturity          | Modern, well-maintained      | Stable but less actively evolved |
| Stealth capabilities  | Better fingerprint diversity | Good with stealth plugins        |
| Crawlee integration   | Recommended default          | Legacy support                   |
| Multi-browser testing | Built-in                     | Requires extra setup             |

**Crawlee's recommendation**: Use `PlaywrightCrawler` unless you have a specific reason to use Puppeteer.

## Model 3: Hybrid Crawling — The Production Pattern

### The Problem with Single-Model Crawlers

Real-world scraping targets typically have mixed page types:

- **List/search pages**: often SSR, many per crawl → benefit from HTTP speed.
- **Detail pages**: may require JS rendering, fewer per crawl → browser acceptable.
- **API endpoints**: pure HTTP, JSON responses → browser is wasteful.

### Hybrid Strategy: Route by Page Type

The production pattern is to use the cheapest viable execution model per page type:

```
Page Type Assessment:
  ┌─────────────────────┐
  │  Does page need JS? │
  └──────┬──────────────┘
         │
    No ──┤── Yes ─────────────┐
         │                    │
         ▼                    ▼
  Use CheerioCrawler    ┌────────────────┐
  or HTTP client        │ Can headless   │
                        │ browser work?  │
                        └──┬─────────────┘
                           │
                      No ──┤── Yes
                           │     │
                           ▼     ▼
                     Use headed    Use headless
                     browser       browser
```

### Implementation Patterns

**Pattern 1: Two-phase crawl (recommended by Crawlee parallel scraping guide)**

1. Phase 1: CheerioCrawler for list pages → enqueue detail URLs to shared queue.
2. Phase 2: PlaywrightCrawler (or workers) consume detail URLs from the same queue.

**Pattern 2: Adaptive within single crawler**
Use `PlaywrightCrawler` with pre-navigation hook that checks request label and skips browser rendering for HTTP-only routes.

**Pattern 3: Cascading fallback**
Start with CheerioCrawler. If response validation detects JS-dependent content, re-enqueue the URL with a `needsBrowser: true` flag for a PlaywrightCrawler instance.

## Decision Framework

```
                    ┌──────────────────────────────┐
                    │     START: New crawl target   │
                    └──────────────┬────────────────┘
                                   │
                    ┌──────────────▼────────────────┐
                    │  Does curl/wget return the    │
                    │  same content as browser?      │
                    └──────────────┬────────────────┘
                          Yes ─────┤───── No
                                   │       │
                    ┌──────────────▼──┐   ┌▼──────────────────┐
                    │ CheerioCrawler  │   │ Does the site have │
                    │ (with Impit for │   │ anti-bot that      │
                    │  TLS stealth)   │   │ blocks headless?    │
                    └─────────────────┘   └────────┬───────────┘
                                            No ────┤──── Yes
                                                   │      │
                                    ┌──────────────▼┐   ┌▼──────────────┐
                                    │ Headless       │   │ Headed browser │
                                    │ Playwright     │   │ with Camoufox  │
                                    │ Crawler        │   │ or fingerprint │
                                    └────────────────┘   │ rotation       │
                                                         └────────────────┘
```

## Cost Model

For a crawl of 100,000 pages on a 4-core / 8GB machine:

| Strategy                         | Est. Time  | Est. Peak Memory | Cost Signal |
| -------------------------------- | ---------- | ---------------- | ----------- |
| All CheerioCrawler               | ~3-4 hours | ~500 MB          | $           |
| All PlaywrightCrawler (headless) | ~2-5 days  | ~4-6 GB          | $$$$        |
| Hybrid (90% HTTP + 10% browser)  | ~5-8 hours | ~2 GB            | $$          |

The hybrid approach typically delivers 5-10x cost reduction over all-browser crawls while maintaining data completeness.

## Hidden Assumption: The HTTP-First Principle

Crawlee's documentation consistently recommends starting with `CheerioCrawler` and escalating to browser crawlers only when needed. This reflects a fundamental engineering principle:

> Use the cheapest execution model that produces correct data.

This principle should guide all crawler architecture decisions, including in non-Crawlee frameworks like Ulixee Hero.
