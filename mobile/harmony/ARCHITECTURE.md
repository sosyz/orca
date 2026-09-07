# Mobile client architecture

## Shared application, platform-owned resources

iOS and Android use the same Expo application in `mobile/app` and `mobile/src`.
Their native projects are generated from `mobile/app.json` and config plugins;
the checked-in Swift/Kotlin extension is `mobile/packages/expo-two-way-audio`.
Harmony boots that same application through RNOH. It does not own a second set
of product screens, host connections, or session business rules.

```text
Shared screens and controllers — mobile/app, mobile/src
  ├─ navigation API → Expo Router (iOS/Android) / Harmony router
  ├─ native API     → Expo modules (iOS/Android) / Harmony compat → ArkTS services
  └─ host API       → RpcClientProvider → logical client → direct/relay session
                                                     → paired Orca execution host
```

The Harmony Metro aliases form a narrow compatibility boundary. Only APIs used
by the shared application belong there. They adapt native results and errors;
they must not duplicate pairing, reconnect, notification delivery, or dictation
business state. Unsupported operations must not claim successful work.

### Route and dependency inventory

The current application has 27 screen routes (15 root, 12 host-scoped), plus root
and host layouts. `harmony-route-registry.tsx` imports these same screen components;
`HarmonyApp.tsx` mounts the shared root layout below the Harmony router and
safe-area provider. `harmony-route-registry-contract.test.ts` enumerates every
actual Expo screen and verifies the registered component and decoded host/workspace
parameters, rather than checking a second manually maintained expected list.

`harmony-runtime-dependency-contract.test.ts` traverses shared runtime imports and
checks that Expo API imports have compatibility aliases and native packages are
declared. Together with navigation behavior tests, the current three-file gate
passes 26 tests. These checks establish entrypoint and dependency coverage only:
they do not execute native permissions, rendering, device layout or host actions.

The secondary product domains also remain shared, not native Harmony facades:

| Domain | Shared entry and execution boundary | Remaining proof |
| --- | --- | --- |
| Tasks/accounts | Host Tasks gates on `status.get`; Accounts subscribes to `accounts.subscribe`, falls back to `accounts.list`, and dispatches provider-specific selection RPCs | Device actions, unsupported-host/error UI and external-link failure feedback |
| Git/agent history | History routes to source control and `git.history`/`git.commitCompare`; agent history gates on `aiVault.v1` before list/resume preparation | Device navigation/resume; explicit commit-file load failures |
| Browser | Session gates on `browser.screencast.v1`; shared image/touch UI subscribes to host screencast and sends browser commands | Cross-host display isolation and device rendering/input/performance |

Browser rendering already coalesces frames at a 100 ms minimum interval, keeps a
four-entry frame LRU, and decodes through two image layers. Backgrounding stops the
subscription. These source invariants are not measured FPS or memory guarantees.
The follow-up account/browser/history and capability regressions passed 103 tests
across 17 files. Subsequent browser isolation and history error-state changes also
passed independent focused reviews and the 535-file/4241-test mobile suite.

Browser frame identity now includes the paired host, workspace, page and view
mode in an unambiguous tuple; paired host is distinct from an execution-host ID.
Cache deletion matches host and workspace exactly. A keyed inner pane also
recreates native image references and pending work when host/workspace/page
changes, preventing a correct cache key from leaving an old visible image behind.
History commit-file errors retain any previous successful entries while exposing
an error and retry action; only a successful empty response means no changes.

`OrcaHarmony` is registered as a UI TurboModule. The installed RNOH worker setup
constructs worker/any-thread factories, not UI factories; listing the package in
both configurations is not evidence of a second worker-owned secure store.
Credential operations belong to the UI-side store. Keep durable preference
updates and legacy migration serialized there, and fail closed on uncertain
persistence or a missing key for retained ciphertext. A replacement alias must
never be generated merely because reading an existing pairing failed.

