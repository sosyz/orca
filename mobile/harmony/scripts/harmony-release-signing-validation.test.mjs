import assert from 'node:assert/strict'
import { X509Certificate } from 'node:crypto'
import test from 'node:test'
import {
  validateReleaseCertificateText,
  validateVerifiedReleaseProfile
} from './harmony-release-signing-validation.mjs'
import {
  TEST_DEVELOPMENT_CERTIFICATE,
  TEST_RELEASE_CERTIFICATE,
  TEST_ROOT_CA_CERTIFICATE
} from './test-fixtures/harmony-release-certificates.mjs'

const certificateChain = `${TEST_ROOT_CA_CERTIFICATE}\n${TEST_RELEASE_CERTIFICATE}`
const fingerprint = new X509Certificate(TEST_RELEASE_CERTIFICATE).fingerprint256

function profile(overrides = {}) {
  return {
    content: {
      acls: { 'allowed-acls': ['ohos.permission.READ_PASTEBOARD'] },
      'bundle-info': { 'bundle-name': 'ai.stably.orca.harmony' },
      type: 'release',
      validity: { 'not-after': 2_000_000, 'not-before': 1_000_000 },
      ...overrides
    },
    verifiedPassed: true
  }
}

test('accepts a verified release profile with the restricted ACL', () => {
  const result = validateVerifiedReleaseProfile(profile(), {
    minimumRemainingSeconds: 1,
    nowSeconds: 1_500_000
  })
  assert.equal(result.type, 'release')
})

test('rejects debug profiles and missing ACLs', () => {
  assert.throws(
    () =>
      validateVerifiedReleaseProfile(profile({ type: 'debug' }), {
        minimumRemainingSeconds: 1,
        nowSeconds: 1_500_000
      }),
    /release profile/u
  )
  assert.throws(
    () =>
      validateVerifiedReleaseProfile(profile({ acls: { 'allowed-acls': [] } }), {
        minimumRemainingSeconds: 1,
        nowSeconds: 1_500_000
      }),
    /READ_PASTEBOARD/u
  )
  assert.throws(
    () =>
      validateVerifiedReleaseProfile(
        profile({
          acls: {
            'allowed-acls': ['ohos.permission.READ_PASTEBOARD', 'ohos.permission.CAMERA']
          }
        }),
        { minimumRemainingSeconds: 1, nowSeconds: 1_500_000 }
      ),
    /unexpected restricted ACL/u
  )
})

test('pins the final certificate fingerprint and rejects development certificates', () => {
  assert.equal(
    validateReleaseCertificateText(certificateChain, fingerprint),
    fingerprint.replaceAll(':', '')
  )
  const developmentFingerprint = new X509Certificate(TEST_DEVELOPMENT_CERTIFICATE).fingerprint256
  assert.throws(
    () =>
      validateReleaseCertificateText(
        `${TEST_ROOT_CA_CERTIFICATE}\n${TEST_DEVELOPMENT_CERTIFICATE}`,
        developmentFingerprint
      ),
    /development or debug/u
  )
  assert.throws(
    () => validateReleaseCertificateText(certificateChain, 'A'.repeat(64)),
    /does not match/u
  )
})

test('rejects a chain when the pinned fingerprint belongs to a non-leaf certificate', () => {
  const rootFingerprint = new X509Certificate(TEST_ROOT_CA_CERTIFICATE).fingerprint256

  assert.throws(
    () => validateReleaseCertificateText(certificateChain, rootFingerprint),
    /does not match/u
  )
})

test('rejects a chain with multiple code-signing leaf candidates', () => {
  assert.throws(
    () =>
      validateReleaseCertificateText(
        `${certificateChain}\n${TEST_RELEASE_CERTIFICATE}`,
        fingerprint
      ),
    /exactly one signing leaf certificate/u
  )
})

test('rejects malformed and CA-only certificate chains', () => {
  assert.throws(
    () => validateReleaseCertificateText('not a certificate', fingerprint),
    /did not expose any PEM/u
  )
  assert.throws(
    () =>
      validateReleaseCertificateText(
        '-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----',
        fingerprint
      ),
    /invalid PEM certificate/u
  )
  assert.throws(
    () => validateReleaseCertificateText(TEST_ROOT_CA_CERTIFICATE, fingerprint),
    /exactly one signing leaf certificate/u
  )
})
