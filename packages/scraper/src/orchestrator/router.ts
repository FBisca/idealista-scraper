import type { CrawlRequest, HandlerFn } from './types.js';

export class Router {
  private readonly handlers: Map<string, HandlerFn>;
  private defaultHandler: HandlerFn | undefined;

  constructor() {
    this.handlers = new Map();
    this.defaultHandler = undefined;
  }

  addHandler(label: string, handler: HandlerFn): void {
    this.handlers.set(label, handler);
  }

  addDefaultHandler(handler: HandlerFn): void {
    this.defaultHandler = handler;
  }

  route(request: CrawlRequest): HandlerFn {
    if (request.label) {
      const handler = this.handlers.get(request.label);
      if (handler) {
        return handler;
      }
    }

    if (this.defaultHandler) {
      return this.defaultHandler;
    }

    const label = request.label ?? '(none)';
    throw new Error(
      `No handler registered for label "${label}" and no default handler set`,
    );
  }
}
