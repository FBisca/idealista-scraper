import { describe, it, expect, vi } from 'vitest';
import { UlixeeController } from './ulixee-controller.js';
import { UlixeePlugin } from './ulixee-plugin.js';
import { UlixeeBrowser, UlixeePage } from './ulixee-browser.js';

function createControllerWithFakeBrowser() {
  const fakeTab = {
    url: 'https://example.com',
    close: vi.fn().mockResolvedValue(undefined),
    cookieStorage: {
      getItems: vi.fn().mockResolvedValue([
        {
          name: 'session',
          value: 'abc',
          domain: '.example.com',
          path: '/',
          httpOnly: true,
          secure: true,
          sameSite: 'Lax',
        },
      ]),
    },
  };

  const fakeHero = {
    newTab: vi.fn().mockResolvedValue(fakeTab),
    close: vi.fn().mockResolvedValue(undefined),
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const browser = new UlixeeBrowser(fakeHero as any);
  const plugin = new UlixeePlugin();
  const controller = new UlixeeController(plugin);

  // Simulate BrowserPool assigning the browser
  controller.assignBrowser(browser, plugin.createLaunchContext());

  return { controller, browser, fakeHero, fakeTab };
}

describe('UlixeeController', () => {
  it('creates a new page via _newPage', async () => {
    const { controller, fakeHero } = createControllerWithFakeBrowser();
    controller.activate();

    const page = await controller.newPage();
    expect(page).toBeInstanceOf(UlixeePage);
    expect(fakeHero.newTab).toHaveBeenCalledOnce();
  });

  it('delegates close to browser.close()', async () => {
    const { controller, fakeHero } = createControllerWithFakeBrowser();
    controller.activate();

    await controller.close();
    expect(fakeHero.close).toHaveBeenCalled();
  });

  it('getCookies returns mapped cookies', async () => {
    const { controller, fakeTab } = createControllerWithFakeBrowser();
    controller.activate();

    const page = await controller.newPage();
    const cookies = await controller.getCookies(page);

    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toEqual(
      expect.objectContaining({
        name: 'session',
        value: 'abc',
        domain: '.example.com',
      }),
    );
    expect(fakeTab.cookieStorage.getItems).toHaveBeenCalled();
  });

  it('normalizeProxyOptions adds upstreamProxyUrl', () => {
    const { controller } = createControllerWithFakeBrowser();

    const result = controller.normalizeProxyOptions('http://proxy:8080', {
      foo: 'bar',
    });
    expect(result).toEqual({
      foo: 'bar',
      upstreamProxyUrl: 'http://proxy:8080',
    });
  });

  it('normalizeProxyOptions passes through when no proxy', () => {
    const { controller } = createControllerWithFakeBrowser();

    const opts = { foo: 'bar' };
    const result = controller.normalizeProxyOptions(undefined, opts);
    expect(result).toEqual(opts);
  });
});
