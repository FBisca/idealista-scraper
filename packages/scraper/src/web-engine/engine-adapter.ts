import type {
  FetchContentOptions,
  FetchResponse,
  InteractiveWebContentParser,
  WebContentParser,
} from './types.js';
import type { UlixeeWebEngine } from './ulixee-engine.js';
import type { IHeroCreateOptions } from '@ulixee/hero';

class UlixeeEngineAdapter {
  private engine: UlixeeWebEngine | undefined;
  private readonly options: IHeroCreateOptions | undefined;

  constructor(options?: IHeroCreateOptions) {
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

export { UlixeeEngineAdapter };
