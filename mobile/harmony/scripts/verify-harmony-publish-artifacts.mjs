#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { pathToFileURL } from 'node:url'
import { normalizeCertificateFingerprint } from './harmony-release-signing-validation.mjs'
import { verifyHarmonyReleaseHap } from './verify-harmony-hap.mjs'
import { verifyHarmonyToolchainSnapshot } from './verify-harmony-toolchain.mjs'

const defaultHarmonyRoot = resolve(import.meta.dirname, '..')
const MINIMUM_PROFILE_VALIDITY_SECONDS = 7 * 86_400
const MAXIMUM_ACCEPTANCE_AGE_SECONDS = 14 * 86_400
const SHA256_PATTERN = /^[0-9a-f]{64}$/u
const GITHUB_LOGIN_PATTERN = /^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/iu

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

function readJson(path, description) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    throw new Error(`Unable to read ${description}`)
  }
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function requiredEnvironment(environment, name) {
  const value = environment[name]?.trim()
  assert(value, `Publish verification requires ${name}`)
  return value
}

function readBuildEvidence(path) {
  const values = new Map()
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/u).filter(Boolean)) {
    const separator = line.indexOf('=')
    assert(separator > 0, 'Harmony build evidence is malformed')
    const name = line.slice(0, separator)
    const value = line.slice(separator + 1)
    assert(!values.has(name) && value.length > 0, 'Harmony build evidence is malformed')
    values.set(name, value)
  }
  return values
}

function assertPublishedHapEvidence(evidence, verifiedHap, hapPath) {
  assert(evidence.artifact === basename(hapPath), 'Published HAP evidence names another artifact')
  for (const name of ['bundleName', 'byteLength', 'sha256', 'versionCode', 'versionName']) {
    assert(evidence[name] === verifiedHap[name], `Published HAP ${name} evidence does not match`)
  }
}

function assertProfileEvidence(profile, nowSeconds) {
  assert(profile?.type === 'release', 'Published HAP profile is not a release profile')
  assert(
    profile.bundleName === 'ai.stably.orca.harmony',
    'Published HAP profile bundle name is wrong'
  )
  assert(
    isDeepStrictEqual(profile.allowedAcls, ['ohos.permission.READ_PASTEBOARD']),
    'Published HAP profile ACL evidence is wrong'
  )
  assert(Number.isFinite(profile.notBefore), 'Published HAP profile start time is missing')
  assert(Number.isFinite(profile.notAfter), 'Published HAP profile expiry is missing')
  assert(profile.notBefore <= nowSeconds, 'Published HAP profile is not valid yet')
  assert(
    profile.notAfter >= nowSeconds + MINIMUM_PROFILE_VALIDITY_SECONDS,
    'Published HAP profile expires too soon'
  )
}

function assertSourceEvidence(source, environment) {
  for (const [evidenceName, environmentName] of [
    ['commit', 'GITHUB_SHA'],
    ['ref', 'GITHUB_REF'],
    ['repository', 'GITHUB_REPOSITORY'],
    ['runAttempt', 'GITHUB_RUN_ATTEMPT'],
    ['runId', 'GITHUB_RUN_ID'],
    ['workflowRef', 'GITHUB_WORKFLOW_REF']
  ]) {
    assert(
      source?.[evidenceName] === requiredEnvironment(environment, environmentName),
      `Published HAP provenance ${evidenceName} does not match this run`
    )
  }
}

function assertPhysicalSourceEvidence(source, environment) {
  for (const [evidenceName, environmentName] of [
    ['commit', 'GITHUB_SHA'],
    ['ref', 'GITHUB_REF'],
    ['repository', 'GITHUB_REPOSITORY'],
    ['runAttempt', 'GITHUB_RUN_ATTEMPT'],
    ['runId', 'GITHUB_RUN_ID']
  ]) {
    assert(
      source?.[evidenceName] === requiredEnvironment(environment, environmentName),
      `Physical acceptance ${evidenceName} does not match this run`
    )
  }
}

function assertEvidenceFile(directory, fileName, digest, description) {
  assert(
    typeof fileName === 'string' && fileName === basename(fileName),
    `${description} path is unsafe`
  )
  assert(SHA256_PATTERN.test(digest ?? ''), `${description} digest is malformed`)
  const path = join(directory, fileName)
  assert(existsSync(path), `${description} is missing`)
  assert(sha256(path) === digest, `${description} digest does not match`)
}