Harmony's entrypoint installs `react-native-url-polyfill/auto` before application
imports. Expo performs URL initialization for iOS/Android; RNOH's built-in subset
does not provide the WebSocket URL parsing and URL setters used by the shared
direct/relay code. Keep this at the bootstrap boundary, not in each transport
consumer. The dependency preserves React Native Blob URLs; Unicode hostnames are
outside its supported subset. URL regressions execute the installed RNOH and
polyfill implementations, not Node's URL as a substitute.

## Ownership and performance invariants

| Concern              | Owner and invariant                                                                                                                                                              |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Host connections     | `RpcClientProvider` owns one logical client per host. Route changes acquire/release demand, not independent sockets.                                                             |
| Connection migration | The shared endpoint supervisor owns direct/relay recovery, background grace, credential rotation, and subscription restoration. Native networking only supplies OS observations. |
| Credentials          | The shared host store owns identity, caching, and mutation order. Expo SecureStore or Harmony HUKS owns protected storage; native clients never use the web credential fallback. |
| Terminal output      | The shared stream and write coalescer preserve snapshot/ack ordering and the 48 ms batching window. The rendering platform owns WebView creation and recovery.                   |
| Large documents      | Shared highlighting budgets, virtualized diff rows, and memoized rendering apply on every platform.                                                                              |
| Dictation            | The shared hook owns the desktop dictation ID, upload budget, cancellation, and transcript delivery. The native service owns capturer allocation, interruption, and release.     |
| Notifications        | Shared delivery owns deduplication, catch-up watermarks, and route targets. Native services own permission, publication, cancellation, and tap events.                           |
| Layout               | Shared responsive metrics own phone/tablet/foldable layout. Native safe-area and orientation adapters supply window facts and honor rotation lock.                               |

## Refactoring decisions

1. Keep shared screens and existing Expo call sites. Do not introduce a second
   application framework or a global bag of platform flags.
2. Make Harmony navigation history the authoritative source for route identity,
   rendered content, and the navigation state observed by shared controllers.
   Keep shared host-stack transition coordination compatible with Expo.
3. Separate native observation from recovery policy. Late native async results
   must not overwrite newer lifecycle or network events.
4. Keep platform rendering policy within its domain. Harmony-specific terminal
   bridge recovery must not spread through unrelated shared UI controllers.
5. Preserve measured device workarounds: inactive Harmony ArkWeb surfaces are
   not mounted, and Harmony terminal WebGL remains disabled. Changing either
   requires device evidence, not an assumption that iOS behavior transfers.
6. Keep the existing SDK compatibility floor, persistent credential formats,
   and client/host wire protocol. A disconnected mobile client is not evidence
   that remote execution has stopped; folder workspaces remain supported.

### Navigation retention tradeoff

Harmony currently renders the active route only. Back restores its history entry
but reconstructs the screen; it does not retain all local React state like an Expo
native stack. Keep root and host layouts stable, and give distinct screen entries
distinct identities so switching workspaces cannot reuse the previous workspace's
drafts or pending local operations. Query-only updates should not remount a screen.

Retaining multiple routed React trees would require a separate focus/visibility
contract for every terminal, subscription, and native resource. It is not safe to
implement by hiding whole screens while leaving ArkWeb instances active.

Native-chat drafts, local image previews, pending outcomes and launch seeds live
in an in-memory owner keyed by host/workspace/tab, with session-specific pending
lists. Reconstructing a route reuses this data without retaining its React tree,
ArkWeb surface or stream subscription. Generation tokens reject late writes after
eviction or successful tab/host removal. Connection loss is not a purge event.

The owner targets 32 scopes, evicting inactive entries only; concurrently active
scopes may temporarily exceed the cap. Coalesced cleanup runs after effect handoff
so StrictMode and route switching cannot evict the scope being reacquired. Timer
and listener cleanup follows scope lifetime. This is bounded session continuity,
not durable prompt storage or a claim that total source size decreased.

### Terminal rendering policy

