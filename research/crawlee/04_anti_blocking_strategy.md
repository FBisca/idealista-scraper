# Crawlee — Anti-Blocking Strategy

## The Detection Surface

Anti-bot systems analyze crawlers across multiple layers. Crawlee addresses each layer with specific countermeasures. Understanding the detection surface is prerequisite to understanding the anti-blocking architecture.

```
Detection Layer Stack:
┌─────────────────────────────────────────────┐
│ Layer 5: Behavioral Analysis                │  mouse movement, scroll patterns,
│          (hardest to fake)                  │  timing, click sequences
├─────────────────────────────────────────────┤
│ Layer 4: Browser Fingerprint                │  navigator properties, WebGL,
│          (browser crawlers only)            │  canvas, fonts, plugins
├─────────────────────────────────────────────┤
│ Layer 3: HTTP Fingerprint                   │  header order, H2 settings,
│          (all crawlers)                     │  pseudo-header sequences
├─────────────────────────────────────────────┤
│ Layer 2: TLS Fingerprint                    │  cipher suites, extensions,
│          (all crawlers)                     │  JA3/JA4 hash
├─────────────────────────────────────────────┤
│ Layer 1: IP Reputation                      │  datacenter vs residential,
│          (network level)                    │  rate per IP, geo-location
└─────────────────────────────────────────────┘
```

## Session Pool — The Core Anti-Blocking Primitive

### What a Session Represents

A `Session` in Crawlee is a **linked identity** — a coherent set of:

- Proxy IP address
- Cookies
- Custom headers
- Browser fingerprint (if browser crawler)
- Auth tokens (if applicable)

The critical insight: anti-bot systems don't just check individual signals — they check **consistency** across signals. A request with Chrome User-Agent but Firefox TLS fingerprint is instantly flagged. Sessions ensure all signals are consistent.

### Session Lifecycle

```
┌──────────────┐
│ SessionPool  │  maxPoolSize: 100 (default)
│              │
│  ┌─────────┐ │
│  │Session 1│ │──► usageCount: 0, isBlocked: false
│  │Session 2│ │──► usageCount: 5, isBlocked: false
│  │Session 3│ │──► usageCount: 12, isBlocked: true → retired
│  │...      │ │
│  └─────────┘ │
└──────────────┘

Session State Machine:
  NEW → ACTIVE → (markBad → penalized) → ACTIVE
                → (retire → RETIRED)
                → (maxUsages reached → RETIRED)
                → (maxAge reached → RETIRED)
```

### Session Rotation Strategy

Crawlee's session rotation is probabilistic, not round-robin:

1. **Random selection** — sessions are picked randomly from the pool. This prevents the deterministic access pattern that round-robin creates (which anti-bot systems can detect via timing analysis).

2. **Health-based filtering** — blocked sessions are retired and replaced. Bad sessions are penalized (temporary cooldown). Only healthy sessions are candidates for selection.

3. **Even distribution** — random selection over a pool naturally distributes requests across IPs, preventing any single IP from receiving disproportionate traffic.

### Session Health Management

```typescript
// In requestHandler:
if (title === 'Blocked') {
  session?.retire(); // Permanent removal, new session created
} else if (title === 'Not sure if blocked') {
  session?.markBad(); // Temporary penalty, might recover
} else {
  // session.markGood() — done automatically by BasicCrawler
}
```

**Design insight**: The three-state health model (good/bad/retired) maps to the real-world detection spectrum:

- **Blocked** (HTTP 403, CAPTCHA page) → this IP/identity is burned, discard it.
- **Degraded** (slow responses, partial content, soft warnings) → back off, might recover.
- **Good** (normal response) → keep using.

## Proxy Tier Strategy

### Crawlee's Proxy Architecture

```
ProxyConfiguration
  │
  ├── proxyUrls: string[]          ← static list rotation
  │
  ├── newUrlFunction: () => string  ← dynamic proxy generation
  │
  └── Apify Proxy integration      ← managed proxy tiers
```

### Proxy Tier Model (Conceptual)

While Crawlee doesn't explicitly define proxy tiers, its architecture supports a tiered strategy:

```
Tier 0: Direct (no proxy)
  Cost: $0
  Detection risk: HIGH (datacenter IP, static)
  Use: Testing, development

Tier 1: Datacenter proxies
  Cost: $
  Detection risk: MEDIUM-HIGH
  Use: Low-protection sites, high-volume crawls where speed matters

Tier 2: ISP/Residential rotating proxies
  Cost: $$$
  Detection risk: LOW
  Use: Medium-protection sites, session-based crawling

Tier 3: Mobile/Premium residential
  Cost: $$$$$
  Detection risk: VERY LOW
  Use: High-protection sites (Cloudflare, DataDome)
```

### Session ↔ Proxy Binding

When `useSessionPool: true` and `proxyConfiguration` are both set, Crawlee binds each session to a specific proxy URL. This means:

- All requests in a session use the same IP.
- Cookies accumulated in a session are used with the same IP.
- If the session is retired, a new session gets a new proxy.

This binding prevents the "cookie from IP-A sent with IP-B" anomaly that triggers detection.

