# Harmony performance evidence — incomplete

This is a measurement ledger, not a performance sign-off. The installed debug
HAP uses a production-minified Hermes bundle, but simulator numbers are not
physical-device measurements or release-package acceptance.

## Environment and isolation

- Huawei WideFold emulator, HarmonyOS 6.0.1 / API 21, arm64, 1320 × 2120 portrait.
- Separate loopback-only orcad on port 17669, temporary profile and Git repository.
- Terminal workload: 5000 numbered ASCII/CJK lines followed by a completion marker.
- Evidence directory: `/private/tmp/orca-harmony-real.vmce4F`.
  Runtime logs/profile contain ephemeral credentials; do not publish them.

## Observations

| Scenario | Observed result | What it does not establish |
| --- | --- | --- |
| Idle homepage | One main-process PSS sample: 151692 kB | No baseline comparison, ArkWeb child accounting, sustained growth or leak verdict |
| Real terminal input | Mobile `pwd` increased the real output cursor from 10 to 14 and returned the fixture path | No key-to-pixel latency distribution or IME coverage |
| Inactive-tab output | 5000 lines completed; switching to that tab displayed lines 4988–4999 and the completion marker | No proof all scrollback lines are retained, active streaming FPS or per-frame timing |
| Repeat desktop input while mobile owns terminal | Rejected with `accepted: false`; existing mobile input-authority contract explains this | Not evidence of a stalled PTY or slow renderer; do not bypass ownership to make a benchmark pass |
| Server restart | Mobile reconnected to the same temporary profile and showed newly created terminals | No packet-loss, relay handoff or long-disconnection measurement |

The load script writes no files and starts no external processes beyond a bounded
shell loop. Its newline bytes pass through the real PTY; unlike the older mock,
it does not model raw LF-only terminal stream output.

## Required next measurements

1. Run the fixed load through the actual mobile-owned input path while visible.
   Observe final marker, subsequent input, scrollback and tab switching.
2. Repeat a defined terminal → files → back cycle with before/after main and
   ArkWeb process PSS/CPU samples, then a background idle interval.
3. Measure cold launch, key-to-pixel latency and sustained output with device
   instrumentation, separating host command latency from UI latency.
4. Repeat large source/Markdown/image workloads with font scaling and rotation.
5. Compare exact final HAP and Hermes sizes to a documented baseline and repeat
   the meaningful measurements on physical hardware.

## Offline package-size investigation

Before font deduplication, the retained debug HAP is 74582915 bytes with SHA-256
`d3771739ea23bce5aa0ca321fdd0c7465285c18cbbc10622e4aae972ee28a94e`.
Its Hermes payload is 20601487 bytes. The complete Meslo WOFF2 base64 is already
inside that payload, while a second raw WOFF2 entry occupies 1054196 bytes.
Moving the build-time WOFF2 outside rawfile resources must preserve that embedded
payload, the native TTF registration and license texts.

The next offline debug build succeeded in 22.340 seconds and measured 73547376
bytes: a net reduction of 1035539 bytes (1.39%). Archive inspection confirms the
raw WOFF2 entry is absent. Hermes, native TTF and all three license files compare
byte-for-byte equal to the retained baseline, and HBC still contains the complete
Meslo base64. Native storage code also changed during this build, so the net
delta is not an isolated font-only benchmark. This is not a runtime speed gain,
a final-source bundle, or a device-tested/release-approved artifact.

Further device measurements are currently paused while investigating preserved
host credentials becoming unreadable after a test-module installation/removal.
Do not replace those credentials or clear storage to unblock a benchmark.
