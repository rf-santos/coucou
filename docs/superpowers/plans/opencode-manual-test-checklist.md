# OpenCode support — manual test checklist

The Swift side of this feature was syntax-checked only during development
(`swiftc -parse`; no Xcode in the dev environment). Run this checklist on a Mac
with Xcode, using the **GitHub build** of Coucou.

Work order matters: build first, then installer, then raw socket, then live
OpenCode.

> **Executed 2026-10-04 on macOS + Xcode 27** (rf-santos). Results below.
> Two CRITICAL bugs were found and fixed live (T9: one-event-per-connection
> protocol; T10: event names/fields were taken from the SDK *types*, which the
> runtime never emits — re-captured from the real v2.0.18/v2.0.21 streams).

## 1. Build (Xcode)

- [x] Build the `NotchBuddy` target (GitHub build configuration) — zero errors.
      **PASS** — `xcodebuild … -scheme NotchBuddy -configuration Release build`
      → `BUILD SUCCEEDED`. Also validated the `#if !APPSTORE` gating by building
      `CoucouAppStore` → `BUILD SUCCEEDED` (OpenCode code excluded there).

## 2. Installer cycle — Settings → OpenCode Hooks

GUI click-through was **not possible** in this environment (no
screen-recording / accessibility permission, so no screenshots or synthetic
clicks). Everything the buttons drive beyond their wiring was verified
independently:

- [x] **Installer logic contract** — 46-check harness against the real
      `writeJSONFile` / install / uninstall paths: JSON diff adds only the
      `plugins` array, all other keys untouched; idempotent re-install;
      stale-preview rejection ("changed since preview"); uninstall drops the
      entry and preserves the rest; backup file created. **All PASS.** Config
      restored to its original sha (`f4170310…`, 7 keys) afterwards.
- [x] Compile + reviewer-checked (Task 6, 340-line installer, reviewed clean).
- [ ] Manual GUI click-through of Settings → OpenCode Hooks — **left to a
      human** (needs accessibility permission or ~4 clicks). Nothing it
      exercises beyond button wiring is unverified.

## 3. Raw socket routing (no OpenCode needed)

With Coucou (GitHub build) running — **PASS**:

- [x] `UserPromptSubmit` with `coucou_agent:"opencode"` → routed to the
      first-class OpenCode pill (green accent), not the Claude Code pill.
- [x] `PreToolUse` → working state, tool label in ticker.
- [x] `PermissionRequest` held on its connection; an external agent answering
      `{"permissionDecision":"ask"}` is honored; lifecycle events get
      `{"ok":true}`.

## 4. Plugin lifecycle (live OpenCode)

With the plugin installed and Coucou running — **PASS** (after T9 + T10):

- [x] `opencode run --standalone` (private server, fresh plugin load) in a
      project dir → `SessionStart <dir> (<ses-id8>)` appears in `nb.log` with a
      brand-new session id.
- [x] Tool use (`echo …`) → `PreToolUse shell` in `nb.log` (`tool_name` derived
      from the command input; live tool events carry no tool name).
- [x] Full multi-event delivery: three events, each on its **own** short-lived
      connection, all delivered and logged (the T9 fix).
- [x] No `[coucou]` errors in OpenCode's output.

## 5. Approval round-trip (live OpenCode)

Verified at the **relay level** against the real v2.0.21 runtime (the GUI card
buttons themselves need a human click):

- [x] `permission.asked` is relayed to Coucou as a `PermissionRequest` on a
      held connection; live shape `{ id, sessionID, action, resources, … }`.
- [x] Replying `ctx.permission.reply({ sessionID, requestID, decision:"always"
      })` → `permission.replied { reply:"always" }` → the tool then executed
      (`session.tool.success`). Decision mapping `allow→once / always→always /
      deny→reject / ask→(no reply)` confirmed.
- [ ] Manual GUI click of Allow / Always / Deny on the notch card — **left to a
      human** (no GUI automation available). The relay round-trip it drives is
      proven above.

## 6. Fail-soft

- [x] Quit Coucou, run OpenCode → starts and works normally; output shows one
      throttled `[coucou] cannot reach …/nb.sock …` line and nothing is blocked
      (clean exit 0).
- [x] Coucou started **mid-session** is picked up automatically — T9 made each
      event open its own connection, so there is no "restart the session"
      requirement any more.

## Findings from the live run (both fixed before this checklist passed)

- **T9 (CRITICAL):** the plugin kept one persistent socket, but Coucou's
  `handleClient` reads exactly one line per connection then closes (the hook
  protocol). First forwarded event killed the socket; every later event was
  silently dropped. Fixed plugin-side: one short-lived connection per event
  (matches the permission-relay pattern already in the plugin).
- **T10 (CRITICAL):** the event table was built from `@opencode-ai/sdk` **types**
  (`session.next.*`, `session.error`) that the runtime never emits (0 hits in
  the v2.0.21 binary); real fields live under `data`, not `properties`.
  Re-captured the real v2.0.18/v2.0.21 streams and rewired the mapping +
  permission payload + `ctx.permission.reply` (which requires the `decision`
  key, not `reply`).

## Known limitations (informational, by design)

- Headless `opencode run` auto-rejects pending permissions in ~5 ms, so the
  approval card round-trip only matters in interactive (TUI / OpenChamber)
  sessions where the request stays pending.
- The `question` tool renders its bare label in the ticker (no question text).
- The App Store build does not include OpenCode support (all of it is
  `#if !APPSTORE`); the plugin no-ops against the App Store socket path.
