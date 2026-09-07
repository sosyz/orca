import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  validateReleaseCertificateText,
  validateVerifiedReleaseProfile
} from './harmony-release-signing-validation.mjs'
import { verifyHarmonyReleaseHap } from './verify-harmony-hap.mjs'
import { collectHarmonyReleaseProvenance } from './harmony-release-provenance.mjs'

function required(value, name) {
  const normalized = value?.trim()
  if (!normalized) {
    throw new Error(`Set ${name} to verify a signed Harmony release`)
  }
  return normalized
}

function run(command, args, description, capture = false) {
  const result = spawnSync(command, args, {
    encoding: capture ? 'utf8' : undefined,
    stdio: capture ? 'pipe' : 'inherit'
  })
  if (result.error || result.status !== 0) {
    throw new Error(`${description} failed`)
  }
  return capture ? `${result.stdout ?? ''}\n${result.stderr ?? ''}` : ''
}

function javaExecutable(javaHome, name) {
  return join(javaHome, 'bin', `${name}${process.platform === 'win32' ? '.exe' : ''}`)
}

export function verifyHarmonySignedRelease(hapPath, options = {}) {
  const resolvedPath = resolve(hapPath)
  const javaHome = required(options.javaHome ?? process.env.JAVA_HOME, 'JAVA_HOME')
  const signTool = resolve(
    required(options.signTool ?? process.env.HAP_SIGN_TOOL_JAR, 'HAP_SIGN_TOOL_JAR')
  )
  const expectedFingerprint = required(
    options.expectedFingerprint ?? process.env.HARMONY_RELEASE_CERT_SHA256,
    'HARMONY_RELEASE_CERT_SHA256'
  )
  const java = javaExecutable(javaHome, 'java')
  const runCommand = options.runCommand ?? run
  const verifyHap = options.verifyHap ?? verifyHarmonyReleaseHap
  const collectProvenance = options.collectProvenance ?? collectHarmonyReleaseProvenance

  if (!existsSync(resolvedPath) || !existsSync(java) || !existsSync(signTool)) {
    throw new Error('Signed HAP or Harmony verification toolchain is missing')
  }
  const hapEvidence = verifyHap(resolvedPath)
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'orca-harmony-verify-'))
  try {
    const extractedCertificate = join(temporaryDirectory, 'certificate-chain.cer')
    const extractedProfile = join(temporaryDirectory, 'profile.p7b')
    const verifiedProfile = join(temporaryDirectory, 'profile-verification.json')
    runCommand(
      java,
      [
        '-jar',
        signTool,
        'verify-app',
        '-inFile',
        resolvedPath,
        '-outCertChain',
        extractedCertificate,
        '-outProfile',
        extractedProfile
      ],
      'Final HAP signature verification'
    )
    runCommand(
      java,
      [
        '-jar',
        signTool,
        'verify-profile',
        '-inFile',
        extractedProfile,
        '-outFile',
        verifiedProfile
      ],
      'Final HAP profile verification'
    )
    const profileEvidence = validateVerifiedReleaseProfile(
      JSON.parse(readFileSync(verifiedProfile, 'utf8')),
      options.profileValidation
    )
    const certificateText = readFileSync(extractedCertificate, 'utf8')
    const certificateSha256 = validateReleaseCertificateText(certificateText, expectedFingerprint)
    return {
      artifact: basename(resolvedPath),
      ...hapEvidence,
      certificateSha256,
      profile: profileEvidence,
      provenance: collectProvenance()
    }
  } finally {
    rmSync(temporaryDirectory, { force: true, recursive: true })
  }
}

function isMainModule() {
  return process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
}

if (isMainModule()) {
  const hapPath = process.argv[2]
  if (!hapPath) {
    throw new Error('Usage: verify-harmony-signed-release.mjs <signed.hap>')
  }
  const evidence = verifyHarmonySignedRelease(hapPath)
  writeFileSync(`${resolve(hapPath)}.evidence.json`, `${JSON.stringify(evidence, null, 2)}\n`)
  console.log(`[release-signing] Verified ${basename(hapPath)}.`)
}
