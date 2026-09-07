import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { runHarmonySimulatorAcceptance } from './run-harmony-simulator-acceptance.mjs'
import {
  runPreserveDataWithHilog,
  writeValidAcceptanceHap
} from './harmony-simulator-acceptance-test-fixtures.mjs'

test('preserve-data uses the device epoch window so clock-skewed fatal logs still fail', async () => {
  await assert.rejects(
    () => runPreserveDataWithHilog('2000000002 101 101 F Orca fatal crash in device window'),
    /Filtered hilog contains fatal entries: fatal/u
  )
})

test('preserve-data fails closed on unknown timestamp or PID log format', async () => {
  await assert.rejects(
    () => runPreserveDataWithHilog('08-30 10:00:00.000 101 101 F Orca fatal crash'),
    /non-epoch or unknown PID-format/u
  )
  await assert.rejects(
    () => runPreserveDataWithHilog('2000000001 pid=101 F Orca fatal crash'),
    /non-epoch or unknown PID-format/u
  )
})

test('preserve-data fails closed when no bounded PID log evidence remains', async () => {
  await assert.rejects(() => runPreserveDataWithHilog(''), /returned no PID-scoped lines/u)
  await assert.rejects(
    () => runPreserveDataWithHilog('1999999900 101 101 I Orca stale only'),
    /retained no lines inside the device clock window/u
  )
  await assert.rejects(
    () => runPreserveDataWithHilog('2000000001 303 303 F Orca fatal from another process'),
    /outside the requested PIDs/u
  )
})

test('does not uninstall an existing app when simulator metadata validation fails', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'orca-harmony-acceptance-metadata-failure-'))
  const outputDir = join(directory, 'evidence')
  const hapPath = join(directory, 'entry.hap')
  const calls = []
  try {
    writeValidAcceptanceHap(hapPath)
    const command = (_hdc, target, args) => {
      calls.push({ args, target })
      if (args.join(' ') === 'list targets') {
        return 'simulator-secret\tdevice\n'
      }
      if (args[0] === 'version') {
        return 'HDC version 3.2.1'
      }
      if (args.at(-1) === 'const.product.model') {
        return 'Physical phone'
      }
      if (args.at(-1) === 'const.ohos.apiversion') {
        return '12'
      }
      return 'ok'
    }
    await assert.rejects(
      runHarmonySimulatorAcceptance(
        { hap: hapPath, hdc: '/opt/hdc', outputDir, skipInstall: false },
        { command }
      ),
      /not a simulator/u
    )
    assert.equal(
      calls.filter(({ args }) => args[0] === 'uninstall').length,
      0,
      'metadata validation must not remove an existing app'
    )
  } finally {
    rmSync(directory, { force: true, recursive: true })
  }
})

test('does not uninstall in finally when installation fails', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'orca-harmony-acceptance-install-failure-'))
  const outputDir = join(directory, 'evidence')
  const hapPath = join(directory, 'entry.hap')
  const calls = []
  try {
    writeValidAcceptanceHap(hapPath)
    const command = (_hdc, target, args) => {
      calls.push({ args, target })
      if (args.join(' ') === 'list targets') {
        return 'simulator-secret\tdevice\n'
      }
      if (args[0] === 'version') {
        return 'HDC version 3.2.1'
      }
      if (args.at(-1) === 'const.product.model') {
        return 'Harmony Simulator'
      }
      if (args.at(-1) === 'const.ohos.apiversion') {
        return '12'
      }
      if (args[0] === 'install') {
        throw new Error('install failed')
      }
      return 'ok'
    }
    await assert.rejects(
      runHarmonySimulatorAcceptance(
        { hap: hapPath, hdc: '/opt/hdc', outputDir, skipInstall: false },
        { command }
      ),
      /install failed/u
    )
    assert.equal(
      calls.filter(({ args }) => args[0] === 'uninstall').length,
      1,
      'only the intentional pre-install cleanup is allowed'
    )
    assert.equal(calls.filter(({ args }) => args[0] === 'install').length, 1)
  } finally {
    rmSync(directory, { force: true, recursive: true })
  }
})

test('never uninstalls an existing app when installation is skipped', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'orca-harmony-acceptance-skip-install-'))
  const outputDir = join(directory, 'evidence')
  const hapPath = join(directory, 'entry.hap')
  const calls = []
  try {
    writeValidAcceptanceHap(hapPath)
    const command = (_hdc, target, args) => {
      calls.push({ args, target })
      if (args.join(' ') === 'list targets') {
        return 'simulator-secret\tdevice\n'
      }
      if (args[0] === 'version') {
        return 'HDC version 3.2.1'
      }
      if (args.join(' ') === 'shell date --help') {
        return 'Usage: date [+FORMAT]\n%s seconds since epoch'
      }
      if (args.join(' ') === 'shell date +%s') {
        return '2000000000'
      }
      if (args.at(-1) === 'const.product.model') {
        return 'Harmony Simulator'
      }
      if (args.at(-1) === 'const.ohos.apiversion') {
        return '12'
      }
      if (args.includes('force-stop')) {
        throw new Error('existing app cannot be stopped')
      }
      return 'ok'
    }
    await assert.rejects(
      runHarmonySimulatorAcceptance(
        { hap: hapPath, hdc: '/opt/hdc', outputDir, skipInstall: true },
        { command }
      ),
      /existing app cannot be stopped/u
    )
    assert.equal(calls.filter(({ args }) => args[0] === 'uninstall').length, 0)
    assert.equal(calls.filter(({ args }) => args[0] === 'install').length, 0)
    assert.equal(
      calls.some(({ args }) => args.includes('hilog') && args.includes('-r')),
      false
    )
  } finally {
    rmSync(directory, { force: true, recursive: true })
  }
})
