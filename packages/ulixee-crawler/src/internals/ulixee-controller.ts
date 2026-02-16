import type { Cookie, Dictionary } from '@crawlee/types';
import { BrowserController } from '@crawlee/browser-pool';
import type { UlixeeLibrary } from './ulixee-plugin.js';
import type { UlixeeBrowser, UlixeePage } from './ulixee-browser.js';
import type { IHeroCreateOptions } from '@ulixee/hero';

/**
 * Controller for managing a single Ulixee Hero browser instance.
 * Maps the BrowserPool lifecycle hooks onto Hero's API.
 */
export class UlixeeController extends BrowserController<
  UlixeeLibrary,
  IHeroCreateOptions,
  UlixeeBrowser
> {
  protected async _close(): Promise<void> {
    await this.browser.close();
  }

  protected async _kill(): Promise<void> {
    await this.browser.close();
  }

  protected async _newPage(): Promise<UlixeePage> {
    return this.browser.newPage();
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected async _setCookies(
    _page: UlixeePage,
    _cookies: Cookie[],
  ): Promise<void> {}

  protected async _getCookies(page: UlixeePage): Promise<Cookie[]> {
    return (await page.tab.cookieStorage.getItems()).map((item) => ({
      name: item.name,
      value: item.value,
      domain: item.domain,
      path: item.path,
      expires: 0,
      httpOnly: item.httpOnly,
      secure: item.secure,
      sameSite: item.sameSite,
    }));
  }

  normalizeProxyOptions(
    proxyUrl: string | undefined,
    pageOptions: Dictionary,
  ): Record<string, unknown> {
    if (proxyUrl) {
      return { ...pageOptions, upstreamProxyUrl: proxyUrl };
    }
    return pageOptions;
  }
}
