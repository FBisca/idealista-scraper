# Crawlee — Advanced & Future Patterns

## Adaptive Crawlers

### The Adaptation Problem

Static crawler configurations are brittle. A site changes its layout, adds a new anti-bot layer, or modifies its pagination — and the crawler breaks. Adaptive crawlers respond to changes without code modifications.

### Pattern: Dynamic Crawler Type Selection

```
Observation Loop:
  1. Attempt HTTP-only fetch (CheerioCrawler)
  2. If blocked → escalate to browser (PlaywrightCrawler)
  3. If content incomplete → escalate to headed browser
  4. Track success rate per crawler type per domain
  5. Next run → start with the type that worked best last time

State Machine:
  ┌────────────┐  blocked  ┌────────────────┐  blocked  ┌──────────┐
  │ HTTP-only  │──────────►│ Headless browser│──────────►│ Headed   │
  │ (Cheerio)  │           │ (Playwright)    │           │ browser  │
  └────────────┘           └────────────────┘           └──────────┘
        ▲                         ▲                           │
        │    success rate > 95%   │    success rate > 95%     │
        └─────────────────────────┴───────────────────────────┘
                            de-escalate
```

**Design insight**: The key is treating crawler type as a **runtime variable**, not a compile-time choice. Crawlee's architecture supports this because all crawler types share the same `CrawlingContext` interface — handlers can be written once and run on any crawler.

### Pattern: Self-Healing Selectors

```
Problem: CSS selector 'div.price-main > span.value' stops matching.

Adaptive approach:
  1. Primary selector: 'div.price-main > span.value'
  2. Fallback selectors: ['span[data-price]', '.price', '[itemprop=price]']
  3. Semantic matching: find element containing price-like pattern (/[\d,.]+\s*€/)
  4. Log when primary fails and fallback succeeds → alert for selector update

State tracking:
  {
    "selectors": {
      "price": {
        "primary": "div.price-main > span.value",
        "lastWorked": "2024-01-15",
        "fallback": "span[data-price]",
        "fallbackActivated": "2024-01-16"
      }
    }
  }
```

### Pattern: Adaptive Rate Limiting

```
Instead of fixed maxRequestsPerMinute:

  Start at conservative rate (10 req/min)
  │
  ├── All responses healthy → increase rate (+5 req/min)
  │
  ├── Soft signals (slow responses, partial content)
  │   → decrease rate (-10 req/min)
  │
  ├── Hard block (403, CAPTCHA)
  │   → halve rate, pause 30s, rotate session
  │
  └── Converge on optimal rate for this site/time

  Optimal rate varies by:
    - Time of day (lower at peak hours)
    - Day of week (lower on weekdays)
    - Protection aggressiveness (varies by site section)
```

## AI-Guided Crawling

### Pattern: LLM-Assisted Content Extraction

```
Traditional Extraction:
  HTML → CSS selectors → structured data
  Brittle: breaks on layout changes

LLM-Assisted Extraction:
  HTML → LLM prompt → structured data
  Flexible: adapts to layout changes automatically

Hybrid Approach (recommended):
  1. Try CSS selectors first (fast, deterministic, cheap)
  2. If selectors fail → fall back to LLM extraction
  3. Use LLM to discover NEW selectors for failed pages
  4. Human reviews and approves new selectors
  5. Selectors updated → back to step 1
```

**Cost model**:

| Approach                          | Cost per 1K pages | Latency  | Accuracy           |
| --------------------------------- | ----------------- | -------- | ------------------ |
| CSS selectors                     | ~$0.00            | ~1ms     | 99% (when working) |
| LLM extraction (GPT-4o-mini)      | ~$0.50            | ~500ms   | 95%                |
| LLM extraction (GPT-4o)           | ~$5.00            | ~1000ms  | 98%                |
| Hybrid (selectors + LLM fallback) | ~$0.05-0.50       | ~2ms avg | 99%+               |

### Pattern: Intelligent Crawl Prioritization

```
Traditional: Crawl all pages in discovery order.

AI-guided: Score each URL by expected value before crawling.

Scoring factors:
  ├── Content freshness (newer = higher priority)
  ├── Expected data richness (detail pages > list pages)
  ├── URL pattern similarity to high-value pages
  ├── Depth from seed (shallower = higher priority)
  └── Domain authority signals

Priority queue:
  Instead of FIFO: pop highest-score request first
  Effect: Extract the most valuable data earliest
  Benefit: If crawl is interrupted, best data is already collected
```

### Pattern: Schema Discovery

```
Instead of defining schemas manually:

  1. Crawl N sample pages (e.g., 50)
  2. Extract all text content with structural metadata
  3. Feed to LLM: "What structured data is on this page?"
  4. LLM outputs: field names, types, selectors
  5. Human reviews and refines
  6. Generate TypeScript types + parser code
  7. Run crawler with generated parsers

Applicable when:
  - Scraping a new site for the first time
  - Site has changed significantly since last crawl
  - Prototyping what data is available
```

## Cost-Aware Orchestration

### The Cost Model

Every crawl decision has a cost. Optimal orchestration minimizes total cost while meeting data quality requirements.

```
Cost Components:
  ├── Compute
  │    ├── HTTP-only: $0.001 per 1K requests
  │    ├── Headless browser: $0.10 per 1K requests
  │    └── Headed browser: $0.50 per 1K requests
  │
  ├── Proxy
  │    ├── Datacenter: $0.001 per request
  │    ├── Residential: $0.01 per request
  │    └── Mobile: $0.05 per request
  │
  ├── Anti-detection
  │    ├── CAPTCHA solving: $0.002 per solve
  │    └── Session creation: amortized over session lifetime
  │
  └── Opportunity
       ├── Block recovery time
       └── Data staleness
```

