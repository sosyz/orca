# Orca for HarmonyOS

Native HarmonyOS companion built with React Native OpenHarmony (RNOH) and ArkTS. It shares the production mobile screens
and business logic in `mobile/app/` and `mobile/src/` with the iOS and Android clients.

See [the mobile architecture](ARCHITECTURE.md) for cross-platform ownership,
performance invariants, navigation tradeoffs, and the validation workflow.

## Supported capabilities

- Direct and Relay pairing, including `orca://pair` cold- and warm-start links
- E2EE host connections, host/worktree management, tasks, terminal, native chat, files, source control, review, history,
  and account views
- HUKS-backed encrypted credential storage and persistent preferences
- Scan Kit QR pairing, system photo/document pickers, clipboard images, image resizing, and WebView terminal/Markdown
  rendering
- Foreground/local notifications and notification-tap navigation
- Microphone capture for desktop voice transcription, network-state events, haptics, and keep-awake
- Phone, tablet, and responsive split-view layouts from the shared mobile UI

The current native dependency set produces an ARM64 HAP, matching shipping HarmonyOS phones and tablets.

## Requirements

- Node.js 20.19.4 or newer
- DevEco Studio with the pinned HarmonyOS SDK `6.0.1.112` (API 21)
- An ARM64 HarmonyOS device or compatible emulator
- A reachable Orca desktop app or `orca serve` runtime

## Install dependencies

Install both the shared mobile toolchain and the RNOH project dependencies:

```bash
cd mobile
pnpm install

cd harmony
npm ci
ohpm install --all
```

`npm ci` creates an unsigned local `build-profile.json5` from the tracked template when the file is missing. It never
overwrites an existing DevEco Studio signing profile, and it restricts local profile and backup permissions to `0600`
on macOS and Linux.

`npm ci` deterministically prepares the patched local WebView HAR. Run `ohpm install --all` again whenever that HAR
or its patch changes so `oh_modules` cannot retain an older native implementation.

## Build

Do not install or remove an `entry_test` module on a paired device/profile:
the 2026-09-06 experimental rotation-runner installation/removal
was followed by existing HUKS-backed credentials becoming unreadable, and the
cause/recovery have not been established. `bm uninstall -m ... -k` must not be
treated as proof that keystore material is preserved. Use only a disposable,
unpaired environment for any future test-module experiments until this lifecycle
is verified. The ordinary
`preserve-data` acceptance runner does not install this test module.

Bundle the shared React Native application first:

```bash
cd mobile/harmony
npm run typecheck
npm run bundle:harmony
```

Then open `mobile/harmony` in DevEco Studio and build the `entry` module. The command-line equivalent on macOS is:

```bash
JAVA_HOME=/Applications/DevEco-Studio.app/Contents/jbr/Contents/Home \
DEVECO_SDK_HOME=/Applications/DevEco-Studio.app/Contents/sdk \
  /Applications/DevEco-Studio.app/Contents/tools/hvigor/bin/hvigorw \
  --mode module -p product=default -p module=entry@default \
  -p buildMode=debug assembleHap --no-daemon
```

Without a signing profile, the unsigned artifact is written to:

```text
entry/build/default/outputs/default/entry-default-unsigned.hap
```

When a local debug signing profile is configured, keep it untouched and disable only the
sign task for an unsigned release validation build:

```bash
JAVA_HOME=/Applications/DevEco-Studio.app/Contents/jbr/Contents/Home \
DEVECO_SDK_HOME=/Applications/DevEco-Studio.app/Contents/sdk \
  /Applications/DevEco-Studio.app/Contents/tools/hvigor/bin/hvigorw \
  --mode module -p product=default -p module=entry@default \
  -p buildMode=release -p properties.enableSignTask=false \
  clean assembleHap --no-daemon
```

Use `clean` for release validation, especially after DevEco Studio debug or
hot-reload builds. Hvigor can retain `entry/build/config/buildConfig.json`
across mode switches; a stale hot-reload config can package `ets/symbolMap.map`
into an otherwise release HAP, and the release verifier must reject that
source-map artifact.

