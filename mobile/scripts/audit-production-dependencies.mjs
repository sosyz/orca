import { createHash } from 'node:crypto'
import { spawnSync, execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const mobileRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const patchPath = 'patches/image-size@1.2.1.patch'
const patchHash = 'a5f215f616a99a61357ff8be0fea71eb8d73cf296250c4cc01162854282f789e'
const patchPackage = 'image-size'
const patchVersion = '1.2.1'
const patchDependencyPath = '.>react-native>@react-native/community-cli-plugin>metro>image-size'

export const ALLOWED_ADVISORIES = Object.freeze({
  'GHSA-W3RX-R6R6-PGPR': Object.freeze({
    dependencyPath: patchDependencyPath,
    packageName: patchPackage,
    severity: 'high',
    version: patchVersion
  }),
  'GHSA-5P2G-FCMC-QVQQ': Object.freeze({
    dependencyPath: patchDependencyPath,
    packageName: patchPackage,
    severity: 'high',
    version: patchVersion
  })
})

const fail = (message) => {
  throw new Error(`production dependency audit: ${message}`)
}

const getAdvisoryEntries = (report) => {
  if (!report || typeof report !== 'object' || Array.isArray(report)) {
    fail('pnpm audit returned a non-object report')
  }

  if (!Object.hasOwn(report, 'advisories')) {
    fail('pnpm audit report has no advisories field')
  }

  if (Array.isArray(report.advisories)) {
    return report.advisories.map((advisory, index) => [String(index), advisory])
  }

  if (report.advisories && typeof report.advisories === 'object') {
    return Object.entries(report.advisories)
  }

  fail('pnpm audit advisories field has an unsupported shape')
}

const advisoryId = (key, advisory) => {
  const fromReport = advisory?.github_advisory_id
  if (typeof fromReport === 'string' && /^GHSA-[a-z0-9-]+$/i.test(fromReport)) {
    return fromReport.toUpperCase()
  }

  if (/^GHSA-[a-z0-9-]+$/i.test(key)) {
    return key.toUpperCase()
  }

  fail('an advisory is missing a GitHub advisory ID')
}

export const validateAuditReport = (report) => {
  const entries = getAdvisoryEntries(report)
  if (!Array.isArray(report.muted)) {
    fail('pnpm audit report has no muted-advisory list')
  }
  if (report.muted.length > 0) {
    fail('pnpm audit report contains muted advisories')
  }
  const seen = new Set()

  for (const [key, advisory] of entries) {
    if (!advisory || typeof advisory !== 'object' || Array.isArray(advisory)) {
      fail(`advisory ${key} has an unsupported shape`)
    }

    const id = advisoryId(key, advisory)
    const allowed = ALLOWED_ADVISORIES[id]
    if (!allowed) {
      fail(`unexpected advisory ${id}`)
    }
    if (seen.has(id)) {
      fail(`duplicate advisory ${id}`)
    }
    seen.add(id)

    if (advisory.module_name !== allowed.packageName) {
      fail(`advisory ${id} affects an unexpected package`)
    }
    if (advisory.severity !== allowed.severity) {
      fail(`advisory ${id} has an unexpected severity`)
    }

    if (!Array.isArray(advisory.findings) || advisory.findings.length === 0) {
      fail(`advisory ${id} has no findings`)
    }

    for (const finding of advisory.findings) {
      if (!finding || finding.version !== allowed.version) {
        fail(`advisory ${id} affects an unexpected version`)
      }
      if (!Array.isArray(finding.paths) || finding.paths.length === 0) {
        fail(`advisory ${id} has no dependency paths`)
      }
      for (const path of finding.paths) {
        if (path !== allowed.dependencyPath) {
          fail(`image-size dependency path drifted: ${String(path)}`)
        }
      }
    }
  }

  return [...seen].sort()
}

export const verifyPatchMetadata = (root = mobileRoot) => {
  const patchFile = resolve(root, patchPath)
  const lockFile = resolve(root, 'pnpm-lock.yaml')
  const workspaceFile = resolve(root, 'pnpm-workspace.yaml')

  if (!existsSync(patchFile) || !existsSync(lockFile) || !existsSync(workspaceFile)) {
    fail('image-size patch metadata is incomplete')
  }

  const actualHash = createHash('sha256').update(readFileSync(patchFile)).digest('hex')
  if (actualHash !== patchHash) {
    fail(`image-size patch hash drifted: ${actualHash}`)
  }

  const lockText = readFileSync(lockFile, 'utf8')
  const lockSection = lockText.match(/^patchedDependencies:\n([\s\S]*?)(?=^importers:)/m)?.[1]
  const expectedLockEntry = `  ${patchPackage}@${patchVersion}:\n    hash: ${patchHash}\n    path: ${patchPath}`
  if (!lockSection || lockSection.split(expectedLockEntry).length !== 2) {
    fail('pnpm lockfile image-size patch entry drifted')
  }
  if ((lockSection.match(/^  image-size@[^:\n]+:/gm) ?? []).length !== 1) {
    fail('pnpm lockfile contains an unexpected image-size patch entry')
  }

  const workspaceText = readFileSync(workspaceFile, 'utf8')
  const workspaceEntry = `  ${patchPackage}@${patchVersion}: ${patchPath}`
  const workspaceEntries = workspaceText.match(/^  image-size@[^:\n]+: [^\n]+$/gm) ?? []
  if (workspaceEntries.length !== 1 || workspaceEntries[0] !== workspaceEntry) {
    fail('pnpm workspace image-size patch entry drifted')
  }
}

const runImageSizeRegressionContract = (root = mobileRoot) => {
  const testFile = resolve(root, 'scripts/image-size-security-patch.test.mjs')
  if (!existsSync(testFile)) {
    fail('image-size patch regression contract is missing')
  }

  try {
    execFileSync(process.execPath, ['--test', testFile], {
      cwd: root,
      stdio: 'inherit'
    })
  } catch {
    fail('image-size patch regression contract failed')
  }
}

const runPnpmAudit = (root = mobileRoot) => {
  const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
  const result = spawnSync(command, ['audit', '--prod', '--json'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024
  })

  if (result.error) {
    fail(`could not run pnpm audit: ${result.error.message}`)
  }
  if (result.status === null || (result.status !== 0 && result.status !== 1)) {
    fail(
      `pnpm audit failed before producing a vulnerability report (exit ${result.status ?? 'unknown'})`
    )
  }

  let report
  try {
    report = JSON.parse(result.stdout.trim())
  } catch {
    fail('pnpm audit did not produce valid JSON')
  }
  return report
}

export const runProductionDependencyAudit = (root = mobileRoot) => {
  verifyPatchMetadata(root)
  runImageSizeRegressionContract(root)
  const advisories = validateAuditReport(runPnpmAudit(root))
  console.log(
    `production dependency audit passed (${advisories.length} allowed high-severity ${advisories.length === 1 ? 'advisory' : 'advisories'})`
  )
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    runProductionDependencyAudit()
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'production dependency audit failed')
    process.exitCode = 1
  }
}
