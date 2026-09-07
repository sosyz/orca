import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { CLEAN_INSTALL_MODE, PRESERVE_DATA_MODE } from './harmony-simulator-acceptance-mode.mjs'
import { INVALID_PAIRING_URI, sha256 } from './harmony-simulator-acceptance-options.mjs'
import {
  assertPreserveDataHilogScopeResult,
  hilogReadArgsForAcceptanceMode,
  hilogScopeEvidenceForAcceptanceMode,
  scopeHilogToPidEpochWindow
} from './harmony-simulator-log-window.mjs'

export function githubSourceEvidence(environment) {
  const source = {
    commit: environment.GITHUB_SHA?.trim(),
    ref: environment.GITHUB_REF?.trim(),
    repository: environment.GITHUB_REPOSITORY?.trim(),
    runAttempt: environment.GITHUB_RUN_ATTEMPT?.trim(),
    runId: environment.GITHUB_RUN_ID?.trim(),
    workflowRef: environment.GITHUB_WORKFLOW_REF?.trim()
  }
  return Object.values(source).every(Boolean) ? source : undefined
}

export function acceptanceArtifactEvidence(mode, hap) {
  if (mode === CLEAN_INSTALL_MODE) {
    return {
      artifactBinding: {
        kind: 'installed-by-runner',
        sha256: hap.sha256,
        verified: true
      },
      hapSha256: hap.sha256
    }
  }
  return {
    artifactBinding: {
      kind: 'preexisting-install-unverified',
      reason: 'preserve-data mode does not install or hash the app already present on the target',
      verified: false
    },
    candidateHap: {
      bundleName: hap.bundleName,
      entryAbility: hap.entryAbility,
      entryModule: hap.entryModule,
      sha256: hap.sha256
    }
  }
}

export function filterHilogByPids(hilog, pids) {
  const pidSet = new Set(pids.map(String))
  if (pidSet.size === 0) {
    return ''
  }
  return String(hilog)
    .split(/\r?\n/u)
    .filter((line) =>
      [...pidSet].some((pid) => new RegExp(`(?:^|\\s|[=:])${pid}(?:\\s|$|[,:])`, 'u').test(line))
    )
    .join('\n')
}

export function sanitizeLog(log, secrets = []) {
  let sanitized = String(log)
  for (const secret of secrets) {
    if (secret) {
      sanitized = sanitized.replaceAll(String(secret), '<redacted>')
    }
  }
  return sanitized
    .replace(/([?&][^=\s#]+)=([^&#\s]+)/gu, '$1=<redacted>')
    .replace(/(#[^\s]+)/gu, '#<redacted>')
    .replace(/(access[_-]?token|password|secret|api[_-]?key)\s*[=:]\s*[^\s,;]+/giu, '$1=<redacted>')
    .replace(/(?:Bearer\s+)[A-Za-z0-9._~+/=-]+/gu, 'Bearer <redacted>')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/gu, '<redacted>')
}

export function classifyFatalLogs(log) {
  const hasSuccessfulEmbeddedBundle =
    /(?:Loaded bundle from rawfile resource|JS bundle executed successfully)/iu.test(log)
  const categories = [
    ['fatal', /\bfatal\b/iu],
    ['uncaught', /\buncaught(?: exception| error)?\b/iu],
    ['crash', /\b(?:crash|abort|segmentation fault)\b/iu],
    ['metro', /(?:metro|localhost:8081)/iu],
    ['plaintext-bundle', /(?:plaintext(?: javascript)?|bundle\.harmony\.js|source map)/iu],
    [
      'signing',
      /(?:signing\s+(?:error|failed)|signature\s+(?:error|verification failed)|certificate\s+(?:error|invalid))/iu
    ]
  ]
  return String(log)
    .split(/\r?\n/u)
    .filter(Boolean)
    .flatMap((line) => {
      const match = categories.find(([category, pattern]) =>
        category === 'metro'
          ? !hasSuccessfulEmbeddedBundle && pattern.test(line)
          : pattern.test(line)
      )
      return match ? [{ category: match[0], line }] : []
    })
}

export function writeAcceptanceEvidence(outputDir, evidence) {
  mkdirSync(outputDir, { recursive: true, mode: 0o700 })
  const path = resolve(outputDir, 'evidence.json')
  writeFileSync(path, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 })
  return path
}

export function remoteAcceptanceDirectory(runKey = `${Date.now()}-${process.pid}`) {
  return `/data/local/tmp/orca-harmony-acceptance-${sha256(String(runKey)).slice(0, 16)}`
}

function acceptancePhaseFileStem(phase) {
  return phase.replace(/[^a-z0-9-]+/giu, '-')
}

function phaseFailureArtifacts(outputDir, phase) {
  const safeName = acceptancePhaseFileStem(phase)
  const artifacts = {}
  for (const [kind, extension] of [
    ['layout', '.layout.json'],
    ['screenshot', '.png']
  ]) {
    const path = resolve(outputDir, `${safeName}${extension}`)
    if (existsSync(path)) {
      artifacts[kind] = basename(path)
      artifacts[`${kind}Sha256`] = sha256(readFileSync(path))
    }
  }
  return artifacts
}

export function acceptanceFailureEvidence(error, phase, outputDir, target) {
  const message = error instanceof Error ? error.message : String(error)
  return {
    artifacts: phaseFailureArtifacts(outputDir, phase),
    completedAt: new Date().toISOString(),
    message: sanitizeLog(message, [target, INVALID_PAIRING_URI]),
    phase
  }
}

export function collectLogEvidence(
  command,
  hdc,
  target,
  pids,
  { completedAtMs, mode, startedAtMs }
) {
  const rawLog = command(hdc, target, hilogReadArgsForAcceptanceMode(mode, pids))
  let boundedLog = filterHilogByPids(rawLog, pids)
  let timeWindowResult
  if (mode === PRESERVE_DATA_MODE) {
    timeWindowResult = scopeHilogToPidEpochWindow(rawLog, { completedAtMs, pids, startedAtMs })
    assertPreserveDataHilogScopeResult(timeWindowResult)
    boundedLog = timeWindowResult.text
  }
  const sanitized = sanitizeLog(boundedLog, [target, INVALID_PAIRING_URI])
  return {
    fatal: classifyFatalLogs(sanitized),
    scope: hilogScopeEvidenceForAcceptanceMode({
      completedAtMs,
      mode,
      startedAtMs,
      timeWindowResult
    }),
    text: sanitized
  }
}
