import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  hashToolchainDirectory,
  verifyHarmonyToolchainSnapshot
} from './verify-harmony-toolchain.mjs'

const expected = {
  codeLinterContentSha256: '0'.repeat(64),
  devEcoNode: '18.20.1',
  devEcoNodeContentSha256: '1'.repeat(64),
  hapSignToolSha256: 'a'.repeat(64),
  hvigor: '6.21.1',
  hvigorContentSha256: 'b'.repeat(64),
  java: '21.0.8',
  javaContentSha256: 'c'.repeat(64),
  node: '20.19.4',
  npm: '10.8.2',
  ohpm: '6.0.1',
  ohpmContentSha256: 'd'.repeat(64),
  platform: 'darwin-arm64',
  sdkApi: 21,
  sdkComponents: ['ets', 'js', 'native', 'previewer', 'toolchains'],
  sdkContentSha256: 'e'.repeat(64),
  sdkVersion: '6.0.1.112'
}

test('accepts the exact pinned Harmony release toolchain', () => {
  assert.equal(verifyHarmonyToolchainSnapshot(expected, { ...expected }).sdkApi, 21)
})

test('rejects version, hash, and component drift', () => {
  for (const actual of [
    { ...expected, codeLinterContentSha256: 'f'.repeat(64) },
    { ...expected, devEcoNode: '18.20.2' },
    { ...expected, devEcoNodeContentSha256: 'f'.repeat(64) },
    { ...expected, node: '20.20.0' },
    { ...expected, npm: '11.0.0' },
    { ...expected, hapSignToolSha256: 'f'.repeat(64) },
    { ...expected, sdkContentSha256: 'f'.repeat(64) },
    { ...expected, sdkComponents: expected.sdkComponents.slice(0, -1) }
  ]) {
    assert.throws(() => verifyHarmonyToolchainSnapshot(expected, actual), /not pinned/u)
  }
})

test('hashes toolchain trees deterministically and rejects external symlink targets', () => {
  const directory = mkdtempSync(join(tmpdir(), 'orca-toolchain-hash-'))
  const externalDirectory = mkdtempSync(join(tmpdir(), 'orca-toolchain-external-'))
  try {
    mkdirSync(join(directory, 'nested'))
    writeFileSync(join(directory, 'nested', 'tool.js'), 'first')
    symlinkSync('nested/tool.js', join(directory, 'tool-link'))
    const first = hashToolchainDirectory(directory)
    assert.equal(hashToolchainDirectory(directory), first)

    writeFileSync(join(directory, 'nested', 'tool.js'), 'second')
    assert.notEqual(hashToolchainDirectory(directory), first)

    writeFileSync(join(externalDirectory, 'external-tool'), 'first')
    symlinkSync(join(externalDirectory, 'external-tool'), join(directory, 'external-link'))
    assert.throws(() => hashToolchainDirectory(directory), /symlink escapes the pinned root/u)
  } finally {
    rmSync(directory, { force: true, recursive: true })
    rmSync(externalDirectory, { force: true, recursive: true })
  }
})
