import { describe, it, expect, vi } from 'vitest';
import { UlixeeBrowser, UlixeePage } from './ulixee-browser.js';

describe('UlixeePage', () => {
  it('delegates url() to tab.url', () => {
    const fakeTab = {
      url: 'https://example.com',
      close: vi.fn().mockResolvedValue(undefined),
      cookieStorage: { getItems: vi.fn().mockResolvedValue([]) },
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const page = new UlixeePage(fakeTab as any);
    expect(page.url()).toBe('https://example.com');
  });

  it('delegates close() to tab.close', async () => {
    const fakeTab = {
      url: 'https://example.com',
      close: vi.fn().mockResolvedValue(undefined),
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const page = new UlixeePage(fakeTab as any);
    await page.close();
    expect(fakeTab.close).toHaveBeenCalledOnce();
  });
});

describe('UlixeeBrowser', () => {
  it('exposes activeHero', () => {
    const fakeHero = {
      newTab: vi.fn(),
      close: vi.fn(),
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const browser = new UlixeeBrowser(fakeHero as any);
    expect(browser.activeHero).toBe(fakeHero);
  });

  it('delegates close() to hero.close()', async () => {
    const fakeHero = {
      close: vi.fn().mockResolvedValue(undefined),
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const browser = new UlixeeBrowser(fakeHero as any);
    await browser.close();
    expect(fakeHero.close).toHaveBeenCalledOnce();
  });

  it('newPage() returns a UlixeePage wrapping a new tab', async () => {
    const fakeTab = {
      url: 'about:blank',
      close: vi.fn(),
    };
    const fakeHero = {
      newTab: vi.fn().mockResolvedValue(fakeTab),
      close: vi.fn(),
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const browser = new UlixeeBrowser(fakeHero as any);
    const page = await browser.newPage();

    expect(page).toBeInstanceOf(UlixeePage);
    expect(page.tab).toBe(fakeTab);
    expect(fakeHero.newTab).toHaveBeenCalledOnce();
  });
});
