import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { openHarmonyHapArchive } from './harmony-hap-archive.mjs'
import {
  CLEAN_INSTALL_MODE,
  PRESERVE_DATA_MODE,
  parseHarmonySimulatorAcceptanceMode,
  resolveHarmonySimulatorAcceptanceMode
} from './harmony-simulator-acceptance-mode.mjs'
import { REQUIRED_EMPTY_HOME_TEXT } from './harmony-simulator-layout-semantics.mjs'

export const BUNDLE_NAME = 'ai.stably.orca.harmony'
export const ENTRY_ABILITY = 'EntryAbility'
export const ENTRY_MODULE = 'entry'
export const INVALID_PAIRING_URI = 'orca://pair?code=TEST_INVALID'
export const REQUIRED_HOME_TEXT = REQUIRED_EMPTY_HOME_TEXT

const DARWIN_HDC = '/Applications/DevEco-Studio.app/Contents/sdk/default/openharmony/toolchains/hdc'

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function parseJson(content, name) {
  try {
    return JSON.parse(content.toString('utf8'))
  } catch {
    throw new Error(`HAP contains invalid ${name}`)
  }
}

export function parseAcceptanceArgs(argv) {
  const defaultHdc =
    process.env.HARMONY_HDC?.trim() ||
    process.env.HDC?.trim() ||
    (process.env.DEVECO_SDK_HOME?.trim()
      ? join(process.env.DEVECO_SDK_HOME.trim(), 'default', 'openharmony', 'toolchains', 'hdc')
      : process.env.DEVECO_HOME?.trim()
        ? join(process.env.DEVECO_HOME.trim(), 'sdk', 'default', 'openharmony', 'toolchains', 'hdc')
        : process.platform === 'darwin' && existsSync(DARWIN_HDC)
          ? DARWIN_HDC
          : 'hdc')
  const options = {
    hap: undefined,
    target: undefined,
    hdc: defaultHdc,
    mode: CLEAN_INSTALL_MODE,
    outputDir: resolve('.harmony-simulator-acceptance'),
    skipInstall: false
  }
  const valueOptions = new Map([
    ['--hap', 'hap'],
    ['--target', 'target'],
    ['--hdc', 'hdc'],
    ['--mode', 'mode'],
    ['--output-dir', 'outputDir']
  ])
  let modeWasSpecified = false
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--skip-install') {
      options.skipInstall = true
      continue
    }
    const key = valueOptions.get(argument)
    if (!key) {
      throw new Error(`Unknown option: ${argument}`)
    }
    const value = argv[index + 1]?.trim()
    if (!value || value.startsWith('--')) {
      throw new Error(`${argument} requires a value`)
    }
    if (key === 'mode') {
      options.mode = parseHarmonySimulatorAcceptanceMode(value)
      modeWasSpecified = true
    } else {
      options[key] = value
    }
    index += 1
  }
  const usage = [
    'Usage: run-harmony-simulator-acceptance.mjs --hap <file.hap>',
    '[--target <target>] [--hdc <hdc>] [--output-dir <dir>]',
    `[--mode ${CLEAN_INSTALL_MODE}|${PRESERVE_DATA_MODE}] [--skip-install]`
  ].join(' ')
  assert(options.hap, usage)
  options.mode = resolveHarmonySimulatorAcceptanceMode({
    mode: options.mode,
    modeWasSpecified,
    skipInstall: options.skipInstall
  })
  options.skipInstall = options.mode === PRESERVE_DATA_MODE
  options.hap = resolve(options.hap)
  options.outputDir = resolve(options.outputDir)
  return options
}

export function parseHdcTargets(output) {
  const targets = []
  for (const line of String(output).split(/\r?\n/u)) {
    const trimmed = line.trim()
    if (
      !trimmed ||
      trimmed.startsWith('[') ||
      /^\[?(?:empty|no devices|list of devices attached)\]?$/iu.test(trimmed)
    ) {
      continue
    }
    const target = trimmed.split(/\s+/u)[0]
    if (/^(?:offline|unauthorized|unknown|device)$/iu.test(target)) {
      continue
    }
    if (!targets.includes(target)) {
      targets.push(target)
    }
  }
  return targets
}

export function chooseHdcTarget(target, targetList) {
  if (target) {
    assert(targetList.includes(target), 'Requested HDC target is not connected')
    return target
  }
  assert(
    targetList.length === 1,
    `Expected exactly one connected HDC target; found ${targetList.length}`
  )
  return targetList[0]
}

export function inspectHarmonyAcceptanceHap(hapPath) {
  const archive = openHarmonyHapArchive(resolve(hapPath))
  const manifest = parseJson(archive.readEntry('module.json'), 'module.json')
  const app = manifest.app ?? {}
  const module = manifest.module ?? {}
  assert(app.bundleName === BUNDLE_NAME, `HAP bundle must be ${BUNDLE_NAME}`)
  assert(module.name === ENTRY_MODULE, `HAP entry module must be ${ENTRY_MODULE}`)
  assert(module.mainElement === ENTRY_ABILITY, `HAP main ability must be ${ENTRY_ABILITY}`)
  assert(
    module.abilities?.some((ability) => ability.name === ENTRY_ABILITY),
    `HAP does not declare ${ENTRY_ABILITY}`
  )
  return {
    bundleName: app.bundleName,
    entryAbility: ENTRY_ABILITY,
    entryModule: ENTRY_MODULE,
    sha256: sha256(readFileSync(resolve(hapPath)))
  }
}
