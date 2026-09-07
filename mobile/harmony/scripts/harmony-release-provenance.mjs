import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function requiredCiValue(environment, name, pattern) {
  const value = environment[name]?.trim()
  if (!value || (pattern && !pattern.test(value))) {
    throw new Error(`Harmony release provenance requires ${name}`)
  }
  return value
}

export function collectHarmonyReleaseProvenance(options = {}) {
  const harmonyRoot = resolve(options.harmonyRoot ?? resolve(import.meta.dirname, '..'))
  const environment = options.environment ?? process.env
  const requireCi = options.requireCi ?? environment.HARMONY_RELEASE_REQUIRE_PROVENANCE === 'true'
  const source = {
    commit: environment.GITHUB_SHA?.trim() || null,
    ref: environment.GITHUB_REF?.trim() || null,
    repository: environment.GITHUB_REPOSITORY?.trim() || null,
    runAttempt: environment.GITHUB_RUN_ATTEMPT?.trim() || null,
    runId: environment.GITHUB_RUN_ID?.trim() || null,
    workflowRef: environment.GITHUB_WORKFLOW_REF?.trim() || null
  }
  if (requireCi) {
    source.commit = requiredCiValue(environment, 'GITHUB_SHA', /^[0-9a-f]{40,64}$/u)
    source.ref = requiredCiValue(environment, 'GITHUB_REF')
    source.repository = requiredCiValue(environment, 'GITHUB_REPOSITORY')
    source.runAttempt = requiredCiValue(environment, 'GITHUB_RUN_ATTEMPT', /^\d+$/u)
    source.runId = requiredCiValue(environment, 'GITHUB_RUN_ID', /^\d+$/u)
    source.workflowRef = requiredCiValue(environment, 'GITHUB_WORKFLOW_REF')
  }

  const toolchainEvidencePath = environment.HARMONY_RELEASE_TOOLCHAIN_EVIDENCE_PATH?.trim()
  if (requireCi && !toolchainEvidencePath) {
    throw new Error('Harmony release provenance requires toolchain evidence')
  }
  const toolchain = toolchainEvidencePath
    ? JSON.parse(readFileSync(resolve(toolchainEvidencePath), 'utf8'))
    : null
  const sbomPath = environment.HARMONY_RELEASE_SBOM_PATH?.trim()
  if (requireCi && !sbomPath) {
    throw new Error('Harmony release provenance requires an SBOM')
  }

  return {
    locks: {
      npm: sha256(join(harmonyRoot, 'package-lock.json')),
      ohpmEntry: sha256(join(harmonyRoot, 'entry/oh-package-lock.json5')),
      ohpmProject: sha256(join(harmonyRoot, 'oh-package-lock.json5'))
    },
    patchedWebView: {
      har: sha256(join(harmonyRoot, 'generated/rn_webview.har')),
      patch: sha256(
        join(harmonyRoot, 'patches/@react-native-oh-tpl+react-native-webview+13.10.3.patch')
      )
    },
    patchedSafeArea: {
      har: sha256(join(harmonyRoot, 'generated/safe_area.har')),
      patch: sha256(
        join(
          harmonyRoot,
          'patches/@react-native-oh-tpl+react-native-safe-area-context+4.7.4-0.2.1.patch'
        )
      )
    },
    sbom: sbomPath
      ? { artifact: sbomPath.split(/[\\/]/u).at(-1), sha256: sha256(resolve(sbomPath)) }
      : null,
    source,
    toolchain
  }
}
