# Crawlee — Scaling Patterns

## Concurrency vs Parallelism — The Distinction That Matters

Crawlee makes a clear architectural distinction between two scaling dimensions:

**Concurrency**: Multiple async tasks within a single Node.js process. Bounded by event loop capacity, memory, CPU. Crawlee manages this via `AutoscaledPool`.

**Parallelism**: Multiple Node.js processes (or machines) consuming from a shared queue. Crawlee provides this via `RequestQueueV2` with request locking.

```
Single Process (Concurrency):
  ┌─────────────────────────────────┐
  │  Node.js Process                │
  │  ┌───┐ ┌───┐ ┌───┐ ┌───┐      │
  │  │ T1│ │ T2│ │ T3│ │ T4│      │  4 concurrent tasks
  │  └───┘ └───┘ └───┘ └───┘      │
  │         AutoscaledPool          │
  └──────────────┬──────────────────┘
                 │
          ┌──────▼──────┐
          │ RequestQueue│
          └─────────────┘

Multiple Processes (Parallelism):
  ┌────────────┐ ┌────────────┐ ┌────────────┐
  │ Process 0  │ │ Process 1  │ │ Process 2  │
  │ ┌──┐ ┌──┐ │ │ ┌──┐ ┌──┐ │ │ ┌──┐ ┌──┐ │
  │ │T1│ │T2│ │ │ │T1│ │T2│ │ │ │T1│ │T2│ │
  │ └──┘ └──┘ │ │ └──┘ └──┘ │ │ └──┘ └──┘ │
  └──────┬─────┘ └──────┬─────┘ └──────┬─────┘
         │              │              │
         └──────────────┼──────────────┘
                        │
               ┌────────▼─────────┐
               │ RequestQueueV2   │
               │ (with locking)   │
               └──────────────────┘
```

## AutoscaledPool — Resource-Aware Concurrency

### The Autoscaling Algorithm

The AutoscaledPool is a feedback controller that adjusts concurrency based on system resource utilization:

```
┌──────────────────────────────────────────────────┐
│                                                  │
│  every autoscaleIntervalSecs (10s):              │
│                                                  │
│  1. measure = snapshot(CPU%, MEM%)               │
│  2. if measure < target_ratio(0.95):             │
│       desired += desired * scaleUpStepRatio      │
│  3. if measure > target_ratio:                   │
│       desired -= desired * scaleDownStepRatio    │
│  4. desired = clamp(min, desired, max)           │
│                                                  │
│  every maybeRunIntervalSecs (0.5s):              │
│  5. if running_tasks < desired && queue.hasNext: │
│       start_new_task()                           │
│                                                  │
└──────────────────────────────────────────────────┘
```

### Key Configuration Parameters

| Parameter                 | Default          | Effect                                                                       |
| ------------------------- | ---------------- | ---------------------------------------------------------------------------- |
| `minConcurrency`          | 1                | Floor for concurrent tasks. Setting too high wastes resources on fast sites. |
| `maxConcurrency`          | 200              | Ceiling. Browser crawlers should use 5-20. HTTP crawlers can go higher.      |
| `desiredConcurrency`      | = minConcurrency | Starting point before autoscaling kicks in.                                  |
| `desiredConcurrencyRatio` | 0.95             | System load ratio that triggers scaling decisions.                           |
| `scaleUpStepRatio`        | 0.05             | Fraction of desired concurrency to add when scaling up.                      |
| `scaleDownStepRatio`      | 0.05             | Fraction to subtract when scaling down.                                      |
| `autoscaleIntervalSecs`   | 10               | How often the controller evaluates. 5-20s recommended.                       |
| `maybeRunIntervalSecs`    | 0.5              | How often new tasks are started when slots are available.                    |
| `maxRequestsPerMinute`    | Infinity         | Hard rate limit. Enforced per-second to prevent bursts.                      |

### Design Insight: Why Autoscaling, Not Fixed Concurrency?

Fixed concurrency (e.g., `concurrency: 10`) has two failure modes:

1. **Too high**: overwhelms system resources → crashes, OOM errors, throttled CPU.
2. **Too low**: leaves resources idle → slower crawl than possible.

The autoscaler eliminates both by dynamically finding the optimal operating point. This is particularly valuable for:

- **Browser crawlers** where memory usage varies wildly per page (50MB for simple pages, 300MB+ for complex ones).
- **Mixed workloads** where some pages are fast (2s) and others slow (30s).
- **Server-side rate limits** that vary over time.

### Rate Limiting: Per-Second Enforcement

`maxRequestsPerMinute: 250` does not mean "fire 250 requests in the first few seconds, then wait." It means:

```
target_per_second = 250 / 60 ≈ 4.17 requests/second

Each second, the rate limiter allows up to ceil(target_per_second) new requests.
```

This spread distribution prevents the burst-then-idle pattern that triggers rate limit detection on target servers.

## Horizontal Scaling — RequestQueueV2 with Locking

### The Locking Protocol

