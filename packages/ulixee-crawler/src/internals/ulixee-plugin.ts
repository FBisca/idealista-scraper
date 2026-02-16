import type { IHeroCreateOptions } from '@ulixee/hero';
import type { Dictionary } from '@crawlee/types';
import { BrowserPlugin } from '@crawlee/browser-pool';
import type {
  BrowserController,
  CommonLibrary,
  LaunchContext,
} from '@crawlee/browser-pool';
import { UlixeeBrowser, UlixeePage } from './ulixee-browser.js';
import { UlixeeController } from './ulixee-controller.js';
import { Hero } from '@ulixee/hero/lib/extendables';

export interface UlixeePluginOptions {
  launchOptions?: IHeroCreateOptions;
  proxyUrl?: string;
}

/**
 * Minimal "library" object that satisfies BrowserPlugin's `CommonLibrary` contract.
 * It delegates `.launch()` to creating a `UlixeeBrowser` wrapper around Hero.
 */
export interface UlixeeLibrary extends CommonLibrary {
  launch(opts?: Dictionary): Promise<UlixeeBrowser>;
}

function createUlixeeLibrary(): UlixeeLibrary {
  return {
    async launch(opts: IHeroCreateOptions = {}): Promise<UlixeeBrowser> {
      const hero = new Hero(opts);
      const browser = new UlixeeBrowser(hero, opts);
      return browser;
    },
  };
}

/**
 * BrowserPlugin implementation for Ulixee Hero.
 * Integrates Hero into BrowserPool so that BrowserCrawler can manage
 * lifecycle, retries, sessions, and autoscaling.
 */
export class UlixeePlugin extends BrowserPlugin<
  UlixeeLibrary,
  IHeroCreateOptions,
  UlixeeBrowser
> {
  constructor(options: UlixeePluginOptions = {}) {
    const library = createUlixeeLibrary();
    super(library, {
      launchOptions: options.launchOptions ?? {},
      proxyUrl: options.proxyUrl,
    });
  }

  protected override _createController(): BrowserController<
    UlixeeLibrary,
    IHeroCreateOptions,
    UlixeeBrowser,
    undefined,
    UlixeePage
  > {
    return new UlixeeController(this);
  }

  protected async _launch(
    launchContext: LaunchContext<
      UlixeeLibrary,
      IHeroCreateOptions,
      UlixeeBrowser
    >,
  ): Promise<UlixeeBrowser> {
    const mergedOptions: IHeroCreateOptions = {
      ...this.launchOptions,
      ...launchContext.launchOptions,
    };

    if (launchContext.proxyUrl) {
      mergedOptions.upstreamProxyUrl = launchContext.proxyUrl;
    }

    return this.library.launch(mergedOptions);
  }

  protected async _addProxyToLaunchOptions(
    launchContext: LaunchContext<
      UlixeeLibrary,
      IHeroCreateOptions,
      UlixeeBrowser
    >,
  ): Promise<void> {
    launchContext.launchOptions ??= {};
    if (launchContext.proxyUrl) {
      (launchContext.launchOptions as Dictionary).upstreamProxyUrl =
        launchContext.proxyUrl;
    }
  }

  protected _isChromiumBasedBrowser(): boolean {
    return true;
  }
}
