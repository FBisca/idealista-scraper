# Crawlee — HTTP Client Strategy

## The HTTP Client Landscape

Crawlee's HTTP client strategy addresses a fundamental tension: **Node.js HTTP clients look nothing like browsers at the network level**. Anti-bot systems fingerprint not just headers but TLS handshakes, HTTP/2 settings, and TCP behavior. Crawlee offers three HTTP client tiers to navigate this tension.

## HTTP Client Tier Model

```
┌─────────────────────────────────────────────────────────────────────┐
│ Tier 3: Full Browser (Playwright/Puppeteer)                        │
│   Detection risk: LOWEST                                           │
│   Speed: 5-20 pages/min                                            │
│   Resource cost: HIGH (200-500MB per browser)                      │
│   Capabilities: JS rendering, interaction, real fingerprint        │
├─────────────────────────────────────────────────────────────────────┤
│ Tier 2: Impit (ImpitHttpClient)                                    │
│   Detection risk: LOW                                              │
│   Speed: 200-500 pages/min                                         │
│   Resource cost: LOW (HTTP-only, no browser)                       │
│   Capabilities: TLS mimicry, H2 fingerprint, header ordering      │
├─────────────────────────────────────────────────────────────────────┤
│ Tier 1: got-scraping (GotScrapingHttpClient)                       │
│   Detection risk: MEDIUM                                           │
│   Speed: 500+ pages/min                                            │
│   Resource cost: LOWEST                                            │
│   Capabilities: Header ordering, basic fingerprint evasion         │
├─────────────────────────────────────────────────────────────────────┤
│ Tier 0: Raw HTTP (Node fetch, Axios, undici)                       │
│   Detection risk: HIGHEST                                          │
│   Speed: 1000+ pages/min                                           │
│   Resource cost: LOWEST                                            │
│   Capabilities: None — pure Node.js fingerprint                    │
└─────────────────────────────────────────────────────────────────────┘
```

## got-scraping — The Legacy Default

### What It Does

`got-scraping` is Crawlee's original default HTTP library, a wrapper around `got` with scraping-specific enhancements:

- **Header ordering**: Sends headers in browser-consistent order.
- **User-Agent generation**: Generates realistic UA strings.
- **Header generation**: Produces matching `sec-ch-ua`, `sec-fetch-*`, and other headers.
- **HTTP/2 support**: Uses HTTP/2 by default.
- **Proxy support**: Built-in proxy rotation.

### What It Doesn't Do

- Does NOT replicate TLS fingerprints — JA3 hash still identifies it as Node.js.
- Does NOT replicate HTTP/2 settings frame — `SETTINGS_INITIAL_WINDOW_SIZE`, `SETTINGS_MAX_CONCURRENT_STREAMS` differ from browsers.
- Does NOT replicate HTTP/2 pseudo-header ordering.

### Detection Surface

```
got-scraping fingerprint analysis:

  TLS Layer:
    ✗ JA3 hash → Node.js (detectable by Cloudflare, DataDome, PerimeterX)
    ✗ Cipher suite ordering → Node.js default
    ✗ TLS extensions → missing browser-specific extensions

  HTTP/2 Layer:
    ✗ SETTINGS frame → Node default values
    ✗ WINDOW_UPDATE → different from Chrome
    ✓ Pseudo-header order → can be configured

  HTTP Header Layer:
    ✓ Header order → browser-consistent
    ✓ Header values → realistic
    ✓ User-Agent → valid Chrome/Firefox UA
```

**Bottom line**: got-scraping passes header-level checks but fails TLS-level fingerprinting. Sufficient for sites without advanced bot detection.

## Impit — The Next-Generation HTTP Client

### Architecture

Impit ("impersonation HTTP client") uses **native binaries** compiled from patched Rust HTTP/TLS libraries:

```
Architecture Comparison:

got-scraping:
  Node.js → got → http2 module → OpenSSL → TCP
  (Node fingerprint at every layer)

Impit:
  Node.js → napi binding → Rust binary → patched TLS → TCP
  (Browser fingerprint at TLS/HTTP layers)
```

### What Impit Replicates

```
Layer-by-layer impersonation:

  TLS Layer:
    ✓ JA3 hash → matches target browser exactly
    ✓ Cipher suites → browser-identical ordering
    ✓ TLS extensions → all browser extensions present
    ✓ ALPN → correct protocol negotiation
    ✓ Key share → matching curves and order

  HTTP/2 Layer:
    ✓ SETTINGS frame → browser-identical values
    ✓ WINDOW_UPDATE → matching initial window size
    ✓ PRIORITY frame → browser-consistent stream priorities
    ✓ Pseudo-header order → :method, :authority, :scheme, :path

  HTTP Header Layer:
    ✓ Header order → browser-consistent
    ✓ Header values → realistic
    ✓ Sec-CH-UA → matching version strings
```

### Supported Browser Impersonation Targets

Impit can impersonate:

- Chrome (multiple versions: 116-131+)
- Firefox (multiple versions)
- Safari (multiple versions)
- Edge (via Chrome engine profiles)

### ImpitHttpClient in Crawlee

```typescript
import { ImpitHttpClient } from 'crawlee';

const crawler = new CheerioCrawler({
  httpClient: new ImpitHttpClient(),
  // All requests now use browser-grade TLS fingerprints
});
```

