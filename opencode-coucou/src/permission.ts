// Permission relay: OpenCode `permission.asked` event → Coucou
// `PermissionRequest` payload, and Coucou decision → ctx.permission.reply
// value. Contract:
// .superpowers/sdd/2026-10-02-coucou-opencode-support/opencode-event-shapes.md
// Both functions are pure (no ctx, no I/O) so they unit-test without a socket.
import type { PermissionDecision } from "./socket.ts";

// Payload Coucou's HookServer.swift processPermissionRequest expects.
export type CoucouPermissionPayload = {
  hook_event_name: "PermissionRequest";
  coucou_agent: "opencode";
  session_id: string;
  cwd?: string;
  tool_name: string;
  tool_input: object;
};

/**
 * Build the Coucou payload from a `permission.asked` event's `data`
 * (live v2.0.21 shape, captured 2026-10-04:
 * { id, sessionID, action, resources, save, source }).
 * Returns null (caller drops) for malformed data — never throws.
 */
export function buildPermissionPayload(
  data: unknown,
  cwd?: string,
): CoucouPermissionPayload | null {
  if (typeof data !== "object" || data === null) return null;
  const d = data as {
    sessionID?: unknown;
    action?: unknown;
    resources?: unknown;
  };
  if (typeof d.sessionID !== "string" || typeof d.action !== "string")
    return null;

  // Best-effort card context: the `shell` action carries the command as
  // resources[0] (that is what Coucou renders as the command line); other
  // actions get the raw resources list, or nothing (Coucou falls back to
  // tool_name).
  let tool_input: object = {};
  if (Array.isArray(d.resources)) {
    if (d.action === "shell" && typeof d.resources[0] === "string")
      tool_input = { command: d.resources[0] };
    else tool_input = { patterns: d.resources };
  }

  const out: CoucouPermissionPayload = {
    hook_event_name: "PermissionRequest",
    coucou_agent: "opencode",
    session_id: d.sessionID,
    tool_name: d.action,
    tool_input,
  };
  if (typeof cwd === "string") out.cwd = cwd;
  return out;
}

/**
 * Map Coucou's decision to the ctx.permission.reply value.
 * "ask" (timeout/displacement) → null: do NOT reply; OpenCode re-asks in its
 * own terminal.
 */
export function decisionToReply(
  decision: PermissionDecision | unknown,
): "once" | "always" | "reject" | null {
  if (decision === "allow") return "once";
  if (decision === "always") return "always";
  if (decision === "deny") return "reject";
  return null;
}
