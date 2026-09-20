#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { cleanupHarmonyAcceptanceTarget } from './harmony-simulator-package-state.mjs'
import {
  PRESERVE_DATA_MODE,
  harmonySimulatorAcceptanceModeEvidence,
  harmonySimulatorAcceptanceModePolicy,
  resolveHarmonySimulatorAcceptanceMode
} from './harmony-simulator-acceptance-mode.mjs'
import {
  readHarmonyDeviceEpochMs,
  verifyHarmonyDeviceDateEpochSupport
} from './harmony-simulator-device-clock.mjs'
import {
  hdcCommand,
  recordPhase,
  waitForBundlePids
} from './harmony-simulator-acceptance-device.mjs'
import {
  acceptanceArtifactEvidence,
  acceptanceFailureEvidence,
  collectLogEvidence,
  githubSourceEvidence,
  remoteAcceptanceDirectory,
  sanitizeLog,
  writeAcceptanceEvidence
} from './harmony-simulator-acceptance-evidence.mjs'
import {
  BUNDLE_NAME,
  ENTRY_ABILITY,
  ENTRY_MODULE,
  INVALID_PAIRING_URI,
  chooseHdcTarget,
  inspectHarmonyAcceptanceHap,
  parseAcceptanceArgs,
  parseHdcTargets,
  sha256
} from './harmony-simulator-acceptance-options.mjs'

export { isExpectedUninstallAbsentOutput } from './harmony-simulator-package-state.mjs'
export {
  CLEAN_INSTALL_MODE,
  PRESERVE_DATA_MODE,
  harmonySimulatorAcceptanceModeEvidence,
  harmonySimulatorAcceptanceModePolicy,
  parseHarmonySimulatorAcceptanceMode,
  resolveHarmonySimulatorAcceptanceMode
} from './harmony-simulator-acceptance-mode.mjs'
export {
  parseDeviceDateEpochMs,
  readHarmonyDeviceEpochMs,
  verifyHarmonyDeviceDateEpochSupport
} from './harmony-simulator-device-clock.mjs'
export {
  REQUIRED_EMPTY_HOME_TEXT,
  REQUIRED_PAIRED_HOME_TEXT,
  REQUIRED_PAIRING_TEXT,
  assertHomeLayout,
  assertPairingErrorLayout,
  classifyPairingErrorLayout,
  classifyHomeLayout,
  extractLayoutText
} from './harmony-simulator-layout-semantics.mjs'
export {
  parseHilogTimestampMs,
  scopeHilogToPidEpochWindow
} from './harmony-simulator-log-window.mjs'
export {
  classifyFatalLogs,
  filterHilogByPids,
  sanitizeLog,
  writeAcceptanceEvidence
} from './harmony-simulator-acceptance-evidence.mjs'
export {
  BUNDLE_NAME,
  ENTRY_ABILITY,
  ENTRY_MODULE,
  INVALID_PAIRING_URI,
  REQUIRED_HOME_TEXT,
  chooseHdcTarget,
  inspectHarmonyAcceptanceHap,
  parseAcceptanceArgs,
  parseHdcTargets
} from './harmony-simulator-acceptance-options.mjs'
export { remoteAcceptanceDirectory } from './harmony-simulator-acceptance-evidence.mjs'
export { extractBundlePids, waitForBundlePids } from './harmony-simulator-acceptance-device.mjs'

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

