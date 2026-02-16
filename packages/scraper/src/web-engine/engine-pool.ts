import { EngineAdapter } from './engine-adapter.js';

type EngineFactory = () => EngineAdapter;

type EnginePoolConfig = {
  maxSize: number;
};

export class EnginePool {
  private readonly idle: EngineAdapter[];
  private readonly active: Set<EngineAdapter>;
  private readonly factory: EngineFactory;
  private readonly maxSize: number;
  private readonly waiters: Array<(adapter: EngineAdapter) => void>;

  constructor(factory: EngineFactory, config?: Partial<EnginePoolConfig>) {
    this.factory = factory;
    this.maxSize = config?.maxSize ?? 4;
    this.idle = [];
    this.active = new Set();
    this.waiters = [];
  }

  async acquire(): Promise<EngineAdapter> {
    if (this.idle.length > 0) {
      const adapter = this.idle.pop()!;
      this.active.add(adapter);
      return adapter;
    }

    if (this.active.size < this.maxSize) {
      const adapter = this.factory();
      this.active.add(adapter);
      return adapter;
    }

    return new Promise<EngineAdapter>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  release(adapter: EngineAdapter): void {
    this.active.delete(adapter);

    if (this.waiters.length > 0) {
      const waiter = this.waiters.shift()!;
      this.active.add(adapter);
      waiter(adapter);
      return;
    }

    this.idle.push(adapter);
  }

  async cleanup(): Promise<void> {
    const all = [...this.idle, ...this.active];
    this.idle.length = 0;
    this.active.clear();

    for (const waiter of this.waiters) {
      waiter(null as unknown as EngineAdapter);
    }
    this.waiters.length = 0;

    await Promise.all(all.map((adapter) => adapter.cleanup()));
  }

  get activeCount(): number {
    return this.active.size;
  }

  get idleCount(): number {
    return this.idle.length;
  }

  get totalCount(): number {
    return this.active.size + this.idle.length;
  }
}

export type { EngineFactory, EnginePoolConfig };
