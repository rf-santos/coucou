// opencode-coucou — OpenCode V2 plugin bridging session events to the Coucou
// notch app. Plain plugin object (no @opencode/plugin import) so it loads
// anywhere node can, matching the bundled ponytail plugin pattern.
import os from "node:os";
import path from "node:path";
import { connectSocket, sendEvent, sendPermissionRequest } from "./src/socket.ts";
import { mapEvent, type CanonicalEvent } from "./src/mapping.ts";
import { buildPermissionPayload, decisionToReply } from "./src/permission.ts";

// GitHub build of Coucou (NotchBuddy.swift, non-sandboxed branch).
// COUCOU_SOCKET_PATH override exists for tests (mock Coucou server).
const SOCKET_PATH =
  process.env.COUCOU_SOCKET_PATH ??
  path.join(os.homedir(), "Library/Application Support/NotchBuddy/nb.sock");

// Coucou's hook protocol is one event per connection: the server reads a
// single line, processes it, replies {"ok":true} and closes. (Same as
// Claude Code hooks.) Each lifecycle event therefore gets a short-lived
// connection; permission relays use their own held-open connection
// (sendPermissionRequest). Never throws — a dead Coucou drops the event.
let lastConnectFailLog = 0;

async function forwardEvent(
  mapped: CanonicalEvent,
  cwd: string | undefined,
): Promise<void> {
  let sock: import("node:net").Socket;
  try {
    sock = await connectSocket(SOCKET_PATH);
  } catch (err) {
    const now = Date.now();
    if (now - lastConnectFailLog >= 10_000) {
      lastConnectFailLog = now;
      console.error(
        `[coucou] cannot reach ${SOCKET_PATH}: ${
          err instanceof Error ? err.message : err
        }; event dropped`,
      );
    }
    return;
  }
  try {
    sendEvent(sock, { ...mapped, coucou_agent: "opencode", cwd });
    sock.end(); // flush the buffered line, then half-close; Coucou closes its end
  } catch (err) {
    console.error(
      `[coucou] forward failed: ${err instanceof Error ? err.message : err}`,
    );
    sock.destroy();
  }
}

// Double-load guard: the installer writes this plugin into the auto-discovered
// global-plugins dir AND references it from the `plugins` config entry. If the
// runtime initialises it via both paths, `setup` must not subscribe a second
// time (that would forward every event twice). A module-level flag makes a
// second `setup` on the same module instance a no-op.
let started = false;

// Minimal structural view of the V2 plugin ctx we actually use — no
// @opencode/plugin import. Fields are read defensively: a ctx that lacks
// them (or a ctx that isn't an object at all) simply disables forwarding.
type Ctx = {
  event?: {
    subscribe?: (opts: { signal?: AbortSignal }) => AsyncIterable<unknown>;
  };
  location?: { directory?: unknown };
  permission?: {
    reply?: (req: {
      sessionID: string;
      requestID: string;
      decision: string;
    }) => Promise<unknown>;
  };
};

export default {
  id: "coucou",
  async setup(_ctx: unknown) {
    if (started) return () => {}; // already initialised — do not subscribe twice
    const ctx = typeof _ctx === "object" && _ctx !== null ? (_ctx as Ctx) : {};
    started = true; // committed; further setup() calls no-op

    // Subscribe once, forward every mapped event. Each event goes out on its
    // own short-lived connection (see forwardEvent) — Coucou closes every
    // connection after a single event, so no persistent socket is kept.
    // A mapping miss or a connect failure is logged and dropped — never
    // thrown back at the OpenCode runtime.
    const controller = new AbortController();
    const subscribe = ctx.event?.subscribe;
    if (typeof subscribe === "function") {
      const cwd =
        typeof ctx.location?.directory === "string"
          ? ctx.location.directory
          : undefined;

      // Fire-and-forget permission relay (Task 3): forward to Coucou on a
      // held connection, then ctx.permission.reply. Not awaited in the loop —
      // a decision can take up to ~110 s and must not stall event forwarding.
      // Every failure is logged and dropped, never thrown at the runtime.
      let warnedNoReply = false;
      const relayPermission = (properties: unknown) => {
        void (async () => {
          try {
            const payload = buildPermissionPayload(properties, cwd);
            if (!payload) return;
            const requestID =
              typeof properties === "object" && properties !== null
                ? (properties as { id?: unknown }).id
                : undefined;
            if (typeof requestID !== "string") return;
            const decision = await sendPermissionRequest(SOCKET_PATH, payload);
            const reply = decisionToReply(decision);
            if (!reply) return; // "ask" → let OpenCode re-ask in its terminal
            const replyFn = ctx.permission?.reply;
            if (typeof replyFn !== "function") {
              // Feature-detect: no reply surface → decisions are dropped.
              if (!warnedNoReply) {
                warnedNoReply = true;
                console.error(
                  "[coucou] ctx.permission.reply unavailable; permission decisions dropped",
                );
              }
              return;
            }
            // Live v2.0.21 signature (schema-verified against the real
            // runtime, 2026-10-04): reply({ sessionID, requestID, decision })
            // — all three keys are required; decision is once|always|reject.
            await replyFn({ sessionID: payload.session_id, requestID, decision: reply });
          } catch (err) {
            console.error(
              `[coucou] permission relay failed: ${err instanceof Error ? err.message : err}`,
            );
          }
        })();
      };

      void (async () => {
        try {
          for await (const event of subscribe({ signal: controller.signal })) {
            // Permission requests take the relay path; lifecycle events go
            // through mapEvent (which stays permission-free by contract).
            const e =
              typeof event === "object" && event !== null
                ? (event as {
                    type?: unknown;
                    properties?: unknown;
                    data?: unknown;
                  })
                : {};
            if (e.type === "permission.asked") {
              relayPermission(e.data ?? e.properties);
              continue;
            }
            let mapped: CanonicalEvent | null = null;
            try {
              mapped = mapEvent(event);
            } catch (err) {
              console.error(
                `[coucou] dropped event: ${err instanceof Error ? err.message : err}`,
              );
              continue;
            }
            if (!mapped) continue;
            void forwardEvent(mapped, cwd);
          }
        } catch (err) {
          if ((err as Error)?.name !== "AbortError")
            console.error(
              `[coucou] event stream ended: ${err instanceof Error ? err.message : err}`,
            );
        }
      })();
    }
    return () => controller.abort();
  },
};
