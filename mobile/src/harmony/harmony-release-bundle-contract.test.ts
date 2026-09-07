import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const mobileRoot = resolve(import.meta.dirname, '../..')
const harmonyRoot = join(mobileRoot, 'harmony')

describe('Harmony release bundle contract', () => {
  it('forwards the native back gesture to React Native', () => {
    const index = readFileSync(join(harmonyRoot, 'entry/src/main/ets/pages/Index.ets'), 'utf8')

    expect(index).toMatch(
      /onBackPress\(\): boolean\s*\{[\s\S]*dispatchBackPress\(\)[\s\S]*return true/
    )
  })

  it('registers the packaged Nerd Font for Harmony native monospace text', () => {
    const index = readFileSync(join(harmonyRoot, 'entry/src/main/ets/pages/Index.ets'), 'utf8')
    const harmonyFontFamily = readFileSync(
      join(mobileRoot, 'src/theme/mobile-mono-font-family.harmony.ts'),
      'utf8'
    )
    const font = readFileSync(
      join(harmonyRoot, 'entry/src/main/resources/rawfile/fonts/MesloLGS-NF-Regular.ttf')
    )

    expect(index).toContain("'MesloLGS NF': $rawfile('fonts/MesloLGS-NF-Regular.ttf')")
    expect(harmonyFontFamily).toContain("mobileMonoFontFamily = 'MesloLGS NF'")
    expect(createHash('sha256').update(font).digest('hex')).toBe(
      'd97946186e97f8d7c0139e8983abf40a1d2d086924f2c5dbf1c29bd8f2c6e57d'
    )
  })

  it('loads Metro only in debug and HBC only in release', () => {
    const index = readFileSync(join(harmonyRoot, 'entry/src/main/ets/pages/Index.ets'), 'utf8')

    expect(index).toMatch(
      /isDebugModeEnabled\s*\?\s*new AnyJSBundleProvider\(\[\s*new MetroJSBundleProvider\(\)/
    )
    expect(index).toMatch(/\]\)\s*:\s*new ResourceJSBundleProvider\(/)
    expect(index).not.toContain('FileJSBundleProvider')
    expect(index).not.toContain("'bundle.harmony.js'")
  })

  it('generates optimized Hermes bytecode from both release entry points', () => {
    const harmonyPackage = JSON.parse(readFileSync(join(harmonyRoot, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
    }
    const hvigor = readFileSync(join(harmonyRoot, 'hvigorfile.ts'), 'utf8')

    expect(harmonyPackage.scripts['bundle:harmony']).toContain(
      '--bundle-output entry/src/main/resources/rawfile/hermes_bundle.hbc'
    )
    expect(harmonyPackage.scripts['bundle:harmony']).toContain('--js-engine hermes')
    expect(harmonyPackage.scripts['bundle:harmony']).toContain(
      '--hermesc-dir node_modules/hermes-compiler/hermesc'
    )
    expect(harmonyPackage.scripts['bundle:harmony']).toContain('--dev false')
    expect(hvigor).toContain("bundleOutput: './entry/src/main/resources/rawfile/hermes_bundle.hbc'")
    expect(hvigor).toContain("jsEngine: 'hermes'")
    expect(hvigor).toContain("process.env.HERMES_V1_ENABLED = 'true'")
    expect(hvigor).not.toContain("hermescDir: './node_modules/hermes-compiler/hermesc'")
    expect(hvigor).toContain('dev: false')
    expect(hvigor).toContain('minify: true')
  })

  it('does not retain the legacy plaintext bundle as a raw resource', () => {
    expect(
      existsSync(join(harmonyRoot, 'entry/src/main/resources/rawfile/bundle.harmony.js'))
    ).toBe(false)
  })

  it('streams deterministic Hermes input without a plaintext temporary bundle', () => {
    const patch = readFileSync(
      join(harmonyRoot, 'patches/@react-native-oh+react-native-harmony-cli+0.84.3.patch'),
      'utf8'
    )

    expect(patch).toContain('execFileSync(resolvedHermescPath, hermescArgs')
    expect(patch).toContain('input: bundleCode')
    expect(patch).toContain("stdio: ['pipe', 'inherit', 'inherit']")
    expect(patch).toContain("hbcFilePath,\n+    '-',")
    expect(patch).not.toContain('+import { randomUUID }')
    expect(patch).not.toContain('+  const tmpBundlePath')
    expect(patch).not.toContain('+  execSync(')
  })

  it('forwards renderer exits and applies WebView security props on ArkWeb', () => {
    const patch = readFileSync(
      join(harmonyRoot, 'patches/@react-native-oh-tpl+react-native-webview+13.10.3.patch'),
      'utf8'
    )

    expect(patch).toContain("emit('contentProcessDidTerminate'")
    expect(patch).toContain('lockIdentifier: this.lockIdentifier')
    expect(patch).toContain('allowFileAccess: boolean = false')
    expect(patch).toContain('@State mode: MixedMode = MixedMode.None')
    expect(patch).toContain('rawProps.allowFileAccess === true')
    expect(patch).toContain('mixedContentMode === "always"')
    expect(patch).toContain('mixedContentMode === "compatibility"')
    expect(patch).toContain('this.mode = MixedMode.None')
  })

  it('hardens the release native and resource package inputs', () => {
    const profile = readFileSync(join(harmonyRoot, 'entry/build-profile.json5'), 'utf8')
    const cmake = readFileSync(join(harmonyRoot, 'entry/src/main/cpp/CMakeLists.txt'), 'utf8')
    const packageSource = readFileSync(join(harmonyRoot, 'entry/oh-package.json5'), 'utf8')
    const fontReadme = readFileSync(
      join(harmonyRoot, 'entry/src/main/resources/rawfile/fonts/README.md'),
      'utf8'
    )

    expect(profile).toContain("name: 'release'")
    expect(profile).toContain("excludes: ['**/x86_64/*.so']")
    expect(profile).toContain('strip: true')
    expect(profile).toContain("ignoreResourcePattern: ['rnoh.profdata']")
    expect(cmake).toContain('set(CMAKE_SKIP_RPATH TRUE)')
    expect(cmake).toContain('-ffile-prefix-map=')
    expect(cmake).toContain('-fdebug-prefix-map=')
    expect(packageSource).toContain("license: 'MIT'")
    expect(
      existsSync(
        join(harmonyRoot, 'entry/src/main/resources/rawfile/fonts/MesloLGS-NF-Regular.woff2')
      )
    ).toBe(false)
    expect(existsSync(join(mobileRoot, 'assets/fonts/MesloLGS-NF-Regular.woff2'))).toBe(true)
    expect(fontReadme).toContain('assets/fonts/MesloLGS-NF-Regular.woff2')
    expect(fontReadme).toContain('generated base64 WOFF2 payload')
    expect(fontReadme).toContain('registered as `MesloLGS NF`')
    expect(fontReadme).not.toContain('terminal HTML also embeds')
  })

  it('keeps signing material local and rejects debug keys for release builds', () => {
    const ignore = readFileSync(join(harmonyRoot, '.gitignore'), 'utf8')
    const mobileFormatIgnore = readFileSync(join(mobileRoot, '.prettierignore'), 'utf8')
    const rootFormatIgnore = readFileSync(
      join(resolve(mobileRoot, '..'), '.prettierignore'),
      'utf8'
    )
    const template = readFileSync(join(harmonyRoot, 'build-profile.template.json5'), 'utf8')
    const hvigor = readFileSync(join(harmonyRoot, 'hvigorfile.ts'), 'utf8')
    const harmonyPackage = JSON.parse(readFileSync(join(harmonyRoot, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
    }
    const releaseProfileVerifier = readFileSync(
      join(harmonyRoot, 'scripts/verify-harmony-release-profile.mjs'),
      'utf8'
    )

    expect(ignore).toContain('/build-profile.json5')
    expect(mobileFormatIgnore).toContain('harmony/**/*.json5')
    expect(rootFormatIgnore).toContain('mobile/harmony/**/*.json5')
    expect(template).toContain('"signingConfigs": []')
    expect(template).not.toMatch(/keyPassword|storePassword|keyAlias/u)
    expect(hvigor).toContain("pluginId: 'orcaReleaseSigningGuard'")
    expect(hvigor).toContain("getProperty('enableSignTask')")
    expect(hvigor).toContain("value !== false && value !== 'false'")
    expect(hvigor).toContain('Refusing to sign a release HAP with a debug key')
    expect(hvigor).toContain('Release build requires a release provisioning profile')
    expect(hvigor).toContain('Release profile targets the wrong bundle')
    expect(hvigor).toContain('Release profile must not contain a debug device allowlist')
    expect(hvigor).toContain("Buffer.from('ohos.permission.READ_PASTEBOARD')")
    expect(hvigor).toContain('Release profile does not grant the pasteboard ACL')
    expect(harmonyPackage.scripts['verify:release-profile']).toContain(
      'verify-harmony-release-profile.mjs'
    )
    expect(releaseProfileVerifier).toContain("'verify-profile'")
    expect(releaseProfileVerifier).toContain('validateVerifiedReleaseProfile')
  })

  it('verifies final HAP contents and pins the production signing identity', () => {
    const harmonyPackage = JSON.parse(readFileSync(join(harmonyRoot, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
    }
    const readme = readFileSync(join(harmonyRoot, 'README.md'), 'utf8')
    const hapVerifier = readFileSync(join(harmonyRoot, 'scripts/verify-harmony-hap.mjs'), 'utf8')
    const signer = readFileSync(join(harmonyRoot, 'scripts/sign-harmony-release.mjs'), 'utf8')
    const signedVerifier = readFileSync(
      join(harmonyRoot, 'scripts/verify-harmony-signed-release.mjs'),
      'utf8'
    )
    const signingValidation = readFileSync(
      join(harmonyRoot, 'scripts/harmony-release-signing-validation.mjs'),
      'utf8'
    )

    expect(harmonyPackage.scripts['verify:release-hap']).toContain('verify-harmony-hap.mjs')
    expect(harmonyPackage.scripts['sign:release']).toContain('sign-harmony-release.mjs')
    expect(readme).toContain('-p buildMode=release -p properties.enableSignTask=false')
    expect(readme).toContain('clean assembleHap --no-daemon')
    expect(readme).toContain('entry/build/config/buildConfig.json')
    expect(readme).toContain('ets/symbolMap.map')
    expect(hapVerifier).toContain('Release HAP contains plaintext JavaScript or source maps')
    expect(hapVerifier).toContain("'resources/rawfile/hermes_bundle.hbc'")
    expect(signer).toContain('HARMONY_RELEASE_CERT_SHA256')
    expect(signer).toContain('verifyHarmonySignedRelease(outputPath)')
    expect(signedVerifier).toContain("'verify-app'")
    expect(signedVerifier).toContain("'verify-profile'")
    expect(signingValidation).toContain("content.type === 'release'")
    expect(signingValidation).toContain("'bundle-name'] === bundleName")
  })

  it('gates Harmony pull requests and protected release signing in CI', () => {
    const repositoryRoot = resolve(mobileRoot, '..')
    const harmonyPackage = JSON.parse(readFileSync(join(harmonyRoot, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
    }
    const checks = readFileSync(join(repositoryRoot, '.github/workflows/mobile.yml'), 'utf8')
    const release = readFileSync(
      join(repositoryRoot, '.github/workflows/mobile-harmony-release.yml'),
      'utf8'
    )
    const releasePolicy = readFileSync(
      join(repositoryRoot, '.github/workflows/release-policy.yml'),
      'utf8'
    )

    expect(checks).toContain('harmony-js:')
    expect(checks).toContain('npm run test:release-scripts')
    expect(checks).toContain('npm run bundle:harmony')
    expect(release).toContain('authorize-release:')
    expect(release.indexOf('authorize-release:')).toBeLessThan(release.indexOf('mobile-tests:'))
    expect(release).toContain('needs: authorize-release')
    expect(release).toContain('mobile-tests:')
    expect(release).toContain('pnpm typecheck')
    expect(release).toContain('pnpm test')
    expect(release).toContain('needs: [authorize-release, mobile-tests]')
    expect(release).toContain('runs-on: [self-hosted, macOS, ARM64, harmonyos]')
    expect(release).toContain('environment: harmony-production')
    expect(release).toContain('environment: harmony-production-publish')
    expect(release).toContain('prevent_self_review')
    expect(release).toContain('Verify signing environment approval policy')
    expect(release).toContain('entry-default-unsigned.hap')
    expect(release).toContain('npm run compare:release-haps')
    expect(release).toContain('npm run sign:release')
    expect(release.match(/run: npm run verify:release-toolchain/gu)).toHaveLength(2)
    expect(release).toContain('HARMONY_RELEASE_PROFILE_BASE64')
    expect(release).toContain('HARMONY_RELEASE_ORIGINAL_ACTOR: ${{ github.actor }}')
    expect(release).toContain('HARMONY_RELEASE_TRIGGERING_ACTOR: ${{ github.triggering_actor }}')
    expect(release).toContain('run: npm run verify:release-actors')
    expect(harmonyPackage.scripts['verify:release-actors']).toContain(
      'verify-harmony-release-actors.mjs'
    )
    expect(harmonyPackage.scripts['compare:release-haps']).toContain(
      'compare-harmony-hap-contents.mjs'
    )
    expect(release).toContain('if-no-files-found: error')
    expect(release).toContain(
      'permissions:\n      attestations: write\n      contents: read\n      id-token: write'
    )
    expect(release).toContain('publish-release:')
    expect(release).toContain('actions: read')
    expect(release).toContain('attestations: write')
    expect(release).toContain('attestations: read')
    expect(release).toContain('id-token: write')
    expect(release).toContain(
      'uses: actions/attest@1e69f48acb82d1966a394da916b4c1698aa569d6 # v4.2.2'
    )
    expect(release).toContain('gh attestation verify "$hap"')
    expect(release).toContain('contents: write')
    expect(release).toContain('test "$release_author" = \'github-actions[bot]\'')
    expect(release).toContain('verify-harmony-publish-artifacts.mjs')
    expect(release).toContain(
      'HARMONY_RELEASE_CERT_SHA256: ${{ vars.HARMONY_RELEASE_CERT_SHA256 }}'
    )
    expect(release).not.toContain('HARMONY_RELEASE_ALLOWED_AUTHOR')
    expect(release).toContain('persist-credentials: false')
    expect(release).not.toMatch(/uses: (?:actions|pnpm)\/[\w-]+@v/u)
    expect(releasePolicy).not.toMatch(/uses: actions\/github-script@v/u)
    expect(releasePolicy).toContain('(?:android|harmony)')
  })

  it('pins complete production toolchain contents', () => {
    const pins = JSON.parse(
      readFileSync(join(harmonyRoot, 'release-toolchain-pins.json'), 'utf8')
    ) as Record<string, unknown>
    const verifier = readFileSync(join(harmonyRoot, 'scripts/verify-harmony-toolchain.mjs'), 'utf8')

    expect(pins.platform).toBe('darwin-arm64')
    for (const name of [
      'codeLinterContentSha256',
      'devEcoNodeContentSha256',
      'hvigorContentSha256',
      'javaContentSha256',
      'ohpmContentSha256',
      'sdkContentSha256'
    ]) {
      expect(pins[name]).toMatch(/^[0-9a-f]{64}$/u)
    }
    expect(verifier).toContain('hashToolchainDirectory')
    expect(verifier).toContain('entry.isSymbolicLink()')
  })

  it('fails closed when source scanning or the DevEco linter does not run', () => {
    const secretGuard = readFileSync(
      join(harmonyRoot, 'scripts/harmony-source-secret-guard.mjs'),
      'utf8'
    )
    const nativeLinter = readFileSync(join(harmonyRoot, 'scripts/run-code-linter.mjs'), 'utf8')

    expect(secretGuard).toContain("'--others'")
    expect(secretGuard).toContain('sourceFiles.length === 0')
    expect(secretGuard).toContain("'.jks'")
    expect(secretGuard).toContain('validateLocalSigningProfile')
    expect(nativeLinter).toContain('result.error !== undefined')
    expect(nativeLinter).toContain('checkedFiles === 0')
  })
})
