import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  BUNDLE_NAME,
  CLEAN_INSTALL_MODE,
  INVALID_PAIRING_URI,
  PRESERVE_DATA_MODE,
  runHarmonySimulatorAcceptance
} from './run-harmony-simulator-acceptance.mjs'
import { recordPhase } from './harmony-simulator-acceptance-device.mjs'
import {
  PAIRED_HOME_LAYOUT_FIXTURE,
  createPassingAcceptanceCommand,
  defaultAcceptanceLayout,
  writeValidAcceptanceHap
} from './harmony-simulator-acceptance-test-fixtures.mjs'

test('runs the acceptance transcript with safe HDC arguments and exact cleanup', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'orca-harmony-acceptance-run-'))
  const outputDir = join(directory, 'evidence')
  const hapPath = join(directory, 'entry.hap')
  const calls = []
  try {
    writeValidAcceptanceHap(hapPath)
    const command = createPassingAcceptanceCommand({
      calls,
      hilogOutput: '08-30 10:00:00.000 101 101 I Orca normal'
    })
    const result = await runHarmonySimulatorAcceptance(
      { hap: hapPath, hdc: '/opt/hdc', outputDir, skipInstall: false },
      { command }
    )
    assert.equal(result.status, 'passed')
    assert.equal(result.schemaVersion, 1)
    assert.equal(result.acceptance, 'simulator')
    assert.equal(result.mode, CLEAN_INSTALL_MODE)
    assert.equal(result.cleanInstall, true)
    assert.equal(result.publishableCleanAcceptance, true)
    assert.equal(result.dataPolicy.appInstall, 'uninstall-then-install-exact-hap')
    assert.equal(result.dataPolicy.globalHilog, 'cleared-before-run')
    assert.equal(result.artifactBinding.verified, true)
    assert.equal(result.artifactBinding.kind, 'installed-by-runner')
    assert.equal(result.artifactBinding.sha256, result.hapSha256)
    assert.equal(result.deviceModel, 'Harmony Simulator')
    assert.equal(result.harmonyApi, '12')
    assert.equal(result.phases.coldLaunch.layout, 'cold-launch.layout.json')
    assert.equal(result.phases.coldLaunch.screenshot, 'cold-launch.png')
    assert.equal(result.phases.coldLaunch.uiState, 'empty-home')
    assert.equal(result.phases.warmDeepLink.uiState, 'pairing-error')
    assert.equal(result.phases.coldDeepLink.uiState, 'pairing-error')
    assert.match(result.phases.coldLaunch.layoutSha256, /^[0-9a-f]{64}$/u)
    assert.match(result.phases.coldLaunch.screenshotSha256, /^[0-9a-f]{64}$/u)
    assert.equal(result.logs.path, 'hilog.filtered.txt')
    assert.equal(result.logs.scope.globalBufferCleared, true)
    assert.equal(result.logs.scope.pidFiltered, true)
    assert.equal(result.logs.scope.timeWindow.enabled, false)
    assert.match(result.logs.sha256, /^[0-9a-f]{64}$/u)

    const allArgs = calls.map(({ args }) => args)
    const uninstallCalls = allArgs.filter((args) => args[0] === 'uninstall')
    assert.equal(uninstallCalls.length, 2)
    assert.deepEqual(uninstallCalls, [
      ['uninstall', BUNDLE_NAME],
      ['uninstall', BUNDLE_NAME]
    ])
    assert.equal(
      calls.filter(({ target, args }) => target === 'simulator-secret' && args[0] === 'uninstall')
        .length,
      2
    )
    assert.deepEqual(
      allArgs.find((args) => args[0] === 'install'),
      ['install', '-r', hapPath]
    )
    assert.equal(
      allArgs.findIndex((args) => args[0] === 'uninstall') <
        allArgs.findIndex((args) => args[0] === 'install'),
      true
    )
    assert.equal(
      allArgs.some((args) => args.includes('snapshot_display')),
      false
    )
    assert.equal(
      allArgs.some((args) => args.includes('move-to-background')),
      false
    )
    assert.equal(
      allArgs.some((args) => args.includes('screenCap')),
      true
    )
    assert.equal(allArgs.filter((args) => args.includes('dumpLayout')).length >= 5, true)
    assert.equal(
      allArgs.some(
        (args) =>
          args.includes('dumpLayout') &&
          args.includes('-a') &&
          args.includes('-b') &&
          args.includes(BUNDLE_NAME)
      ),
      true
    )
    assert.equal(
      allArgs.some((args) => args.includes('keyEvent') && args.includes('Home')),
      true
    )
    assert.equal(
      allArgs.some((args) => args.includes(INVALID_PAIRING_URI)),
      true
    )
    assert.equal(
      allArgs.some((args) => args.includes('hilog') && args.includes('-r')),
      true
    )
    assert.equal(
      allArgs.some(
        (args) => args.includes('hilog') && args.includes('-P') && args.includes('101,202')
      ),
      true
    )
    const cleanup = allArgs.find((args) => args.includes('rm') && args.includes('-rf'))
    assert.ok(cleanup)
    assert.match(cleanup.at(-1), /^\/data\/local\/tmp\/orca-harmony-acceptance-[a-f0-9]{16}$/u)
    assert.equal(
      readFileSync(join(outputDir, 'evidence.json'), 'utf8').includes('simulator-secret'),
      false
    )
    assert.equal(
      readFileSync(join(outputDir, 'evidence.json'), 'utf8').includes(INVALID_PAIRING_URI),
      false
    )
    assert.equal(existsSync(join(outputDir, 'warm-deep-link.layout.json')), true)
    assert.equal(statSync(join(outputDir, 'cold-launch.png')).mode & 0o777, 0o600)
    assert.equal(statSync(join(outputDir, 'cold-launch.layout.json')).mode & 0o777, 0o600)
  } finally {
    rmSync(directory, { force: true, recursive: true })
  }
})

