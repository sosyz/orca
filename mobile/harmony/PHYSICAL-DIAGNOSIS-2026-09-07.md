# Physical terminal blank-screen diagnosis

Unresolved intermittent failure; navigation recovered the visible terminal, not
a verified permanent fix. Initial diagnosis made no production changes. A scoped
Harmony foreground-recovery correction is now under test; it has not yet been
installed on the physical device. The earlier approved replacement installation
described below used the pre-correction signed debug candidate.

## Observed evidence

- Target: user-supplied wireless HDC device, model VDE-AL00.
- Installed bundle: `ai.stably.orca.harmony`, version 0.0.47 / code 47;
  update timestamp `2026-09-02T08:08:56.272Z`. This predates the final simulator
  candidate; the current source cannot be assumed identical to the device build.
- At the reproduced failure PID 49258 remained live. Earlier snapshots captured
  the lock screen, so they did not establish the terminal's visible state.
- After unlocking, selected `leapOrg` in the `main` workspace showed a green
  connection indicator and seven loaded tabs, but the terminal surface was blank.
- Home subsequently showed the affected host connected through Direct/LAN and
  populated workspaces. The diagnostic page initially showed connecting, later
  connected; cumulative events included authenticated, WebSocket closed (code 0),
  retry, and successful reauthentication. Relative event times span older runs;
  they are not sufficient to time-correlate the original blank screen.
- Returning from diagnostics through Home/Resume to the same terminal restored
  its output. No application restart, pairing change, explicit reconnect action,
  or terminal input was performed.
- PID-scoped nonblocking HiLog read returned zero records. An initial attempt
  combining `-x` and `-z` was rejected by this device and was corrected; that
  command error is not application evidence.

Private screenshots/layouts are under `/private/tmp/orca-harmony-real.vmce4F`,
with `physical-missing`, `physical-diagnostics`, `physical-diagnostics-tail`,
and `physical-after-resume` prefixes. They may contain user session content and
must not be published unreviewed.

## Interpretation and limits

The observed recovery points toward terminal subscription/surface restoration
after lifecycle or connection changes. It does not distinguish failed stream
replay from lost WebView state, nor rule out an earlier transport interruption.
Input acceptance was not tested against the user's live agent terminal.

Current-source review identified a candidate interval between publishing
`connected` and receiving the terminal subscription/input lease acknowledgment.
That is a hypothesis, not a confirmed cause on this older installed build.

At the user's request, `power-shell timeout -o 1800000` temporarily overrides
screen-off time to 30 minutes, preserving the system setting. Restore with
`power-shell timeout -r` when physical debugging ends. Password and lock-screen
security settings were not changed.

## Approved replacement and current-build reproduction

- `hdc install -r` succeeded for the signed debug HAP SHA-256
  `29ee55f311150657912ce82a692e3f92e603f887448438465fb20064a7b46291`.
  No uninstall or re-pair was performed. Original install time stayed
  `1788192360500`; update time became `1788793690543`.
- New PID 64784 launched; both pre-existing hosts automatically connected, with
  the affected host listing 16 workspaces. Credential retention passed this
  replacement check.
- Opening the original agent terminal still produced the green-indicator blank
  surface (`physical-upgraded-terminal.png`). Therefore the newer build alone
  does not fix the failure.
- Switching to an adjacent ordinary terminal displayed its output, and switching
  back restored the original terminal (`physical-after-switch.png`,
  `physical-return-tab.png`). No input was sent by the agent.
- A 20-second, maximum-5-MB PID-filtered capture completed and stopped normally
  (`physical-switch-window.log`, about 408 KB). It included an earlier buffered
  JS event at device time 23:09:38.704:
  `[fit]measure-fail { notReady: true, cellWidth: 0, cellHeight: 0, retriesLeft: 0 }`.
  This points to incomplete terminal initialization at measurement, but does not
  establish that measurement failure itself caused the blank surface.
