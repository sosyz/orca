# Post-reset simulator acceptance

Partial acceptance only. No production source changed during this test pass.

## Environment and artifact

- User-reset Huawei_WideFold, HDC target `127.0.0.1:5555`.
- Installed signed debug HAP SHA-256:
  `29ee55f311150657912ce82a692e3f92e603f887448438465fb20064a7b46291`.
- Real isolated orcad, loopback port 17669, temporary Git fixture and private
  profile; no user desktop session used. HDC reverse forwarding is limited to
  this port. Runtime PTY self-test passed (28 ms, not an app-latency benchmark).
- Private evidence: `/private/tmp/orca-harmony-real.vmce4F`.
  Runtime logs contain pairing secrets and must not be published.

## Observed results

| Check | Result and evidence |
| --- | --- |
| Real encrypted pairing | Confirmation completed; `FIXTURE / main` loaded from real runtime (`reset-connected.layout.json`) |
| First-use onboarding | Terminal default selected; skipping notifications still allows workspace entry |
| Terminal input | After system keyboard first-use layout setup, phone entered `pwd`; output matched temporary fixture (`reset-pwd-verified.png`) |
| Font rendering | Terminal prompt glyphs visible; code preview rendered `Harmony 完整验收` (not a complete glyph/IME matrix) |
| Code zoom | Two + taps changed 100% to 120%; text height changed 399 to 477 px with reflow (`reset-code.layout.json`, `reset-code-zoom.layout.json`, `reset-code-100.png`, `reset-code-120.png`) |
| Reopen behavior | Back then reopen same source resets zoom to 100%; this hook currently uses mount-local state (`reset-code-reopen.layout.json`), design review pending |
| Paired lifecycle | All four preserve-data smoke phases passed (`reset-paired-lifecycle-20260907/evidence.json`) |
| Credential restoration | Subsequent cold launch showed `Host 1, Connected · Direct · LAN` plus fixture resume entry (`reset-persist-ready.layout.json`) |
| Runtime state | Read-only encrypted RPC: graph ready, one repo/worktree, two ready terminal tabs |

The first attempted `pwd` reached system keyboard onboarding, not the PTY, and
is not counted as successful terminal input. Only the later verified screenshot
establishes execution and output.

## Remaining boundaries

- Computer Use sees DevEco but not its standalone emulator window. The installed
  emulator is 6.0.1; current documented `-instance ... -rotation` support starts
  at 26.0.0 Beta1, so it was not applied blindly. A user toolbar rotation was
  requested for landscape testing. No test module or persistent rotation lock
  was installed.
- Plus-button zoom is verified; pinch, minus/reset, landscape/fold/keyboard
  combinations, active-load latency and comparative process memory are not.
- Fresh credential restoration does not prove recovery or identify the cause of
  the pre-reset HUKS incident.
- This is not signed production-release, physical camera/microphone, relay,
  SSH/folder-workspace, or whole-client acceptance.
