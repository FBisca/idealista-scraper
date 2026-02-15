import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

function getPlatformTarget() {
  if (process.platform === 'darwin') return process.arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64'
  if (process.platform === 'linux') return process.arch === 'arm64' ? 'linux-arm64' : 'linux-x64'
  if (process.platform === 'win32') return process.arch === 'arm64' ? 'win32-arm64' : 'win32-x64'
  return `${process.platform}-${process.arch}`
}

function ensureUlixeeMitmSocketBinary() {
  let packageJsonPath

  try {
    packageJsonPath = require.resolve('@ulixee/unblocked-agent-mitm-socket/package.json')
  } catch {
    console.log('[postinstall] @ulixee/unblocked-agent-mitm-socket not installed, skipping native binary check')
    return
  }

  const packageDir = dirname(packageJsonPath)
  const platformTarget = getPlatformTarget()
  const connectBinaryPath = join(packageDir, 'dist', platformTarget, 'connect')

  if (existsSync(connectBinaryPath)) {
    console.log(`[postinstall] Ulixee MitmSocket binary present (${platformTarget})`)
    return
  }

  const installerPath = join(packageDir, 'install.js')
  console.log(`[postinstall] Ulixee MitmSocket binary missing (${platformTarget}), running installer...`)
  execFileSync(process.execPath, [installerPath], { stdio: 'inherit' })

  if (!existsSync(connectBinaryPath)) {
    throw new Error(
      `[postinstall] Ulixee MitmSocket binary still missing after install: ${connectBinaryPath}`
    )
  }

  console.log(`[postinstall] Ulixee MitmSocket binary installed (${platformTarget})`)
}

ensureUlixeeMitmSocketBinary()