### Pattern: Tiered Resource Allocation

```
Tier Assignment:
  ┌────────────────────┬────────────────────┬──────────────┐
  │ Page Type          │ Resource Tier      │ Proxy Tier   │
  ├────────────────────┼────────────────────┼──────────────┤
  │ Sitemaps           │ HTTP-only          │ None         │
  │ List/index pages   │ HTTP-only or Impit │ Datacenter   │
  │ Detail pages       │ Impit or browser   │ Residential  │
  │ Protected pages    │ Browser + Camoufox │ Mobile       │
  │ CAPTCHA pages      │ Headed browser     │ Premium      │
  └────────────────────┴────────────────────┴──────────────┘

  Dynamic tier selection:
    Start at lowest viable tier
    Escalate only on failure
    Track which tier works per URL pattern
    Cache tier decisions for subsequent runs
```

### Pattern: Budget-Bounded Crawling

```
Given: $50 budget for this crawl

Optimizer:
  1. Estimate total pages (from sitemap or list page counts)
  2. Calculate cost per page at each tier
  3. Allocate budget across tiers:
     - 80% of pages via HTTP ($10)
     - 18% of pages via headless browser ($30)
     - 2% of pages via headed browser ($10)
  4. If budget exhausted → stop gracefully, output partial results
  5. Prioritize highest-value pages first (see AI-guided prioritization)
```

## Multi-Modal Crawling

### Pattern: Beyond HTML

Modern websites contain data in formats beyond HTML:

```
Data Modalities:
  ├── HTML → traditional parsing
  ├── JSON (API responses) → direct parsing
  ├── PDF documents → pdf-parse or AI extraction
  ├── Images → OCR, vision models
  ├── Video → frame extraction, transcription
  ├── WebSocket streams → real-time data capture
  └── GraphQL/REST APIs → direct query
```

### Pattern: API Discovery and Direct Access

```
Before crawling HTML:
  1. Open Network tab, browse the site
  2. Identify XHR/Fetch requests to APIs
  3. If API exists and is accessible:
     - Direct API calls are 100x faster than HTML parsing
     - Less likely to be blocked (API tokens vs browser fingerprints)
     - Structured data without parsing
  4. If API requires auth → use session cookies from browser

Crawlee supports this via:
  requestHandler: async ({ sendRequest }) => {
    const { body } = await sendRequest({
      url: 'https://api.site.com/listings',
      headers: { Authorization: `Bearer ${token}` },
      responseType: 'json',
    });
    await pushData(body.items);
  }
```

### Pattern: Visual Regression Testing for Extraction

```
Detect site changes before they break extraction:

  1. Capture screenshots of key page sections
  2. Compare against baseline screenshots
  3. If visual diff > threshold:
     - Alert: "List page layout has changed"
     - Show diff image for human review
     - Optionally: run LLM to suggest new selectors

  Integration point:
    Crawlee's KeyValueStore can persist screenshots
    Per-run comparison against last run's screenshots
```

## Distributed Crawling Patterns

### Pattern: Work Stealing

```
Multiple processes sharing a request queue:

  Process A: [assigned: 100 requests, completed: 95, remaining: 5]
  Process B: [assigned: 100 requests, completed: 30, remaining: 70]

  Work stealing:
    Process A finishes early
    Process A "steals" 35 requests from Process B's queue
    Both processes finish at roughly the same time

  Implementation:
    RequestQueueV2 with lock-based request assignment
    Short lock timeouts (30s)
    If a process dies, its locked requests expire and are re-assigned
```

### Pattern: Geographic Distribution

```
For sites with geo-based content or rate limiting:

  ┌──────────────────────────────────────┐
  │ Coordinator                          │
  │  ├── EU region worker → EU content   │
  │  ├── US region worker → US content   │
  │  └── APAC region worker → APAC content│
  └──────────────────────────────────────┘

  Benefits:
    - Lower latency (closer to target servers)
    - Different IP reputation per region
    - Geo-locked content accessible
    - Rate limits applied per region
```

## The Evolution Path for This Repository

```
Current State:
  Single-site (idealista.com)
  Single-engine (Ulixee Hero)
  Single-machine
  Sequential list + parallel detail

Near-Term Evolution (from 09_recommendations):
  + Progressive persistence
  + Resumable crawls
  + Session health tracking
  + Rate limiting

Medium-Term Evolution:
  + HTTP-first with browser fallback (hybrid pipeline)
  + Engine pool for connection reuse
  + Structured metrics and error snapshots
  + Adaptive rate limiting

Long-Term Evolution (if needed):
  + Multi-site support (plugin-per-site architecture)
  + LLM-assisted extraction fallback
  + Cost-aware orchestration
  + Distributed crawling across machines

Decision Point:
  At some scale, it may make more sense to migrate to Crawlee
  rather than reimplement its infrastructure. The migration path
  from this repo's parser plugin system → Crawlee's Router is
  relatively clean (see 08_ulixee_pattern_mapping.md).
```

The key principle: **Build only what you need today, but architect so tomorrow's needs don't require a rewrite.** The parser plugin system, interaction adapter, and typed error model are investments that pay off regardless of which direction the infrastructure evolves.
