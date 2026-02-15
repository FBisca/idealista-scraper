import {
  InteractiveWebContentParser,
  InteractiveParseContext,
  type FetchContentOptions,
  type ParseContext,
  type WebContent,
} from './types.js';

type ResolveParserResult<T> = {
  content: T;
  pluginName?: string;
};

class ParserInteractionUnsupportedError extends Error {
  readonly code = 'unsupported-interaction' as const;
  readonly parserName: string;
  readonly engine: string;

  constructor(parserName: string, engine: string) {
    super(
      `Parser "${parserName}" requires interactive DOM capabilities, but engine "${engine}" does not provide them`,
    );
    this.name = 'ParserInteractionUnsupportedError';
    this.parserName = parserName;
    this.engine = engine;
  }
}

async function resolveParserWithPlugins<T>(
  content: WebContent<string>,
  options: FetchContentOptions<T>,
  context: ParseContext | InteractiveParseContext,
): Promise<ResolveParserResult<T>> {
  const isInteractionContext = 'interaction' in context;
  const plugins =
    options.plugins?.filter(
      (plugin) =>
        !isInteractionContext ||
        (plugin instanceof InteractiveWebContentParser && isInteractionContext),
    ) ?? [];

  for (const plugin of plugins) {
    const shouldApply = await plugin.applies({ content, context });
    if (!shouldApply) continue;

    const pluginContent = await plugin.extract(content, context);
    return {
      content: pluginContent,
      pluginName: plugin.name,
    };
  }

  return {
    content: await options.htmlParser.extract(content, context),
  };
}

export type { ResolveParserResult };
export { resolveParserWithPlugins, ParserInteractionUnsupportedError };
