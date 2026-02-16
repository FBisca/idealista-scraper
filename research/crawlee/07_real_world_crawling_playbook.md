# Crawlee — Real-World Crawling Playbook

## Crawl Planning Methodology

### Phase 0: Site Analysis

Before writing any code, analyze the target site systematically:

```
Site Analysis Checklist:
┌───────────────────────────────────────────────────────────┐
│ 1. Protection Level Assessment                            │
│    ├── Check for Cloudflare/Akamai (DNS, headers, JS)    │
│    ├── Check for DataDome/PerimeterX (script tags)       │
│    ├── Test with curl (baseline detection)               │
│    ├── Test with headless browser (elevated detection)   │
│    └── Check robots.txt and rate limit headers            │
│                                                           │
│ 2. Content Rendering Analysis                            │
│    ├── View source vs rendered DOM                        │
│    │    Is critical data in initial HTML or JS-rendered?  │
│    ├── Check for API calls in Network tab                │
│    │    Can you call APIs directly?                       │
│    └── Check for SSR/hydration patterns                  │
│         Data in __NEXT_DATA__ or similar?                │
│                                                           │
│ 3. URL Structure Mapping                                 │
│    ├── List page URL patterns                            │
│    ├── Detail page URL patterns                          │
│    ├── Pagination mechanism (offset, cursor, infinite)   │
│    ├── Filter/sort URL parameters                        │
│    └── URL normalization requirements                    │
│                                                           │
│ 4. Data Schema Discovery                                 │
│    ├── Identify all extractable fields                   │
│    ├── Which fields are always present vs optional?      │
│    ├── Data format variations (dates, prices, addresses) │
│    └── Linked data (images, documents, related items)    │
│                                                           │
│ 5. Scale Estimation                                      │
│    ├── Total pages to crawl                              │
│    ├── Rate limit constraints                            │
│    ├── Data volume (KB per page × pages)                 │
│    └── Time budget                                       │
└───────────────────────────────────────────────────────────┘
```

### Phase 1: Prototype

```
Build the minimum viable crawler:
  1. Single list page → extract structure
  2. Single detail page → extract all fields
  3. Validate extraction against multiple pages
  4. Identify edge cases (missing fields, different layouts)
```

The prototype phase answers: **Can we extract this data reliably?** It does not address scale, anti-blocking, or robustness.

### Phase 2: Hardening

```
Make the crawler production-ready:
  1. Anti-blocking configuration
  2. Error handling (retry logic, failure classification)
  3. Data validation
  4. Monitoring and logging
  5. Resume/recovery support
```

### Phase 3: Scaling

```
Run at target scale:
  1. Concurrency tuning
  2. Proxy tier selection
  3. Rate limit calibration
  4. Resource monitoring
```

## Pagination Strategies

### Offset-Based Pagination

```
Pattern: /listings?page=1, /listings?page=2, ...

Crawlee approach:
  requestHandler: async ({ $, enqueueLinks, request }) => {
    // Extract items on this page
    const items = extractItems($);
    await pushData(items);

    // Enqueue next page if exists
    const nextLink = $('a.next-page').attr('href');
    if (nextLink) {
      await enqueueLinks({ urls: [nextLink] });
    }
  }
```

**Pitfalls**:

- Pages can shift during crawling (new items added between page loads).
- Solution: crawl backwards (last page first) or use deduplication.

### Cursor-Based Pagination

```
Pattern: /api/listings?cursor=abc123&limit=50

Crawlee approach:
  requestHandler: async ({ json, request }) => {
    const { items, nextCursor } = json;
    await pushData(items);

    if (nextCursor) {
      await crawler.addRequests([{
        url: `https://site.com/api/listings?cursor=${nextCursor}&limit=50`,
        uniqueKey: `cursor-${nextCursor}`,
      }]);
    }
  }
```

**Advantage**: No duplicates or gaps. Each cursor points to an immutable position.

### Infinite Scroll

```
Pattern: Content loads on scroll, no URL change.

Requires browser crawler:
  requestHandler: async ({ page, infiniteScroll }) => {
    await infiniteScroll({
      maxScrolls: 100,
      waitForSelectorTimeout: 5000,
    });
    // All items now in DOM
    const items = await page.$$eval('.item', extractAll);
    await pushData(items);
  }
```

### Search-Based Pagination

When a site has no list browsing but has search:

```
Pattern: Enumerate search space to discover all items.

Strategy:
  1. Identify search dimensions (location, category, price range)
  2. Generate search queries that cover the entire space
  3. Check result counts — if any query returns max results,
     subdivide that search space further

  Example for real estate:
    Search by city → if > 1000 results, search by district
    Search by district → if > 1000 results, search by price range
