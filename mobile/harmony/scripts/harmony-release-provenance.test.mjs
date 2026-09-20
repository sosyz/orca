import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { collectHarmonyReleaseProvenance } from './harmony-release-provenance.mjs'

test('records lock hashes, toolchain evidence, and exact CI source identity', () => {
  const root = mkdtempSync(join(tmpdir(), 'orca-harmony-provenance-'))
  try {
    mkdirSync(join(root, 'entry'))
    mkdirSync(join(root, 'generated'))
    mkdirSync(join(root, 'patches'))
    mkdirSync(join(root, 'scripts'))
    writeFileSync(join(root, 'package-lock.json'), 'npm')
    writeFileSync(join(root, 'oh-package-lock.json5'), 'project')
    writeFileSync(join(root, 'entry/oh-package-lock.json5'), 'entry')
    writeFileSync(join(root, 'generated/rn_webview.har'), 'patched-har')
    writeFileSync(join(root, 'generated/safe_area.har'), 'patched-safe-area-har')
    writeFileSync(join(root, 'generated/react_native_openharmony.har'), 'patched-core-har')
    writeFileSync(join(root, 'scripts/react-native-core-text-input-patch.mjs'), 'core-patch')
    writeFileSync(
      join(root, 'patches/@react-native-oh-tpl+react-native-webview+13.10.3.patch'),
      'webview-patch'
    )
    writeFileSync(
      join(root, 'patches/@react-native-oh-tpl+react-native-safe-area-context+4.7.4-0.2.1.patch'),
      'safe-area-patch'
    )
    const toolchainPath = join(root, 'toolchain.json')
    writeFileSync(toolchainPath, JSON.stringify({ node: '20.19.4' }))
    const sbomPath = join(root, 'release.cdx.json')
    writeFileSync(sbomPath, JSON.stringify({ bomFormat: 'CycloneDX' }))
    const provenance = collectHarmonyReleaseProvenance({
      environment: {
        GITHUB_REF: 'refs/heads/main',
        GITHUB_REPOSITORY: 'stablyai/orca',
        GITHUB_RUN_ATTEMPT: '1',
        GITHUB_RUN_ID: '123',
        GITHUB_SHA: 'a'.repeat(40),
        GITHUB_WORKFLOW_REF: 'stablyai/orca/.github/workflows/release.yml@refs/heads/main',
        HARMONY_RELEASE_SBOM_PATH: sbomPath,
        HARMONY_RELEASE_TOOLCHAIN_EVIDENCE_PATH: toolchainPath
      },
      harmonyRoot: root,
      requireCi: true
    })
    assert.equal(provenance.locks.npm, createHash('sha256').update('npm').digest('hex'))
    assert.equal(provenance.source.commit, 'a'.repeat(40))
    assert.equal(
      provenance.patchedWebView.har,
      createHash('sha256').update('patched-har').digest('hex')
    )
    assert.equal(
      provenance.patchedWebView.patch,
      createHash('sha256').update('webview-patch').digest('hex')
    )
    assert.equal(
      provenance.patchedSafeArea.har,
      createHash('sha256').update('patched-safe-area-har').digest('hex')
    )
    assert.equal(
      provenance.patchedSafeArea.patch,
      createHash('sha256').update('safe-area-patch').digest('hex')
    )
    assert.equal(provenance.toolchain.node, '20.19.4')
    assert.equal(
      provenance.patchedReactNativeCore.har,
      createHash('sha256').update('patched-core-har').digest('hex')
    )
    assert.equal(
      provenance.patchedReactNativeCore.patch,
      createHash('sha256').update('core-patch').digest('hex')
    )
    assert.equal(provenance.sbom.artifact, 'release.cdx.json')
  } finally {
    rmSync(root, { force: true, recursive: true })
  }
})

test('fails closed when required CI identity is missing', () => {
  assert.throws(
    () => collectHarmonyReleaseProvenance({ environment: {}, requireCi: true }),
    /requires GITHUB_SHA/u
  )
})
