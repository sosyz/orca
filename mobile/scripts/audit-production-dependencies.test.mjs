import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ALLOWED_ADVISORIES,
  validateAuditReport,
  verifyPatchMetadata
} from './audit-production-dependencies.mjs'

const dependencyPath = '.>react-native>@react-native/community-cli-plugin>metro>image-size'

const finding = (version = '1.2.1', path = dependencyPath) => ({
  version,
  paths: [path]
})

const advisory = (id, packageName = 'image-size', version = '1.2.1', path, severity = 'high') => ({
  github_advisory_id: id,
  module_name: packageName,
  severity,
  findings: [finding(version, path ?? dependencyPath)]
})

const auditReport = (advisories) => ({ advisories, muted: [] })

test('accepts a clean audit report and the two pinned image-size advisories', () => {
  assert.deepEqual(validateAuditReport(auditReport({})), [])
  assert.deepEqual(
    validateAuditReport(
      auditReport({
        1: advisory('GHSA-W3RX-R6R6-PGPR'),
        2: advisory('GHSA-5P2G-FCMC-QVQQ')
      })
    ),
    Object.keys(ALLOWED_ADVISORIES).sort()
  )
})

test('rejects an advisory outside the exact allowlist', () => {
  assert.throws(
    () => validateAuditReport(auditReport({ 1: advisory('GHSA-unknown-0000-0000') })),
    /unexpected advisory GHSA-UNKNOWN-0000-0000/
  )
})

test('rejects package, version, and dependency path drift', () => {
  assert.throws(
    () => validateAuditReport(auditReport({ 1: advisory('GHSA-W3RX-R6R6-PGPR', 'other-package') })),
    /unexpected package/
  )
  assert.throws(
    () =>
      validateAuditReport(
        auditReport({ 1: advisory('GHSA-W3RX-R6R6-PGPR', 'image-size', '1.2.2') })
      ),
    /unexpected version/
  )
  assert.throws(
    () =>
      validateAuditReport(
        auditReport({
          1: advisory(
            'GHSA-W3RX-R6R6-PGPR',
            'image-size',
            '1.2.1',
            '.>react-native>metro>image-size'
          )
        })
      ),
    /dependency path drifted/
  )
  assert.throws(
    () =>
      validateAuditReport(
        auditReport({
          1: advisory('GHSA-W3RX-R6R6-PGPR', 'image-size', '1.2.1', dependencyPath, 'critical')
        })
      ),
    /unexpected severity/
  )
})

test('rejects missing advisory IDs and duplicate IDs', () => {
  assert.throws(
    () =>
      validateAuditReport({
        advisories: { 1: { module_name: 'image-size', findings: [finding()] } },
        muted: []
      }),
    /missing a GitHub advisory ID/
  )
  assert.throws(
    () =>
      validateAuditReport(
        auditReport([advisory('GHSA-W3RX-R6R6-PGPR'), advisory('GHSA-W3RX-R6R6-PGPR')])
      ),
    /duplicate advisory/
  )
})

test('rejects missing and non-empty muted advisory lists', () => {
  assert.throws(() => validateAuditReport({ advisories: {} }), /no muted-advisory list/)
  assert.throws(
    () => validateAuditReport({ advisories: {}, muted: ['GHSA-ignored'] }),
    /contains muted advisories/
  )
})

test('locks the image-size patch path and hash', () => {
  assert.doesNotThrow(() => verifyPatchMetadata())
})
