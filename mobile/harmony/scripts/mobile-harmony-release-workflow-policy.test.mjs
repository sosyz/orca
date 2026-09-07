import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

const workflowPath = resolve(
  import.meta.dirname,
  '../../../.github/workflows/mobile-harmony-release.yml'
)
const workflow = readFileSync(workflowPath, 'utf8')

test('signing temporary files stay inside the runner cleanup boundary', () => {
  assert.match(workflow, /^      TMPDIR: \$\{\{ runner\.temp \}\}$/mu)
  assert.match(workflow, /safe_remove_temp_path\(\)/u)
  assert.match(workflow, /test "\$runner_temp" != \/ -a "\$runner_temp" != "\$workspace"/u)
  assert.doesNotMatch(workflow, /RUNNER_TEMP:-\/tmp/u)
  assert.match(workflow, /-name 'orca-harmony-sign-\*'/u)
})

test('self-hosted signing and simulator jobs verify exact runner identity before checkout', () => {
  const signingJob = workflowJob('build-and-sign')
  const simulatorJob = workflowJob('simulator-acceptance')
  for (const [job, stepName, sentinelName] of [
    [
      signingJob,
      'Verify exact signing runner identity before checkout',
      'harmony-release-runner.sentinel'
    ],
    [
      simulatorJob,
      'Verify exact simulator runner identity before checkout',
      'harmony-simulator-runner.sentinel'
    ]
  ]) {
    const identityIndex = job.indexOf(`      - name: ${stepName}`)
    const checkoutIndex = job.indexOf('uses: actions/checkout@')
    assert.notEqual(identityIndex, -1)
    assert.ok(identityIndex < checkoutIndex)
    assert.match(job.slice(identityIndex, checkoutIndex), /runner\.name/u)
    assert.match(job.slice(identityIndex, checkoutIndex), /runner\.environment/u)
    assert.match(
      job.slice(identityIndex, checkoutIndex),
      /test "\$ACTUAL_RUNNER_NAME" = "\$EXPECTED_RUNNER_NAME"/u
    )
    assert.match(
      job.slice(identityIndex, checkoutIndex),
      new RegExp(`test "\\$SENTINEL_PATH" = /Users/Shared/orca/${sentinelName.replace('.', '\\.')}`)
    )
    assert.match(job.slice(identityIndex, checkoutIndex), /shasum -a 256/u)
    assert.match(
      job.slice(identityIndex, checkoutIndex),
      /test "\$actual_sentinel_sha256" = "\$EXPECTED_SENTINEL_SHA256"/u
    )
  }
  const simulatorDownloadIndex = simulatorJob.indexOf('uses: actions/download-artifact@')
  const simulatorIdentityIndex = simulatorJob.indexOf(
    '      - name: Verify exact simulator runner identity before checkout'
  )
  assert.ok(simulatorIdentityIndex < simulatorDownloadIndex)
})

function workflowRunScript(stepName) {
  const stepMarker = `      - name: ${stepName}\n`
  const stepStart = workflow.indexOf(stepMarker)
  assert.notEqual(stepStart, -1, `Workflow step is missing: ${stepName}`)
  const runMarker = '        run: |\n'
  const runStart = workflow.indexOf(runMarker, stepStart)
  assert.notEqual(runStart, -1, `Workflow run block is missing: ${stepName}`)

  const lines = workflow.slice(runStart + runMarker.length).split('\n')
  const script = []
  for (const line of lines) {
    if (line.startsWith('          ')) {
      script.push(line.slice(10))
      continue
    }
    if (line.length === 0) {
      script.push('')
      continue
    }
    break
  }
  assert(
    script.some((line) => line.trim()),
    `Workflow run block is empty: ${stepName}`
  )
  return script.join('\n')
}

function workflowJob(jobName) {
  const marker = `  ${jobName}:\n`
  const start = workflow.indexOf(marker)
  assert.notEqual(start, -1, `Workflow job is missing: ${jobName}`)
  const remaining = workflow.slice(start + marker.length)
  const nextJob = remaining.search(/^  [a-z][a-z0-9-]*:\n/mu)
  return nextJob === -1 ? remaining : remaining.slice(0, nextJob)
}

