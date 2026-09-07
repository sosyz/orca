import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import test from 'node:test'
import { verifyHarmonyPublishArtifacts } from './verify-harmony-publish-artifacts.mjs'

function digest(value) {
  return createHash('sha256').update(value).digest('hex')
}

test('reverifies hosted publish artifacts and rejects associated evidence drift', () => {
  const root = mkdtempSync(join(tmpdir(), 'orca-publish-artifacts-'))
  const entry = join(root, 'entry')
  const dist = join(root, 'dist')
  const generated = join(root, 'generated')
  const patches = join(root, 'patches')
  mkdirSync(entry)
  mkdirSync(dist)
  mkdirSync(generated)
  mkdirSync(patches)

  const environment = {
    GITHUB_ACTOR: 'release-actor',
    GITHUB_REF: 'refs/tags/mobile-harmony-v0.0.47',
    GITHUB_REPOSITORY: 'stablyai/orca',
    GITHUB_RUN_ATTEMPT: '1',
    GITHUB_RUN_ID: '123',
    GITHUB_SHA: 'a'.repeat(40),
    GITHUB_TRIGGERING_ACTOR: 'release-actor',
    HARMONY_RELEASE_ENVIRONMENT: 'harmony-production-publish',
    GITHUB_WORKFLOW_REF: 'stablyai/orca/.github/workflows/release.yml@refs/heads/main'
  }
  const expectedToolchain = {
    hapSignToolSha256: 'a'.repeat(64),
    hvigor: '6.21.1',
    hvigorContentSha256: 'b'.repeat(64),
    java: '21.0.8',
    javaContentSha256: 'c'.repeat(64),
    node: '20.19.4',
    npm: '10.8.2',
    ohpm: '6.0.1',
    ohpmContentSha256: 'd'.repeat(64),
    platform: 'darwin-arm64',
    sdkApi: 21,
    sdkComponents: ['ets', 'js', 'native', 'previewer', 'toolchains'],
    sdkContentSha256: 'e'.repeat(64),
    sdkVersion: '6.0.1.112'
  }
  const paths = {
    buildEvidence: join(dist, 'release.build-evidence.txt'),
    evidence: join(dist, 'release.hap.evidence.json'),
    hap: join(dist, 'release.hap'),
    physicalAcceptance: join(dist, 'release.physical-acceptance.json'),
    sbom: join(dist, 'release.sbom.cdx.json'),
    simulatorAcceptance: join(dist, 'release.simulator-acceptance.json'),
    toolchain: join(dist, 'release.toolchain.json')
  }

  try {
    const hapContent = 'signed-hap'
    writeFileSync(join(root, 'package-lock.json'), 'npm-lock')
    writeFileSync(join(root, 'oh-package-lock.json5'), 'project-lock')
    writeFileSync(join(entry, 'oh-package-lock.json5'), 'entry-lock')
    writeFileSync(join(generated, 'rn_webview.har'), 'patched-har')
    writeFileSync(join(generated, 'safe_area.har'), 'patched-safe-area-har')
    writeFileSync(
      join(patches, '@react-native-oh-tpl+react-native-webview+13.10.3.patch'),
      'webview-patch'
    )
    writeFileSync(
      join(patches, '@react-native-oh-tpl+react-native-safe-area-context+4.7.4-0.2.1.patch'),
      'safe-area-patch'
    )
    writeFileSync(paths.hap, hapContent)
    writeFileSync(paths.toolchain, JSON.stringify(expectedToolchain))
    writeFileSync(
      paths.sbom,
      JSON.stringify({
        bomFormat: 'CycloneDX',
        components: [{ name: 'runtime' }],
        dependencies: [],
        serialNumber: `urn:uuid:${'1'.repeat(8)}-${'2'.repeat(4)}-5${'3'.repeat(3)}-8${'4'.repeat(3)}-${'5'.repeat(12)}`,
        specVersion: '1.5'
      })
    )
    writeFileSync(
      paths.buildEvidence,
      [
        `commit=${environment.GITHUB_SHA}`,
        'os=macOS 26.0 (arm64)',
        'kernel=Darwin 25.0',
        'node=v20.19.4',
        'npm=10.8.2',
        'ohpm=6.0.1',
        'hvigor=6.21.1',
        'java=openjdk version 21.0.8',
        'git=git version 2.50.0'
      ].join('\n')
    )
    const verifiedHap = {
      bundleName: 'ai.stably.orca.harmony',
      byteLength: Buffer.byteLength(hapContent),
      sha256: digest(hapContent),
      versionCode: 47,
      versionName: '0.0.47'
    }
    const simulatorPhases = {}
    for (const [phaseName, stem] of [
      ['coldLaunch', 'cold-launch'],
      ['warmDeepLink', 'warm-deep-link'],
      ['backgroundForeground', 'background-foreground'],
      ['coldDeepLink', 'cold-deep-link']
    ]) {
      const layout = `${stem}.layout.json`
      const screenshot = `${stem}.png`
      writeFileSync(join(dist, layout), `${phaseName}-layout`)
      writeFileSync(join(dist, screenshot), `${phaseName}-screenshot`)
      simulatorPhases[phaseName] = {
        layout,
        layoutSha256: digest(`${phaseName}-layout`),
        pids: ['101'],
        screenshot,
        screenshotSha256: digest(`${phaseName}-screenshot`)
      }
    }
    writeFileSync(join(dist, 'hilog.filtered.txt'), 'clean-hilog')
    writeFileSync(
      paths.simulatorAcceptance,
      JSON.stringify({
        acceptance: 'simulator',
        artifactBinding: {
          kind: 'installed-by-runner',
          sha256: verifiedHap.sha256,
          verified: true
        },
        bundleName: verifiedHap.bundleName,
        cleanInstall: true,
        completedAt: new Date(1_499_970_000).toISOString(),
        dataPolicy: {
          appCleanup: 'uninstall-installed-hap-after-run',
          appInstall: 'uninstall-then-install-exact-hap',
          globalHilog: 'cleared-before-run',
          logScope: 'pid-filtered-after-global-clear'
        },
        deviceModel: 'emulator',
        hapSha256: verifiedHap.sha256,
        harmonyApi: '12',
        harmonyFullName: 'OpenHarmony-5.0.0',
        hdcVersion: '3.2.1',
        logs: {
          fatal: [],
          path: 'hilog.filtered.txt',
          scope: {
            bounded: true,
            completedAt: new Date(1_499_970_000).toISOString(),
            globalBufferCleared: true,
            pidFiltered: true,
            readMode: 'non-blocking',
            startedAt: new Date(1_499_940_000).toISOString(),
            timeWindow: { enabled: false }
          },
          sha256: digest('clean-hilog')
        },
        mode: 'clean-install',
        phases: simulatorPhases,
        publishableCleanAcceptance: true,
        schemaVersion: 1,
        source: {
          commit: environment.GITHUB_SHA,
          ref: environment.GITHUB_REF,
          repository: environment.GITHUB_REPOSITORY,
          runAttempt: environment.GITHUB_RUN_ATTEMPT,
          runId: environment.GITHUB_RUN_ID,
          workflowRef: environment.GITHUB_WORKFLOW_REF
        },
        status: 'passed',
        targetHash: 'f'.repeat(64),
        timestamp: new Date(1_499_940_000).toISOString()
      })
    )
    writeFileSync(
      paths.physicalAcceptance,
      JSON.stringify({
        acceptance: 'physical-device',
        approvalCommentSha256: '9'.repeat(64),
        environment: environment.HARMONY_RELEASE_ENVIRONMENT,
        hap: { artifact: basename(paths.hap), sha256: verifiedHap.sha256 },
        reviewer: 'release-reviewer',
        schemaVersion: 1,
        source: {
          commit: environment.GITHUB_SHA,
          ref: environment.GITHUB_REF,
          repository: environment.GITHUB_REPOSITORY,
          runAttempt: environment.GITHUB_RUN_ATTEMPT,
          runId: environment.GITHUB_RUN_ID
        },
        status: 'approved'
      })
    )
    writeFileSync(
      paths.evidence,
      JSON.stringify({
        artifact: basename(paths.hap),
        ...verifiedHap,
        certificateSha256: 'AB'.repeat(32),
        profile: {
          allowedAcls: ['ohos.permission.READ_PASTEBOARD'],
          bundleName: 'ai.stably.orca.harmony',
          notAfter: 3_000_000,
          notBefore: 1_000_000,
          type: 'release'
        },
        provenance: {
          locks: {
            npm: digest('npm-lock'),
            ohpmEntry: digest('entry-lock'),
            ohpmProject: digest('project-lock')
          },
          patchedWebView: {
            har: digest('patched-har'),
            patch: digest('webview-patch')
          },
          patchedSafeArea: {
            har: digest('patched-safe-area-har'),
            patch: digest('safe-area-patch')
          },
          sbom: { artifact: basename(paths.sbom), sha256: digest(readFileSync(paths.sbom)) },
          source: {
            commit: environment.GITHUB_SHA,
            ref: environment.GITHUB_REF,
            repository: environment.GITHUB_REPOSITORY,
            runAttempt: environment.GITHUB_RUN_ATTEMPT,
            runId: environment.GITHUB_RUN_ID,
            workflowRef: environment.GITHUB_WORKFLOW_REF
          },
          toolchain: expectedToolchain
        }
      })
    )

    const verifyOptions = {
      environment,
      expectedFingerprint: 'AB'.repeat(32),
      expectedToolchain,
      harmonyRoot: root,
      nowSeconds: 1_500_000,
      verifyHap: () => verifiedHap
    }
    const verify = () => verifyHarmonyPublishArtifacts(paths, verifyOptions)
    const expectMutationRejected = (path, mutate, pattern) => {
      const original = readFileSync(path)
      try {
        writeFileSync(path, mutate(original))
        assert.throws(verify, pattern)
      } finally {
        writeFileSync(path, original)
      }
    }

    const result = verify()
    assert.equal(result.sha256, verifiedHap.sha256)

    expectMutationRejected(
      paths.evidence,
      (content) => {
        const evidence = JSON.parse(content)
        evidence.certificateSha256 = 'CD'.repeat(32)
        return JSON.stringify(evidence)
      },
      /certificate evidence does not match/u
    )
    expectMutationRejected(
      paths.evidence,
      (content) => {
        const evidence = JSON.parse(content)
        evidence.provenance.source.commit = 'b'.repeat(40)
        return JSON.stringify(evidence)
      },
      /provenance commit does not match/u
    )
    expectMutationRejected(
      paths.sbom,
      (content) => {
        const sbom = JSON.parse(content)
        sbom.components[0].name = 'tampered-runtime'
        return JSON.stringify(sbom)
      },
      /SBOM evidence does not match/u
    )
    expectMutationRejected(
      paths.toolchain,
      (content) => {
        const toolchain = JSON.parse(content)
        toolchain.node = '20.20.0'
        return JSON.stringify(toolchain)
      },
      /toolchain node is not pinned/u
    )
    expectMutationRejected(
      join(root, 'package-lock.json'),
      () => 'tampered-lock',
      /npm lock evidence does not match/u
    )
    expectMutationRejected(
      join(generated, 'rn_webview.har'),
      () => 'tampered-har',
      /WebView har evidence does not match/u
    )
    expectMutationRejected(
      paths.buildEvidence,
      (content) => content.toString().replace(environment.GITHUB_SHA, 'b'.repeat(40)),
      /build commit does not match/u
    )
    expectMutationRejected(
      paths.simulatorAcceptance,
      (content) => {
        const evidence = JSON.parse(content)
        evidence.hapSha256 = '0'.repeat(64)
        return JSON.stringify(evidence)
      },
      /Simulator acceptance HAP digest does not match/u
    )
    expectMutationRejected(
      paths.simulatorAcceptance,
      (content) => {
        const evidence = JSON.parse(content)
        evidence.artifactBinding.sha256 = '0'.repeat(64)
        return JSON.stringify(evidence)
      },
      /Simulator acceptance artifact binding does not match/u
    )
    expectMutationRejected(
      paths.simulatorAcceptance,
      (content) => {
        const evidence = JSON.parse(content)
        evidence.status = 'failed'
        return JSON.stringify(evidence)
      },
      /Simulator acceptance did not pass/u
    )
    expectMutationRejected(
      paths.simulatorAcceptance,
      (content) => {
        const evidence = JSON.parse(content)
        evidence.cleanInstall = false
        evidence.dataPolicy.globalHilog = 'not-cleared'
        evidence.logs.scope.globalBufferCleared = false
        evidence.logs.scope.timeWindow = { enabled: true }
        evidence.mode = 'preserve-data'
        evidence.publishableCleanAcceptance = false
        return JSON.stringify(evidence)
      },
      /Simulator acceptance mode is not clean-install/u
    )
    expectMutationRejected(
      paths.physicalAcceptance,
      (content) => {
        const evidence = JSON.parse(content)
        evidence.hap.sha256 = '0'.repeat(64)
        return JSON.stringify(evidence)
      },
      /Physical acceptance HAP digest does not match/u
    )
    expectMutationRejected(
      paths.physicalAcceptance,
      (content) => {
        const evidence = JSON.parse(content)
        evidence.source.commit = 'b'.repeat(40)
        return JSON.stringify(evidence)
      },
      /Physical acceptance commit does not match/u
    )
    expectMutationRejected(
      paths.physicalAcceptance,
      (content) => {
        const evidence = JSON.parse(content)
        evidence.reviewer = 'RELEASE-ACTOR'
        return JSON.stringify(evidence)
      },
      /cannot approve their own release/u
    )
    for (const name of ['GITHUB_ACTOR', 'GITHUB_TRIGGERING_ACTOR']) {
      const original = environment[name]
      try {
        delete environment[name]
        assert.throws(verify, new RegExp(`requires ${name}`, 'u'))
      } finally {
        environment[name] = original
      }
    }
    expectMutationRejected(paths.hap, () => 'tampered-hap', /digest verification failed/u)
  } finally {
    rmSync(root, { force: true, recursive: true })
  }
})
