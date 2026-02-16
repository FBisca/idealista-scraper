import type {
  FetchContentOptions,
  FetchResponse,
  InteractiveWebContentParser,
  WebContentParser,
} from './types.js';
import type { UlixeeWebEngine } from './ulixee-engine.js';
import type { IHeroCreateOptions } from '@ulixee/hero';

type EngineType = 'ulixee' | 'crawlee';

abstract class EngineAdapter {
  abstract readonly engineType: EngineType;

  abstract fetch<T>(
    url: string,
    options: FetchContentOptions<
      T,
      WebContentParser<string, T> | InteractiveWebContentParser<string, T>
    >,
  ): Promise<FetchResponse<T>>;

  abstract cleanup(): Promise<void>;
}

class UlixeeEngineAdapter extends EngineAdapter {
  readonly engineType = 'ulixee' as const;
  private engine: UlixeeWebEngine | undefined;
  private readonly options: IHeroCreateOptions | undefined;

  constructor(options?: IHeroCreateOptions) {
    super();
    this.options = options;
  }

  private async getEngine(): Promise<UlixeeWebEngine> {
    if (!this.engine) {
      const { UlixeeWebEngine: Engine } = await import('./ulixee-engine.js');
      this.engine = new Engine(this.options);
    }
    return this.engine;
  }

  async fetch<T>(
    url: string,
    options: FetchContentOptions<
      T,
      WebContentParser<string, T> | InteractiveWebContentParser<string, T>
    >,
  ): Promise<FetchResponse<T>> {
    const engine = await this.getEngine();
    return engine.fetchContent(url, options);
  }

  async cleanup(): Promise<void> {
    if (this.engine) {
      await this.engine.cleanup();
      this.engine = undefined;
    }
  }
}

export { EngineAdapter, UlixeeEngineAdapter };
export type { EngineType };