test('mobile release tests run the fail-closed production dependency audit', () => {
  const job = workflowJob('mobile-tests')
  const auditIndex = job.indexOf('      - name: Audit production dependencies')
  const applicationTestsIndex = job.indexOf('      - name: Verify mobile application')

  assert.notEqual(auditIndex, -1)
  assert.ok(auditIndex < applicationTestsIndex)
  const script = workflowRunScript('Audit production dependencies')
  assert.match(script, /^set -euo pipefail$/mu)
  assert.match(script, /^pnpm test:production-dependency-audit$/mu)
  assert.match(script, /^pnpm audit:production-dependencies$/mu)
  assert.doesNotMatch(job, /^\s+pnpm audit(?:\s|$)/mu)
})

function runWorkflowScript(script, environment, prelude = '') {
  return spawnSync('/bin/bash', ['-c', `${prelude}\n${script}`], {
    encoding: 'utf8',
    env: { ...process.env, ...environment }
  })
}

test('authorize-release actor policy accepts only exact allowlisted initiators', () => {
  const script = workflowRunScript('Verify trusted release initiator before checkout')
  const baseEnvironment = {
    HARMONY_RELEASE_ALLOWED_ACTOR: 'alice,bob',
    HARMONY_RELEASE_ORIGINAL_ACTOR: 'alice',
    HARMONY_RELEASE_TRIGGERING_ACTOR: 'bob'
  }
  assert.equal(runWorkflowScript(script, baseEnvironment).status, 0)

  for (const environment of [
    { ...baseEnvironment, HARMONY_RELEASE_ALLOWED_ACTOR: 'alice, bob' },
    { ...baseEnvironment, HARMONY_RELEASE_ORIGINAL_ACTOR: 'mallory' },
    { ...baseEnvironment, HARMONY_RELEASE_TRIGGERING_ACTOR: 'mallory' }
  ]) {
    assert.notEqual(runWorkflowScript(script, environment).status, 0)
  }
})

const githubComparisonPrelude = `
gh() {
  case "$*" in
    *"--jq .default_branch"*) printf '%s\\n' main ;;
    *"--jq .[0].sha"*) printf '%s\\n' "$MOCK_DEFAULT_SHA" ;;
    *"/compare/"*) printf '%s\\n' '{}' ;;
    *) return 2 ;;
  esac
}
jq() {
  command cat >/dev/null
  case "$*" in
    *".status"*) printf '%s\\n' "$MOCK_COMPARISON_STATUS" ;;
    *".behind_by"*) printf '%s\\n' "$MOCK_BEHIND_BY" ;;
    *) return 2 ;;
  esac
}
`

test('authorize-release accepts only a commit in default-branch history', () => {
  const script = workflowRunScript('Verify source belongs to the default branch before checkout')
  const baseEnvironment = {
    GITHUB_REPOSITORY: 'stablyai/orca',
    GITHUB_SHA: 'a'.repeat(40),
    MOCK_BEHIND_BY: '0',
    MOCK_COMPARISON_STATUS: 'ahead',
    MOCK_DEFAULT_SHA: 'b'.repeat(40)
  }
  assert.equal(runWorkflowScript(script, baseEnvironment, githubComparisonPrelude).status, 0)
  assert.equal(
    runWorkflowScript(
      script,
      { ...baseEnvironment, MOCK_COMPARISON_STATUS: 'identical' },
      githubComparisonPrelude
    ).status,
    0
  )
  for (const environment of [
    { ...baseEnvironment, MOCK_COMPARISON_STATUS: 'diverged' },
    { ...baseEnvironment, MOCK_BEHIND_BY: '1' },
    { ...baseEnvironment, GITHUB_SHA: 'not-a-commit' }
  ]) {
    assert.notEqual(
      runWorkflowScript(script, environment, githubComparisonPrelude).status,
      0,
      JSON.stringify(environment)
    )
  }
})

