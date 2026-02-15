import {
  type FetchContentOptions,
  type ParseContext,
  type WebContent
} from './types.js'

type ResolveParserResult<T> = {
  content: T
  pluginName?: string
}

async function resolveParserWithPlugins<T>(
  content: WebContent<string>,
  options: FetchContentOptions<T>,
  context: ParseContext
): Promise<ResolveParserResult<T>> {
  const plugins = options.plugins ?? []

  for (const plugin of plugins) {
    const shouldApply = await plugin.applies({ content, context })
    if (!shouldApply) continue

    const pluginContent = await plugin.extract(content, context)
    return {
      content: pluginContent,
      pluginName: plugin.name
    }
  }

  return {
    content: await options.htmlParser.extract(content, context)
  }
}

export type { ResolveParserResult }
export { resolveParserWithPlugins }
