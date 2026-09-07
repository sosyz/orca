import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import {
  verifyHarmonyPhysicalAcceptance,
  writeHarmonyPhysicalAcceptanceEvidence
} from './verify-harmony-physical-acceptance.mjs'

const scriptPath = fileURLToPath(
  new URL('./verify-harmony-physical-acceptance.mjs', import.meta.url)
)

function createFixture() {
  const directory = mkdtempSync(join(tmpdir(), 'orca-harmony-physical-acceptance-'))
  const hapPath = join(directory, 'orca-release.hap')
  const hapBytes = Buffer.from('physical HAP fixture')
  writeFileSync(hapPath, hapBytes)
  const hapSha256 = createHash('sha256').update(hapBytes).digest('hex')
  const environment = {
    GITHUB_ACTOR: 'release-author',
    GITHUB_REF: 'refs/tags/mobile-harmony-v0.0.47',
    GITHUB_REPOSITORY: 'sosyz/orca',
    GITHUB_RUN_ATTEMPT: '1',
    GITHUB_RUN_ID: '123456789',
    GITHUB_SHA: 'a'.repeat(40),
    GITHUB_TRIGGERING_ACTOR: 'rerun-author'
  }
  const comment = `Physical device acceptance complete.\nphysical-hap-sha256: ${hapSha256}`
  const approvals = [
    {
      comment,
      environments: [{ name: 'harmony-production-publish' }],
      state: 'approved',
      user: { login: 'physical-reviewer' }
    }
  ]
  return { approvals, comment, directory, environment, hapPath, hapSha256 }
}

function withFixture(callback) {
  const fixture = createFixture()
  try {
    return callback(fixture)
  } finally {
    rmSync(fixture.directory, { force: true, recursive: true })
  }
}

test('produces minimal physical acceptance evidence without the original comment', () => {
  withFixture(({ approvals, comment, environment, hapPath, hapSha256 }) => {
    const evidence = verifyHarmonyPhysicalAcceptance({
      approvals,
      environment,
      hapPath
    })
    assert.deepEqual(evidence, {
      acceptance: 'physical-device',
      approvalCommentSha256: createHash('sha256').update(comment).digest('hex'),
      environment: 'harmony-production-publish',
      hap: { artifact: basename(hapPath), sha256: hapSha256 },
      reviewer: 'physical-reviewer',
      schemaVersion: 1,
      source: {
        commit: 'a'.repeat(40),
        ref: 'refs/tags/mobile-harmony-v0.0.47',
        repository: 'sosyz/orca',
        runAttempt: '1',
        runId: '123456789'
      },
      status: 'approved'
    })
    assert.equal(JSON.stringify(evidence).includes(comment), false)
  })
})

test('writes evidence with restrictive 0600 permissions', () => {
  withFixture(({ approvals, environment, hapPath }) => {
    const outputPath = join(hapPath, '..', 'acceptance.json')
    const evidence = verifyHarmonyPhysicalAcceptance({ approvals, environment, hapPath })
    writeHarmonyPhysicalAcceptanceEvidence(outputPath, evidence)
    assert.equal(statSync(outputPath).mode & 0o777, 0o600)
    assert.deepEqual(JSON.parse(readFileSync(outputPath, 'utf8')), evidence)
    chmodSync(outputPath, 0o644)
  })
})

test('CLI reads the HAP and approvals JSON and writes redacted evidence', () => {
  withFixture(({ approvals, comment, directory, environment, hapPath }) => {
    const approvalsPath = join(directory, 'approvals.json')
    const outputPath = join(directory, 'physical-acceptance.json')
    writeFileSync(approvalsPath, `${JSON.stringify(approvals)}\n`)
    const result = spawnSync(process.execPath, [scriptPath, hapPath, approvalsPath, outputPath], {
      encoding: 'utf8',
      env: { ...process.env, ...environment }
    })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout.includes(comment), false)
    assert.equal(statSync(outputPath).mode & 0o777, 0o600)
    assert.equal(JSON.parse(readFileSync(outputPath, 'utf8')).status, 'approved')
  })
})