`mobile/src/terminal/terminal-webview-platform-policy.ts` owns these differences;
it does not own stream subscriptions or introduce another terminal state machine.

| Behavior                          | iOS                   | Android                 | Harmony                           |
| --------------------------------- | --------------------- | ----------------------- | --------------------------------- |
| Inactive or covered pane          | Retain hidden WebView | Retain hidden WebView   | Unmount ArkWeb surface            |
| Initial bridge readiness          | Direct                | Direct                  | Native acknowledgment gate        |
| Terminal WebGL                    | Enabled               | Enabled                 | Disabled                          |
| Reload                            | Native reload         | Native reload           | Remount surface                   |
| Foreground document recovery      | Probe before replay   | Existing ready document | Invalidate and remount surface    |
| Missing-bridge automatic recovery | None                  | None                    | Once while foreground and visible |

The shared 15-second ready watchdog remains separate from Harmony's 5-second
missing-bridge retry. Backgrounding cancels that retry timer without spending its
attempt; foregrounding starts a new wait. An explicit reload resets the allowance.
Snapshot ordering, pending writes, and readiness acknowledgments remain owned by
the existing terminal lifecycle rather than a new platform-specific stream layer.
WebView registration uses the existing session refs and stream owner. Detaching a
surface cancels its rendering subscription even before the first snapshot arrives,
but preserves a native-chat input-only lease. Reattaching registers the ref; only
the subsequent web-ready event can start a new rendering subscription.

Transport owns authentication and subscription replay; the session owns which
terminal is subscribed; the WebView owns only its document and bridge readiness.
The imperative handle represents the component lifetime, not a snapshot of its
theme, font scale, or callback props. Updating those props must not detach that
handle or release the session's subscription. A native surface replacement has a
new document generation, not a new transport owner. Harmony re-registers its
foreground subscription without a delayed gap, reusing the transport's replay
and the route's document-readiness gate. Input never recreates a subscription or
replays unacknowledged bytes as an implicit recovery action.

Live-input capture text belongs to the input bar, not the session route. The bar
owns the native field's controlled value and visible preview; existing session
hooks still own mirror deltas, send ordering, and clearing on terminal changes.
A stable capture setter lets those hooks update the bar without re-rendering the
terminal and the rest of the session on every keystroke. No connection state or
transport recovery belongs in this UI boundary.

### Microphone startup ownership

The native microphone is process-scoped, while a session screen's generation is
local to that hook instance. A shared owner identity therefore guards native
initialization, recording start/stop, audio-data delivery and teardown. Neither
late initialization nor old-screen unmount can operate on a newer owner's
recorder. Current startup failures restore a retryable state and preserve the
error for the existing caller; stale failures do not report over a replacement
session. Desktop dictation IDs, cancellation and protocol stay with the existing
shared hook rather than a second state machine.

### Usable capability fallbacks

A no-op gesture adapter is not feature parity. Where the installed Harmony gesture
runtime cannot perform an interaction, provide an explicit usable control at that
component boundary. Shortcut ordering can use move-up/down controls while the
iOS/Android implementation retains drag-and-drop. Both commit the same ordered keys
through the shared settings persistence code.

## Change validation

Review cross-platform ownership before changing navigation, native lifecycle, or
rendering. Each slice needs behavior-level regression evidence and independent
review before integration; file movement alone is not a result.

Run targeted tests for each slice, then shared mobile tests, both mobile and
Harmony typechecks, root typecheck, changed-code quality, native lint, Hermes
bundling, and HAP compilation. These checks establish source/build compatibility,
not actual device performance.

Device acceptance must cover cold/warm pairing, host/session navigation and Back,
same-screen workspace switching, terminal/chat/file tabs, keyboard and rotation,
network handoff/resume, notifications, image selection, and microphone teardown.
Exercise iOS/Android regressions when shared code changes. Keep installed-device
results distinct from tests that execute ArkTS service logic with mocked OS APIs.