function assertSimulatorAcceptanceEvidence(evidence, verifiedHap, path, environment, nowSeconds) {
  assert(evidence.schemaVersion === 1, 'Simulator acceptance schema is unsupported')
  assert(evidence.acceptance === 'simulator', 'Simulator acceptance type is wrong')
  assert(evidence.status === 'passed', 'Simulator acceptance did not pass')
  assert(evidence.mode === 'clean-install', 'Simulator acceptance mode is not clean-install')
  assert(evidence.cleanInstall === true, 'Simulator acceptance was not a clean install')
  assert(
    evidence.publishableCleanAcceptance === true,
    'Simulator acceptance is not publishable clean evidence'
  )
  assert(
    evidence.dataPolicy?.appInstall === 'uninstall-then-install-exact-hap',
    'Simulator acceptance install policy is not clean'
  )
  assert(
    evidence.dataPolicy?.globalHilog === 'cleared-before-run',
    'Simulator acceptance did not clear hilog before run'
  )
  assert(evidence.bundleName === verifiedHap.bundleName, 'Simulator acceptance bundle is wrong')
  assert(
    evidence.hapSha256 === verifiedHap.sha256,
    'Simulator acceptance HAP digest does not match'
  )
  assert(
    evidence.artifactBinding?.kind === 'installed-by-runner',
    'Simulator acceptance artifact binding is not runner-installed'
  )
  assert(
    evidence.artifactBinding?.verified === true &&
      evidence.artifactBinding.sha256 === verifiedHap.sha256,
    'Simulator acceptance artifact binding does not match the verified HAP'
  )
  assert(SHA256_PATTERN.test(evidence.targetHash ?? ''), 'Simulator target hash is malformed')
  assert(
    /(?:emulator|simulator)/iu.test(evidence.deviceModel ?? ''),
    'Simulator device evidence is wrong'
  )
  assert(
    /^\d+$/u.test(evidence.harmonyApi ?? '') && Number(evidence.harmonyApi) >= 12,
    'Simulator API evidence is missing or unsupported'
  )
  assert(
    /^\d+(?:\.\d+){1,3}$/u.test(evidence.hdcVersion ?? ''),
    'Simulator HDC evidence is invalid'
  )
  assert(
    typeof evidence.harmonyFullName === 'string' && evidence.harmonyFullName.length > 0,
    'Simulator OS evidence is missing'
  )
  assertSourceEvidence(evidence.source, environment)

  const startedAt = Date.parse(evidence.timestamp ?? '')
  const completedAt = Date.parse(evidence.completedAt ?? '')
  assert(
    Number.isFinite(startedAt) && Number.isFinite(completedAt),
    'Simulator acceptance time is invalid'
  )
  assert(completedAt >= startedAt, 'Simulator acceptance completion precedes its start')
  const completedSeconds = Math.floor(completedAt / 1000)
  assert(completedSeconds <= nowSeconds + 300, 'Simulator acceptance completion is in the future')
  assert(
    completedSeconds >= nowSeconds - MAXIMUM_ACCEPTANCE_AGE_SECONDS,
    'Simulator acceptance evidence is too old'
  )

  const directory = dirname(path)
  for (const [phaseName, fileStem] of [
    ['coldLaunch', 'cold-launch'],
    ['warmDeepLink', 'warm-deep-link'],
    ['backgroundForeground', 'background-foreground'],
    ['coldDeepLink', 'cold-deep-link']
  ]) {
    const phase = evidence.phases?.[phaseName]
    assert(
      Array.isArray(phase?.pids) && phase.pids.length > 0,
      `Simulator ${phaseName} PID evidence is missing`
    )
    assert(
      phase.pids.every((pid) => /^\d+$/u.test(pid)),
      `Simulator ${phaseName} PID evidence is malformed`
    )
    assert(
      phase.layout === `${fileStem}.layout.json`,
      `Simulator ${phaseName} layout name is wrong`
    )
    assert(
      phase.screenshot === `${fileStem}.png`,
      `Simulator ${phaseName} screenshot name is wrong`
    )
    assertEvidenceFile(directory, phase.layout, phase.layoutSha256, `Simulator ${phaseName} layout`)
    assertEvidenceFile(
      directory,
      phase.screenshot,
      phase.screenshotSha256,
      `Simulator ${phaseName} screenshot`
    )
  }
  assert(
    Array.isArray(evidence.logs?.fatal) && evidence.logs.fatal.length === 0,
    'Simulator fatal log evidence is not empty'
  )
  assert(evidence.logs?.path === 'hilog.filtered.txt', 'Simulator log evidence name is wrong')
  assert(
    evidence.logs?.scope?.globalBufferCleared === true,
    'Simulator log evidence did not start from a cleared buffer'
  )
  assert(
    evidence.logs?.scope?.timeWindow?.enabled === false,
    'Simulator log evidence was collected in preserve-data mode'
  )
  assertEvidenceFile(directory, evidence.logs.path, evidence.logs.sha256, 'Simulator filtered log')
}