const environmentPolicyPrelude = `
gh() {
  case "$*" in
    *"deployment-branch-policies"*)
      printf '%s\\n' '{"branch_policies":[{"type":"branch","name":"main"},{"type":"tag","name":"mobile-harmony-v*"}]}'
      ;;
    *"/environments/"*)
      printf '%s\\n' '{"protection_rules":[{"type":"required_reviewers","reviewers":[{"login":"release-reviewer"}],"prevent_self_review":true}],"deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}'
      ;;
    *) printf '%s\\n' '{}';;
  esac
}
jq() {
  command cat >/dev/null
  case "$*" in
    *"deployment_branch_policy"*) printf '%s\\n' "$MOCK_DEPLOYMENT_POLICY_OK" ;;
    *"branch_policies"*)
      test "$MOCK_REF_POLICY_OK" = true
      ;;
    *"length"*) printf '%s\\n' "$MOCK_REVIEWER_COUNT" ;;
    *"any"*) printf '%s\\n' "$MOCK_PREVENT_SELF_REVIEW" ;;
    *) return 2 ;;
  esac
}
`

function assertEnvironmentApprovalPolicy(stepName, environmentName) {
  const script = workflowRunScript(stepName)
  const baseEnvironment = {
    GITHUB_REPOSITORY: 'stablyai/orca',
    HARMONY_RELEASE_ENVIRONMENT: environmentName,
    GITHUB_REF: 'refs/heads/main',
    RELEASE_BRANCH: 'main',
    RELEASE_TAG_PATTERN: 'mobile-harmony-v*',
    MOCK_DEPLOYMENT_POLICY_OK: 'true',
    MOCK_PREVENT_SELF_REVIEW: 'true',
    MOCK_REF_POLICY_OK: 'true',
    MOCK_REVIEWER_COUNT: '1'
  }
  assert.equal(runWorkflowScript(script, baseEnvironment, environmentPolicyPrelude).status, 0)
  assert.notEqual(
    runWorkflowScript(
      script,
      { ...baseEnvironment, MOCK_REVIEWER_COUNT: '0' },
      environmentPolicyPrelude
    ).status,
    0
  )
  assert.notEqual(
    runWorkflowScript(
      script,
      { ...baseEnvironment, MOCK_DEPLOYMENT_POLICY_OK: 'false' },
      environmentPolicyPrelude
    ).status,
    0
  )
  assert.notEqual(
    runWorkflowScript(
      script,
      { ...baseEnvironment, MOCK_REF_POLICY_OK: 'false' },
      environmentPolicyPrelude
    ).status,
    0
  )
  assert.equal(
    runWorkflowScript(
      script,
      { ...baseEnvironment, GITHUB_REF: 'refs/tags/mobile-harmony-v0.0.47' },
      environmentPolicyPrelude
    ).status,
    0
  )
  assert.notEqual(
    runWorkflowScript(
      script,
      { ...baseEnvironment, GITHUB_REF: 'refs/heads/release' },
      environmentPolicyPrelude
    ).status,
    0
  )
  assert.notEqual(
    runWorkflowScript(
      script,
      { ...baseEnvironment, MOCK_PREVENT_SELF_REVIEW: 'false' },
      environmentPolicyPrelude
    ).status,
    0
  )
  assert.match(script, /environments\/\$HARMONY_RELEASE_ENVIRONMENT/u)
  assert.match(script, /deployment_branch_policy/u)
  assert.match(script, /deployment-branch-policies/u)
  assert.match(script, /refs\/tags\/\$\{RELEASE_TAG_PATTERN\}/u)
}

test('signing and publish environments require reviewers and deployment branch/tag policy', () => {
  assertEnvironmentApprovalPolicy(
    'Verify signing environment approval policy',
    'harmony-production'
  )
  assertEnvironmentApprovalPolicy(
    'Verify physical acceptance approval policy',
    'harmony-production-publish'
  )
})