## Fingerprinting Handling

### Layer 2: TLS Fingerprint (Impit)

Impit solves TLS fingerprinting by using a patched Rust TLS library that replicates exact browser `ClientHello` messages:

```
Standard Node.js fetch:           Impit:
  JA3: abc123 (Node.js)            JA3: xyz789 (Chrome 131)
  Cipher order: Node default        Cipher order: Chrome-identical
  TLS extensions: minimal           TLS extensions: Chrome-identical
```

This is the **deepest layer** of fingerprinting — you can't fix it with headers alone. Impit replaces the entire TLS handshake profile.

### Layer 3: HTTP Fingerprint (Impit + got-scraping)

HTTP-level fingerprinting includes:

- **Header order**: Chrome sends headers in a specific order. Node.js sends them differently.
- **HTTP/2 pseudo-header sequence**: `:method`, `:authority`, `:scheme`, `:path` ordering.
- **H2 settings frame**: `SETTINGS_HEADER_TABLE_SIZE`, `SETTINGS_MAX_CONCURRENT_STREAMS`, etc.

Impit handles all three. got-scraping handles header ordering but not TLS-level mimicry.

### Layer 4: Browser Fingerprint (Fingerprint Suite)

For browser crawlers, Crawlee's `BrowserPool` integrates the Fingerprint Suite:

```typescript
browserPoolOptions: {
  useFingerprints: true,  // default
  fingerprintOptions: {
    fingerprintGeneratorOptions: {
      browsers: [{ name: BrowserName.chrome, minVersion: 115 }],
      devices: [DeviceCategory.desktop],
      operatingSystems: [OperatingSystemsName.macos],
    }
  }
}
```

Generated fingerprints include:

- `navigator` properties (userAgent, platform, languages, hardwareConcurrency)
- WebGL renderer/vendor strings
- Canvas fingerprint perturbation
- Screen resolution and color depth
- Plugin list and MIME types

**Design philosophy**: Fingerprints are generated as **coherent sets**, not individual random values. A Windows user-agent with macOS screen resolution would fail consistency checks.

### Layer 5: Behavioral — Camoufox

For the hardest protection (Cloudflare challenges), Crawlee supports Camoufox — a custom Firefox build with:

- Modified browser internals to defeat automation detection
- `handleCloudflareChallenge` hook for automated challenge solving
- Deep integration via post-navigation hooks

## Retry Intelligence

### Crawlee's Retry Model

```
Request fails:
  │
  ├─ retryCount < maxRetries?
  │    ├─ Yes → re-enqueue with incremented retryCount
  │    │         + rotate session (new IP, new cookies)
  │    │         + optional delay (human-like back-off)
  │    │
  │    └─ No → mark as failed, log to errorHandler
  │
  └─ Is it a session-level failure?
       ├─ HTTP 403/429 → session.retire()
       ├─ Timeout → session.markBad()
       └─ Network error → session.markBad()
```

**Key insight**: Retries with session rotation means each retry attempt uses a different IP + identity. This is fundamentally different from naive retries (same IP, same cookies) which just hit the same block again.

### Error Classification

Crawlee implicitly classifies errors into:

| Error Type    | Session Action | Retry?               | Example                   |
| ------------- | -------------- | -------------------- | ------------------------- |
| Hard block    | retire()       | Yes (new session)    | 403, CAPTCHA page         |
| Soft block    | markBad()      | Yes (after cooldown) | 429, slow response        |
| Network error | markBad()      | Yes                  | Timeout, connection reset |
| Parse error   | none           | No (user code bug)   | Selector not found        |
| System error  | none           | No                   | OOM, disk full            |

## Human Behavior Simulation Patterns

Crawlee does not have explicit "human simulation" but its architecture enables the patterns:

### 1. Request Pacing

`maxRequestsPerMinute` with per-second distribution creates natural-looking request cadence.

### 2. Session Persistence

`persistCookiesPerSession: true` maintains cookie state across requests, mimicking a real browsing session.

### 3. Referrer Chain

`enqueueLinks()` automatically sets the `Referer` header to the page that discovered the link, creating natural navigation chains.

### 4. Page Time

The time spent in `requestHandler` (parsing, extracting) creates natural "dwell time" between requests.

### 5. Fingerprint Consistency

Session-bound fingerprints ensure the same "user" exhibits consistent browser characteristics across pages.

## System-Thinking Summary

The anti-blocking system works as a **layered defense-in-depth model**:

```
If blocked at Layer 1 (IP):
  → Rotate proxy via SessionPool

If blocked at Layer 2 (TLS):
  → Use Impit for TLS fingerprinting

If blocked at Layer 3 (HTTP):
  → Use Impit/got-scraping for header order mimicry

If blocked at Layer 4 (Browser):
  → Use Fingerprint Suite for consistent browser identity

If blocked at Layer 5 (Behavior):
  → Use Camoufox + natural pacing + session persistence

If all layers fail:
  → Escalate to headed browser (visual mode)
  → Human intervention for CAPTCHA solving
```

Each layer is independently configurable, and each failure escalates to the next layer. The system degrades gracefully rather than failing catastrophically.
