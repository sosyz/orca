import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const scriptPath = fileURLToPath(new URL('./prepare-harmony-release.mjs', import.meta.url))

function runReleasePreparation({
  enforceVersionCode = false,
  packageVersion = '0.0.47',
  publish = false,
  ref = '',
  releaseBranch = '',
  repositoryPath = '',
  version = '0.0.47',
  versionCode = 47
} = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'orca-harmony-release-test-'))
  const appConfigPath = join(directory, 'app.json5')
  const packagePath = join(directory, 'package.json')
  const expoConstantsPath = join(directory, 'expo-constants.ts')
  try {
    writeFileSync(appConfigPath, JSON.stringify({ app: { versionCode, versionName: version } }))
    writeFileSync(packagePath, JSON.stringify({ version: packageVersion }))
    writeFileSync(
      expoConstantsPath,
      `const Constants = { expoConfig: { version: '${version}' } }\n`
    )
    return spawnSync(process.execPath, [scriptPath], {
      encoding: 'utf8',
      env: {
        ...process.env,
        GITHUB_REF: ref,
        HARMONY_APP_CONFIG_PATH: appConfigPath,
        HARMONY_EXPO_CONSTANTS_PATH: expoConstantsPath,
        HARMONY_PACKAGE_JSON_PATH: packagePath,
        MOBILE_HARMONY_ENFORCE_VERSION_CODE: enforceVersionCode ? 'true' : '',
        MOBILE_HARMONY_PUBLISH_RELEASE: publish ? 'true' : '',
        MOBILE_HARMONY_RELEASE_BRANCH: releaseBranch,
        MOBILE_HARMONY_REPOSITORY_PATH: repositoryPath
      }
    })
  } finally {
    rmSync(directory, { force: true, recursive: true })
  }
}

test('accepts a matching Harmony release tag', () => {
  const result = runReleasePreparation({ ref: 'refs/tags/mobile-harmony-v0.0.47' })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Publish GitHub Release: yes/u)
})

test('rejects tag and package version drift', () => {
  const staleTag = runReleasePreparation({ ref: 'refs/tags/mobile-harmony-v0.0.46' })
  assert.notEqual(staleTag.status, 0)
  assert.match(staleTag.stderr, /must match committed version/u)

  const stalePackage = runReleasePreparation({ packageVersion: '0.0.46' })
  assert.notEqual(stalePackage.status, 0)
  assert.match(stalePackage.stderr, /package version must match/u)
})

test('rejects expo-constants version drift', () => {
  const directory = mkdtempSync(join(tmpdir(), 'orca-harmony-version-test-'))
  const appConfigPath = join(directory, 'app.json5')
  const packagePath = join(directory, 'package.json')
  const expoConstantsPath = join(directory, 'expo-constants.ts')
  try {
    writeFileSync(
      appConfigPath,
      JSON.stringify({ app: { versionCode: 47, versionName: '0.0.47' } })
    )
    writeFileSync(packagePath, JSON.stringify({ version: '0.0.47' }))
    writeFileSync(expoConstantsPath, `const Constants = { expoConfig: { version: '0.0.46' } }\n`)
    const result = spawnSync(process.execPath, [scriptPath], {
      encoding: 'utf8',
      env: {
        ...process.env,
        HARMONY_APP_CONFIG_PATH: appConfigPath,
        HARMONY_EXPO_CONSTANTS_PATH: expoConstantsPath,
        HARMONY_PACKAGE_JSON_PATH: packagePath
      }
    })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /expo-constants version must match/u)
  } finally {
    rmSync(directory, { force: true, recursive: true })
  }
})

test('restricts manual signing runs to the configured release branch', () => {
  const untrusted = runReleasePreparation({
    ref: 'refs/heads/feature/harmony',
    releaseBranch: 'main'
  })
  assert.notEqual(untrusted.status, 0)
  assert.match(untrusted.stderr, /may only run from refs\/heads\/main/u)

  const trusted = runReleasePreparation({ ref: 'refs/heads/main', releaseBranch: 'main' })
  assert.equal(trusted.status, 0, trusted.stderr)
})

test('requires versionCode to increase across release tags', () => {
  const repository = mkdtempSync(join(tmpdir(), 'orca-harmony-release-repo-'))
  try {
    const taggedConfig = join(repository, 'mobile/harmony/AppScope/app.json5')
    mkdirSync(join(repository, 'mobile/harmony/AppScope'), { recursive: true })
    writeFileSync(taggedConfig, JSON.stringify({ app: { versionCode: 46, versionName: '0.0.46' } }))
    for (const args of [
      ['init', '-b', 'main'],
      ['config', 'user.email', 'release-test@example.invalid'],
      ['config', 'user.name', 'Release Test'],
      ['config', 'commit.gpgsign', 'false'],
      ['config', 'tag.gpgsign', 'false'],
      ['add', '.'],
      ['commit', '-m', 'release fixture'],
      ['tag', 'mobile-harmony-v0.0.46']
    ]) {
      const result = spawnSync('git', args, { cwd: repository, encoding: 'utf8' })
      assert.equal(result.status, 0, result.stderr)
    }

    const stale = runReleasePreparation({
      enforceVersionCode: true,
      repositoryPath: repository,
      versionCode: 46
    })
    assert.notEqual(stale.status, 0)
    assert.match(stale.stderr, /must exceed the previously released value 46/u)

    const next = runReleasePreparation({
      enforceVersionCode: true,
      repositoryPath: repository,
      versionCode: 47
    })
    assert.equal(next.status, 0, next.stderr)
  } finally {
    rmSync(repository, { force: true, recursive: true })
  }
})
