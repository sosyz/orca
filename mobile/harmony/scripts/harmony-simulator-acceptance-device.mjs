import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, posix, resolve } from 'node:path'
import { BUNDLE_NAME, sha256 } from './harmony-simulator-acceptance-options.mjs'
import {
  assertHomeLayout,
  assertPairingErrorLayout,
  classifyPairingErrorLayout,
  classifyHomeLayout,
  extractLayoutText
} from './harmony-simulator-layout-semantics.mjs'
import { isExpectedUninstallAbsentOutput } from './harmony-simulator-package-state.mjs'

const DEFAULT_WAIT_MS = 15_000
const DEFAULT_POLL_MS = 250
const DEFAULT_COMMAND_TIMEOUT_MS = 60_000

function commandResult(command, args, allowExpectedUninstall = false) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: DEFAULT_COMMAND_TIMEOUT_MS
  })
  if (result.error?.code === 'ETIMEDOUT') {
    throw new Error(`HDC command timed out after ${DEFAULT_COMMAND_TIMEOUT_MS} ms`)
  }
  if (result.error || result.status !== 0) {
    const output = `${result.stdout || ''}\n${result.stderr || ''}`
    if (allowExpectedUninstall && isExpectedUninstallAbsentOutput(output)) {
      return String(result.stdout || '')
    }
    throw new Error(`HDC command failed with exit ${result.status ?? 'error'}`)
  }
  return String(result.stdout || '')
}

export function hdcCommand(hdc, target, args) {
  return commandResult(
    hdc,
    target ? ['-t', target, ...args] : args,
    args[0] === 'uninstall' && args[1] === BUNDLE_NAME
  )
}

export function extractBundlePids(psOutput, bundleName = BUNDLE_NAME) {
  const pids = []
  for (const line of String(psOutput).split(/\r?\n/u)) {
    const trimmed = line.trim()
    if (!trimmed) {
      continue
    }
    const pidofPids = trimmed.split(/\s+/u)
    if (pidofPids.every((pid) => /^\d+$/u.test(pid))) {
      for (const pid of pidofPids) {
        if (!pids.includes(pid)) {
          pids.push(pid)
        }
      }
      continue
    }
    if (!line.includes(bundleName)) {
      continue
    }
    const match = line.match(/(?:^|\s)(\d+)(?=\s)/u)
    if (match && !pids.includes(match[1])) {
      pids.push(match[1])
    }
  }
  return pids
}

export async function recordPhase(
  command,
  hdc,
  target,
  outputDir,
  phase,
  pids,
  remoteDirectory,
  options = {}
) {
  const safeName = phase.replace(/[^a-z0-9-]+/giu, '-')
  const screenshotPath = resolve(outputDir, `${safeName}.png`)
  const layoutPath = resolve(outputDir, `${safeName}.layout.json`)
  const remoteScreenshot = posix.join(remoteDirectory, `${safeName}.png`)
  const remoteLayout = posix.join(remoteDirectory, `${safeName}.layout.json`)
  const deadline = Date.now() + DEFAULT_WAIT_MS
  let layout = ''
  let uiState
  while (true) {
    const layoutOutput = command(hdc, target, [
      'shell',
      'uitest',
      'dumpLayout',
      '-p',
      remoteLayout,
      '-a',
      '-b',
      BUNDLE_NAME
    ])
    command(hdc, target, ['file', 'recv', remoteLayout, layoutPath])
    if (!existsSync(layoutPath)) {
      writeFileSync(layoutPath, layoutOutput, { mode: 0o600 })
    }
    chmodSync(layoutPath, 0o600)
    layout = readFileSync(layoutPath, 'utf8')
    const visibleText = extractLayoutText(layout)
    let ready = false
    if (options.assertHome) {
      const homeLayout = classifyHomeLayout(layout)
      ready = homeLayout.recognized
      uiState = homeLayout.recognized ? homeLayout.kind : undefined
    } else if (options.assertPairing) {
      ready = classifyPairingErrorLayout(layout).recognized
    } else {
      ready = visibleText.length > 0
    }
    if (ready) {
      break
    }
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for ${phase} UI`)
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, DEFAULT_POLL_MS))
  }
  if (options.assertHome) {
    uiState = assertHomeLayout(layout)
  }
  if (options.assertPairing) {
    assertPairingErrorLayout(layout)
    uiState = 'pairing-error'
  }
  command(hdc, target, ['shell', 'uitest', 'screenCap', '-p', remoteScreenshot])
  command(hdc, target, ['file', 'recv', remoteScreenshot, screenshotPath])
  chmodSync(screenshotPath, 0o600)
  const result = {
    layout: basename(layoutPath),
    layoutSha256: sha256(readFileSync(layoutPath)),
    pids,
    screenshot: basename(screenshotPath),
    screenshotSha256: sha256(readFileSync(screenshotPath))
  }
  if (uiState) {
    result.uiState = uiState
  }
  return result
}

export async function waitForBundlePids(
  command,
  hdc,
  target,
  predicate = (pids) => pids.length > 0
) {
  const timeout = Number(process.env.HARMONY_ACCEPTANCE_TIMEOUT_MS) || DEFAULT_WAIT_MS
  const poll = Number(process.env.HARMONY_ACCEPTANCE_POLL_MS) || DEFAULT_POLL_MS
  const deadline = Date.now() + timeout
  while (true) {
    const pids = extractBundlePids(command(hdc, target, ['shell', 'pidof', BUNDLE_NAME]))
    if (predicate(pids)) {
      return pids
    }
    if (Date.now() >= deadline) {
      throw new Error('Timed out waiting for the Harmony app process')
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, poll))
  }
}
