// Mapping from OpenCode events to Coucou's canonical hook event shape.
// Event names/fields were captured live from the real v2.0.18 + v2.0.21
// event streams (2026-10-04) — see
// .superpowers/sdd/2026-10-02-coucou-opencode-support/opencode-event-shapes.md.
// mapEvent is pure (no ctx): unknown or malformed events return null; the
// caller drops them. `cwd` is not in the event — index.ts fills it from
// ctx.location.
export type CanonicalEvent = {
  hook_event_name: string;
  session_id: string;
  coucou_agent: "opencode";
  prompt?: string;
  tool_name?: string;
  tool_input?: object;
  message?: string;
  cwd?: string;
};

// Live-captured table: event.type → canonical hook_event_name.
// The SDK-type names (session.next.*, session.error) are never emitted by
// the runtime. session.created / session.idle exist in the runtime but have
// only been observed in interactive (TUI) sessions — kept as aliases.
const HOOK_NAMES: Record<string, string> = {
  "session.created": "SessionStart",
  "session.execution.started": "SessionStart",
  "session.inbox.enqueued": "UserPromptSubmit",
  "session.tool.called": "PreToolUse",
  "session.tool.success": "PostToolUse",
  "session.tool.failed": "PostToolUseFailure",
  "session.idle": "Stop",
  "session.execution.succeeded": "Stop",
  "session.execution.failed": "StopFailure",
  "session.deleted": "SessionEnd",
};

export function mapEvent(evt: unknown): CanonicalEvent | null {
  if (typeof evt !== "object" || evt === null) return null;
  const e = evt as {
    type?: unknown;
    properties?: unknown;
    data?: unknown;
    durable?: unknown;
  };
  const type = typeof e.type === "string" ? e.type : null;
  const hookName = type ? HOOK_NAMES[type] : undefined;
  if (!hookName) return null;

  // Live events carry fields under `data`; durable events also expose the
  // session under `durable.aggregateID`. `properties` (older SDK shape) is
  // kept as a fallback.
  const p =
    (typeof e.data === "object" && e.data) ||
    (typeof e.properties === "object" && e.properties) ||
    null;
  let session_id = p && typeof p.sessionID === "string" ? p.sessionID : null;
  if (!session_id && typeof e.durable === "object" && e.durable) {
    const aggregateID = (e.durable as { aggregateID?: unknown }).aggregateID;
    if (typeof aggregateID === "string") session_id = aggregateID;
  }
  if (!session_id) return null;

  const out: CanonicalEvent = {
    hook_event_name: hookName,
    session_id,
    coucou_agent: "opencode",
  };

  // Optional fields are omitted (not dropped) when mis-shaped — fail soft.
  if (hookName === "UserPromptSubmit") {
    // Live shape: data.item.payload.text (user message enqueued in inbox).
    const text = (p.item as { payload?: { text?: unknown } } | undefined)?.payload?.text;
    if (typeof text === "string") out.prompt = text;
  } else if (hookName === "PreToolUse") {
    // Live shape: the event carries no tool name; a `command` input is the
    // shell tool (confirmed via permission.asked action names).
    if (p.input && typeof p.input === "object") out.tool_input = p.input;
    if (typeof (p.input as { command?: unknown } | undefined)?.command === "string")
      out.tool_name = "shell";
  } else if (hookName === "PostToolUseFailure" || hookName === "StopFailure") {
    // Live session.tool.failed shape: error: { type, message }; string form
    // kept for safety. If a future shape slips past both, message is
    // omitted, not thrown.
    const err = p.error;
    const message =
      typeof err === "string"
        ? err
        : err && typeof err === "object"
          ? ((err as { message?: unknown }).message ??
             (err as { error?: { message?: unknown } }).error?.message)
          : undefined;
    if (typeof message === "string") out.message = message;
  }

  return out;
}