```
Process A:                          Process B:
  │                                   │
  ├─ lock(request_42) ──────────►     │
  │  ← locked_ok                      │
  │                                   ├─ lock(request_42)
  │                                   │  ← already_locked
  │                                   │
  │  process(request_42)              ├─ lock(request_43) ────►
  │                                   │  ← locked_ok
  │  mark_handled(request_42) ──►     │
  │                                   │  process(request_43)
  │                                   │
  │                                   │  mark_handled(request_43)
```

When a process acquires a lock, other processes skip that request and pick the next available one. If the locking process crashes, the lock expires after a timeout and the request becomes available again. This provides **at-least-once** processing semantics.

### Storage Isolation for Workers

Each worker process needs isolated storage to prevent conflicts:

```
storage/
  datasets/default/      ← parent process (aggregator)
  worker-0/
    datasets/default/    ← worker 0 local state
  worker-1/
    datasets/default/    ← worker 1 local state
```

Workers send scraped data back to the parent via `process.send()` (IPC), and the parent writes to the shared dataset. This is the **aggregator pattern** — workers produce, parent collects.

### Crawlee's Recommended Parallelization Architecture

```
Phase 1: URL Discovery (single process)
  ┌────────────────────────────────────────┐
  │ CheerioCrawler / PlaywrightCrawler     │
  │ - Crawl list pages                     │
  │ - enqueueLinks → RequestQueueV2        │
  │ - NO detail page scraping              │
  └──────────────────┬─────────────────────┘
                     │ fills
                     ▼
  ┌──────────────────────────────────┐
  │ RequestQueueV2('shop-urls')      │
  │ [url_1, url_2, ..., url_N]      │
  └──────────────────┬───────────────┘
                     │

Phase 2: Parallel Consumption (multiple processes)
  ┌─────────┐ ┌─────────┐ ┌─────────┐
  │ Worker 0│ │ Worker 1│ │ Worker 2│
  │ lock+   │ │ lock+   │ │ lock+   │
  │ scrape  │ │ scrape  │ │ scrape  │
  └────┬────┘ └────┬────┘ └────┬────┘
       │           │           │
       └───────────┼───────────┘
                   │ IPC
                   ▼
         ┌─────────────────┐
         │ Parent Process  │
         │ Dataset.pushData│
         └─────────────────┘
```

## Backpressure Handling

Crawlee implements implicit backpressure through three mechanisms:

1. **Queue depth**: When the queue is empty (all URLs being processed), no new tasks start. When `enqueueLinks()` adds more URLs, tasks resume automatically.

2. **AutoscaledPool scaling down**: If system resources are stressed, the pool reduces concurrency, reducing queue consumption rate.

3. **maxRequestsPerMinute**: Hard ceiling on throughput prevents overwhelming both the scraper system and the target site.

There is no explicit backpressure protocol (like TCP flow control). Instead, the bounded queue + bounded concurrency + rate limit creates a natural governor.

## Distributed Crawling Strategies

Crawlee's open-source version does not natively support multi-machine distribution. The strategies available:

### Strategy 1: Request Queue Sharding (Local)

Partition URLs across multiple processes on the same machine using `child_process.fork()`. Each worker has its own AutoscaledPool but shares the RequestQueueV2.

**Scaling limit**: Number of CPU cores × memory per browser instance.

### Strategy 2: External Queue (Custom)

Replace Crawlee's built-in queue with a distributed queue (Redis, SQS, Kafka) and implement the `RequestProvider` interface. Each machine runs an independent crawler consuming from the shared queue.

**Complexity**: Requires custom storage adapter, distributed state management.

### Strategy 3: Apify Platform (Managed)

Deploy crawlers as Apify Actors. The platform handles queue distribution, storage, and worker orchestration.

**Scaling limit**: Platform quotas and budget.

## Resource Optimization Models

### Memory Budget Allocation

```
Total Available Memory: M

HTTP Crawler:
  Per-task overhead: ~5 MB
  Recommended max_concurrency: M / 10 MB (safety margin)
  Example: 4 GB → maxConcurrency = 400

Browser Crawler:
  Per-task overhead: ~100-300 MB
  Recommended max_concurrency: (M - 500 MB) / 200 MB
  Example: 4 GB → maxConcurrency = 17
```

### CPU Budget

```
HTTP Crawler:
  Mostly I/O-bound, CPU usage is low.
  CPU cores ≤ 2 sufficient for high concurrency.

Browser Crawler:
  CPU-bound (rendering, JS execution).
  Each browser tab consumes 0.5-1 core under load.
  max_concurrency ≈ CPU_cores * 2 (with autoscaling as safety net)
```

### Network Budget

The often-overlooked bottleneck. At maxConcurrency = 200 with average page size 500KB:

```
Bandwidth = 200 * 500KB / avg_response_time
           = 200 * 500KB / 1s
           = 100 MB/s sustained

This can saturate a 1 Gbps connection.
```

Rate limiting (`maxRequestsPerMinute`) indirectly controls bandwidth consumption.