export async function runHarmonySimulatorAcceptance(options, dependencies = {}) {
  const command = dependencies.command ?? hdcCommand
  const mode = resolveHarmonySimulatorAcceptanceMode(options)
  const modePolicy = harmonySimulatorAcceptanceModePolicy(mode)
  const hdc = options.hdc
  const hap = inspectHarmonyAcceptanceHap(options.hap)
  mkdirSync(options.outputDir, { recursive: true, mode: 0o700 })
  let target
  const list = command(hdc, undefined, ['list', 'targets'])
  target = chooseHdcTarget(options.target, parseHdcTargets(list))
  const targetHash = sha256(target)
  const remoteDirectory = remoteAcceptanceDirectory(
    `${Date.now()}-${process.pid}-${options.outputDir}`
  )
  const evidence = {
    acceptance: 'simulator',
    bundleName: hap.bundleName,
    ...acceptanceArtifactEvidence(mode, hap),
    ...harmonySimulatorAcceptanceModeEvidence(mode),
    schemaVersion: 1,
    targetHash,
    timestamp: new Date().toISOString(),
    phases: {}
  }
  const source = githubSourceEvidence(process.env)
  if (source) {
    evidence.source = source
  }
  let pids = []
  let installedByRunner = false
  let currentPhase = 'preflight'
  try {
    try {
      const hdcVersion = command(hdc, undefined, ['version']).match(/\d+(?:\.\d+){1,3}/u)?.[0]
      if (hdcVersion) {
        evidence.hdcVersion = hdcVersion
      }
    } catch {
      // Version is optional evidence; acceptance commands remain authoritative.
    }
    for (const [key, property] of [
      ['deviceModel', 'const.product.model'],
      ['harmonyApi', 'const.ohos.apiversion'],
      ['harmonyFullName', 'const.ohos.fullname']
    ]) {
      try {
        const value = command(hdc, target, ['shell', 'param', 'get', property]).trim()
        if (value) {
          evidence[key] = sanitizeLog(value, [target])
        }
      } catch {
        // Device metadata is optional on older simulator images.
      }
    }
    assert(
      /(?:emulator|simulator)/iu.test(evidence.deviceModel ?? ''),
      'Harmony acceptance target is not a simulator'
    )
    assert(
      /^\d+$/u.test(evidence.harmonyApi ?? '') && Number(evidence.harmonyApi) >= 12,
      'Harmony simulator API metadata is missing or unsupported'
    )
    currentPhase = 'prepare-target'
    command(hdc, target, ['shell', 'mkdir', '-p', remoteDirectory])
    let logStartedAtMs = Date.now()
    let deviceClock
    if (mode === PRESERVE_DATA_MODE) {
      const verifiedClock = verifyHarmonyDeviceDateEpochSupport(command, hdc, target)
      logStartedAtMs = verifiedClock.startedAtMs
      deviceClock = verifiedClock.clock
    }
    if (modePolicy.clearGlobalHilogBeforeRun) {
      command(hdc, target, ['shell', 'hilog', '-r'])
    }
    if (modePolicy.installHap) {
      command(hdc, target, ['uninstall', BUNDLE_NAME])
      command(hdc, target, ['install', '-r', options.hap])
      installedByRunner = true
    }
    currentPhase = 'cold-launch'
    command(hdc, target, ['shell', 'aa', 'force-stop', BUNDLE_NAME])
    command(hdc, target, [
      'shell',
      'aa',
      'start',
      '-a',
      ENTRY_ABILITY,
      '-b',
      BUNDLE_NAME,
      '-m',
      ENTRY_MODULE
    ])
    pids = await waitForBundlePids(command, hdc, target)
    evidence.phases.coldLaunch = await recordPhase(
      command,
      hdc,
      target,
      options.outputDir,
      'cold-launch',
      pids,
      remoteDirectory,
      { assertHome: true }
    )

    currentPhase = 'warm-deep-link'
    command(hdc, target, [
      'shell',
      'aa',
      'start',
      '-a',
      ENTRY_ABILITY,
      '-b',
      BUNDLE_NAME,
      '-m',
      ENTRY_MODULE,
      '-U',
      INVALID_PAIRING_URI,
      '-A',
      'ohos.want.action.viewData'
    ])
    const warmPids = await waitForBundlePids(command, hdc, target, (candidatePids) =>
      candidatePids.some((pid) => pids.includes(pid))
    )
    evidence.phases.warmDeepLink = await recordPhase(
      command,
      hdc,
      target,
      options.outputDir,
      'warm-deep-link',
      warmPids,
      remoteDirectory,
      { assertPairing: true }
    )

    currentPhase = 'background-foreground'
    command(hdc, target, ['shell', 'uitest', 'uiInput', 'keyEvent', 'Home'])
    command(hdc, target, [
      'shell',
      'aa',
      'start',
      '-a',
      ENTRY_ABILITY,
      '-b',
      BUNDLE_NAME,
      '-m',
      ENTRY_MODULE
    ])
    const foregroundPids = await waitForBundlePids(command, hdc, target, (candidatePids) =>
      candidatePids.some((pid) => warmPids.includes(pid))
    )
    evidence.phases.backgroundForeground = await recordPhase(
      command,
      hdc,
      target,
      options.outputDir,
      'background-foreground',
      foregroundPids,
      remoteDirectory
    )

    currentPhase = 'cold-deep-link'
    command(hdc, target, ['shell', 'aa', 'force-stop', BUNDLE_NAME])
    command(hdc, target, [
      'shell',
      'aa',
      'start',
      '-a',
      ENTRY_ABILITY,
      '-b',
      BUNDLE_NAME,
      '-m',
      ENTRY_MODULE,
      '-U',
      INVALID_PAIRING_URI,
      '-A',
      'ohos.want.action.viewData'
    ])
    const coldPairPids = await waitForBundlePids(
      command,
      hdc,
      target,
      (candidatePids) =>
        candidatePids.length > 0 && candidatePids.every((pid) => !pids.includes(pid))
    )
    evidence.phases.coldDeepLink = await recordPhase(
      command,
      hdc,
      target,
      options.outputDir,
      'cold-deep-link',
      coldPairPids,
      remoteDirectory,
      { assertPairing: true }
    )

    currentPhase = 'logs'
    const logCompletedAtMs =
      mode === PRESERVE_DATA_MODE ? readHarmonyDeviceEpochMs(command, hdc, target) : Date.now()
    if (mode === PRESERVE_DATA_MODE) {
      assert(
        logCompletedAtMs >= logStartedAtMs,
        'Device shell date +%s went backwards during preserve-data acceptance'
      )
    }
    const logs = collectLogEvidence(
      command,
      hdc,
      target,
      [...new Set([...pids, ...warmPids, ...foregroundPids, ...coldPairPids])],
      {
        completedAtMs: logCompletedAtMs,
        mode,
        startedAtMs: logStartedAtMs
      }
    )
    if (deviceClock) {
      logs.scope.clock = {
        ...deviceClock,
        endEpochSeconds: Math.floor(logCompletedAtMs / 1000)
      }
    }
    const logPath = resolve(options.outputDir, 'hilog.filtered.txt')
    writeFileSync(logPath, `${logs.text}\n`, { mode: 0o600 })
    evidence.logs = {
      fatal: logs.fatal,
      path: basename(logPath),
      scope: logs.scope,
      sha256: sha256(readFileSync(logPath))
    }
    assert(
      logs.fatal.length === 0,
      `Filtered hilog contains fatal entries: ${logs.fatal
        .map(({ category }) => category)
        .join(', ')}`
    )
    evidence.completedAt = new Date().toISOString()
    evidence.status = 'passed'
    return { ...evidence, evidencePath: writeAcceptanceEvidence(options.outputDir, evidence) }
  } catch (error) {
    evidence.completedAt = new Date().toISOString()
    evidence.failure = acceptanceFailureEvidence(error, currentPhase, options.outputDir, target)
    evidence.status = 'failed'
    const evidencePath = writeAcceptanceEvidence(options.outputDir, evidence)
    if (error instanceof Error) {
      error.evidencePath = evidencePath
    }
    throw error
  } finally {
    if (target) {
      cleanupHarmonyAcceptanceTarget(command, hdc, target, remoteDirectory, installedByRunner)
    }
  }
}

function isMainModule() {
  return process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
}

if (isMainModule()) {
  const options = parseAcceptanceArgs(process.argv.slice(2))
  const result = await runHarmonySimulatorAcceptance(options)
  console.log(`[harmony-acceptance] Passed ${result.bundleName}; evidence: ${result.evidencePath}`)
}