### Performance Characteristics

| Metric             | got-scraping | Impit                       |
| ------------------ | ------------ | --------------------------- |
| Cold start         | ~50ms        | ~100ms (native binary load) |
| Request latency    | 20-50ms      | 25-60ms (marginal overhead) |
| Memory per request | ~5KB         | ~8KB                        |
| Throughput         | 500+ req/s   | 300-500 req/s               |
| TLS reuse          | Yes          | Yes                         |
| HTTP/3 support     | No           | Yes (QUIC)                  |

The slight overhead is negligible compared to the anti-detection benefit. The throughput difference rarely matters because rate limiting constrains real-world crawls far below these numbers.

### Platform Considerations

Impit uses **precompiled native binaries** distributed as npm optionalDependencies:

```
@aspect-build/impit-darwin-arm64    ← macOS Apple Silicon
@aspect-build/impit-darwin-x64      ← macOS Intel
@aspect-build/impit-linux-x64-gnu   ← Linux x64
@aspect-build/impit-win32-x64-msvc  ← Windows x64
```

This is similar to the `better-sqlite3` native dependency pattern already present in this repository.

## Raw HTTP vs Browser: The Decision Framework

### Detection Risk Model

```
Detection Probability by Protection Level:

                  │ No protection │ Basic WAF │ Cloudflare │ DataDome │
──────────────────┼───────────────┼───────────┼────────────┼──────────┤
Raw Node.js HTTP  │  0%           │  20%      │  95%       │  99%     │
got-scraping      │  0%           │  5%       │  60%       │  90%     │
Impit             │  0%           │  1%       │  10%       │  40%     │
Headless browser  │  0%           │  0%       │  5%        │  20%     │
Camoufox          │  0%           │  0%       │  2%        │  10%     │
```

_Estimates based on publicly known detection capabilities. Actual rates vary by site configuration._

### Cost Model

```
Total Cost per 100K pages:

Raw HTTP:
  Compute: $0.50    (1 vCPU, 512MB)
  Proxy:   $0       (datacenter or none)
  Time:    ~5 min
  Total:   ~$0.50

Impit:
  Compute: $1.00    (1 vCPU, 512MB)
  Proxy:   $5-50    (residential for anti-detect benefit)
  Time:    ~10 min
  Total:   ~$6-51

Headless Browser:
  Compute: $20      (4 vCPU, 4GB per browser)
  Proxy:   $5-50    (residential)
  Time:    ~8 hours
  Total:   ~$25-70
```

### Decision Tree

```
Does the site have bot protection?
  │
  ├─ No → CheerioCrawler + got-scraping (cheapest, fastest)
  │
  ├─ Basic WAF → CheerioCrawler + Impit (TLS fingerprint bypasses most WAFs)
  │
  ├─ Cloudflare/Akamai → Two options:
  │    ├─ HTTP-first: CheerioCrawler + Impit + residential proxies
  │    │   (try first — 10x cheaper than browser)
  │    │
  │    └─ Browser fallback: PlaywrightCrawler + fingerprints
  │        (if HTTP-first gets blocked)
  │
  └─ DataDome/PerimeterX/Kasada →
       PlaywrightCrawler + Camoufox + premium proxies
       (or: give up on automation, use API if available)
```

## Hybrid Crawling Pipeline

The most cost-effective strategy uses HTTP-first with browser escalation:

```
Phase 1: Attempt with Impit (HTTP-only)
  ├─ Success (90% of requests) → extract data
  └─ Blocked (10% of requests) → enqueue for Phase 2

Phase 2: Retry blocked URLs with PlaywrightCrawler
  ├─ Success (80% of retries) → extract data
  └─ Still blocked (2% of original) → log for manual review
```

```typescript
// Conceptual implementation:
const httpCrawler = new CheerioCrawler({
  httpClient: new ImpitHttpClient(),
  failedRequestHandler: async ({ request }) => {
    // Escalate to browser queue
    await browserQueue.addRequest(request);
  },
});

const browserCrawler = new PlaywrightCrawler({
  requestQueue: browserQueue,
  // Full browser for the hardest URLs
});

await httpCrawler.run(urls);
await browserCrawler.run(); // Processes only failed URLs
```

**Economics**: If 90% of URLs succeed with HTTP, you save ~85% of compute cost compared to using a browser for everything.

## Comparison with This Repository's HTTP Strategy

| Capability                    | Crawlee (Impit)           | AxiosWebEngine (current) |
| ----------------------------- | ------------------------- | ------------------------ |
| TLS fingerprinting            | Browser-identical JA3     | Node.js default          |
| HTTP/2 fingerprinting         | Browser-identical         | Not supported            |
| Header ordering               | Browser-consistent        | Manual (partial)         |
| Proxy rotation                | Built-in with SessionPool | Not implemented          |
| Browser impersonation targets | Chrome, Firefox, Safari   | Chrome UA string only    |
| Cookie persistence            | SessionPool + persistence | Not implemented          |
| HTTP/3 (QUIC)                 | Supported                 | Not supported            |

The gap is most significant at the TLS layer. AxiosWebEngine's browser-like headers are a Tier 0.5 solution — they pass visual inspection of headers but fail network-level fingerprinting. Impit solves this at the binary level.
