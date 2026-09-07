import { X509Certificate } from 'node:crypto'

const PASTEBOARD_PERMISSION = 'ohos.permission.READ_PASTEBOARD'
const SECONDS_PER_DAY = 86_400
const MINIMUM_RELEASE_PROFILE_VALIDITY_SECONDS = 7 * SECONDS_PER_DAY
const CODE_SIGNING_EXTENDED_KEY_USAGE = '1.3.6.1.5.5.7.3.3'
const PEM_CERTIFICATE_PATTERN = /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/gu

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

export function normalizeCertificateFingerprint(value) {
  const normalized = value.replaceAll(':', '').replaceAll(/\s/gu, '').toUpperCase()
  assert(/^[0-9A-F]{64}$/u.test(normalized), 'Expected release certificate SHA-256 is invalid')
  return normalized
}

export function validateReleaseCertificateText(text, expectedFingerprint) {
  const encodedCertificates = [...text.matchAll(PEM_CERTIFICATE_PATTERN)].map((match) => match[0])
  assert(
    encodedCertificates.length > 0,
    'Final HAP certificate chain did not expose any PEM certificates'
  )
  let certificates
  try {
    certificates = encodedCertificates.map((certificate) => new X509Certificate(certificate))
  } catch {
    throw new Error('Final HAP certificate chain contains an invalid PEM certificate')
  }
  const signingCertificates = certificates.filter(
    (certificate) =>
      !certificate.ca && certificate.keyUsage?.includes(CODE_SIGNING_EXTENDED_KEY_USAGE)
  )
  assert(
    signingCertificates.length === 1,
    'Final HAP certificate inspection must identify exactly one signing leaf certificate'
  )
  const signingCertificate = signingCertificates[0]
  assert(
    !/(?:Development|Debug)/iu.test(signingCertificate.subject),
    'Final HAP uses a development or debug certificate'
  )
  const normalizedExpected = normalizeCertificateFingerprint(expectedFingerprint)
  const certificateFingerprint = normalizeCertificateFingerprint(signingCertificate.fingerprint256)
  assert(
    certificateFingerprint === normalizedExpected,
    'Final HAP certificate does not match HARMONY_RELEASE_CERT_SHA256'
  )
  return normalizedExpected
}

export function validateVerifiedReleaseProfile(report, options = {}) {
  const bundleName = options.bundleName ?? 'ai.stably.orca.harmony'
  const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1000)
  const minimumRemainingSeconds =
    options.minimumRemainingSeconds ?? MINIMUM_RELEASE_PROFILE_VALIDITY_SECONDS
  const content = report?.content ?? {}
  const validity = content.validity ?? {}
  const allowedAcls = content.acls?.['allowed-acls'] ?? []

  assert(report?.verifiedPassed === true, 'Release profile signature verification failed')
  assert(content.type === 'release', 'Final HAP does not contain a release profile')
  assert(
    content['bundle-info']?.['bundle-name'] === bundleName,
    'Release profile bundle name is wrong'
  )
  assert(
    allowedAcls.includes(PASTEBOARD_PERMISSION),
    `Release profile does not grant ${PASTEBOARD_PERMISSION}`
  )
  assert(
    allowedAcls.length === 1 && allowedAcls[0] === PASTEBOARD_PERMISSION,
    'Release profile grants an unexpected restricted ACL'
  )
  assert(Number.isFinite(validity['not-before']), 'Release profile has no valid start time')
  assert(Number.isFinite(validity['not-after']), 'Release profile has no valid expiry time')
  assert(validity['not-before'] <= nowSeconds, 'Release profile is not valid yet')
  assert(
    validity['not-after'] >= nowSeconds + minimumRemainingSeconds,
    'Release profile expires too soon'
  )
  assert(
    !content['debug-info']?.['device-ids']?.length,
    'Release profile is restricted to debug devices'
  )

  return {
    allowedAcls: [...allowedAcls],
    bundleName,
    notAfter: validity['not-after'],
    notBefore: validity['not-before'],
    type: content.type
  }
}