test('runs preserve-data acceptance without uninstalling, installing, or clearing global hilog', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'orca-harmony-acceptance-preserve-data-'))
  const outputDir = join(directory, 'evidence')
  const hapPath = join(directory, 'entry.hap')
  const calls = []
  try {
    writeValidAcceptanceHap(hapPath)
    const command = createPassingAcceptanceCommand({
      calls,
      hilogOutput: [
        '1999999940 101 101 F Orca stale fatal before this run',
        '2000000001 101 101 I Orca current run',
        '2000000002 202 202 I Orca current restart'
      ].join('\n'),
      targetList: 'simulator-one\tdevice\nsimulator-two\tdevice\n'
    })
    const result = await runHarmonySimulatorAcceptance(
      {
        hap: hapPath,
        hdc: '/opt/hdc',
        mode: PRESERVE_DATA_MODE,
        outputDir,
        target: 'simulator-two'
      },
      { command }
    )
    const allArgs = calls.map(({ args }) => args)
    assert.equal(result.status, 'passed')
    assert.equal(result.mode, PRESERVE_DATA_MODE)
    assert.equal(result.cleanInstall, false)
    assert.equal(result.publishableCleanAcceptance, false)
    assert.equal(result.dataPolicy.appInstall, 'preserve-existing-install')
    assert.equal(result.dataPolicy.globalHilog, 'not-cleared')
    assert.equal(result.artifactBinding.verified, false)
    assert.equal(result.artifactBinding.kind, 'preexisting-install-unverified')
    assert.equal(result.candidateHap.sha256.length, 64)
    assert.equal(result.hapSha256, undefined)
    assert.equal(result.logs.scope.globalBufferCleared, false)
    assert.equal(result.logs.scope.clock.command, 'date +%s')
    assert.equal(result.logs.scope.clock.startEpochSeconds, 2_000_000_000)
    assert.equal(result.logs.scope.clock.endEpochSeconds, 2_000_000_004)
    assert.equal(result.logs.scope.timeWindow.enabled, true)
    assert.equal(result.logs.scope.timeWindow.droppedBeforeWindowLineCount, 1)
    assert.equal(result.logs.scope.timeWindow.keptLineCount, 2)
    assert.equal(result.phases.coldLaunch.uiState, 'empty-home')
    assert.equal(result.phases.warmDeepLink.uiState, 'pairing-error')
    assert.equal(result.phases.coldDeepLink.uiState, 'pairing-error')
    assert.equal(
      allArgs.some((args) => args[0] === 'uninstall'),
      false
    )
    assert.equal(
      allArgs.some((args) => args[0] === 'install'),
      false
    )
    assert.equal(
      allArgs.some((args) => args.includes('hilog') && args.includes('-r')),
      false
    )
    assert.deepEqual(
      allArgs.find((args) => args.includes('hilog') && args.includes('-P')),
      ['shell', 'hilog', '-v', 'epoch', '-x', '-P', '101,202']
    )
    assert.equal(
      allArgs.findIndex((args) => args.join(' ') === 'shell date --help') <
        allArgs.findIndex((args) => args.join(' ') === 'shell date +%s'),
      true
    )
    assert.equal(
      allArgs.findIndex((args) => args.join(' ') === 'shell date +%s') <
        allArgs.findIndex((args) => args.includes('force-stop')),
      true
    )
    assert.equal(
      calls.every(
        ({ args, target }) =>
          args.join(' ') === 'list targets' || args[0] === 'version' || target === 'simulator-two'
      ),
      true
    )
    const filteredLog = readFileSync(join(outputDir, 'hilog.filtered.txt'), 'utf8')
    assert.match(filteredLog, /current run/u)
    assert.match(filteredLog, /current restart/u)
    assert.doesNotMatch(filteredLog, /stale fatal/u)
    assert.equal(
      readFileSync(join(outputDir, 'evidence.json'), 'utf8').includes(
        '"publishableCleanAcceptance": false'
      ),
      true
    )
  } finally {
    rmSync(directory, { force: true, recursive: true })
  }
})