Configure a local signing profile in DevEco Studio before installing on a physical device. Release builds reject signing
configurations whose name or key alias identifies a debug key; use a distribution certificate/profile or sign the unsigned
release HAP in the release pipeline. Signed release builds also require the profile to grant the restricted
`ohos.permission.READ_PASTEBOARD` ACL used by Orca's explicit text/image paste actions. Signing files, passwords, and
machine-local paths must never be committed.

When signing outside the release workflow, run the same final-artifact gate locally:

```bash
JAVA_HOME=/path/to/deveco/jbr \
HAP_SIGN_TOOL_JAR=/path/to/hap-sign-tool.jar \
HARMONY_RELEASE_CERT_SHA256=<pinned-distribution-fingerprint> \
  npm run verify:signed-release -- entry-default-signed.hap
```

This verifies the HAP and profile signatures, release profile fields, certificate fingerprint, HBC payload, manifest, and
absence of plaintext JavaScript from the exact artifact being distributed.
The certificate check is fail-closed: the PEM chain exported by `verify-app` is decoded as X.509 and must identify
exactly one non-CA leaf with the code-signing extended key usage. That leaf's SHA-256 fingerprint must match the pinned
value; missing, malformed, or ambiguous leaf certificates are rejected.

## Production release

The `Mobile Harmony Release` GitHub Actions workflow builds an unsigned release HAP on a dedicated, encrypted, protected
self-hosted macOS runner, signs it outside Hvigor, verifies the exact final artifact, and uploads the HAP, SBOM, and
non-secret evidence. The runner must have the labels `self-hosted`, `macOS`, `ARM64`, and `harmonyos`, Node `20.19.4`
with npm `10.8.2`, DevEco Studio pinned to `6.0.1.112`, and no other tenant's workloads. Use full-disk encryption,
restrict runner administration, and treat the runner workspace as disposable. Before checkout, the workflow requires an
exact `runner.name` repository variable plus a root-owned, non-symlink sentinel at
`/Users/Shared/orca/harmony-release-runner.sentinel` with mode `0644` and the configured SHA-256. The simulator job
uses the corresponding `HARMONY_RELEASE_SIMULATOR_*` contract and
`/Users/Shared/orca/harmony-simulator-runner.sentinel`; missing or mismatched identity data fails closed. These
variables and sentinel files are an external runner-administration contract: a `GITHUB_TOKEN` cannot attest that a
host administrator has not replaced the runner or sentinel, so changes require protected repository administration
and review. When DevEco is not installed under `/Applications`, set the `HARMONY_DEVECO_HOME` GitHub Actions repository
or organization variable to its `Contents` directory.

A separate acceptance runner must have the additional `harmonyos-simulator` label and exactly one booted HDC simulator.
It downloads the signed build artifact without receiving signing secrets, installs that exact HAP, records screenshots,
UI layouts, and filtered logs with per-file SHA-256 values, and attests the redacted acceptance JSON. A failed install,
ambiguous target, missing simulator metadata, UI failure, fatal log, or evidence mismatch blocks publication.

Protect the `mobile-harmony-v*` tag pattern and both the `harmony-production` and
`harmony-production-publish` GitHub Environments with required reviewers and self-review prevention. Configure each
environment's deployment branch policy as selected custom policies with `protected_branches=false` and
`custom_branch_policies=true`, containing the default branch name and the exact tag pattern `mobile-harmony-v*`.
The workflow reads and checks these policies before any protected build or publication. Production signing
secrets are environment-scoped and are never available to the SBOM or unsigned-build
steps. The workflow verifies the exact Node/npm versions and content digests for Java, DevEco's embedded Node and Code
Linter, OHPM, Hvigor, and the complete Harmony SDK, records OS/Git/GitHub CLI evidence, rejects lockfile drift, and cleans the HAP, generated bundle,
dependency directories, and temporary signing material from the self-hosted runner in an `always()` cleanup step.
Before signing, it creates a fresh detached checkout under the runner temporary directory, reinstalls npm and OHPM
dependencies, performs an isolated second release build, and compares every uncompressed HAP entry by name, size, and
SHA-256 so workspace state, ZIP timestamps, compression metadata, and entry order cannot hide payload drift.
The pinned Harmony CLI patch streams Metro output to Hermes over stdin, avoiding both randomized source paths in HBC and
plaintext JavaScript temporary files.
The protected signing job publishes separate GitHub build-provenance and CycloneDX SBOM attestations for the verified
HAP. The hosted publish job verifies both against this repository, this workflow, and the exact source commit, and
requires the attested SBOM and simulator-acceptance evidence to exactly match the uploaded files before creating a
release.

