# Harmony feature completion audit

This is an incomplete-work checklist, not an acceptance certificate.

| Requirement | Current evidence | Remaining acceptance |
| --- | --- | --- |
| Keep visited, open tabs mounted | Retained terminal, document, and browser surface hosts; unit coverage verifies retained terminal overlay cover/reveal without unmounting; the Harmony simulator showed the New Tab drawer above the retained terminal after the native-surface fix | Device A/B/A switching, scroll/zoom preservation, reconnect refresh, close/reopen and dirty-document conflict checks |
| Embedded terminal emoji | Bundled Noto COLRv1 native font and generated terminal WOFF2 payload | Verify actual selected font and color/ZWJ/keycap rendering on Harmony; inclusion alone is insufficient |
| Embedded native emoji | `Orca Emoji` applied to repository icons, review reactions, and emoji-only image placeholders; paths keep their original text font; focused tests pass | Verify actual color-font rendering on Harmony; preserve iOS/Android appearance |
| Internationalization | Language provider, system/en/zh preference, home/settings/pairing/browser catalogs; settings and preference/lifecycle coverage passed 47 focused tests; session reader/review-note/live-input coverage includes Chinese rendering | Other routes and task/chat surfaces require coverage audit and language-switch tests |
| Remote browser responsiveness | Bounded frame decoding and wheel queue; desktop wheel fast path with fallback; relay browser streams now replace and unsubscribe correctly, including early-cancel tombstones; the repository fixture loaded through a paired simulator browser tab | End-to-end click, outer/nested scrolling, fresh-frame input gate, tab return, reconnect, zoom and drag behavior; desktop build must include host changes to validate its fast path |

## Reusable browser fixture

Open `test-fixtures/browser-interaction.html` in a desktop Orca browser tab, then open that tab through the paired Harmony client. Do not substitute opening the HTML directly in the phone browser: that bypasses the remote streaming and input paths.

- Record the installed client artifact and desktop build before testing.
- Confirm a tap changes the visible click count once.
- Swipe the outer page and verify the page Y counter changes on both devices.
- Swipe inside the nested container and verify its Y counter changes independently.
- Switch away and back: cached pixels should remain, while page input waits for a fresh decoded frame.
- Verify text, slider and drag separately; a passing scroll test does not prove pointer dragging.
- Exercise disconnect/reconnect without resetting pairing or losing unsaved content.

## Current simulator evidence and limitation

On September 16, the signed HAP was installed on the existing Huawei_WideFold simulator without clearing data. The simulator paired over the LAN with the installed desktop Orca, preserved pairing across a later reinstall, opened the New Tab drawer above a retained terminal surface, created a browser tab, and rendered the repository fixture through the paired desktop host. This proves launch, preserved pairing, native-surface cover/reveal, remote tab creation, and remote frame presentation on that artifact.

Click and scrolling counters were not yet confirmed before the simulator disconnected from HDC. The Mac then locked, which prevented Computer from restoring the simulator. No reset, data deletion, re-pair, or SDK configuration change was performed. The fixture remains in this repository; the interaction checklist above is still required after the device reconnects.

The installed desktop app has not been replaced with a build from this working tree. Therefore, the modified desktop wheel fast path is covered by automated tests but not by the simulator session described above.

## Current automated gates

On September 16, the current worktree passed the full mobile suite (561 files, 4,353 passed and 3 skipped), mobile and Harmony TypeScript checks, all 98 Harmony release-script tests, and the changed-code quality gate with no new findings. Browser-focused coverage passed 16 mobile tests and 24 desktop bridge tests. These checks do not replace the remaining device interactions.

## Desktop fixture verification

On September 16, the repository fixture loaded in the installed Orca browser tab. A direct desktop click and nested scroll produced `页面 Y=0 · 内层 Y=242 · 点击=1`. This verifies the fixture's independent counters, not the Harmony remote input/streaming path or the modified desktop server implementation. The installed desktop app has not been replaced with this working tree's host changes.

## Remaining localization groups

The September 16 read-only coverage audit found untranslated UI beyond the completed leaf components:

- Host workspace lists, filters and new-workspace forms (implementation in progress).
- Session route shell, dialogs, toasts and quick commands.
- Source control, review and pull-request surfaces.
- Task list/details/provider configuration.
- File explorer/preview and agent-session history.
- Host accounts/edit, voice settings and connection diagnostics.

Browser localized rendering and language-switch stream continuity passed 8 focused tests together with frameless-stream coverage. This does not establish localization of the groups above.
