import type {
  BrowserCrawlerOptions,
  BrowserCrawlingContext,
  BrowserHook,
  BrowserRequestHandler,
  GetUserDataFromRequest,
  LoadedContext,
  RouterRoutes,
} from '@crawlee/browser';
import { BrowserCrawler, Configuration, Router } from '@crawlee/browser';
import type { BrowserPoolOptions } from '@crawlee/browser-pool';
import type { Dictionary } from '@crawlee/types';
import type { IHeroCreateOptions } from '@ulixee/hero';
import type { Resource } from '@ulixee/hero/lib/extendables';

import { UlixeePlugin } from './ulixee-plugin.js';
import type { UlixeeController } from './ulixee-controller.js';
import type { UlixeePage } from './ulixee-browser.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type UlixeeCrawlingContext<UserData extends Dictionary = Dictionary> =
  BrowserCrawlingContext<
    UlixeeCrawler,
    UlixeePage,
    Resource,
    UlixeeController,
    UserData
  >;

export type UlixeeHook = BrowserHook<UlixeeCrawlingContext, UlixeeGotoOptions>;

export type UlixeeRequestHandler = BrowserRequestHandler<
  LoadedContext<UlixeeCrawlingContext>
>;

export type UlixeeGotoOptions = Dictionary & {
  timeoutMs?: number;
};

export interface UlixeeLaunchContext {
  heroOptions?: IHeroCreateOptions;
  proxyUrl?: string;
  showChrome?: boolean;
}

export interface UlixeeCrawlerOptions extends BrowserCrawlerOptions<
  UlixeeCrawlingContext,
  { browserPlugins: [UlixeePlugin] }
> {
  launchContext?: UlixeeLaunchContext;
  requestHandler?: UlixeeRequestHandler;
  preNavigationHooks?: UlixeeHook[];
  postNavigationHooks?: UlixeeHook[];
}

// ---------------------------------------------------------------------------
// Crawler
// ---------------------------------------------------------------------------

/**
 * Crawlee-compatible crawler powered by Ulixee Hero.
 *
 * Mirrors the PlaywrightCrawler API but uses Hero as the underlying
 * browser automation engine.  Hero's built-in anti-bot features
 * (human emulation, TLS fingerprinting, DOM shielding) are available
 * out-of-the-box without additional configuration.
 *
 * @example
 * ```ts
 * const crawler = new UlixeeCrawler({
 *   async requestHandler({ hero, request }) {
 *     const title = await hero.document.title;
 *     console.log(title, request.url);
 *   },
 * });
 * await crawler.run(['https://example.com']);
 * ```
 *
 * @category Crawlers
 */
export class UlixeeCrawler extends BrowserCrawler<
  { browserPlugins: [UlixeePlugin] },
  IHeroCreateOptions,
  UlixeeCrawlingContext
> {
  constructor(
    private readonly options: UlixeeCrawlerOptions = {},
    override readonly config = Configuration.getGlobalConfig(),
  ) {
    const { launchContext = {}, headless, ...browserCrawlerOptions } = options;

    const heroOptions: IHeroCreateOptions = launchContext.heroOptions ?? {};

    if (headless != null) {
      heroOptions.showChrome = !headless;
    }
    if (launchContext.showChrome != null) {
      heroOptions.showChrome = launchContext.showChrome;
    }
    if (launchContext.proxyUrl) {
      heroOptions.upstreamProxyUrl = launchContext.proxyUrl;
    }

    const ulixeePlugin = new UlixeePlugin({ launchOptions: heroOptions });

    const browserPoolOptions: BrowserPoolOptions = {
      ...options.browserPoolOptions,
      browserPlugins: [ulixeePlugin],
    };

    super({ ...browserCrawlerOptions, browserPoolOptions }, config);
  }

  protected override async _navigationHandler(
    crawlingContext: UlixeeCrawlingContext,
    gotoOptions: UlixeeGotoOptions,
  ): Promise<Resource> {
    const { tab } = crawlingContext.page;
    const { url } = crawlingContext.request;

    const timeoutMs = gotoOptions.timeoutMs ?? this.navigationTimeoutMillis;

    const resource = await tab.goto(url, { timeoutMs });
    await tab.waitForPaintingStable();

    return resource;
  }
}

// ---------------------------------------------------------------------------
// Router factory
// ---------------------------------------------------------------------------

export function createUlixeeRouter<
  Context extends UlixeeCrawlingContext = UlixeeCrawlingContext,
  UserData extends Dictionary = GetUserDataFromRequest<Context['request']>,
>(routes?: RouterRoutes<Context, UserData>) {
  return Router.create<Context>(routes);
}