Configure the protected `harmony-production` GitHub Environment with:

- Secrets: `HARMONY_RELEASE_CERT_BASE64`, `HARMONY_RELEASE_KEYSTORE_BASE64`,
  `HARMONY_RELEASE_PROFILE_BASE64`, `HARMONY_RELEASE_KEY_ALIAS`, `HARMONY_RELEASE_KEY_PASSWORD`, and
  `HARMONY_RELEASE_KEYSTORE_PASSWORD`

Configure these repository (or organization) variables so both protected jobs can verify the same public policy:

- `HARMONY_RELEASE_CERT_SHA256`: pinned distribution certificate fingerprint
- `HARMONY_RELEASE_ALLOWED_ACTOR`: maintainers or trusted automation allowed to initiate or rerun a signed build
- `HARMONY_RELEASE_SIGNING_RUNNER_NAME`, `HARMONY_RELEASE_SIGNING_RUNNER_SENTINEL_PATH`, and
  `HARMONY_RELEASE_SIGNING_RUNNER_SENTINEL_SHA256`: exact protected signing runner contract; the path must be
  `/Users/Shared/orca/harmony-release-runner.sentinel` and the digest must be lowercase hexadecimal
- `HARMONY_RELEASE_SIMULATOR_RUNNER_NAME`, `HARMONY_RELEASE_SIMULATOR_RUNNER_SENTINEL_PATH`, and
  `HARMONY_RELEASE_SIMULATOR_RUNNER_SENTINEL_SHA256`: exact protected simulator runner contract; the path must be
  `/Users/Shared/orca/harmony-simulator-runner.sentinel` and the digest must be lowercase hexadecimal
- `HARMONY_DEVECO_HOME` (optional): DevEco Studio `Contents` directory on the protected runner

Existing prereleases must be authored by `github-actions[bot]`; the identity is fixed in the workflow instead of being
configurable. Keeping the initiator policy outside the signing Environment lets the workflow enforce it without
attaching signing secrets to the publish job.

The release profile must be type `release`, target `ai.stably.orca.harmony`, remain valid for at least seven days, have no
debug device allowlist, and grant `ohos.permission.READ_PASTEBOARD`. Signing files are decoded only into an isolated
temporary directory and are deleted before the job exits. The final verifier rejects debug builds, version drift, wrong
bundle IDs, missing native/font resources, non-Hermes bundles, plaintext JavaScript, expired profiles, and unexpected
certificates.

Use a committed `AppScope/app.json5` version and push `mobile-harmony-v<version>`, or run the workflow manually. Both the
original actor and, on reruns, the triggering actor must be listed in `HARMONY_RELEASE_ALLOWED_ACTOR`; tag protection and
Environment approval remain required independent controls. For a tag build, the publish job waits at
`harmony-production-publish`: download the exact signed artifact from that workflow, complete the physical-device
checklist, calculate its lowercase SHA-256, and include this exact line in the Environment approval comment before
approving publication:

```text
physical-hap-sha256: <64 lowercase hexadecimal characters>
```