```

## Crawl Completeness Validation

### Completeness Checks

```
Check 1: Expected vs Actual Count
  If the site shows "50,000 results" but you extracted 45,000
  → 10% missing, investigate gaps

Check 2: Pagination Continuity
  Verify page N's last item connects to page N+1's first item
  No gaps in sequence

Check 3: Distribution Analysis
  Plot extraction counts over time/geography/category
  Anomalies indicate blocked or missed segments

Check 4: Sample Verification
  Randomly sample 100 URLs from site
  Verify each appears in crawl results
  Missing URLs indicate systematic gaps
```

### The "Dark Pages" Problem

Some pages are not discoverable through normal navigation:

- Items not in any list (removed from index but URL still works).
- Pages behind search-only access.
- Pages requiring specific cookie/session state.
- Time-limited pages.

**Mitigation**: Use multiple discovery methods:

1. List page crawling (primary).
2. Sitemap parsing (supplementary).
3. Search enumeration (supplementary).
4. Historical URL database (if available).

## Data Quality Assurance

### Extraction Validation Patterns

```
Level 1: Presence Check
  Is the field present? (not null, not empty)

Level 2: Format Check
  Does the field match expected format? (price is number, URL is valid)

Level 3: Range Check
  Is the value within expected bounds? (price > 0, date not in future)

Level 4: Cross-Field Consistency
  Do related fields agree? (currency matches locale, area > 0 if rooms > 0)

Level 5: Cross-Run Consistency
  Has this item's data changed unexpectedly vs last crawl?
```

### The "Partial Page" Problem

Anti-bot systems sometimes return **partial pages** — the HTML structure is correct but some data is missing or replaced with placeholders. These are designed to fool basic crawlers that only check HTTP status codes.

**Detection strategies**:

- Check for minimum field count per item.
- Verify CSS class names match expected structure.
- Compare extraction count against historical baseline.
- Monitor for sudden drops in extracted field population.

## Crawl Architecture Patterns

### Pattern 1: Two-Phase Crawl (List → Detail)

```
Phase 1: List Crawling
  CheerioCrawler (HTTP-only, fast)
  Goal: Collect all item URLs
  Output: RequestQueue for Phase 2

Phase 2: Detail Crawling
  PlaywrightCrawler or CheerioCrawler (depends on site)
  Goal: Extract full data for each item
  Output: Dataset with structured data
```

This is the pattern used by this repository's `crawl.ts` action.

### Pattern 2: Incremental Crawl

```
Initial crawl: Full site crawl → save all data + URL manifest
Subsequent crawls:
  1. Crawl list pages only → compare against manifest
  2. New URLs → add to detail queue
  3. Missing URLs → mark as removed
  4. Changed URLs → re-crawl for updates
```

### Pattern 3: Monitoring Crawl

```
Continuous operation:
  Every N hours:
    1. Crawl known list pages
    2. Compare against last snapshot
    3. Alert on: new items, removed items, price changes
    4. Update snapshot
```

### Pattern 4: Distributed Crawl

```
Multiple workers sharing one RequestQueue (RequestQueueV2):
  Worker 1 ──┐
  Worker 2 ──┤──► RequestQueue ──► Dataset
  Worker 3 ──┘

  Each worker:
    1. Lock N requests from queue
    2. Process locked requests
    3. Mark as handled or re-enqueue
    4. Repeat
```

## Operational Runbook

### Pre-Crawl Checklist

1. **Proxy health**: Verify proxy pool is working (test 10 random proxies).
2. **Storage space**: Ensure sufficient disk for expected data volume.
3. **Rate limit config**: Set `maxRequestsPerMinute` based on site tolerance.
4. **Error thresholds**: Configure `maxRequestRetries` and monitoring alerts.
5. **Resume state**: Decide whether to purge previous state or resume.

### During-Crawl Monitoring

```
Key Metrics:
  ├── Requests/minute (actual vs target)
  ├── Success rate (should be >95%)
  ├── Session retirement rate (high = proxy quality issue)
  ├── Memory usage (should be stable, not growing)
  ├── CPU usage (should be <80% sustained)
  └── Queue depth (should be decreasing)

Alert Triggers:
  ├── Success rate < 90% for 5 minutes
  ├── Session retirement rate > 50% (proxies burned)
  ├── Memory growing unbounded (leak)
  └── Queue depth plateauing (stall)
```

### Post-Crawl Validation

1. **Row count**: Does extracted count match expected?
2. **Field completeness**: What % of items have all required fields?
3. **Duplicate check**: Any duplicate entries?
4. **Format consistency**: All dates same format? All prices same currency?
5. **Sample spot-check**: Manually verify 10 random items against source.
