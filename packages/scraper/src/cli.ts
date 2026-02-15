#!/usr/bin/env node
import { z } from 'zod'
import { listArgsSchema, runListAction } from './actions/list.js'

type ParsedArgs = {
  command: string
  options: Record<string, string>
}

const cliInputSchema = z.discriminatedUnion('command', [
  z.object({
    command: z.literal('help'),
    options: z.record(z.string(), z.string())
  }),
  z.object({
    command: z.literal('list'),
    options: z.record(z.string(), z.string())
  })
])

function parseArgs(argv: string[]): ParsedArgs {
  const [rawCommand, ...rest] = argv
  const command = normalizeCommand(rawCommand)
  const options: Record<string, string> = {}

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]
    if (!arg?.startsWith('--')) {
      continue
    }

    const [key, maybeValue] = arg.slice(2).split('=', 2)
    if (!key) {
      continue
    }

    if (maybeValue !== undefined) {
      options[key] = maybeValue
      continue
    }

    const next = rest[index + 1]
    if (next && !next.startsWith('--')) {
      options[key] = next
      index += 1
      continue
    }

    options[key] = 'true'
  }

  return { command, options }
}

function normalizeCommand(command?: string): string {
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    return 'help'
  }

  return command
}

function printHelp(): void {
  console.log(`idealista-scraper CLI

Usage:
  cli help
  cli list --url="venta-viviendas/madrid-madrid/con-precio-hasta_360000,precio-desde_175000,metros-cuadrados-mas-de_40,solo-pisos,ascensor,plantas-intermedias,buen-estado/"
  cli list --url="https://www.idealista.com/venta-viviendas/madrid-madrid/"
  cli list --url="https://www.idealista.com/venta-viviendas/madrid-madrid/" --maxPages=3
  cli list --url="https://www.idealista.com/venta-viviendas/madrid-madrid/" --headless=false
  cli list --url="https://www.idealista.com/venta-viviendas/madrid-madrid/" --outputFile="./tmp/listings.json"
  cli list --url="https://www.idealista.com/venta-viviendas/madrid-madrid/" --pretty

Commands:
  help    Show this help message
  list    Scrape an Idealista listing page and print parsed JSON

List options:
  --url   Required for list. Accepts full URL or idealista path.
  --outputFile Optional for list. Writes JSON output to the given file path.
  --maxPages Optional for list. Maximum number of pages to fetch (default: 1).
  --headless Optional for list. Use false to show browser (default: true).
  --pretty Optional for list. Pretty-print JSON output.
`)
}

async function main(): Promise<number> {
  const { command, options } = parseArgs(process.argv.slice(2))
  const parsedCliInput = cliInputSchema.safeParse({ command, options })
    
  if (!parsedCliInput.success) {
    console.error(`Unknown command: ${command}`)
    printHelp()
    return 1
  }

  if (parsedCliInput.data.command === 'help') {
    printHelp()
    return 0
  }

  if (parsedCliInput.data.command === 'list') {
    const parsedListArgs = listArgsSchema.safeParse(parsedCliInput.data.options)
    if (!parsedListArgs.success) {
      console.error(parsedListArgs.error.issues[0]?.message ?? 'Invalid arguments')
      printHelp()
      return 1
    }

    return runListAction(parsedListArgs.data.url, {
      pretty: parsedListArgs.data.pretty,
      maxPages: parsedListArgs.data.maxPages,
      headless: parsedListArgs.data.headless,
      outputFile: parsedListArgs.data.outputFile
    })
  }

  printHelp()
  return 0
}

const exitCode = await main()
process.exitCode = exitCode
