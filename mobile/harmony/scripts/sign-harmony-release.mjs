import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { verifyHarmonyReleaseHap } from './verify-harmony-hap.mjs'
import { verifyHarmonySignedRelease } from './verify-harmony-signed-release.mjs'
import { formatJavaArgumentFile } from './harmony-java-argument-file.mjs'

const harmonyRoot = resolve(import.meta.dirname, '..')

function requiredEnvironment(name) {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`Set ${name} for Harmony production signing`)
  }
  return value
}

function decodeMaterial(name) {
  const encoded = requiredEnvironment(name).replaceAll(/\s/gu, '')
  if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(encoded) || encoded.length % 4 !== 0) {
    throw new Error(`${name} is not valid base64`)
  }
  const decoded = Buffer.from(encoded, 'base64')
  if (decoded.length === 0) {
    throw new Error(`${name} is empty`)
  }
  return decoded
}

function executableFromJavaHome(name) {
  const suffix = process.platform === 'win32' ? '.exe' : ''
  const javaHome = requiredEnvironment('JAVA_HOME')
  return join(javaHome, 'bin', `${name}${suffix}`)
}

function run(command, args, description, environment = process.env) {
  const result = spawnSync(command, args, {
    cwd: harmonyRoot,
    env: environment,
    stdio: 'inherit'
  })
  if (result.error || result.status !== 0) {
    throw new Error(`${description} failed`)
  }
}

function compatibleApiVersion() {
  const profile = readFileSync(join(harmonyRoot, 'build-profile.template.json5'), 'utf8')
  const match = profile.match(/"compatibleSdkVersion"\s*:\s*"[^"]*\((\d+)\)"/u)
  if (!match) {
    throw new Error('Unable to resolve compatibleSdkVersion from the build profile')
  }
  return match[1]
}

function materializeSigningFiles(directory) {
  const paths = {
    certificate: join(directory, 'release.cer'),
    keystore: join(directory, 'release.p12'),
    profile: join(directory, 'release.p7b')
  }
  writeFileSync(paths.certificate, decodeMaterial('HARMONY_RELEASE_CERT_BASE64'), { mode: 0o600 })
  writeFileSync(paths.keystore, decodeMaterial('HARMONY_RELEASE_KEYSTORE_BASE64'), { mode: 0o600 })
  writeFileSync(paths.profile, decodeMaterial('HARMONY_RELEASE_PROFILE_BASE64'), { mode: 0o600 })
  return paths
}

function validateArguments() {
  const inputArgument = process.argv[2]
  const outputArgument = process.argv[3]
  if (!inputArgument || !outputArgument) {
    throw new Error('Usage: sign-harmony-release.mjs <unsigned.hap> <signed.hap>')
  }
  const inputPath = resolve(inputArgument)
  const outputPath = resolve(outputArgument)
  if (!existsSync(inputPath)) {
    throw new Error(`Unsigned HAP does not exist: ${inputPath}`)
  }
  if (inputPath === outputPath) {
    throw new Error('Signed HAP output must differ from the unsigned input')
  }
  return { inputPath, outputPath }
}

const { inputPath, outputPath } = validateArguments()
const java = executableFromJavaHome('java')
const signTool = resolve(requiredEnvironment('HAP_SIGN_TOOL_JAR'))
requiredEnvironment('HARMONY_RELEASE_CERT_SHA256')
const keyAlias = requiredEnvironment('HARMONY_RELEASE_KEY_ALIAS')
const keyPassword = requiredEnvironment('HARMONY_RELEASE_KEY_PASSWORD')
const keystorePassword = requiredEnvironment('HARMONY_RELEASE_KEYSTORE_PASSWORD')

if (!existsSync(java) || !existsSync(signTool)) {
  throw new Error('Harmony signing toolchain is incomplete')
}
if (/debug/i.test(keyAlias)) {
  throw new Error('Refusing to sign a release HAP with a debug key alias')
}

verifyHarmonyReleaseHap(inputPath)
mkdirSync(dirname(outputPath), { recursive: true })
rmSync(outputPath, { force: true })
rmSync(`${outputPath}.evidence.json`, { force: true })

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'orca-harmony-sign-'))
let completed = false
try {
  const materials = materializeSigningFiles(temporaryDirectory)
  const argumentFile = join(temporaryDirectory, 'sign-app.args')
  const signingArguments = [
    '-jar',
    signTool,
    'sign-app',
    '-mode',
    'localSign',
    '-keyAlias',
    keyAlias,
    '-keyPwd',
    keyPassword,
    '-appCertFile',
    materials.certificate,
    '-profileFile',
    materials.profile,
    '-profileSigned',
    '1',
    '-inFile',
    inputPath,
    '-signAlg',
    'SHA256withECDSA',
    '-keystoreFile',
    materials.keystore,
    '-keystorePwd',
    keystorePassword,
    '-outFile',
    outputPath,
    '-compatibleVersion',
    compatibleApiVersion(),
    '-signCode',
    '1'
  ]
  writeFileSync(argumentFile, formatJavaArgumentFile(signingArguments), { mode: 0o600 })
  const signingEnvironment = { ...process.env }
  for (const name of [
    'HARMONY_RELEASE_CERT_BASE64',
    'HARMONY_RELEASE_KEY_ALIAS',
    'HARMONY_RELEASE_KEY_PASSWORD',
    'HARMONY_RELEASE_KEYSTORE_BASE64',
    'HARMONY_RELEASE_KEYSTORE_PASSWORD',
    'HARMONY_RELEASE_PROFILE_BASE64'
  ]) {
    delete signingEnvironment[name]
  }

  run(java, [`@${argumentFile}`], 'Harmony HAP signing', signingEnvironment)
  const evidence = verifyHarmonySignedRelease(outputPath)
  writeFileSync(`${outputPath}.evidence.json`, `${JSON.stringify(evidence, null, 2)}\n`)
  completed = true
  console.log(`[release-signing] Produced verified ${basename(outputPath)}.`)
} finally {
  rmSync(temporaryDirectory, { force: true, recursive: true })
  if (!completed) {
    rmSync(outputPath, { force: true })
    rmSync(`${outputPath}.evidence.json`, { force: true })
  }
}
