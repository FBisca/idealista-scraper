# Crawlee — Data Pipeline Patterns

## The Storage Model Philosophy

Crawlee treats storage as a **first-class primitive**, not an afterthought. Storage operations are part of the crawling lifecycle — they participate in error handling, state management, and crash recovery. This is a fundamental departure from "crawl first, save later" approaches.

## Core Storage Abstractions

### Dataset — Append-Only Result Store

```
Dataset Architecture:
┌─────────────────────────────────────┐
│ Dataset                             │
│  ├── pushData(item)     → append    │
│  ├── pushData(items[])  → batch     │
│  ├── getData()          → paginated │
│  ├── exportToCSV()      → export    │
│  ├── exportToJSON()     → export    │
│  └── drop()             → cleanup   │
│                                     │
│  Storage: ./storage/datasets/default│
│  Format: per-item JSON files        │
│  Naming: {sequenceId}.json          │
└─────────────────────────────────────┘
```

**Design decision — append-only**: Datasets are intentionally append-only. You cannot update or delete individual items. This prevents:

- Partial update corruption during crashes.
- Race conditions in concurrent crawlers.
- Complex conflict resolution logic.

If you need to update data, treat the dataset as an **immutable event log** and post-process downstream.

### KeyValueStore — Named Blob Storage

```
KeyValueStore Architecture:
┌─────────────────────────────────────┐
│ KeyValueStore                       │
│  ├── getValue(key)                  │
│  ├── setValue(key, value, options?)  │
│  │   options.contentType → MIME     │
│  ├── getAutoSavedValue(key)         │
│  └── drop()                         │
│                                     │
│  Storage: ./storage/key_value_stores│
│  Format: any (JSON, HTML, Buffer)   │
│  Naming: {key}.{ext}               │
└─────────────────────────────────────┘
```

**Use cases**:

- Storing page HTML snapshots for debugging.
- Configuration/state that persists across runs.
- Screenshots (PNG/JPEG).
- Intermediate computation results.
- Migration checkpoints.

### RequestQueue — Persistent Work Queue

The RequestQueue is both a scheduling mechanism and a storage abstraction:

```
RequestQueue as Persistent Work Queue:
┌──────────────────────────────────────────────┐
│ RequestQueue                                 │
│                                              │
│  Pending: [req4, req5, req6]                │
│  In-progress: [req3]                        │
│  Handled: [req1, req2]                      │
│                                              │
│  Crash Recovery:                             │
│    On restart → in-progress items            │
│    move back to pending                      │
│                                              │
│  Deduplication:                              │
│    uniqueKey = normalize(url)                │
│    duplicate requests silently dropped       │
│                                              │
│  Storage: ./storage/request_queues/default   │
└──────────────────────────────────────────────┘
```

## Streaming vs Batch: Crawlee's Real-Time Pipeline

Crawlee uses a **streaming architecture**. Data flows through the system item-by-item:

```
Request         Handler         Dataset
Queue      →   Execution   →   Push
  │               │               │
  ▼               ▼               ▼
pick one    process & extract   write immediately
  │               │               │
  ▼               ▼               ▼
pick next   process & extract   write immediately
  ...             ...             ...
```

This is fundamentally different from batch architectures:

| Aspect              | Streaming (Crawlee)   | Batch               |
| ------------------- | --------------------- | ------------------- |
| Data persistence    | Immediate             | After all pages     |
| Memory footprint    | O(1) per item         | O(n) all items      |
| Crash data loss     | Current item only     | All items           |
| Progress visibility | Per-item              | None until complete |
| Backpressure        | Natural (queue-based) | Manual              |

### The Implicit Pipeline

Crawlee's `requestHandler` is actually a **micro-pipeline stage**:

```typescript
requestHandler: async ({ request, $, pushData, enqueueLinks }) => {
  // Stage 1: Extract — pull data from page
  const title = $('h1').text();
  const price = $('span.price').text();

  // Stage 2: Transform — clean/normalize
  const cleanPrice = parsePrice(price);

  // Stage 3: Load — persist result
  await pushData({ url: request.url, title, price: cleanPrice });

  // Stage 4: Discover — feed next stage
  await enqueueLinks({ selector: 'a.next-page' });
};
```

Each handler invocation is a complete ETL cycle for one URL. This micro-pipeline design means:

- Failures are isolated to individual URLs.
- Retries replay the full ETL cycle.
- No intermediate state to manage between stages.

## Failure Recovery Patterns

### Crash Recovery via Persistent State

```
Normal Run:
  Queue: [A, B, C, D, E]
  Process A → save result → mark handled
  Process B → save result → mark handled
  Process C → CRASH

Restart:
  Queue state loaded from disk
  Handled: [A, B]          → skip
  In-progress: [C]         → retry (moved back to pending)
  Pending: [D, E]          → process normally

  Result: No data loss, no duplicate work for A and B
```

### Error Categorization