function assertPhysicalAcceptanceEvidence(evidence, verifiedHap, hapPath, environment) {
  assert(evidence.schemaVersion === 1, 'Physical acceptance schema is unsupported')
  assert(evidence.acceptance === 'physical-device', 'Physical acceptance type is wrong')
  assert(evidence.status === 'approved', 'Physical acceptance was not approved')
  assert(
    evidence.environment === requiredEnvironment(environment, 'HARMONY_RELEASE_ENVIRONMENT'),
    'Physical acceptance environment is wrong'
  )
  assert(
    evidence.hap?.artifact === basename(hapPath),
    'Physical acceptance names another HAP artifact'
  )
  assert(
    evidence.hap?.sha256 === verifiedHap.sha256,
    'Physical acceptance HAP digest does not match'
  )
  assert(
    GITHUB_LOGIN_PATTERN.test(evidence.reviewer ?? ''),
    'Physical acceptance reviewer is invalid'
  )
  const reviewer = evidence.reviewer.toLowerCase()
  const actor = requiredEnvironment(environment, 'GITHUB_ACTOR').toLowerCase()
  const triggeringActor = requiredEnvironment(environment, 'GITHUB_TRIGGERING_ACTOR').toLowerCase()
  assert(
    reviewer !== actor && reviewer !== triggeringActor,
    'Physical acceptance reviewer cannot approve their own release'
  )
  assert(
    SHA256_PATTERN.test(evidence.approvalCommentSha256 ?? ''),
    'Physical acceptance approval comment digest is invalid'
  )
  assertPhysicalSourceEvidence(evidence.source, environment)
}

function assertLockEvidence(locks, harmonyRoot) {
  for (const [name, path] of [
    ['npm', join(harmonyRoot, 'package-lock.json')],
    ['ohpmEntry', join(harmonyRoot, 'entry/oh-package-lock.json5')],
    ['ohpmProject', join(harmonyRoot, 'oh-package-lock.json5')]
  ]) {
    assert(locks?.[name] === sha256(path), `Published HAP ${name} lock evidence does not match`)
  }
}

function assertPatchedDependencyEvidence(label, evidence, paths) {
  for (const [name, path] of Object.entries(paths)) {
    assert(
      evidence?.[name] === sha256(path),
      `Published HAP ${label} ${name} evidence does not match`
    )
  }
}