test('attests the exact verified HAP, SBOM, and provenance before publication', () => {
  const buildJob = workflowJob('build-and-sign')
  const publishJob = workflowJob('publish-release')
  assert.equal(
    [
      ...buildJob.matchAll(
        /uses: actions\/attest@1e69f48acb82d1966a394da916b4c1698aa569d6 # v4\.2\.2/gu
      )
    ].length,
    2
  )
  assert.match(
    buildJob,
    /permissions:\n      attestations: write\n      contents: read\n      id-token: write/u
  )
  assert.match(
    publishJob,
    /permissions:\n      actions: read\n      attestations: read\n      contents: write/u
  )
  assert.match(
    buildJob,
    /subject-path: mobile\/harmony\/dist\/orca-mobile-harmony-\$\{\{ steps\.release\.outputs\.version \}\}\.hap/u
  )
  assert.match(
    buildJob,
    /sbom-path: mobile\/harmony\/dist\/orca-mobile-harmony-\$\{\{ steps\.release\.outputs\.version \}\}\.sbom\.cdx\.json/u
  )
  const signIndex = buildJob.indexOf('      - name: Sign and verify release HAP')
  const rebuildIndex = buildJob.indexOf(
    '      - name: Isolated rebuild and compare release HAP contents'
  )
  const attestIndex = buildJob.indexOf('      - name: Attest verified HAP provenance')
  const sbomAttestIndex = buildJob.indexOf('      - name: Attest verified HAP SBOM')
  const uploadIndex = buildJob.indexOf('      - name: Upload verified HAP artifact')
  assert.notEqual(rebuildIndex, -1)
  assert.ok(rebuildIndex < signIndex)
  assert.match(buildJob, /git clone --no-hardlinks --no-checkout/u)
  assert.match(buildJob, /checkout --detach "\$GITHUB_SHA"/u)
  assert.match(buildJob, /HARMONY_RELEASE_REBUILD_ROOT\/mobile\/harmony/u)
  assert.match(buildJob, /npm ci/u)
  assert.match(buildJob, /"\$HARMONY_OHPM" install --all/u)
  assert.match(buildJob, /npm run compare:release-haps/u)
  assert.match(buildJob, /HARMONY_RELEASE_REFERENCE_HAP_PATH/u)
  assert.ok(signIndex < attestIndex)
  assert.ok(attestIndex < sbomAttestIndex)
  assert.ok(sbomAttestIndex < uploadIndex)
  const verification = workflowRunScript('Verify GitHub artifact attestations')
  assert.match(verification, /gh attestation verify "\$hap"/u)
  assert.match(verification, /--repo "\$GITHUB_REPOSITORY"/u)
  assert.match(
    verification,
    /--signer-workflow "\$GITHUB_REPOSITORY\/\.github\/workflows\/mobile-harmony-release\.yml"/u
  )
  assert.match(verification, /--source-ref "\$RELEASE_REF"/u)
  assert.match(verification, /--source-digest "\$RELEASE_SHA"/u)
  assert.match(verification, /--predicate-type 'https:\/\/cyclonedx\.org\/bom'/u)
  assert.match(verification, /--format json/u)
  assert.match(verification, /--slurpfile expected "\$sbom"/u)
  assert.match(verification, /\.verificationResult\.statement\.predicate == \$expected\[0\]/u)
})