```
Error in requestHandler:
  │
  ├── Retriable (default: maxRetries = 3)
  │    Request re-enqueued with incremented retryCount
  │    Session rotated (new IP/identity)
  │    Exponential delay applied
  │
  └── Non-retriable (after maxRetries exhausted)
       Request logged to failedRequestHandler
       Error snapshot saved to KeyValueStore
       Crawl continues (does not abort)
```

### Error Snapshots

When a request fails, Crawlee optionally captures:

- HTML content of the page at failure time.
- Screenshot (for browser crawlers).
- Request/response headers.
- Error stack trace.

These are stored in the KeyValueStore for post-mortem analysis.

## Idempotency in Crawling

### URL Deduplication

RequestQueue provides built-in URL deduplication via `uniqueKey`:

```
addRequest({ url: 'https://site.com/page?a=1&b=2' })
  → uniqueKey: 'https://site.com/page?a=1&b=2' (normalized)

addRequest({ url: 'https://site.com/page?b=2&a=1' })
  → same uniqueKey (query params sorted) → SKIPPED
```

Normalization includes:

- Protocol normalization (http → https optional).
- Query parameter sorting.
- Fragment removal.
- Trailing slash normalization.

### Cross-Run Idempotency

When `purgeOnStart: false`:

- Previously handled requests are not re-processed.
- The queue picks up exactly where the last run stopped.
- Results already in the Dataset are preserved.

This makes crawls **resumable by default**.

## Data Quality Patterns

### Validation at Extraction Point

Best practice in Crawlee is to validate data inside the handler:

```typescript
requestHandler: async ({ request, $, pushData, log }) => {
  const price = $('span.price').text();

  if (!price) {
    log.warning('Missing price', { url: request.url });
    // Option A: skip this item
    return;
    // Option B: throw to trigger retry
    // throw new Error('Missing price — page may not have loaded');
  }

  await pushData({ url: request.url, price: parseFloat(price) });
};
```

### Schema Enforcement

Crawlee doesn't enforce schemas on Dataset items, but the pattern is:

```typescript
interface PropertyListing {
  url: string;
  title: string;
  price: number;
  currency: string;
}

// TypeScript ensures type safety at pushData
await crawler.pushData<PropertyListing>({
  url: request.url,
  title,
  price: cleanPrice,
  currency: 'EUR',
});
```

## Scaling Data Pipelines

### The Funnel Pattern

Real-world crawling pipelines narrow as they progress:

```
Stage 1: Search/List pages
  1,000 pages → extract 50,000 URLs
           ↓
Stage 2: Detail pages
  50,000 pages → extract structured data
           ↓
Stage 3: Enrichment (optional)
  50,000 records → API lookups, geocoding
           ↓
Stage 4: Export
  50,000 records → CSV, database, API
```

Each stage can be a separate crawler with its own Dataset/RequestQueue:

```typescript
// Stage 1: List crawler
const listCrawler = new CheerioCrawler({
  requestHandler: async ({ $, enqueueLinks }) => {
    const urls = $('a.listing')
      .map((_, el) => $(el).attr('href'))
      .get();
    // Write URLs to a dataset for Stage 2
    await Dataset.pushData(urls.map((url) => ({ url })));
  },
});

// Stage 2: Detail crawler — reads from Stage 1's output
const listResults = await Dataset.getData();
const detailCrawler = new PlaywrightCrawler({
  requestHandler: async ({ page }) => {
    // Extract detailed data
  },
});
await detailCrawler.run(listResults.items.map((item) => item.url));
```

### Multi-Dataset Isolation

Named datasets for different data types:

```typescript
const listingsDataset = await Dataset.open('listings');
const errorsDataset = await Dataset.open('errors');
const metricsDataset = await Dataset.open('metrics');

// In handler:
await listingsDataset.pushData(listing);
await metricsDataset.pushData({ url, duration, status: 200 });
```

This prevents mixing result data with operational data.

## The Data Pipeline Mental Model

```
Input:           Processing:          Output:
┌──────────┐    ┌────────────────┐   ┌──────────┐
│ Request  │───►│ RequestHandler │───►│ Dataset  │
│ Queue    │    │                │    │ (results)│
│          │    │  extract()     │    └──────────┘
│ Persistent│   │  transform()  │   ┌──────────┐
│ Ordered   │   │  validate()   │───►│ Request  │
│ Deduped   │   │  enqueue()    │    │ Queue    │
└──────────┘    │  pushData()   │    │ (more    │
                └────────────────┘    │ work)    │
                                     └──────────┘
                Error handling:
                ┌──────────────────┐
                │ Retry → Queue    │
                │ Fail → KV Store  │
                │ Skip → Log       │
                └──────────────────┘
```

Key takeaway: The data pipeline is not a separate system — it's woven into the crawl lifecycle. Every handler invocation is a complete pipeline stage. Persistence is immediate, recovery is automatic, and idempotency is structural.
