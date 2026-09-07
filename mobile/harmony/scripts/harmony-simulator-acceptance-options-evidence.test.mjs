import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createStoredHap } from './harmony-hap-test-archive.mjs'
import {
  BUNDLE_NAME,
  CLEAN_INSTALL_MODE,
  ENTRY_ABILITY,
  ENTRY_MODULE,
  INVALID_PAIRING_URI,
  PRESERVE_DATA_MODE,
  REQUIRED_EMPTY_HOME_TEXT,
  assertHomeLayout,
  assertPairingErrorLayout,
  chooseHdcTarget,
  classifyFatalLogs,
  classifyHomeLayout,
  extractBundlePids,
  extractLayoutText,
  filterHilogByPids,
  inspectHarmonyAcceptanceHap,
  isExpectedUninstallAbsentOutput,
  parseAcceptanceArgs,
  parseDeviceDateEpochMs,
  parseHdcTargets,
  parseHilogTimestampMs,
  remoteAcceptanceDirectory,
  sanitizeLog,
  scopeHilogToPidEpochWindow
} from './run-harmony-simulator-acceptance.mjs'
import {
  PAIRED_HOME_LAYOUT_FIXTURE,
  PAIRED_HOME_WITH_PAIR_DESKTOP_FOOTER_FIXTURE,
  writeValidAcceptanceHap
} from './harmony-simulator-acceptance-test-fixtures.mjs'

test('accepts only an explicit missing-bundle uninstall result', () => {
  assert.equal(isExpectedUninstallAbsentOutput('Failure: package is not installed'), true)
  assert.equal(isExpectedUninstallAbsentOutput('package does not exist'), true)
  assert.equal(isExpectedUninstallAbsentOutput('file not found'), false)
  assert.equal(isExpectedUninstallAbsentOutput('uninstall failed: package not installed'), false)
  assert.equal(isExpectedUninstallAbsentOutput('permission denied: package not found'), false)
  assert.equal(isExpectedUninstallAbsentOutput('permission denied'), false)
  assert.equal(isExpectedUninstallAbsentOutput('uninstall failed'), false)
})

test('parses the bounded acceptance CLI and never invents a target', () => {
  const cleanOptions = parseAcceptanceArgs(['--hap', './release.hap'])
  assert.equal(cleanOptions.mode, CLEAN_INSTALL_MODE)
  assert.equal(cleanOptions.skipInstall, false)

  const options = parseAcceptanceArgs([
    '--hap',
    './release.hap',
    '--target',
    'simulator-one',
    '--hdc',
    '/opt/hdc',
    '--mode',
    'preserve-data',
    '--output-dir',
    './evidence'
  ])
  assert.equal(options.hdc, '/opt/hdc')
  assert.equal(options.target, 'simulator-one')
  assert.equal(options.mode, PRESERVE_DATA_MODE)
  assert.equal(options.skipInstall, true)
  assert.equal(
    parseAcceptanceArgs(['--hap', './release.hap', '--skip-install']).mode,
    PRESERVE_DATA_MODE
  )
  assert.throws(
    () => parseAcceptanceArgs(['--hap', 'release.hap', '--target']),
    /requires a value/u
  )
  assert.throws(
    () =>
      parseAcceptanceArgs(['--hap', 'release.hap', '--mode', 'clean-install', '--skip-install']),
    /cannot be used/u
  )
  assert.throws(
    () => parseAcceptanceArgs(['--hap', 'release.hap', '--mode', 'local']),
    /Unsupported Harmony simulator acceptance mode/u
  )
  assert.throws(() => parseAcceptanceArgs(['--hap', 'release.hap', '--bogus']), /Unknown option/u)
})

test('requires one connected simulator when target is omitted', () => {
  assert.deepEqual(parseHdcTargets('simulator-one\tdevice\n'), ['simulator-one'])
  assert.deepEqual(parseHdcTargets('[Empty]\n'), [])
  assert.equal(chooseHdcTarget(undefined, ['simulator-one']), 'simulator-one')
  assert.throws(() => chooseHdcTarget(undefined, []), /exactly one/u)
  assert.throws(() => chooseHdcTarget(undefined, ['one', 'two']), /exactly one/u)
  assert.throws(() => chooseHdcTarget('missing', ['simulator-one']), /not connected/u)
  assert.throws(() => chooseHdcTarget('missing', []), /not connected/u)
})

test('accepts only verified device epoch seconds for preserve-data clock bounds', () => {
  assert.equal(parseDeviceDateEpochMs('2000000000\n'), 2_000_000_000_000)
  assert.throws(() => parseDeviceDateEpochMs(''), /did not return epoch seconds/u)
  assert.throws(
    () => parseDeviceDateEpochMs('Sun Sep 06 12:00:00'),
    /did not return epoch seconds/u
  )
  assert.throws(() => parseDeviceDateEpochMs('2000000000 extra'), /did not return epoch seconds/u)
})

test('validates only the HAP manifest identity required by simulator acceptance', () => {
  const directory = mkdtempSync(join(tmpdir(), 'orca-harmony-acceptance-hap-'))
  try {
    const hapPath = join(directory, 'release.hap')
    writeValidAcceptanceHap(hapPath)
    const identity = inspectHarmonyAcceptanceHap(hapPath)
    assert.equal(identity.bundleName, BUNDLE_NAME)
    assert.equal(identity.entryAbility, ENTRY_ABILITY)
    assert.equal(identity.entryModule, ENTRY_MODULE)

    writeFileSync(
      hapPath,
      createStoredHap({
        'module.json': JSON.stringify({
          app: { bundleName: 'not.orca' },
          module: {
            abilities: [{ name: ENTRY_ABILITY }],
            mainElement: ENTRY_ABILITY,
            name: ENTRY_MODULE
          }
        })
      })
    )
    assert.throws(() => inspectHarmonyAcceptanceHap(hapPath), /bundle must be/u)
  } finally {
    rmSync(directory, { force: true, recursive: true })
  }
})