test('binds simulator and physical acceptance to the exact signed HAP before publication', () => {
  const simulatorJob = workflowJob('simulator-acceptance')
  const publishJob = workflowJob('publish-release')

  assert.match(simulatorJob, /^    needs: build-and-sign$/mu)
  assert.match(
    simulatorJob,
    /^    runs-on: \[self-hosted, macOS, ARM64, harmonyos, harmonyos-simulator\]$/mu
  )
  assert.match(
    simulatorJob,
    /permissions:\n      attestations: write\n      contents: read\n      id-token: write/u
  )
  assert.match(
    simulatorJob,
    /name: \$\{\{ needs\.build-and-sign\.outputs\.artifact_name \}\}\n          path: dist/u
  )
  const simulatorAcceptance = workflowRunScript('Run exact-HAP simulator acceptance')
  assert.match(simulatorAcceptance, /hap="dist\/orca-mobile-harmony-\$RELEASE_VERSION\.hap"/u)
  assert.match(simulatorAcceptance, /Release version is unsafe for runner-local paths/u)
  assert.match(
    simulatorAcceptance,
    /node mobile\/harmony\/scripts\/run-harmony-simulator-acceptance\.mjs/u
  )
  assert.match(simulatorAcceptance, /--hap "\$hap"/u)
  assert.match(simulatorAcceptance, /--hdc "\$HARMONY_HDC"/u)
  assert.match(simulatorAcceptance, /--output-dir "\$evidence_dir"/u)
  assert.doesNotMatch(simulatorAcceptance, /--skip-install|preserve-data/u)
  assert.match(
    simulatorJob,
    /uses: actions\/attest@1e69f48acb82d1966a394da916b4c1698aa569d6 # v4\.2\.2/u
  )
  assert.match(
    simulatorJob,
    /name: orca-mobile-harmony-\$\{\{ needs\.build-and-sign\.outputs\.version \}\}-simulator-acceptance/u
  )
  assert.match(simulatorJob, /retention-days: 14/u)

  assert.match(publishJob, /^    needs: \[build-and-sign, simulator-acceptance\]$/mu)
  assert.match(publishJob, /^    environment: harmony-production-publish$/mu)
  const attestationVerification = workflowRunScript('Verify GitHub artifact attestations')
  assert.match(attestationVerification, /gh attestation verify "\$simulator_acceptance"/u)

  const physicalAcceptance = workflowRunScript('Bind physical acceptance approval to HAP')
  assert.match(
    physicalAcceptance,
    /repos\/\$GITHUB_REPOSITORY\/actions\/runs\/\$GITHUB_RUN_ID\/approvals/u
  )
  assert.match(
    physicalAcceptance,
    /node mobile\/harmony\/scripts\/verify-harmony-physical-acceptance\.mjs/u
  )
  assert.match(physicalAcceptance, /trap 'rm -f -- "\$approval_history"' EXIT/u)
  const approvalUmaskIndex = physicalAcceptance.indexOf('umask 077')
  const approvalDownloadIndex = physicalAcceptance.indexOf('gh api')
  assert.notEqual(approvalUmaskIndex, -1)
  assert.ok(approvalUmaskIndex < approvalDownloadIndex)
  assert.match(
    physicalAcceptance,
    /"dist\/orca-mobile-harmony-\$RELEASE_VERSION\.hap"[\s\S]*"\$approval_history"[\s\S]*"dist\/orca-mobile-harmony-\$RELEASE_VERSION\.physical-acceptance\.json"/u
  )

  const publishVerification = workflowRunScript(
    'Reverify downloaded release semantics and provenance'
  )
  assert.match(
    publishVerification,
    /"dist\/simulator-acceptance\/orca-mobile-harmony-\$RELEASE_VERSION\.simulator-acceptance\.json"/u
  )
  assert.match(
    publishVerification,
    /"dist\/orca-mobile-harmony-\$RELEASE_VERSION\.physical-acceptance\.json"/u
  )

  const physicalIndex = publishJob.indexOf('      - name: Bind physical acceptance approval to HAP')
  const reverifyIndex = publishJob.indexOf(
    '      - name: Reverify downloaded release semantics and provenance'
  )
  const tagIndex = publishJob.indexOf('      - name: Pin release tag to the verified source')
  const releaseIndex = publishJob.indexOf('      - name: Create or update trusted prerelease')
  assert.ok(physicalIndex < reverifyIndex)
  assert.ok(reverifyIndex < tagIndex)
  assert.ok(tagIndex < releaseIndex)
  assert.match(
    publishJob,
    /"dist\/simulator-acceptance\/orca-mobile-harmony-\$RELEASE_VERSION\.simulator-acceptance\.json"/u
  )
  assert.match(
    publishJob,
    /"dist\/orca-mobile-harmony-\$RELEASE_VERSION\.physical-acceptance\.json"/u
  )
})
