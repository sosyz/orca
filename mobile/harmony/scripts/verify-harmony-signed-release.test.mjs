import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { verifyHarmonySignedRelease } from './verify-harmony-signed-release.mjs'
import {
  TEST_RELEASE_CERTIFICATE,
  TEST_ROOT_CA_CERTIFICATE
} from './test-fixtures/harmony-release-certificates.mjs'

test('orchestrates final HAP, profile, and certificate verification and removes extracts', () => {
  const directory = mkdtempSync(join(tmpdir(), 'orca-signed-release-test-'))
  const javaHome = join(directory, 'java-home')
  const signTool = join(directory, 'hap-sign-tool.jar')
  const hap = join(directory, 'release.hap')
  const fingerprint = '6D0862C19D0F72E3A2EF5F8031551E4B43B732BDFB443C7D266CCC90B238D9B1'
  const commands = []
  let extractionDirectory = ''

  try {
    mkdirSync(join(javaHome, 'bin'), { recursive: true })
    for (const path of [join(javaHome, 'bin', 'java'), signTool, hap]) {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, 'fixture')
    }

    const runCommand = (command, args, description, capture = false) => {
      commands.push({ args, capture, command, description })
      if (description === 'Final HAP signature verification') {
        const certificate = args[args.indexOf('-outCertChain') + 1]
        const profile = args[args.indexOf('-outProfile') + 1]
        extractionDirectory = dirname(certificate)
        writeFileSync(certificate, `${TEST_ROOT_CA_CERTIFICATE}\n${TEST_RELEASE_CERTIFICATE}`)
        writeFileSync(profile, 'profile')
        return ''
      }
      if (description === 'Final HAP profile verification') {
        const report = args[args.indexOf('-outFile') + 1]
        writeFileSync(
          report,
          JSON.stringify({
            content: {
              acls: { 'allowed-acls': ['ohos.permission.READ_PASTEBOARD'] },
              'bundle-info': { 'bundle-name': 'ai.stably.orca.harmony' },
              type: 'release',
              validity: { 'not-after': 2_000_000, 'not-before': 1_000_000 }
            },
            verifiedPassed: true
          })
        )
        return ''
      }
      assert.equal(capture, false)
      return ''
    }

    const evidence = verifyHarmonySignedRelease(hap, {
      collectProvenance: () => ({ commit: 'verified-commit' }),
      expectedFingerprint: fingerprint,
      javaHome,
      profileValidation: { minimumRemainingSeconds: 1, nowSeconds: 1_500_000 },
      runCommand,
      signTool,
      verifyHap: () => ({
        bundleName: 'ai.stably.orca.harmony',
        byteLength: 7,
        sha256: 'c'.repeat(64),
        versionCode: 47,
        versionName: '0.0.47'
      })
    })

    assert.equal(commands.length, 2)
    assert.deepEqual(commands[0].args.slice(2, 4), ['verify-app', '-inFile'])
    assert.deepEqual(commands[1].args.slice(2, 4), ['verify-profile', '-inFile'])
    assert.equal(evidence.certificateSha256, fingerprint)
    assert.equal(evidence.profile.type, 'release')
    assert.deepEqual(evidence.provenance, { commit: 'verified-commit' })
    assert.equal(existsSync(extractionDirectory), false)
  } finally {
    rmSync(directory, { force: true, recursive: true })
  }
})