test('filters and classifies PID-scoped hilog without retaining the target or pairing URI', () => {
  const raw = [
    '08-30 10:00:00.000 101 101 I Orca normal',
    '08-30 10:00:00.001 202 202 F Orca fatal crash',
    '08-30 10:00:00.002 pid=101 I Orca password=do-not-record',
    '08-30 10:00:00.003 303 303 I unrelated'
  ].join('\n')
  const filtered = filterHilogByPids(raw, ['101'])
  const safe = sanitizeLog(filtered, ['simulator-secret', INVALID_PAIRING_URI])
  assert.match(safe, /normal/u)
  assert.match(safe, /password=<redacted>/u)
  assert.doesNotMatch(safe, /simulator-secret/u)
  assert.deepEqual(classifyFatalLogs(`${safe}\nFATAL unrelated`), [
    { category: 'fatal', line: 'FATAL unrelated' }
  ])
  assert.deepEqual(
    classifyFatalLogs('JSPackagerClient localhost:8081\nLoaded bundle from rawfile resource'),
    []
  )
})

test('bounds preserve-data hilog to the current PID and time window', () => {
  const startedAtMs = 1_800_000_000_000
  const completedAtMs = startedAtMs + 2_000
  const scoped = scopeHilogToPidEpochWindow(
    [
      `${(startedAtMs - 60_000) / 1000} 101 101 F Orca fatal before this run`,
      `${(startedAtMs + 500) / 1000} 101 101 I Orca current run`,
      `${(completedAtMs + 60_000) / 1000} 101 101 F Orca fatal after this run`,
      `${(startedAtMs + 500) / 1000} 303 303 F Orca fatal wrong PID`,
      'no timestamp 101 F Orca fatal without a bound'
    ].join('\n'),
    { allowanceMs: 0, completedAtMs, pids: ['101'], startedAtMs }
  )

  assert.match(scoped.text, /current run/u)
  assert.doesNotMatch(scoped.text, /fatal before/u)
  assert.doesNotMatch(scoped.text, /fatal after/u)
  assert.doesNotMatch(scoped.text, /wrong PID/u)
  assert.doesNotMatch(scoped.text, /without a bound/u)
  assert.equal(scoped.keptLineCount, 1)
  assert.equal(scoped.droppedBeforeWindowLineCount, 1)
  assert.equal(scoped.droppedAfterWindowLineCount, 1)
  assert.equal(scoped.unexpectedPidLineCount, 1)
  assert.equal(scoped.unverifiableLineCount, 1)
  assert.equal(parseHilogTimestampMs(`${startedAtMs / 1000} 101 101 I Orca`), startedAtMs)
  assert.equal(parseHilogTimestampMs('08-30 10:00:00.000 101 101 I Orca'), undefined)
})

test('recognizes empty and paired home layouts without accepting arbitrary text', () => {
  assert.deepEqual(REQUIRED_EMPTY_HOME_TEXT, [
    'Connect your desktop',
    'Pair Desktop',
    'How it works'
  ])
  assert.equal(
    assertHomeLayout('Orca\nConnect your desktop\nPair Desktop\nHOW IT WORKS'),
    'empty-home'
  )
  assert.equal(assertHomeLayout('Connect your desktop\nPair Desktop\nHow it works'), 'empty-home')
  assert.equal(assertHomeLayout(PAIRED_HOME_LAYOUT_FIXTURE), 'paired-home')
  assert.equal(assertHomeLayout(PAIRED_HOME_WITH_PAIR_DESKTOP_FOOTER_FIXTURE), 'paired-home')
  assert.deepEqual(classifyHomeLayout(PAIRED_HOME_LAYOUT_FIXTURE), {
    kind: 'paired-home',
    missing: { emptyHome: [], pairedHome: [] },
    recognized: true
  })
  assert.equal(
    extractLayoutText({
      children: [
        { text: 'Connect your desktop' },
        { text: 'Pair Desktop', visible: false },
        { text: 'HOW IT WORKS' },
        { text: 'DESKTOPS' },
        { text: 'TASKS', visible: 'true' },
        { originalText: 'RESUME' }
      ]
    }),
    'Connect your desktop\nHOW IT WORKS\nDESKTOPS\nTASKS\nRESUME'
  )
  assert.throws(
    () => assertHomeLayout('Welcome back\nPair Desktop'),
    /empty-home missing: Connect your desktop/u
  )
  assert.throws(
    () => assertHomeLayout('Connect your desktop\nPair Desktop'),
    /empty-home missing: How it works/u
  )
  assert.throws(() => assertHomeLayout('Orca\nHost1'), /paired-home missing: Welcome back/u)
  assert.equal(assertPairingErrorLayout('Not a valid pairing code\nBack to home'), true)
  assert.throws(() => assertPairingErrorLayout('Not a valid pairing code'), /Back to home/u)
  assert.match(
    remoteAcceptanceDirectory('fixed-run'),
    /^\/data\/local\/tmp\/orca-harmony-acceptance-[a-f0-9]{16}$/u
  )
})

test('PID extraction handles common Harmony ps rows', () => {
  assert.deepEqual(
    extractBundlePids(
      `User 101 1 0 0 /data/app/${BUNDLE_NAME}\nUser 202 1 0 0 other\nUser 101 1 0 0 /data/app/${BUNDLE_NAME}`
    ),
    ['101']
  )
})
