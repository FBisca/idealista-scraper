import { describe, it, expect } from 'vitest';
import { CrawlMetrics } from './metrics.js';

describe('CrawlMetrics', () => {
  it('increments counters', () => {
    const metrics = new CrawlMetrics();
    metrics.increment('requests.total');
    metrics.increment('requests.total');
    metrics.increment('requests.failed');

    const snap = metrics.snapshot();
    expect(snap.counters['requests.total']).toBe(2);
    expect(snap.counters['requests.failed']).toBe(1);
  });

  it('sets and gets gauges', () => {
    const metrics = new CrawlMetrics();
    metrics.gauge('workers.active', 4);
    metrics.gauge('queue.depth', 150);
    metrics.gauge('workers.active', 3);

    const snap = metrics.snapshot();
    expect(snap.gauges['workers.active']).toBe(3);
    expect(snap.gauges['queue.depth']).toBe(150);
  });

  it('records durations with min/max/avg', () => {
    const metrics = new CrawlMetrics();
    metrics.recordDuration(100);
    metrics.recordDuration(200);
    metrics.recordDuration(300);

    const snap = metrics.snapshot();
    expect(snap.durations.count).toBe(3);
    expect(snap.durations.min).toBe(100);
    expect(snap.durations.max).toBe(300);
    expect(snap.durations.avg).toBe(200);
    expect(snap.durations.total).toBe(600);
  });

  it('snapshot returns all metrics', () => {
    const metrics = new CrawlMetrics();
    metrics.increment('a');
    metrics.gauge('b', 10);
    metrics.recordDuration(50);

    const snap = metrics.snapshot();
    expect(snap.counters).toHaveProperty('a');
    expect(snap.gauges).toHaveProperty('b');
    expect(snap.durations.count).toBe(1);
  });

  it('reset clears state', () => {
    const metrics = new CrawlMetrics();
    metrics.increment('x');
    metrics.gauge('y', 5);
    metrics.recordDuration(100);

    metrics.reset();

    const snap = metrics.snapshot();
    expect(Object.keys(snap.counters)).toHaveLength(0);
    expect(Object.keys(snap.gauges)).toHaveLength(0);
    expect(snap.durations.count).toBe(0);
  });

  it('handles empty durations gracefully', () => {
    const metrics = new CrawlMetrics();
    const snap = metrics.snapshot();

    expect(snap.durations.count).toBe(0);
    expect(snap.durations.min).toBe(0);
    expect(snap.durations.max).toBe(0);
    expect(snap.durations.avg).toBe(0);
  });
});