The publish job reads GitHub's workflow approval history, requires exactly one matching marker from an independent
reviewer, and emits a redacted physical-acceptance JSON bound to the HAP, source commit, workflow run, and Environment.
It never copies the original approval comment into release assets. Manual publishing is opt-in. A GitHub Release is
always a non-latest prerelease. Before an existing release is updated, the workflow checks that its tag
resolves to the verified commit, its status is non-draft/prerelease, and its author is `github-actions[bot]`; an
untrusted release fails closed. Existing assets must exactly match the candidate before missing assets are added, and
unexpected assets block the update. The hosted publish job independently rechecks HAP semantics, certificate/profile
evidence, SBOM digest, lock hashes, source identity, pinned toolchain evidence, and both acceptance records before
upload; it then requires every HAP, SBOM, build-evidence, and acceptance asset's name, size, and SHA-256 digest to match. Follow
[RELEASE_CHECKLIST.md](./RELEASE_CHECKLIST.md) before making the artifact public.

For rollback, stop distribution of the candidate, retain its evidence, and point the release channel back to the last
known-good signed HAP. Do not clobber a release whose tag, commit, status, author, or asset digest does not verify. For
certificate rotation, stage the new certificate, keystore, profile, and fingerprint in the protected Environment, run the
full signed-artifact and physical-device gates, obtain reviewer approval, then retire the old material only after the
new certificate is confirmed in production. Never commit signing files or passwords.

## Development

Run Metro in one terminal:

```bash
cd mobile/harmony
npm start
```

Launch the already-signed app from DevEco Studio or run the RNOH launcher in another terminal:

```bash
npm run harmony
```

QR pairing uses Scan Kit's system default scanning UI. HarmonyOS preauthorizes that UI for camera access, so the app must
not request `ohos.permission.CAMERA` itself. The default scanner requires a physical device; use pasted pairing codes for
emulator testing.

## Validation

From `mobile/`:

```bash
pnpm typecheck
pnpm test src/harmony
```

From `mobile/harmony/`:

```bash
npm run typecheck
npm run test:release-scripts
npm run bundle:harmony
npm run lint:native
npm run check:source-secrets
npm run verify:release-hap -- /path/to/release.hap
npm run verify:release-profile -- /path/to/profile-extracted-from-final-hap.p7b
npm run verify:signed-release -- /path/to/signed-release.hap
npm run acceptance:simulator -- --mode clean-install --hap /path/to/signed-release.hap --output-dir ./harmony-acceptance
npm run acceptance:simulator -- --mode preserve-data --hap /path/to/signed-release.hap --target <hdc-target> --output-dir ./harmony-acceptance-local
```

The simulator acceptance command requires exactly one connected HDC target unless `--target` is supplied. Set
`HARMONY_HDC` (or pass `--hdc`) when HDC is not on `PATH`; with DevEco installed, `DEVECO_SDK_HOME` is also used to
locate it. The default `clean-install` mode installs the HAP, exercises cold/warm pairing and lifecycle transitions, and
writes screenshots, UI layouts, filtered `hilog`, and redacted evidence to `--output-dir`. The dedicated-runner path
removes the bundle before installing, clears the global HiLog buffer before launch, and removes only a bundle installed
successfully by the current invocation afterward.

For a local simulator that already has Orca data you want to keep, use `--mode preserve-data` with an explicit
`--target`. This mode never uninstalls or installs the bundle and never clears the global HiLog buffer; it records only
PID-scoped, non-blocking HiLog output bounded by start/end epoch seconds read from the target with `date +%s`. The
runner checks `date --help` and verifies the `date +%s` output before touching the app; if epoch logs are missing,
unparseable, outside the selected PIDs, or outside the device clock window, the run fails as unverifiable.

In `preserve-data`, `--hap` identifies and validates a local candidate HAP only; the runner does not prove that this
exact artifact is the one already installed on the simulator. Its `evidence.json` is marked `mode: "preserve-data"`,
`cleanInstall: false`, `publishableCleanAcceptance: false`, and `artifactBinding.verified: false`, so it cannot satisfy
the release workflow's clean simulator-acceptance gate. The older `--skip-install` flag remains a compatibility alias
for `--mode preserve-data`.

The Harmony contract tests ensure every shared Expo API has an adapter, every imported React Native community module has
a Harmony dependency, every mobile route is registered in the RNOH router, and release builds use embedded Hermes bytecode
without a Metro or plaintext-JavaScript fallback.