test('rejects a comment digest that does not match the HAP', () => {
  withFixture(({ approvals, environment, hapPath }) => {
    approvals[0].comment = `physical-hap-sha256: ${'0'.repeat(64)}`
    assert.throws(
      () => verifyHarmonyPhysicalAcceptance({ approvals, environment, hapPath }),
      /does not match the HAP/u
    )
  })
})

test('rejects multiple digest marker lines and never echoes the comment', () => {
  withFixture(({ approvals, comment, environment, hapPath, hapSha256 }) => {
    const secretComment = `${comment}\nphysical-hap-sha256: ${hapSha256}\nprivate acceptance note`
    approvals[0].comment = secretComment
    assert.throws(
      () => verifyHarmonyPhysicalAcceptance({ approvals, environment, hapPath }),
      (error) => {
        assert.match(error.message, /one digest marker/u)
        assert.doesNotMatch(error.message, /private acceptance note/u)
        return true
      }
    )
  })
})

test('rejects the wrong environment or approval state', () => {
  withFixture(({ approvals, environment, hapPath }) => {
    for (const change of [
      (approval) => {
        approval.environments = [{ name: 'harmony-production' }]
      },
      (approval) => {
        approval.state = 'pending'
      }
    ]) {
      const changed = structuredClone(approvals)
      change(changed[0])
      assert.throws(
        () => verifyHarmonyPhysicalAcceptance({ approvals: changed, environment, hapPath }),
        /exactly one approved physical acceptance/u
      )
    }
  })
})

test('rejects a legacy string environment shape instead of guessing', () => {
  withFixture(({ approvals, environment, hapPath }) => {
    approvals[0].environments = ['harmony-production-publish']
    assert.throws(
      () => verifyHarmonyPhysicalAcceptance({ approvals, environment, hapPath }),
      /exactly one approved physical acceptance/u
    )
  })
})

test('rejects an empty or invalid reviewer login', () => {
  withFixture(({ approvals, environment, hapPath }) => {
    for (const login of ['', '  ', 'reviewer name']) {
      const changed = structuredClone(approvals)
      changed[0].user.login = login
      assert.throws(
        () => verifyHarmonyPhysicalAcceptance({ approvals: changed, environment, hapPath }),
        /reviewer login is invalid/u
      )
    }
  })
})

test('rejects self-approval by either workflow actor', () => {
  withFixture(({ approvals, environment, hapPath }) => {
    for (const actor of ['release-author', 'rerun-author']) {
      const changedEnvironment = { ...environment, GITHUB_ACTOR: actor }
      const changed = structuredClone(approvals)
      changed[0].user.login = actor
      assert.throws(
        () =>
          verifyHarmonyPhysicalAcceptance({
            approvals: changed,
            environment: changedEnvironment,
            hapPath
          }),
        /must not be a workflow actor/u
      )
    }
  })
})

test('fails closed when a required source or actor environment variable is missing', () => {
  withFixture(({ approvals, environment, hapPath }) => {
    for (const name of [
      'GITHUB_REPOSITORY',
      'GITHUB_SHA',
      'GITHUB_REF',
      'GITHUB_RUN_ID',
      'GITHUB_RUN_ATTEMPT',
      'GITHUB_ACTOR',
      'GITHUB_TRIGGERING_ACTOR'
    ]) {
      const missing = { ...environment }
      delete missing[name]
      assert.throws(
        () => verifyHarmonyPhysicalAcceptance({ approvals, environment: missing, hapPath }),
        new RegExp(`requires ${name}`, 'u')
      )
    }
  })
})

test('accepts a workflow approvals wrapper and positional API arguments', () => {
  withFixture(({ approvals, environment, hapPath }) => {
    const evidence = verifyHarmonyPhysicalAcceptance(hapPath, { approvals }, { environment })
    assert.equal(evidence.reviewer, 'physical-reviewer')
  })
})

test('accepts an approvals file through the programmatic API', () => {
  withFixture(({ approvals, directory, environment, hapPath }) => {
    const approvalsPath = join(directory, 'approvals.json')
    writeFileSync(approvalsPath, JSON.stringify(approvals))
    const evidence = verifyHarmonyPhysicalAcceptance({
      approvalsPath,
      environment,
      hapPath
    })
    assert.equal(evidence.environment, 'harmony-production-publish')
  })
})
