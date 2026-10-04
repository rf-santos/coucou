// test/permission.test.mjs — pure permission-relay tests, no framework.
// Run: node test/permission.test.mjs
// Contract: .superpowers/sdd/2026-10-02-coucou-opencode-support/opencode-event-shapes.md
// ("Coucou-side PermissionRequest payload contract" + "Decision mapping").
import assert from "node:assert/strict";
import { buildPermissionPayload, decisionToReply } from "../src/permission.ts";

// --- Decision mapping: Coucou button → ctx.permission.reply value ---
assert.equal(decisionToReply("allow"), "once");
assert.equal(decisionToReply("always"), "always");
assert.equal(decisionToReply("deny"), "reject");
// "ask" (timeout/displacement) → no reply; let OpenCode re-ask in its terminal
assert.equal(decisionToReply("ask"), null);
// Garbage decision → no reply, never throws
assert.equal(decisionToReply("bogus"), null);
assert.equal(decisionToReply(undefined), null);

// --- Payload builder: permission.asked data → Coucou payload ---
// Live v2.0.21 shape (captured 2026-10-04):
// { id, sessionID, action, resources, save, source }
const data = {
  id: "per_1",
  sessionID: "ses_abc",
  action: "shell",
  resources: ["rm -rf *"],
  save: ["rm *"],
  source: { type: "tool", messageID: "msg_1", id: "call_1" },
};
// shell action → resources[0] is the command line Coucou renders
assert.deepEqual(buildPermissionPayload(data, "/work"), {
  hook_event_name: "PermissionRequest",
  coucou_agent: "opencode",
  session_id: "ses_abc",
  cwd: "/work",
  tool_name: "shell",
  tool_input: { command: "rm -rf *" },
});
// Non-shell action → raw resources list as context
assert.deepEqual(buildPermissionPayload({ ...data, action: "edit" }, "/work").tool_input, {
  patterns: ["rm -rf *"],
});
// Shell action but resources[0] not a string → patterns fallback
assert.deepEqual(buildPermissionPayload({ ...data, resources: [42] }, "/work").tool_input, {
  patterns: [42],
});
// No resources → empty tool_input is acceptable (Coucou falls back to tool_name)
assert.deepEqual(buildPermissionPayload({ ...data, resources: undefined }, "/work").tool_input, {});
// cwd omitted when not a string
assert.equal(buildPermissionPayload(data, undefined).cwd, undefined);

// Malformed data → null (caller drops), never throws
for (const bad of [null, undefined, 42, "data", {}, { sessionID: "s1" }, { action: "shell" }, { sessionID: 42, action: "shell" }]) {
  assert.equal(buildPermissionPayload(bad, "/work"), null, `expected null for ${JSON.stringify(bad)}`);
}

console.log("permission.test.mjs PASS");
