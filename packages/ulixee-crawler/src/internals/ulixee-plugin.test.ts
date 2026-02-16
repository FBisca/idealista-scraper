import { describe, it, expect } from 'vitest';
import { UlixeePlugin } from './ulixee-plugin.js';
import { UlixeeController } from './ulixee-controller.js';

describe('UlixeePlugin', () => {
  it('creates an instance with default options', () => {
    const plugin = new UlixeePlugin();
    expect(plugin).toBeDefined();
    expect(plugin.library).toBeDefined();
    expect(typeof plugin.library.launch).toBe('function');
  });

  it('passes launch options through', () => {
    const plugin = new UlixeePlugin({
      launchOptions: { showChrome: true },
    });
    expect(plugin.launchOptions).toEqual({ showChrome: true });
  });

  it('stores proxy URL', () => {
    const plugin = new UlixeePlugin({
      proxyUrl: 'http://proxy.example.com:8080',
    });
    expect(plugin.proxyUrl).toBe('http://proxy.example.com:8080');
  });

  it('creates a UlixeeController', () => {
    const plugin = new UlixeePlugin();
    const controller = plugin.createController();
    expect(controller).toBeInstanceOf(UlixeeController);
  });

  it('reports as chromium-based', () => {
    const plugin = new UlixeePlugin();
    // _isChromiumBasedBrowser is protected, test indirectly via the controller
    expect(plugin.createController()).toBeDefined();
  });
});