export function verifyHarmonyPublishArtifacts(paths, options = {}) {
  const resolvedPaths = Object.fromEntries(
    Object.entries(paths).map(([name, path]) => [name, resolve(path)])
  )
  for (const [name, path] of Object.entries(resolvedPaths)) {
    assert(existsSync(path), `Harmony publish artifact is missing: ${name}`)
  }

  const harmonyRoot = resolve(options.harmonyRoot ?? defaultHarmonyRoot)
  const environment = options.environment ?? process.env
  const expectedToolchain =
    options.expectedToolchain ??
    readJson(join(harmonyRoot, 'release-toolchain-pins.json'), 'toolchain pins')
  const toolchain = readJson(resolvedPaths.toolchain, 'published toolchain evidence')
  verifyHarmonyToolchainSnapshot(expectedToolchain, toolchain)

  const verifyHap = options.verifyHap ?? verifyHarmonyReleaseHap
  const verifiedHap = verifyHap(resolvedPaths.hap, { verifySourceResources: false })
  assert(
    verifiedHap.sha256 === sha256(resolvedPaths.hap),
    'Published HAP digest verification failed'
  )
  assert(
    verifiedHap.byteLength === readFileSync(resolvedPaths.hap).length,
    'Published HAP size verification failed'
  )

  const evidence = readJson(resolvedPaths.evidence, 'published HAP evidence')
  assertPublishedHapEvidence(evidence, verifiedHap, resolvedPaths.hap)
  const expectedFingerprint = normalizeCertificateFingerprint(
    options.expectedFingerprint ?? requiredEnvironment(environment, 'HARMONY_RELEASE_CERT_SHA256')
  )
  assert(
    normalizeCertificateFingerprint(evidence.certificateSha256 ?? '') === expectedFingerprint,
    'Published HAP certificate evidence does not match'
  )
  const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1000)
  assertProfileEvidence(evidence.profile, nowSeconds)

  const simulatorAcceptance = readJson(
    resolvedPaths.simulatorAcceptance,
    'simulator acceptance evidence'
  )
  assertSimulatorAcceptanceEvidence(
    simulatorAcceptance,
    verifiedHap,
    resolvedPaths.simulatorAcceptance,
    environment,
    nowSeconds
  )
  const physicalAcceptance = readJson(
    resolvedPaths.physicalAcceptance,
    'physical acceptance evidence'
  )
  assertPhysicalAcceptanceEvidence(physicalAcceptance, verifiedHap, resolvedPaths.hap, environment)

  const provenance = evidence.provenance ?? {}
  assertSourceEvidence(provenance.source, environment)
  assertLockEvidence(provenance.locks, harmonyRoot)
  assertPatchedDependencyEvidence('React Native core', provenance.patchedReactNativeCore, {
    har: join(harmonyRoot, 'generated/react_native_openharmony.har'),
    patch: join(harmonyRoot, 'scripts/react-native-core-text-input-patch.mjs')
  })
  assertPatchedDependencyEvidence('WebView', provenance.patchedWebView, {
    har: join(harmonyRoot, 'generated/rn_webview.har'),
    patch: join(harmonyRoot, 'patches/@react-native-oh-tpl+react-native-webview+13.10.3.patch')
  })
  assertPatchedDependencyEvidence('safe-area', provenance.patchedSafeArea, {
    har: join(harmonyRoot, 'generated/safe_area.har'),
    patch: join(
      harmonyRoot,
      'patches/@react-native-oh-tpl+react-native-safe-area-context+4.7.4-0.2.1.patch'
    )
  })
  assert(
    isDeepStrictEqual(provenance.toolchain, toolchain),
    'Published HAP toolchain evidence does not match'
  )

  const sbom = readJson(resolvedPaths.sbom, 'published SBOM')
  assert(
    sbom.bomFormat === 'CycloneDX' &&
      sbom.specVersion === '1.5' &&
      Array.isArray(sbom.components) &&
      sbom.components.length > 0 &&
      Array.isArray(sbom.dependencies),
    'Published Harmony SBOM is invalid'
  )
  assert(
    /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
      sbom.serialNumber ?? ''
    ),
    'Published Harmony SBOM serial number is invalid'
  )
  assert(
    provenance.sbom?.artifact === basename(resolvedPaths.sbom) &&
      provenance.sbom?.sha256 === sha256(resolvedPaths.sbom),
    'Published Harmony SBOM evidence does not match'
  )

  const buildEvidence = readBuildEvidence(resolvedPaths.buildEvidence)
  assert(
    buildEvidence.get('commit') === requiredEnvironment(environment, 'GITHUB_SHA'),
    'Published Harmony build commit does not match'
  )
  for (const name of ['os', 'kernel', 'git']) {
    assert(buildEvidence.has(name), `Published Harmony build evidence is missing ${name}`)
  }
  for (const [name, version] of [
    ['node', expectedToolchain.node],
    ['npm', expectedToolchain.npm],
    ['ohpm', expectedToolchain.ohpm],
    ['hvigor', expectedToolchain.hvigor],
    ['java', expectedToolchain.java]
  ]) {
    assert(
      buildEvidence.get(name)?.includes(version),
      `Published Harmony build evidence does not match ${name}`
    )
  }

  return {
    artifact: basename(resolvedPaths.hap),
    acceptanceReviewer: physicalAcceptance.reviewer,
    components: sbom.components.length,
    sha256: verifiedHap.sha256,
    versionName: verifiedHap.versionName
  }
}

function isMainModule() {
  return process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
}

if (isMainModule()) {
  const [hap, evidence, sbom, toolchain, buildEvidence, simulatorAcceptance, physicalAcceptance] =
    process.argv.slice(2)
  if (
    ![hap, evidence, sbom, toolchain, buildEvidence, simulatorAcceptance, physicalAcceptance].every(
      Boolean
    )
  ) {
    throw new Error(
      'Usage: verify-harmony-publish-artifacts.mjs <hap> <evidence> <sbom> <toolchain> <build-evidence> <simulator-acceptance> <physical-acceptance>'
    )
  }
  const result = verifyHarmonyPublishArtifacts({
    buildEvidence,
    evidence,
    hap,
    physicalAcceptance,
    sbom,
    simulatorAcceptance,
    toolchain
  })
  console.log(
    `[release-publish] Verified ${result.artifact} ${result.versionName}, ` +
      `sha256=${result.sha256}, components=${result.components}, ` +
      `physicalReviewer=${result.acceptanceReviewer}.`
  )
}
