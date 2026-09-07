import assert from 'node:assert/strict'
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import {
  hardenLocalSigningProfilePermissions,
  validateLocalSigningProfile
} from './harmony-local-signing-profile-policy.mjs'

function withProfile(callback) {
  const directory = mkdtempSync(join(tmpdir(), 'orca-harmony-profile-policy-'))
  const path = join(directory, 'build-profile.json5')
  writeFileSync(path, '{ signingConfigs: [] }\n', { mode: 0o644 })
  try {
    callback(path)
  } finally {
    rmSync(directory, { force: true, recursive: true })
  }
}

function validate(path, overrides = {}) {
  validateLocalSigningProfile({
    ignored: true,
    path,
    relativePath: 'mobile/harmony/build-profile.json5',
    tracked: false,
    ...overrides
  })
}

test('hardens an existing local signing profile without changing its contents', () => {
  withProfile((path) => {
    const before = readFileSync(path, 'utf8')
    hardenLocalSigningProfilePermissions(path, 'darwin')
    assert.equal(statSync(path).mode & 0o777, 0o600)
    assert.equal(readFileSync(path, 'utf8'), before)
    validate(path)
  })
})

test('rejects tracked, unignored, and group-readable signing profiles', () => {
  withProfile((path) => {
    assert.throws(() => validate(path, { tracked: true }), /must not be tracked/u)
    assert.throws(() => validate(path, { ignored: false }), /must remain ignored/u)
    assert.throws(() => validate(path), /permissions must be 0600/u)
    chmodSync(path, 0o600)
    validate(path)
  })
})

test('does not apply POSIX mode checks on Windows', () => {
  withProfile((path) => validate(path, { platform: 'win32' }))
})

test(
  'rejects symbolic-link profiles without changing their targets',
  { skip: process.platform === 'win32' },
  () => {
    withProfile((path) => {
      const target = join(dirname(path), 'outside-profile.json5')
      writeFileSync(target, '{ signingConfigs: [] }\n', { mode: 0o644 })
      unlinkSync(path)
      symlinkSync(target, path)
      assert.throws(() => hardenLocalSigningProfilePermissions(path), /must be a regular file/u)
      assert.throws(() => validate(path), /must be a regular file/u)
      assert.equal(statSync(target).mode & 0o777, 0o644)
    })
  }
)
