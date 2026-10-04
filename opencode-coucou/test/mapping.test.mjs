// test/mapping.test.mjs — pure mapEvent tests, no framework. Run: node test/mapping.test.mjs
// Table was captured live from the real v2.0.18 + v2.0.21 event streams
// (2026-10-04):
// .superpowers/sdd/2026-10-02-coucou-opencode-support/opencode-event-shapes.md
import assert from "node:assert/strict";
import { mapEvent } from "../src/mapping.ts";

// Live event shape: fields under `data`, optional durable aggregate.
const evt = (type, data, durable) => ({
  id: "evt_test",
  type,
  ...(data !== undefined ? { data } : {}),
  ...(durable ? { durable } : {}),
});

// session.execution.started → SessionStart (live shape: data.sessionID + durable)
assert.deepEqual(mapEvent(evt("session.execution.started", { sessionID: "s1" }, { aggregateID: "s1", seq: 2, version: 1 })), {
  hook_event_name: "SessionStart",
  session_id: "s1",
  coucou_agent: "opencode",
});

// session.created → SessionStart (TUI path, kept as alias)
assert.deepEqual(mapEvent(evt("session.created", { sessionID: "s1" })), {
  hook_event_name: "SessionStart",
  session_id: "s1",
  coucou_agent: "opencode",
});

// session.inbox.enqueued → UserPromptSubmit; data.item.payload.text → prompt
assert.deepEqual(
  mapEvent(
    evt("session.inbox.enqueued", {
      sessionID: "s1",
      inboxID: "m1",
      item: { type: "user", payload: { text: "hi", files: [] } },
    }),
  ),
  {
    hook_event_name: "UserPromptSubmit",
    session_id: "s1",
    coucou_agent: "opencode",
    prompt: "hi",
  },
);

// session.tool.called → PreToolUse; input → tool_input; a command input is
// the shell tool (live tool events carry no tool name field)
assert.deepEqual(
  mapEvent(evt("session.tool.called", { sessionID: "s1", id: "c1", input: { command: "ls", timeout: 15000 }, executed: false })),
  {
    hook_event_name: "PreToolUse",
    session_id: "s1",
    coucou_agent: "opencode",
    tool_name: "shell",
    tool_input: { command: "ls", timeout: 15000 },
  },
);
// Non-shell input → tool_input without tool_name
assert.deepEqual(mapEvent(evt("session.tool.called", { sessionID: "s1", id: "c1", input: { filePath: "/a" }, executed: false })), {
  hook_event_name: "PreToolUse",
  session_id: "s1",
  coucou_agent: "opencode",
  tool_input: { filePath: "/a" },
});

// session.tool.success → PostToolUse
assert.deepEqual(mapEvent(evt("session.tool.success", { sessionID: "s1", id: "c1", executed: true })), {
  hook_event_name: "PostToolUse",
  session_id: "s1",
  coucou_agent: "opencode",
});

// session.tool.failed → PostToolUseFailure; live shape error.message → message
assert.deepEqual(
  mapEvent(evt("session.tool.failed", { sessionID: "s1", id: "c1", error: { type: "permission.rejected", message: "boom" }, executed: false })),
  {
    hook_event_name: "PostToolUseFailure",
    session_id: "s1",
    coucou_agent: "opencode",
    message: "boom",
  },
);

// session.execution.succeeded → Stop
assert.deepEqual(mapEvent(evt("session.execution.succeeded", { sessionID: "s1" }, { aggregateID: "s1" })), {
  hook_event_name: "Stop",
  session_id: "s1",
  coucou_agent: "opencode",
});

// session.idle → Stop (TUI path, kept as alias)
assert.deepEqual(mapEvent(evt("session.idle", { sessionID: "s1" })), {
  hook_event_name: "Stop",
  session_id: "s1",
  coucou_agent: "opencode",
});

// session.execution.failed → StopFailure (string error)
assert.deepEqual(mapEvent(evt("session.execution.failed", { sessionID: "s1", error: "kaboom" })), {
  hook_event_name: "StopFailure",
  session_id: "s1",
  coucou_agent: "opencode",
  message: "kaboom",
});

// session.deleted → SessionEnd; durable.aggregateID fallback when data is absent
assert.deepEqual(mapEvent(evt("session.deleted", undefined, { aggregateID: "s9" })), {
  hook_event_name: "SessionEnd",
  session_id: "s9",
  coucou_agent: "opencode",
});

// Older `properties` shape is still readable (fallback)
assert.deepEqual(mapEvent({ id: "evt_test", type: "session.execution.started", properties: { sessionID: "s1" } }), {
  hook_event_name: "SessionStart",
  session_id: "s1",
  coucou_agent: "opencode",
});

// Everything else is noise → null
for (const type of [
  "session.reasoning.delta",
  "session.text.delta",
  "session.step.started",
  "session.usage.updated",
  "session.instructions.updated",
  "permission.asked",
  "permission.replied",
  "mcp.status.changed",
  "unknown.type",
  "",
]) {
  assert.equal(mapEvent(evt(type, { sessionID: "s1" })), null, `expected null for ${type}`);
}

// Garbage input never throws — a bad event is dropped, not raised
for (const bad of [
  null,
  undefined,
  42,
  "event",
  {},
  { type: "session.idle" }, // no sessionID anywhere
  { type: "session.execution.started", data: {} }, // no sessionID in data, no durable
  { type: "session.inbox.enqueued", data: { prompt: null } }, // wrong field names
]) {
  assert.equal(mapEvent(bad), null, `expected null for ${JSON.stringify(bad)}`);
}

console.log("mapping.test.mjs PASS");
