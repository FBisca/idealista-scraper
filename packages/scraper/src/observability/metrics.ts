type MetricSnapshot = {
  counters: Record<string, number>;
  gauges: Record<string, number>;
  durations: {
    count: number;
    min: number;
    max: number;
    avg: number;
    total: number;
  };
};

export class CrawlMetrics {
  private readonly counters: Map<string, number>;
  private readonly gauges: Map<string, number>;
  private readonly durationValues: number[];

  constructor() {
    this.counters = new Map();
    this.gauges = new Map();
    this.durationValues = [];
  }

  increment(counter: string, amount = 1): void {
    const current = this.counters.get(counter) ?? 0;
    this.counters.set(counter, current + amount);
  }

  gauge(name: string, value: number): void {
    this.gauges.set(name, value);
  }

  recordDuration(ms: number): void {
    this.durationValues.push(ms);
  }

  snapshot(): MetricSnapshot {
    const counters: Record<string, number> = {};
    for (const [key, value] of this.counters) {
      counters[key] = value;
    }

    const gauges: Record<string, number> = {};
    for (const [key, value] of this.gauges) {
      gauges[key] = value;
    }

    const count = this.durationValues.length;
    const total = this.durationValues.reduce((sum, value) => sum + value, 0);
    const min = count > 0 ? Math.min(...this.durationValues) : 0;
    const max = count > 0 ? Math.max(...this.durationValues) : 0;
    const avg = count > 0 ? total / count : 0;

    return {
      counters,
      gauges,
      durations: { count, min, max, avg, total },
    };
  }

  log(logger: { info: (msg: string, data?: string) => void }): void {
    const snap = this.snapshot();
    logger.info('[Metrics]', JSON.stringify(snap));
  }

  reset(): void {
    this.counters.clear();
    this.gauges.clear();
    this.durationValues.length = 0;
  }
}

export type { MetricSnapshot };