- Repeated native ECONNREFUSED records have not been correlated to the affected
  host socket; they may concern a debug connection. They are not accepted as the
  cause without endpoint/channel attribution.

## Live input failure after output recovery

- The user reports that the keyboard opens normally and typed text appears in
  the phone's live-input field, but not in the remote terminal.
- A read-only layout capture confirms an enabled, focused native TextInput with
  three characters. No test bytes, Enter, or control keys were sent to the user's
  terminal; input contents are intentionally omitted from this report.
- PID 64784 remains live. The bounded PID log and recent desktop trace contain
  no usable terminal-send outcome evidence, so RPC rejection versus missing
  output cannot yet be distinguished.
- The current route reduces failed sends to `false` without visible feedback.
  Its mirror state advances before acknowledgement, and the send queue continues
  after failure. Existing focused tests pass (35 tests), but do not establish
  safe mirror recovery after a rejection while connection state stays connected.
- This is a code-level failure-handling risk, not proof of the physical cause.
  Recovery must not automatically replay unacknowledged text or submit a command.
- The user reports iOS works normally in comparison. Prioritize Harmony-specific
  restoration before attributing the failure to the host or network.
- An isolated hook harness (two passing tests, removed after execution) confirmed
  that a rejected initial send with `connected` unchanged still allows subsequent
  mirror deltas and a later Enter. No real terminal was used. This establishes a
  shared failure-handling risk, not a platform-specific root cause.
- Platform comparison found iOS probes its mounted document on foreground;
  Harmony selected `replay-mounted-document`, but its imperative foreground
  preparation did not invalidate document readiness. The existing bridge recovery
  timer also skips a document whose old ready latch is still true. A scoped
  Harmony surface-recovery correction is under implementation; device acceptance
  remains pending.

## Recovery candidate rejected by simulator E2E

- Built and preserve-data installed debug HAP SHA-256
  `79eb7ff945616364d4e241878d8f01ab09e1e39f98ff2efec192f6d4e44acc4d`
  on the isolated simulator only. Build, Harmony typecheck, and the terminal
  test suite passed (565 tests); these do not establish device correctness.
- Existing pairing connected and the fixture terminal initially showed a prompt.
  After Home/background and foreground, the terminal became blank. Typing `pwd`
  through UITest into the isolated live-input field produced no terminal echo
  and the new rejection toast. Enter was not sent.
- The on-device connection log reports `rpc-input-lease-missing`, corresponding
  to the host's `mobile_input_floor_unavailable` response. The rejection occurred
  about 67 seconds after the recorded foreground event, not just during the
  immediate resubscribe window. Authentication and connection stayed available.
- This candidate is not accepted and was not installed on the physical device.
  Investigating whether imperative-ref updates incorrectly release the terminal
  subscription while the same WebView document stays mounted. React's installed
  renderer confirms dependency updates invoke the old callback ref with null;
  the route currently interprets null as teardown.
- Private evidence: `foreground-sim-terminal.png`, `foreground-sim-resumed.json`,
  `foreground-sim-typed.png`, and `foreground-sim-diagnostics.json`. Screenshots
  may contain system clipboard suggestions and must not be published unreviewed.

## Stable imperative-handle correction and simulator verification

- Ordinary handle-property updates previously invoked the callback ref with null,
  releasing the session subscription even though the WebView document remained
  mounted. Reattaching the handle did not produce another document-ready event.
- Keep the imperative handle stable across property updates; its methods read
  options updated in a layout effect, so they use the latest committed values.
  Actual unmount still releases registration. Transport, session subscription,
  and WebView document readiness retain their separate ownership; input does not
  reconnect or replay rejected/unknown sends.
- Built debug HAP SHA-256
  `9ba9b43a512c319cbff069e5371a56b064ca9bed7635d2977d46ccaddb501855`
  and preserve-data installed it on the isolated simulator. After Home/background
  and foreground, typing `pwd` appeared in both the live-input field and terminal.
  Pressing Enter returned `/private/tmp/orca-harmony-real.vmce4F/fixture` and a new
  prompt. This validates that narrow path, not exhaustive stability or the phone.
