#!/usr/bin/env node

import { createHash } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const PHYSICAL_ACCEPTANCE_ENVIRONMENT = 'harmony-production-publish'
const PHYSICAL_ACCEPTANCE_SCHEMA_VERSION = 1
const PHYSICAL_ACCEPTANCE_KIND = 'physical-device'
const COMMIT_PATTERN = /^[0-9a-f]{40,64}$/u
const RUN_NUMBER_PATTERN = /^\d+$/u
const GITHUB_LOGIN_PATTERN = /^(?:[A-Za-z0-9]|[A-Za-z0-9][A-Za-z0-9-]{0,37}[A-Za-z0-9])$/u

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

function requiredEnvironment(environment, name, pattern) {
  const value = typeof environment[name] === 'string' ? environment[name].trim() : ''
  assert(value.length > 0, `Harmony physical acceptance requires ${name}`)
  if (pattern) {
    assert(pattern.test(value), `Harmony physical acceptance has invalid ${name}`)
  }
  return value
}

function sourceFromEnvironment(environment) {
  return {
    repository: requiredEnvironment(environment, 'GITHUB_REPOSITORY'),
    commit: requiredEnvironment(environment, 'GITHUB_SHA', COMMIT_PATTERN),
    ref: requiredEnvironment(environment, 'GITHUB_REF'),
    runId: requiredEnvironment(environment, 'GITHUB_RUN_ID', RUN_NUMBER_PATTERN),
    runAttempt: requiredEnvironment(environment, 'GITHUB_RUN_ATTEMPT', RUN_NUMBER_PATTERN)
  }
}

function readApprovalsDocument(approvals) {
  const records = Array.isArray(approvals)
    ? approvals
    : approvals && typeof approvals === 'object' && Array.isArray(approvals.approvals)
      ? approvals.approvals
      : null
  assert(records, 'Harmony workflow approvals JSON must contain an approvals array')
  assert(records.length > 0, 'Harmony workflow approvals JSON is empty')
  return records
}

function findPhysicalApproval(approvals) {
  const records = readApprovalsDocument(approvals)
  const candidates = records.filter(
    (record) =>
      record &&
      typeof record === 'object' &&
      !Array.isArray(record) &&
      record.state === 'approved' &&
      Array.isArray(record.environments) &&
      record.environments.some(
        (environment) =>
          environment &&
          typeof environment === 'object' &&
          !Array.isArray(environment) &&
          environment.name === PHYSICAL_ACCEPTANCE_ENVIRONMENT
      )
  )
  assert(candidates.length === 1, 'Expected exactly one approved physical acceptance')
  return candidates[0]
}

function validGithubLogin(login) {
  return typeof login === 'string' && GITHUB_LOGIN_PATTERN.test(login)
}

function extractCommentHash(comment, hapSha256) {
  assert(
    typeof comment === 'string' && comment.length > 0,
    'Physical acceptance comment is missing'
  )
  const markerLines = comment
    .split(/\r\n|\n|\r/u)
    .filter((line) => line.startsWith('physical-hap-sha256:'))
  assert(markerLines.length === 1, 'Physical acceptance comment must contain one digest marker')
  const marker = /^physical-hap-sha256: ([0-9a-f]{64})$/u.exec(markerLines[0])
  assert(marker, 'Physical acceptance digest marker is invalid')
  assert(marker[1] === hapSha256, 'Physical acceptance digest does not match the HAP')
  return createHash('sha256').update(comment, 'utf8').digest('hex')
}

function readHap(hapPath) {
  const resolvedPath = resolve(hapPath)
  let bytes
  try {
    assert(existsSync(resolvedPath), 'Harmony physical acceptance HAP does not exist')
    assert(statSync(resolvedPath).isFile(), 'Harmony physical acceptance HAP is not a file')
    bytes = readFileSync(resolvedPath)
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Harmony physical acceptance')) {
      throw error
    }
    throw new Error('Unable to read Harmony physical acceptance HAP')
  }
  return {
    artifact: basename(resolvedPath),
    sha256: createHash('sha256').update(bytes).digest('hex')
  }
}