test('preserve-data accepts an already paired cold-launch home layout fixture', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'orca-harmony-acceptance-paired-home-'))
  const outputDir = join(directory, 'evidence')
  const hapPath = join(directory, 'entry.hap')
  const calls = []
  try {
    writeValidAcceptanceHap(hapPath)
    const command = createPassingAcceptanceCommand({
      calls,
      hilogOutput: [
        '2000000001 101 101 I Orca current run',
        '2000000002 202 202 I Orca current restart'
      ].join('\n'),
      layoutForLocalPath: ({ localPath }) =>
        localPath.endsWith('cold-launch.layout.json')
          ? PAIRED_HOME_LAYOUT_FIXTURE
          : defaultAcceptanceLayout(localPath, 2)
    })
    const result = await runHarmonySimulatorAcceptance(
      {
        hap: hapPath,
        hdc: '/opt/hdc',
        mode: PRESERVE_DATA_MODE,
        outputDir,
        target: 'simulator-secret'
      },
      { command }
    )

    const allArgs = calls.map(({ args }) => args)
    assert.equal(result.status, 'passed')
    assert.equal(result.phases.coldLaunch.uiState, 'paired-home')
    assert.equal(
      allArgs.some((args) => args[0] === 'uninstall'),
      false
    )
    assert.equal(
      allArgs.some((args) => args[0] === 'install'),
      false
    )
    assert.equal(
      allArgs.some((args) => args.includes('hilog') && args.includes('-r')),
      false
    )
  } finally {
    rmSync(directory, { force: true, recursive: true })
  }
})

for (const [locale, layoutText] of [
  ['en', 'Not a valid pairing code\nBack to home'],
  ['zh', '配对码无效\n返回首页']
]) {
  test(`recordPhase accepts ${locale} pairing error layouts`, async () => {
    const directory = mkdtempSync(join(tmpdir(), `orca-harmony-record-phase-${locale}-`))
    try {
      const calls = []
      const command = (_hdc, _target, args) => {
        calls.push(args)
        if (args[0] === 'shell' && args[1] === 'uitest' && args[2] === 'dumpLayout') {
          return layoutText
        }
        if (args[0] === 'file' && args[1] === 'recv') {
          writeFileSync(args[3], args[2].endsWith('.png') ? 'png' : layoutText)
          return ''
        }
        return ''
      }
      const result = await recordPhase(
        command,
        '/opt/hdc',
        'simulator-secret',
        directory,
        `pairing-${locale}`,
        ['101'],
        '/data/local/tmp/orca-harmony-test',
        { assertPairing: true }
      )
      assert.equal(result.uiState, 'pairing-error')
      assert.equal(result.layout, `pairing-${locale}.layout.json`)
      assert.equal(result.screenshot, `pairing-${locale}.png`)
      assert.equal(
        calls.some(
          (args) => args[0] === 'shell' && args[1] === 'uitest' && args[2] === 'screenCap'
        ),
        true
      )
    } finally {
      rmSync(directory, { force: true, recursive: true })
    }
  })
}

test('writes failed evidence with phase artifacts without leaking layout text', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'orca-harmony-acceptance-failed-evidence-'))
  const outputDir = join(directory, 'evidence')
  const hapPath = join(directory, 'entry.hap')
  const secretLayoutText = 'secret-desktop-name-should-stay-in-layout-file-only'
  const calls = []
  try {
    writeValidAcceptanceHap(hapPath)
    const command = createPassingAcceptanceCommand({
      calls,
      layoutForLocalPath: ({ localPath }) => {
        if (localPath.endsWith('warm-deep-link.layout.json')) {
          return JSON.stringify({
            text: `Not a valid pairing code Back to home ${secretLayoutText}`
          })
        }
        return defaultAcceptanceLayout(localPath, 2)
      }
    })
    await assert.rejects(
      () =>
        runHarmonySimulatorAcceptance(
          {
            hap: hapPath,
            hdc: '/opt/hdc',
            mode: PRESERVE_DATA_MODE,
            outputDir,
            target: 'simulator-secret'
          },
          {
            command: (hdc, target, args) => {
              if (args.includes('screenCap') && args.at(-1)?.includes('warm-deep-link.png')) {
                throw new Error('screen capture failed')
              }
              return command(hdc, target, args)
            }
          }
        ),
      /screen capture failed/u
    )

    const evidenceText = readFileSync(join(outputDir, 'evidence.json'), 'utf8')
    const evidence = JSON.parse(evidenceText)
    assert.equal(evidence.status, 'failed')
    assert.equal(evidence.failure.phase, 'warm-deep-link')
    assert.equal(evidence.failure.message, 'screen capture failed')
    assert.equal(evidence.failure.artifacts.layout, 'warm-deep-link.layout.json')
    assert.match(evidence.failure.artifacts.layoutSha256, /^[0-9a-f]{64}$/u)
    assert.equal(evidence.failure.artifacts.screenshot, undefined)
    assert.doesNotMatch(evidenceText, new RegExp(secretLayoutText, 'u'))
  } finally {
    rmSync(directory, { force: true, recursive: true })
  }
})
