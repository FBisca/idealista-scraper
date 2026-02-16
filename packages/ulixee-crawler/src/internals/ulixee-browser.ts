import type { IHeroCreateOptions, Tab } from '@ulixee/hero';
import { Hero } from '@ulixee/hero/lib/extendables';
import type { CommonPage } from '@crawlee/browser-pool';

/**
 * Thin wrapper around Ulixee Hero that satisfies the BrowserPool's
 * `CommonBrowser` contract (`newPage()`, `close()`).
 *
 * Each UlixeeBrowser holds a single Hero instance that acts as
 * the "browser" for BrowserPool purposes.
 */
export class UlixeeBrowser {
  private readonly heroOptions: IHeroCreateOptions;
  private readonly hero: Hero;

  constructor(hero: Hero, heroOptions: IHeroCreateOptions = {}) {
    this.heroOptions = heroOptions;
    this.hero = hero;
  }

  async newPage(): Promise<UlixeePage> {
    const tab = await this.hero.newTab();
    return new UlixeePage(tab);
  }

  async close(): Promise<void> {
    this.hero.close();
  }

  /** Expose the active Hero instance (if any) */
  get activeHero(): Hero | undefined {
    return this.hero;
  }
}

export class UlixeePage implements CommonPage {
  readonly tab: Tab;

  constructor(tab: Tab) {
    this.tab = tab;
  }

  close(): Promise<unknown> {
    return this.tab.close();
  }

  url(): string | Promise<string> {
    return this.tab.url;
  }
}