- Root verification: 57 terminal/session test files, 568 tests passed; Harmony
  typecheck and HAP build passed. Agent verification including the pane lifecycle
  suite: 58 files, 571 tests passed.
- Private evidence: `ref-sim-typed.png` and `ref-sim-executed.png`. Do not publish
  unreviewed screenshots containing system clipboard suggestions.
- Physical installation and acceptance remain pending to preserve the user's
  current unsubmitted input. Independent review also identified possible stale
  route-readiness and asynchronous viewport-refit subscription races; these are
  follow-up hypotheses, not established causes of the reproduced failure. The
  shared optimistic-mirror rejection risk described above remains unresolved.

## Physical installation and input latency follow-up

- Preserve-data installation of `9ba9b43a...501855` succeeded on the physical
  device and EntryAbility started successfully. No agent test input was sent to
  the user's remote session.
- The user now reports single English letters do echo, but feel several hundred
  milliseconds late. They have not yet compared the desktop terminal with the
  phone display, so send latency and mobile rendering latency remain distinct
  possibilities.
- Five ICMP probes from the phone to the supplied desktop address had zero packet
  loss and 6/10/22 ms minimum/average/maximum RTT. This is only an ICMP baseline,
  not a measurement of the active RPC route, host processing, or display latency.
- A bounded recent PID 13119 log sample had no request-timeout, connect-wait,
  input-lease-missing, or measurement-failure markers. The sample has no per-input
  timing and cannot establish a latency cause.
- The installed bundle uses production/minified optimized Hermes bytecode.
  Shared live-input pending sends already batch queued deltas; the output
  coalescer delivers the first idle chunk immediately and bounds its trailing
  window to 48 ms. Neither finding proves actual device scheduling latency.
- On comparison the user reports both desktop and upper mobile terminal echo
  immediately; the remaining complaint concerns display after keyboard input.
  The lower live-input preview is a React Text view backed by route-owned capture
  state; its actual native TextInput is transparent and 1 by 1. Every capture
  update therefore re-renders the session route just to refresh that preview.
  Localizing this UI state is a scoped performance correction, not measured proof
  that it accounts for the entire perceived delay.

## Local live-input rendering isolation candidate

- `MobileTerminalLiveInputBar` now owns capture text and preview rendering. The
  session route retains its existing mirror/flush/focus hooks and forwards their
  capture setter to a stable component handle. Layout, raw input events, and
  transport behavior are unchanged.
- Component tests verify repeated input does not increase the parent render
  count, raw text is preserved, terminal switches clear the capture, submit
  clears it, and unmount releases the native input ref. Root verification passed
  58 test files / 573 tests and Harmony typecheck; agent mobile typecheck and
  scoped lint/format checks passed.
- Debug HAP SHA-256
  `fff692d94d409c8034710d5a88a246cb22bb543789c6728b3e82ac586a675580`
  built successfully and was preserve-data installed only on the simulator.
- The isolated runtime had stopped. It was restarted with the same private
  profile on loopback port 17669; the existing reverse forward remained present.
  After simulator-app restart, pairing reconnected without replacement.
- UITest input `pwd` appeared in the lower preview; accessory Enter cleared it.
  The upper terminal stayed blank, including subsequent recovery/switch checks.
  No successful command output was observed, so this is not an E2E pass or a
  measured latency improvement. Do not install this candidate on the phone as a
  fully accepted fix. Private evidence: `input-local-typed.png`,
  `input-local-submitted.png`, `input-local-foreground.png`, `input-local-switch.png`.
- After the simulator limitation was disclosed, the user explicitly requested
  physical installation. Preserve-data installation of the same `fff692d9...675580`
  candidate succeeded on the phone and EntryAbility started successfully. No
  agent input was sent to the user's terminal. Physical latency/display acceptance
  is still pending; installation success does not establish a fix.
