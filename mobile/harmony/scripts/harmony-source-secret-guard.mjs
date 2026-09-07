import { readFileSync } from 'node:fs'
import { extname, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import {
  LOCAL_SIGNING_PROFILE_NAMES,
  validateLocalSigningProfile
} from './harmony-local-signing-profile-policy.mjs'

const harmonyRoot = resolve(import.meta.dirname, '..')
const repositoryRoot = resolve(harmonyRoot, '../..')
const scannerPath = 'mobile/harmony/scripts/harmony-source-secret-guard.mjs'
const trackedFiles = new Set(
  execFileSync('git', ['ls-files', '--cached', '--', 'mobile/harmony'], {
    cwd: repositoryRoot,
    encoding: 'utf8'
  })
    .split(/\r?\n/u)
    .filter(Boolean)
)
const sourceFiles = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '--', 'mobile/harmony'],
  {
    cwd: repositoryRoot,
    encoding: 'utf8'
  }
)
  .split(/\r?\n/u)
  .filter(Boolean)
const forbiddenExtensions = new Set([
  '.cer',
  '.crt',
  '.csr',
  '.der',
  '.jks',
  '.key',
  '.keystore',
  '.p10',
  '.p12',
  '.p7b',
  '.p7c',
  '.p8',
  '.pem',
  '.pfx',
  '.pk8',
  '.pkcs8',
  '.pvk',
  '.spc'
])
const textExtensions = new Set([
  '',
  '.c',
  '.cmake',
  '.cpp',
  '.ets',
  '.h',
  '.json',
  '.json5',
  '.js',
  '.md',
  '.mjs',
  '.patch',
  '.ts',
  '.tsx'
])
const forbiddenContent = [
  /keyPassword\s*:/iu,
  /storePassword\s*:/iu,
  /-----BEGIN (?:EC |RSA )?PRIVATE KEY-----/u,
  /(?:^|["'])\/(?:Users|home)\//mu,
  /(?:^|["'])[A-Za-z]:\\Users\\/mu
]

if (sourceFiles.length === 0) {
  throw new Error('Harmony source secret guard did not find any source files')
}

for (const name of LOCAL_SIGNING_PROFILE_NAMES) {
  const relativePath = `mobile/harmony/${name}`
  const path = resolve(repositoryRoot, relativePath)
  let ignored = true
  try {
    execFileSync('git', ['check-ignore', '--quiet', '--', relativePath], {
      cwd: repositoryRoot,
      stdio: 'ignore'
    })
  } catch (error) {
    if (error?.status !== 1) {
      throw error
    }
    ignored = false
  }
  validateLocalSigningProfile({
    ignored,
    path,
    relativePath,
    tracked: trackedFiles.has(relativePath)
  })
}

for (const relativePath of sourceFiles) {
  if (forbiddenExtensions.has(extname(relativePath).toLowerCase())) {
    throw new Error(`Signing material must not be tracked: ${relativePath}`)
  }
  if (relativePath === scannerPath) {
    continue
  }
  if (!textExtensions.has(extname(relativePath).toLowerCase())) {
    continue
  }
  const source = readFileSync(resolve(repositoryRoot, relativePath), 'utf8')
  if (forbiddenContent.some((pattern) => pattern.test(source))) {
    throw new Error(`Potential signing secret or machine-local path in ${relativePath}`)
  }
}
