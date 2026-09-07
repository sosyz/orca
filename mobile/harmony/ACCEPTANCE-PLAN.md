# Complete Harmony refactoring and acceptance

Status: **fresh simulator acceptance resumed; not accepted**.
The user completed the reset. The signed debug candidate is now installed on
127.0.0.1:5555 and paired with the isolated loopback orcad. Fresh and paired
lifecycle smoke passed; real terminal input and code zoom were exercised on
2026-09-07. No additional reset will be performed.
Passing source tests or a narrow simulator run is not
whole-client acceptance. This plan tracks the original Harmony client request
(stablyai/orca#10869), the shared iOS/Android architecture, all product flows, and
the user's performance, size, adaptability and code-quality requirements.

## Definition of done

1. Inspect the complete shared mobile design and Harmony adapters, not only the
   current diff. Remove redundant ownership and fake-success implementations;
   preserve supported iOS/Android behavior, SSH/folder workspaces and mixed-version
   host compatibility.
2. Resolve confirmed defects with behavior tests and independent review. File
   movement or deleting features is not successful simplification.
3. Exercise each flow below against an appropriate environment. Mock fixtures
   prove only the scenarios they model; operating-system behavior and actual
   host operations require stronger evidence.
4. Measure startup, terminal responsiveness, sustained output, document handling,
   background resource use and artifact size with a documented workload and
   baseline. Do not infer excellent performance from passing tests.
5. Build and install the exact final artifact, retain redacted evidence, rerun
   affected shared-platform regressions, and record unresolved requirements.
   Do not mark the overall goal complete with unverified rows.

## Coverage ledger

“Partial” means observed evidence exists but does not prove the complete row.
The 2026-09-06 review report contains earlier evidence, not blanket sign-off.

| Area | Required acceptance | Current evidence / remaining work |
| --- | --- | --- |
| Architecture | Shared product state, thin platform resources, complete route/API inventory | All 27 shared screen routes and runtime dependency boundary enumerated; secondary-domain shared RPC paths traced; browser/history findings fixed and independently reviewed |
| Onboarding/pairing | Cold/warm links, scan/cancel, invalid inputs, direct and relay | Partial: final debug candidate paired with real isolated orcad after reset; terminal-default and Not now notification onboarding completed; scan and real relay unverified |
| Credentials/hosts | Secure persistence, upgrade/relaunch, edit/remove, denial/retry | Fresh pairing after user reset survives cold launch and reconnects (2026-09-07). Historical incident remains unexplained: after test-module installation/removal, all four old records had unavailable credentials and original main HAP replacement did not restore reads; fresh success does not establish old-key recovery |
| Connectivity | Real encrypted server, loss/recovery, network handoff, background grace | Partial: isolated real orcad encrypted pairing and RPC exercised; loss/handoff/relay outstanding |
| Workspaces | Repo and folder workspaces, switching, SSH ownership, empty/error states | Partial: real temporary Git repo/main worktree listed and opened; folder/SSH outstanding |
| Tasks/accounts | List/detail, supported actions, capability gates, recoverable errors | Shared Tasks status capability and Accounts subscription/reset gate traced; all nine external-link actions now show generic failure feedback with lifecycle guards, 12 tests and independent review passed; device evidence pending |
| Terminal | Input/paste, IME/CJK/glyphs, zoom/pan, tabs, output/backpressure, scrollback | Partial: real PTY, mobile pwd, Back/resume verified; orcad graph-ready fix passed real RPC and phone Create Tab → Terminal (2→3 tabs); load testing outstanding |
| Native chat | Streaming, history, tools, actions, cancellation, attachments, state retention | Device E2E outstanding |
| Files | Browse, source/HTML/Markdown/image, zoom, large files, selection, error/cancel | Partial: final debug candidate loaded real example.ts including CJK; + controls changed 100% to 120%, content height 399 to 477 px. Back/reopen resets to 100% (review pending). Table alignment, unsaved-preview Back, large/image/selection still need rebuilt-device checks |
| Source control/review | Diff, comments, staged/unstaged state, provider/SSH compatibility | Partial: real status, Stage All and Unstage All verified against temporary Git index; renderer_unavailable fallback implemented and source-tested, rebuilt-device review/provider/SSH outstanding |
| History | Worktree and agent-history loading, navigation and session restoration | Shared git.history/commitCompare and aiVault capability/resume paths traced; commitCompare error/retry preserves loaded files and rejects stale-scope results, 9 component tests and independent review passed; device E2E outstanding |
| Browser | Remote browser rendering/input, lifecycle, URL/security/capability behavior | Shared capability-gated screencast/commands traced; paired-host cache and keyed frame-boundary isolation verified in 9 tests and independent review; device E2E outstanding |
| Notifications | Grant/deny, publish, tap cold/warm, dismiss and reconnect catch-up | Native behavior tests only; device E2E outstanding |
| Images/clipboard | Text/image permissions, pick/cancel, size bounds, decode/resize, upload | Native behavior tests only; device E2E outstanding |
| Voice | Grant/deny/settings, capture, actual transcription, cancel/interruption/teardown | Native/shared behavior tests only; device E2E outstanding |
| Settings/accessibility | Persistence, all controls, focus/readability, ordering, capability copy | Partial simulator settings/reorder; full audit outstanding |
| Adaptability | Portrait/landscape, tablet/fold, keyboard, safe areas, resize without black strips | Portrait partial; signed test module installed, but Driver.create returned null, rotation not executed; test module removed with main app/data retained |
| Performance | Repeatable timings, sustained memory/output, bounded resources and package accounting | 5000-line CJK/ASCII output on inactive real PTY restored to visible completion marker when selected; desktop repeat send correctly rejected by mobile input authority (existing contract); active-load/latency and comparative memory outstanding |
| Automated acceptance | Reproducible, non-destructive local mode; strict CI evidence | 28 script tests passed; corrected paired-home assertion; actual preserve-data cold/warm links, launch and foreground passed, 1602 verifiable PID/epoch log lines, no classified fatal entries |
| Production artifact | Release-mode semantics/signature, clean install/upgrade, required device evidence | Final-source unsigned release built and package-verified; signed install/upgrade and release checklist not signed off |

## Work sequence and authority

Latest device direction: the user first approved an independent clean simulator,
then superseded that with a request to reset the existing simulator. The exact
target is Huawei_WideFold, not MatePad Pro 11. The user subsequently reported
resetting it themselves; fresh installation and acceptance can now proceed.
The agent did not perform a wipe or instance deletion.
Computer Use can control DevEco Studio but cannot select the standalone Emulator
process. DevEco's manager reports missing images because its profile points at
the bundled SDK; the actual image files and running launcher use
`/Users/sonui/Library/Huawei/Sdk`. Global OpenHarmony SDK settings were left
unchanged. The stale IDE debug session was stopped to avoid hot-reload interference.
The exact Huawei_WideFold launcher was then stopped using the official tool;
its process exited and HDC reported no connected devices. No user data was cleared.
Resetting the target would enable fresh testing, not prove recovery of the prior
credentials or explain the original keystore incident.

Real-runtime evidence for this pass is under
`/private/tmp/orca-harmony-real.vmce4F`. The runtime profile and runtime log contain
ephemeral pairing credentials and are not publishable artifacts. Only reviewed,
redacted evidence may be attached to a report. Tests use a loopback-only isolated
orcad and a temporary Git repository, not the user's desktop sessions.

Latest root-run integration snapshot (including Tasks links, browser/history and stale-origin fixes):

| Gate | Evidence | Limit |
| --- | --- | --- |
| Shared mobile tests | 537 files; 4253 passed, 3 skipped | Source regression evidence, not whole-client device acceptance |
| Types | Shared mobile, Harmony and root passed | Source compatibility only |
| Changed-code quality | 312 files; zero new findings in all three checks | Not runtime acceptance |
| Cross-version terminal/session | 20 tests against local stable v1.4.192, both skew directions | Excludes mobile E2EE and relay |
| Host startup/E2EE/relay contract | 43 tests passed | Not real network handoff |
| Release scripts | 110 tests passed; native lint reports zero defects | Not native runtime acceptance |
| iOS/Android production export | Both final shared-source Hermes bundles exported offline successfully | Not native builds or device performance; dependency export-map fallback warnings remain |
| Harmony final-source release | Clean unsigned build and HAP verifier passed; 39418414 bytes | No signed installation or device acceptance |

Current source findings:

- Chat scope-cap cleanup, same-content transcript updates, out-of-order ordinal
  reuse and mixed unknown/accepted retry reconciliation have permanent regressions.
  The independently reproduced stale-origin gap is also fixed: reserve before
  any asynchronous pre-send work and release in one finally covering early exits
  and callback failures. Combined-hook deferred-clear/accepted and
  deferred-heal/unknown tests prove an earlier echo cannot retire the later send.
  Independent final focused review passed 104 tests and closed these findings.
- Microphone ownership now covers initialization, recording, data delivery and
  shutdown across hook instances. The full integration snapshot includes the
  overlapping-route regressions. Actual capture/transcription needs a physical
  device; the simulator deliberately declines unsupported audio initialization.
- Secure-store tests distinguish Preferences cache from durable data and cover
  no-op flush after failed persistence. Real changed-value flush persists the
  whole store; the earlier per-key-only flush assumption was withdrawn.

Every subsequent source change requires renewed relevant gates. Passing these
checks does not replace any outstanding device/performance row above.
The first full run after the Tasks lifecycle fix had one 5-second timeout in
the 1 MB Meslo byte-comparison test (4252 passed, 3 skipped). That check used a
general deep matcher; it now uses `Buffer.equals` with the same exact-byte
contract and unchanged timeout. The targeted 13-test engine suite passed in
422 ms test time. After concurrent builds finished, the full suite passed:
537 files, 4253 tests passed and 3 skipped in 23.40 s, with the original timeout.
The timed-out run is retained as failed evidence, not a passing gate.
An unsigned release-mode build initially passed compilation in 65.299 seconds,
but the HAP verifier rejected its packaged `ets/symbolMap.map`. Local SDK
inspection found `symbolMap.map` referenced only by the Ets loader's hot/cold
reload paths, and preserving then removing stale `entry/build/config` plus
`entry/build/default` removed the packaged map. A verified `clean assembleHap`
release rebuild produced a 39390685-byte unsigned HAP containing Hermes bytecode
and `ets/modules.abc`, with no plaintext JavaScript, maps, x86_64 libraries, or
`rnoh.profdata`; the verifier passed with SHA-256
`3ebcda6186ba3a49219397afb5841d59256a654b4fb32b70a2325d9fc0d3471b`. This is a
packaging-mode sanity check, not the final accepted source artifact.
The subsequent stable-source clean build also passed in 2 min 29.851 s, producing
a verified 39391520-byte unsigned HAP with SHA-256
`e398132949a9669a5ceaa5a313e9b8269fec3503d07b00731da698b3b70e0fb0`.
It predates the stale-origin fix and has not been installed on the preserved
simulator. The final stale-origin-fixed source was rebuilt cleanly in
2 min 29.789 s; its 39391735-byte unsigned HAP passed the verifier with SHA-256
`ecf1b7ac1a1b6b2b14b2ecc8f82a138b7281d53f5b90742bdd0b9efdc47d14e2`.
Mobile/Harmony/root types and changed-code quality passed for that snapshot.
The subsequent browser-isolation/history-error source passed all three type
checks, changed-code quality, the 4241-test mobile suite, and iOS/Android offline
Hermes exports. Its clean unsigned Harmony build passed in 2 min 14.471 s.
The 39397473-byte HAP passed the verifier with SHA-256
`77957720593527ddfccdd2982ab80a0e4f992be248d7a61d0aa183077b95c973`.
Build warnings remain; zero native lint defects is a separate result. The final
artifact is not signed or installed device acceptance. After the Tasks external-link
fix, iOS/Android offline exports and a clean unsigned Harmony build passed again.
That 39418414-byte HAP passed its verifier with SHA-256
`8fdc3741f3c0d03479b89ae8996986381320022803f9d02d9f9b4203430ba748`.
Build time was 5 min 3.704 s under concurrent toolchain load; this is not an app
runtime performance measurement. The subsequent font-test-only optimization does
not change the production payload. This final source artifact is not installed
or signed release acceptance.

The installable local debug candidate was then built cleanly in 2 min 28.652 s:
`entry/build/default/outputs/default/entry-default-signed.hap`, 72720404 bytes,
SHA-256 `29ee55f311150657912ce82a692e3f92e603f887448438465fb20064a7b46291`.
Its embedded HBC exactly matches the final unsigned release payload, SHA-256
`4c339a0f8c28b421bcafeb52942da0559aef0c4cb59b8671e67c6f1d05af89ed`.
The unsigned release was preserved and reverified separately at
`/private/tmp/orca-harmony-real.vmce4F/links-final-unsigned-release.hap` before
the debug build replaced generated output files. After the user reported resetting
the simulator, the debug candidate hash was rechecked and HDC installation on
127.0.0.1:5555 returned `install bundle successfully`. Launch and a screenshot
confirmed the fresh `Connect your desktop` onboarding screen. The first
preserve-data smoke run timed out because its empty-home assertion still expected
`Welcome back`; this is a test-semantic defect, not evidence of a startup crash.
Evidence is under `reset-user-acceptance` and `reset-home.png` in the private
directory above. This is not signed production release or whole-device acceptance.
After correcting the fresh-home semantic assertion, the preserve-data run passed
all four phases: cold launch, warm invalid pairing link, background/foreground,
and cold invalid pairing link. Each phase retained screenshot/layout hashes and
process identities under `reset-user-acceptance-fixed/evidence.json`. This proves
the fresh-install smoke slice, not valid pairing, landscape, or runtime performance.
Mobile v2 outbound admission now reuses the host's plaintext bounds before
encryption and returns actual queue acceptance. Three root-run physical-channel,
client-session and reentrant-ready test files passed 11 tests, including rejection
without consuming a frame counter. No new wire shape or opcode was introduced.
One idle homepage process sample showed 151692 kB PSS; this is not a performance
verdict and excludes separate ArkWeb renderer processes and comparative workloads.

Security incident investigation: the diagnostic main HAP built successfully in
16.004 seconds and was installed with replacement (no data clear). All four host
reads report only `read-decrypt-finish code=12000006`; alias presence and session
initialization do not fail. This establishes a crypto-operation failure, not
that the original key still exists. The previous v3 read path could generate a
replacement for a missing key; the new diagnostic read path cannot. The exact
cause and recovery remain unresolved. Do not treat the generic "unlock" UI copy
as a diagnosis. Legacy v2 migration policy is under independent review; this
diagnostic build is not the final accepted artifact.

Final read-only key-presence probe: all four failures are v3 decrypt-final
12000006. v3/ECE exists; v3/CE, v3/DE and legacy v2/default do not. No alternative
key path was found in these supported probes. This still does not identify the
original key or prove what removed/replaced it. Further credential recovery needs
an original simulator/system backup or explicit user direction on re-pairing;
no credential clearing, alias replacement or re-pairing has been performed.
Read-only host-side inventory found no separately named snapshot/backup files in
the emulator profile, and the macOS local Time Machine snapshot listing was
empty. This does not exclude internal image snapshots or an external backup;
the live userdata image was not opened or modified.
The experimental test-module source and target were withdrawn; its generated HAP
and bounded evidence remain available for investigation.

Cleanup: the loopback test orcad and its isolated daemon/PTYS were stopped after
verifying their profile/socket ownership. The exact 17669 reverse forward was
removed; the pre-existing 8081 forward remains. Simulator host records and
encrypted preferences were not cleared. The private fixture/profile directory
is retained for investigation, not publication.

Post-incident code work continues without changing the paired device:

- Host-card copy now describes an unreadable credential and retry action without
  claiming that unlocking is the solution (card/router targeted tests: 27 passed).
- Controlled legacy migration has 39 passing targeted tests, including retained
  v3 ciphertext with a missing key, failed enumeration, concurrent mutations and
  failed persistence. Independent review is ongoing. The first real ArkTS build
  rejected a TypeScript index signature; replacing it with the documented ArkTS
  Record form passed a real native build. Nothing from this pass has been
  installed on the paired simulator.
  Independent review added write-path lost-key/enumeration and concurrent-read
  tests, and found that a failed rollback could leave an unflushed v3 value in the
  preferences cache. A concurrent v3 read could also observe unflushed writes.
  The approved simplification serializes credential reads and mutations together,
  with inline legacy migration, instead of accumulating race-specific guards.
  The resulting source passed 48 targeted tests, native lint and a real ArkTS/HAP
  build (18.922 seconds; SecureValueStore source SHA-256
  `4bab327cef6cbebbe0f668c38530028171a8fccdab62c9d440acd7edce4a4cea`).
  Final independent secure-store re-review passed 51 targeted tests. No-op
  mutations cannot clear uncertain durability; a real changed-value whole-store
  flush can. The updated native source also passed a real ArkTS/HAP build in
  15.329 seconds, without installing on the preserved simulator.
- A behavior reproducer confirms that session → files → Back loses unsent chat
  text and accepted pending text/image echoes. Bounded transient-state ownership
  now has a scoped in-memory owner and focused lifecycle regressions. It retains
  drafts and late send outcomes without keeping inactive ArkWeb trees mounted.
  Follow-up review is checking cache bounds, transcript updates and complexity;
  the additional ownership code is not yet a code-size improvement.
- Offline release-script regression after font deduplication: 110 passed. The HBC contains the
  complete Meslo WOFF2 payload while the HAP also carries a 1054196-byte unused
  raw WOFF2 copy. Source relocation and embedded-font/duplicate-resource artifact
  gates passed targeted tests. An offline debug rebuild is 1035539 bytes smaller;
  archive checks preserve identical HBC, native TTF and licenses. This partial
  snapshot is not the final rebuilt shared application or device acceptance.
- Non-chat lifecycle review found file-preview hardware Back bypassing the draft
  prompt, and remount during initial-terminal creation reissuing the mutation.
  Both are fixed; six navigation/file/startup test files passed 45 tests. Actual
  unsaved-preview Back now exercises the discard prompt. Device retest remains
  outstanding.

- Reviewers map complete flows and identify concrete design gaps. The coordinator
  decides ownership and scope before parallel implementation.
- Implementation uses GPT-5.5 xhigh agents; independent regression uses Luna.
- The local device runner must preserve existing app data and global logs.
  A preserved-data run cannot masquerade as clean-install release acceptance.
- Use isolated test repositories/profiles for real host mutations. Never run
  destructive scenario actions against the user's existing projects or sessions.
- Keep the signing profile/private material untouched. No dependency-graph upload,
  publication, commit or push is implied by the refactoring goal.
- If production/device acceptance needs credentials, hardware or an independent
  approval that is unavailable, record the specific missing evidence while
  continuing all other actionable work. Do not replace it with mock approval.
