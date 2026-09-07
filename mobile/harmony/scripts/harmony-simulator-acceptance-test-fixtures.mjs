import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStoredHap } from './harmony-hap-test-archive.mjs'
import {
  BUNDLE_NAME,
  ENTRY_ABILITY,
  ENTRY_MODULE,
  PRESERVE_DATA_MODE,
  runHarmonySimulatorAcceptance
} from './run-harmony-simulator-acceptance.mjs'

export function writeValidAcceptanceHap(hapPath) {
  writeFileSync(
    hapPath,
    createStoredHap({
      'module.json': JSON.stringify({
        app: { bundleName: BUNDLE_NAME },
        module: {
          abilities: [{ name: ENTRY_ABILITY }],
          mainElement: ENTRY_ABILITY,
          name: ENTRY_MODULE
        }
      })
    })
  )
}

export const PAIRED_HOME_LAYOUT_FIXTURE = JSON.stringify({
  children: [
    { text: 'Orca' },
    { text: 'Welcome back' },
    { text: 'DESKTOPS' },
    { text: 'Host1' },
    { text: 'Host2' },
    { text: 'Host3' },
    { text: 'Host4' },
    { text: 'RESUME' },
    { text: 'TASKS' }
  ]
})

export const PAIRED_HOME_WITH_PAIR_DESKTOP_FOOTER_FIXTURE = JSON.stringify({
  children: [
    { text: 'Orca' },
    { text: 'Welcome back' },
    { text: 'DESKTOPS' },
    { text: 'Host1' },
    { text: 'RESUME' },
    { text: 'TASKS' },
    { text: 'Pair Desktop' }
  ]
})

export const EMPTY_HOME_LAYOUT_FIXTURE = JSON.stringify({
  children: [
    { text: 'Orca' },
    { text: 'Connect your desktop' },
    { text: 'Pair Desktop' },
    { text: 'HOW IT WORKS' }
  ]
})

export function defaultAcceptanceLayout(localPath, layoutAttempts) {
  if (layoutAttempts === 1) {
    return JSON.stringify({ text: '' })
  }
  if (localPath.endsWith('warm-deep-link.layout.json')) {
    return JSON.stringify({ text: 'Not a valid pairing code Back to home' })
  }
  if (localPath.endsWith('cold-deep-link.layout.json')) {
    return JSON.stringify({ text: 'Not a valid pairing code Back to home' })
  }
  return EMPTY_HOME_LAYOUT_FIXTURE
}

export function createPassingAcceptanceCommand({
  calls,
  dateEpochs = ['2000000000', '2000000004'],
  hilogOutput = '2000000001 101 101 I Orca normal',
  layoutForLocalPath,
  targetList = 'simulator-secret\tdevice\n'
}) {
  let dateReads = 0
  let layoutAttempts = 0
  let starts = 0
  return (_hdc, target, args) => {
    calls.push({ args, target })
    if (args.join(' ') === 'list targets') {
      return targetList
    }
    if (args[0] === 'version') {
      return 'HDC version 3.2.1'
    }
    if (args.join(' ') === 'shell date --help') {
      return 'Usage: date [+FORMAT]\n%s seconds since epoch'
    }
    if (args.join(' ') === 'shell date +%s') {
      const value = dateEpochs[Math.min(dateReads, dateEpochs.length - 1)]
      dateReads += 1
      return value
    }
    if (args[0] === 'install') {
      return 'installed'
    }
    if (args.at(-1) === 'const.product.model') {
      return 'Harmony Simulator'
    }
    if (args.at(-1) === 'const.ohos.apiversion') {
      return '12'
    }
    if (args.includes('aa') && args.includes('start')) {
      starts += 1
      return 'start ability successfully'
    }
    if (args.includes('pidof')) {
      if (starts === 0) {
        return ''
      }
      return starts >= 4 ? '202' : '101'
    }
    if (args.includes('dumpLayout')) {
      layoutAttempts += 1
      return ''
    }
    if (args.includes('file') && args.includes('recv')) {
      const localPath = args.at(-1)
      if (localPath.endsWith('.layout.json')) {
        writeFileSync(
          localPath,
          layoutForLocalPath?.({ layoutAttempts, localPath }) ??
            defaultAcceptanceLayout(localPath, layoutAttempts)
        )
      } else {
        writeFileSync(localPath, Buffer.from('png'))
      }
      return 'received'
    }
    if (args.includes('hilog')) {
      return typeof hilogOutput === 'function' ? hilogOutput() : hilogOutput
    }
    return 'ok'
  }
}

export async function runPreserveDataWithHilog(hilogOutput, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'orca-harmony-acceptance-preserve-fail-'))
  const outputDir = join(directory, 'evidence')
  const hapPath = join(directory, 'entry.hap')
  const calls = []
  try {
    writeValidAcceptanceHap(hapPath)
    return await runHarmonySimulatorAcceptance(
      {
        hap: hapPath,
        hdc: '/opt/hdc',
        mode: PRESERVE_DATA_MODE,
        outputDir,
        target: options.target ?? 'simulator-secret'
      },
      {
        command: createPassingAcceptanceCommand({
          calls,
          dateEpochs: options.dateEpochs,
          hilogOutput,
          targetList: options.targetList
        })
      }
    )
  } finally {
    rmSync(directory, { force: true, recursive: true })
  }
}
