# HarmonyOS release acceptance

Record this evidence for every production HAP. A missing digest, reviewer sign-off, or failed-gate disposition blocks
publication. Do not include device IDs, signing passwords, private keys, or provisioning profile contents.

## Release record (required)

- Commit: `________________________________________`
- Tag: `____________________________________________`
- Tested HAP SHA-256: `________________________________________________`
- Device model / HarmonyOS API: `_______________________________`
- Test date (UTC): `________________` Tester: `________________`
- Reviewer sign-off (name/date): `______________________________________`
- Failed gates and blocking reason: `___________________________________`
- Rollback owner and decision, if any: `_______________________________`

## Automated gates

- [ ] Tag and committed `versionName` match; `versionCode` is higher than the last published build.
- [ ] Original and rerun-triggering actors are listed in `HARMONY_RELEASE_ALLOWED_ACTOR`; tag protection is enabled.
- [ ] Each self-hosted job passes the exact `runner.name`, `runner.environment`, OS/architecture, and root-owned `0644`
      sentinel SHA-256 contract before checkout or artifact download; missing variables or sentinel mismatch fail closed.
- [ ] `harmony-production` and `harmony-production-publish` have required reviewers with self-review prevention and
      selected custom deployment policies (`protected_branches=false`, `custom_branch_policies=true`) containing the
      default branch and `mobile-harmony-v*` tag pattern; the reviewer downloads and tests
      the exact signed artifact from the pending workflow before approving publication.
- [ ] Production toolchain is ARM64 with exact Node `20.19.4`, npm `10.8.2`, and Harmony SDK `6.0.1.112` (API 21);
      pinned Java/DevEco Node/Code Linter/Hvigor/OHPM/SDK content digests pass and the toolchain evidence is attached.
- [ ] `npm ci`, Harmony TypeScript, release-script tests, HBC bundle, source-secret guard, codegen, and DevEco Code Linter pass.
- [ ] OHPM dependencies install from both lockfiles and `package-lock.json`, `oh-package-lock.json5`, and
      `entry/oh-package-lock.json5` are unchanged after install.
- [ ] Final HAP reports `buildMode=release`, `debug=false`, bundle `ai.stably.orca.harmony`, and the committed version.
- [ ] Final HAP contains Hermes HBC, ARM64 native libraries, Meslo/Nerd Font resources, and no JavaScript or source maps.
- [ ] An isolated detached checkout rebuild has the same entry set and uncompressed content SHA-256 values as the first.
- [ ] `hap-sign-tool verify-app` and `verify-profile` pass on the uploaded HAP.
- [ ] Profile type, bundle ID, validity, pasteboard ACL, and absence of a debug-device allowlist pass.
- [ ] The extracted X.509 chain has exactly one non-CA `codeSigning` leaf; its SHA-256 matches the pinned distribution
      certificate, and missing, malformed, or ambiguous leaf output is rejected.
- [ ] HAP, evidence JSON, SBOM, toolchain evidence, and build evidence are uploaded by the protected
      `harmony-production` workflow.
- [ ] The dedicated `harmonyos-simulator` runner tests the exact signed HAP and uploads an attested, redacted acceptance
      JSON whose HAP digest and per-file screenshot/layout/log digests verify.
- [ ] GitHub build provenance and CycloneDX SBOM attestations verify for the exact HAP, source commit, repository, and
      release workflow; the attested SBOM exactly matches the uploaded SBOM.
- [ ] The GitHub-hosted publish job independently rechecks the downloaded HAP semantics, artifact/SBOM digests, source
      identity, lock hashes, profile/certificate evidence, pinned toolchain evidence, and both acceptance records.
- [ ] If a GitHub Release already existed, its tag/commit, non-draft prerelease status, and trusted author were verified;
      existing assets matched before update, no unexpected assets existed, and every final asset name, size, and SHA-256
      digest was checked.

## Simulator acceptance

- [ ] `npm run acceptance:simulator` passes for the exact signed HAP; its redacted evidence, screenshots, UI layouts,
      and PID-filtered `hilog` are retained with the release record.
- [ ] Simulator evidence reports `status=passed`, the final HAP SHA-256, simulator/API metadata, the current workflow
      source identity, no fatal logs, and matching SHA-256 values for every retained evidence file.
- [ ] Cold launch reaches Home; warm/cold invalid pairing links show recoverable errors; Home background/foreground keeps
      the process alive; force-stop/relaunch creates a fresh process; the script restores a normal launch afterward.

## Physical-device acceptance

The required HAP digest and reviewer sign-off above must be completed before this section can pass.

The independent Environment reviewer must put exactly one digest marker in the approval comment:

```text
physical-hap-sha256: <64 lowercase hexadecimal characters>
```

The marker must match the downloaded release HAP. Missing, stale, conflicting, self-approved, or malformed markers
block the publish job. The generated release asset contains only the reviewer login and comment digest, never the raw
comment or a device identifier.

- [ ] Clean install and upgrade from the previous production build both succeed.
- [ ] Cold launch, background/foreground, force-stop/relaunch, and orientation changes preserve usable state.
- [ ] `orca://pair` works from cold and warm starts; direct LAN and Relay pairing both reconnect after network loss.
- [ ] Scan Kit QR success, cancellation, retry, and album selection work on a physical device.
- [ ] Terminal input, paste, resize, zoom, tab switching, scrollback, CJK text, and Nerd Font/Powerlevel10k glyphs render correctly.
- [ ] Text/image clipboard reads show the system permission flow and denial remains recoverable.
- [ ] File/document/image pickers return usable content and cancellation does not leave a stuck overlay.
- [ ] Microphone grant/deny/settings, background interruption, and repeated dictation starts do not leave recording active.
- [ ] Notification grant/deny, foreground delivery, tap routing, and dismissal work after relaunch.
- [ ] Phone and tablet layouts cover home, worktree, task, terminal, files, source control, review, history, and settings.
- [ ] No fatal, uncaught, Metro, localhost:8081, plaintext-bundle, or signing errors appear in filtered `hilog` output.

## Failure disposition

- [ ] Every failed gate is recorded above with a blocking reason and owner; unresolved failures block publication.
- [ ] If rollback is required, distribution is stopped and the last known-good signed HAP is restored; the candidate is
      retained for investigation and its release is not silently overwritten.
