#!/usr/bin/env node

import { appendFileSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'

const harmonyRoot = resolve(import.meta.dirname, '..')
const tagPrefix = 'refs/tags/mobile-harmony-v'
const releaseTagPrefix = 'mobile-harmony-v'
const semverPattern = /^\d+\.\d+\.\d+$/u

function input(name) {
  return (process.env[name] ?? '').trim()
}

function truthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase())
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

function writeOutput(name, value) {
  const outputPath = process.env.GITHUB_OUTPUT
  if (outputPath) {
    appendFileSync(outputPath, `${name}=${value}\n`)
  }
}

function runGit(args, repositoryPath) {
  const result = spawnSync('git', args, { cwd: repositoryPath, encoding: 'utf8' })
  assert(!result.error && result.status === 0, `git ${args[0]} failed while preparing release`)
  return result.stdout.trim()
}

function maximumReleasedVersionCode(repositoryPath, currentTag) {
  const tags = runGit(['tag', '--list', `${releaseTagPrefix}*`], repositoryPath)
    .split('\n')
    .map((tag) => tag.trim())
    .filter((tag) => tag && tag !== currentTag)
  let maximum = 0
  for (const tag of tags) {
    const configText = runGit(['show', `${tag}:mobile/harmony/AppScope/app.json5`], repositoryPath)
    let taggedVersionCode
    try {
      taggedVersionCode = Number(JSON.parse(configText).app?.versionCode)
    } catch {
      throw new Error(`Harmony release tag ${tag} contains an invalid app config`)
    }
    assert(
      Number.isSafeInteger(taggedVersionCode) && taggedVersionCode > 0,
      `Harmony release tag ${tag} contains an invalid versionCode`
    )
    maximum = Math.max(maximum, taggedVersionCode)
  }
  return maximum
}

const appConfigPath = resolve(
  process.env.HARMONY_APP_CONFIG_PATH ?? join(harmonyRoot, 'AppScope/app.json5')
)
const packagePath = resolve(
  process.env.HARMONY_PACKAGE_JSON_PATH ?? join(harmonyRoot, 'package.json')
)
const expoConstantsPath = resolve(
  process.env.HARMONY_EXPO_CONSTANTS_PATH ?? join(harmonyRoot, 'src/compat/expo-constants.ts')
)
const app = JSON.parse(readFileSync(appConfigPath, 'utf8')).app
const harmonyPackage = JSON.parse(readFileSync(packagePath, 'utf8'))
const expoConstantsSource = readFileSync(expoConstantsPath, 'utf8')
const expoConstantsVersion =
  /\bversion\s*:\s*(['"])(?<version>[^'"\r\n]+)\1/u
    .exec(expoConstantsSource)
    ?.groups?.version?.trim() ?? ''
const version = String(app?.versionName ?? '').trim()
const versionCode = Number(app?.versionCode)
const requestedVersion = input('MOBILE_HARMONY_RELEASE_VERSION')
const githubRef = input('GITHUB_REF')
const tagVersion = githubRef.startsWith(tagPrefix) ? githubRef.slice(tagPrefix.length) : ''
const releaseBranch = input('MOBILE_HARMONY_RELEASE_BRANCH')

assert(semverPattern.test(version), 'Harmony versionName must use x.y.z format')
assert(Number.isSafeInteger(versionCode) && versionCode > 0, 'Harmony versionCode must be positive')
assert(
  harmonyPackage.version === version,
  'Harmony package version must match AppScope versionName'
)
assert(
  expoConstantsVersion === version,
  'Harmony expo-constants version must match AppScope versionName'
)
if (requestedVersion) {
  assert(
    semverPattern.test(requestedVersion),
    'MOBILE_HARMONY_RELEASE_VERSION must use x.y.z format'
  )
  assert(
    requestedVersion === version,
    'Requested Harmony release version must match committed version'
  )
}
if (tagVersion) {
  assert(semverPattern.test(tagVersion), 'Harmony release tag version must use x.y.z format')
  assert(tagVersion === version, 'Harmony release tag must match committed version')
}

const tag = `mobile-harmony-v${version}`
const publishRelease = Boolean(tagVersion) || truthy(input('MOBILE_HARMONY_PUBLISH_RELEASE'))
if (releaseBranch && !tagVersion) {
  assert(
    githubRef === `refs/heads/${releaseBranch}`,
    `Harmony releases may only run from refs/heads/${releaseBranch}`
  )
}
if (truthy(input('MOBILE_HARMONY_ENFORCE_VERSION_CODE'))) {
  const repositoryPath = resolve(
    process.env.MOBILE_HARMONY_REPOSITORY_PATH ?? join(harmonyRoot, '../..')
  )
  const maximumVersionCode = maximumReleasedVersionCode(repositoryPath, tag)
  assert(
    versionCode > maximumVersionCode,
    `Harmony versionCode must exceed the previously released value ${maximumVersionCode}`
  )
}
writeOutput('publish_release', publishRelease ? 'true' : 'false')
writeOutput('tag', tag)
writeOutput('version', version)
writeOutput('version_code', String(versionCode))

console.log(`Prepared Orca Mobile Harmony ${version} (${versionCode})`)
console.log(`Release tag: ${tag}`)
console.log(`Publish GitHub Release: ${publishRelease ? 'yes' : 'no'}`)