function normalizeArguments(input, approvals, options) {
  if (typeof input === 'string') {
    return { hapPath: input, approvals, ...options }
  }
  assert(
    input && typeof input === 'object' && !Array.isArray(input),
    'Physical acceptance input is invalid'
  )
  return input
}

export function verifyHarmonyPhysicalAcceptance(input, approvals, options) {
  const normalized = normalizeArguments(input, approvals, options)
  const { hapPath, environment = process.env } = normalized
  assert(
    typeof hapPath === 'string' && hapPath.length > 0,
    'Harmony physical acceptance HAP path is missing'
  )
  assert(
    environment && typeof environment === 'object',
    'Harmony physical acceptance environment is invalid'
  )

  const source = sourceFromEnvironment(environment)
  const actor = requiredEnvironment(environment, 'GITHUB_ACTOR')
  const triggeringActor = requiredEnvironment(environment, 'GITHUB_TRIGGERING_ACTOR')
  const hap = readHap(hapPath)
  const approvalsDocument =
    normalized.approvals ??
    (normalized.approvalsPath ? readApprovalsFile(normalized.approvalsPath) : undefined)
  const approval = findPhysicalApproval(approvalsDocument)
  const reviewer = approval.user?.login
  assert(validGithubLogin(reviewer), 'Physical acceptance reviewer login is invalid')
  assert(
    reviewer.toLowerCase() !== actor.toLowerCase() &&
      reviewer.toLowerCase() !== triggeringActor.toLowerCase(),
    'Physical acceptance reviewer must not be a workflow actor'
  )
  const approvalCommentSha256 = extractCommentHash(approval.comment, hap.sha256)

  return {
    schemaVersion: PHYSICAL_ACCEPTANCE_SCHEMA_VERSION,
    status: 'approved',
    acceptance: PHYSICAL_ACCEPTANCE_KIND,
    hap,
    source,
    environment: PHYSICAL_ACCEPTANCE_ENVIRONMENT,
    reviewer,
    approvalCommentSha256
  }
}

export function writeHarmonyPhysicalAcceptanceEvidence(outputPath, evidence) {
  assert(
    typeof outputPath === 'string' && outputPath.length > 0,
    'Physical acceptance output path is missing'
  )
  const resolvedPath = resolve(outputPath)
  if (existsSync(resolvedPath)) {
    assert(
      !lstatSync(resolvedPath).isSymbolicLink(),
      'Physical acceptance output must not be a symlink'
    )
  }
  mkdirSync(dirname(resolvedPath), { recursive: true })
  writeFileSync(resolvedPath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 })
  chmodSync(resolvedPath, 0o600)
  return resolvedPath
}

function readApprovalsFile(approvalsPath) {
  try {
    return JSON.parse(readFileSync(resolve(approvalsPath), 'utf8'))
  } catch {
    throw new Error('Unable to read Harmony workflow approvals JSON')
  }
}

function isMainModule() {
  return process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
}

if (isMainModule()) {
  const [hapPath, approvalsPath, outputPath] = process.argv.slice(2)
  if (!hapPath || !approvalsPath || !outputPath) {
    throw new Error(
      'Usage: verify-harmony-physical-acceptance.mjs <release.hap> <workflow-approvals.json> <output.json>'
    )
  }
  const resolvedOutputPath = resolve(outputPath)
  assert(
    resolvedOutputPath !== resolve(hapPath) && resolvedOutputPath !== resolve(approvalsPath),
    'Physical acceptance output must differ from its inputs'
  )
  const evidence = verifyHarmonyPhysicalAcceptance({
    hapPath,
    approvals: readApprovalsFile(approvalsPath),
    environment: process.env
  })
  writeHarmonyPhysicalAcceptanceEvidence(resolvedOutputPath, evidence)
  console.log(
    `[physical-acceptance] Verified ${evidence.hap.artifact}, sha256=${evidence.hap.sha256}`
  )
}
