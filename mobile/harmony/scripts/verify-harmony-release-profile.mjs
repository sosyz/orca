import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { validateVerifiedReleaseProfile } from './harmony-release-signing-validation.mjs'

function requiredEnvironment(name) {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`Set ${name} to verify a Harmony release profile`)
  }
  return value
}

const profileArgument = process.argv[2]
if (!profileArgument) {
  throw new Error('Usage: verify-harmony-release-profile.mjs <release-profile.p7b>')
}

const profilePath = resolve(profileArgument)
const javaHome = resolve(requiredEnvironment('JAVA_HOME'))
const java = join(javaHome, 'bin', `java${process.platform === 'win32' ? '.exe' : ''}`)
const signTool = resolve(requiredEnvironment('HAP_SIGN_TOOL_JAR'))
if (!existsSync(profilePath) || !existsSync(java) || !existsSync(signTool)) {
  throw new Error('Release profile or Harmony verification toolchain is missing')
}

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'orca-harmony-profile-'))
try {
  const reportPath = join(temporaryDirectory, 'profile-verification.json')
  const result = spawnSync(
    java,
    ['-jar', signTool, 'verify-profile', '-inFile', profilePath, '-outFile', reportPath],
    { stdio: 'inherit' }
  )
  if (result.error || result.status !== 0) {
    throw new Error('Release profile signature verification failed')
  }
  const evidence = validateVerifiedReleaseProfile(JSON.parse(readFileSync(reportPath, 'utf8')))
  console.log(
    `[release-signing] Verified ${evidence.type} profile for ${evidence.bundleName} with ohos.permission.READ_PASTEBOARD.`
  )
} finally {
  rmSync(temporaryDirectory, { force: true, recursive: true })
}
