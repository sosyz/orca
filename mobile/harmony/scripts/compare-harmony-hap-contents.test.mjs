import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { compareHarmonyHapContents } from './compare-harmony-hap-contents.mjs'
import { createStoredHap } from './harmony-hap-test-archive.mjs'

function withHaps(reference, candidate, callback) {
  const directory = mkdtempSync(join(tmpdir(), 'orca-harmony-hap-compare-'))
  const referencePath = join(directory, 'reference.hap')
  const candidatePath = join(directory, 'candidate.hap')
  try {
    writeFileSync(referencePath, reference)
    writeFileSync(candidatePath, candidate)
    callback(referencePath, candidatePath)
  } finally {
    rmSync(directory, { force: true, recursive: true })
  }
}

test('accepts identical content despite entry order and ZIP timestamp differences', () => {
  const entries = {
    'libs/arm64-v8a/librnoh_app.so': Buffer.from('native'),
    'module.json': '{"app":{"debug":false}}',
    'resources/rawfile/hermes_bundle.hbc': Buffer.from('bundle')
  }
  const reversed = Object.fromEntries(Object.entries(entries).toReversed())
  withHaps(
    createStoredHap(entries, { dosDate: 1, dosTime: 1 }),
    createStoredHap(reversed, { dosDate: 2, dosTime: 2 }),
    (referencePath, candidatePath) => {
      const result = compareHarmonyHapContents(referencePath, candidatePath)
      assert.equal(result.entryCount, 3)
      assert.match(result.contentSha256, /^[0-9a-f]{64}$/u)
    }
  )
})

test('rejects changed, added, and removed HAP content', () => {
  const reference = { 'module.json': 'release', 'resources/rawfile/hermes_bundle.hbc': 'hbc' }
  for (const [candidate, message] of [
    [{ ...reference, 'module.json': 'debug' }, /module\.json/u],
    [{ ...reference, 'extra.txt': 'extra' }, /entry set/u],
    [{ 'module.json': 'release' }, /entry set/u]
  ]) {
    withHaps(createStoredHap(reference), createStoredHap(candidate), (left, right) => {
      assert.throws(() => compareHarmonyHapContents(left, right), message)
    })
  }
})

test('rejects otherwise matching archives with trailing bytes', () => {
  const archive = createStoredHap({ 'module.json': 'release' })
  withHaps(archive, Buffer.concat([archive, Buffer.from('trailing')]), (left, right) => {
    assert.throws(() => compareHarmonyHapContents(left, right), /valid ZIP/u)
  })
})
