// test/plugin.test.mjs — plain node test, no framework. Run: node test/plugin.test.mjs
import assert from "node:assert/strict";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import plugin from "../index.ts";

// Shape: matches the bundled ponytail plugin's V2 form
assert.equal(plugin.id, "coucou");
assert.equal(typeof plugin.setup, "function");

// Hard constraint: setup must never throw, even when Coucou is not running.
// Returns a no-op cleanup in that case. (Both no-subscribe and running-Coucou
// paths must resolve with a function.)
const cleanup = await plugin.setup({});
assert.equal(typeof cleanup, "function");
cleanup();

// --- Protocol test: Coucou's hook protocol is ONE event per connection —
// it reads a single line, replies, and closes. The mock below emulates that
// exactly. Every mapped event must still arrive, each on its own connection.
const sockPath = path.join(os.tmpdir(), `coucou-plugin-test-${process.pid}.sock`);
fs.rmSync(sockPath, { force: true });

const received = [];
let connections = 0;
const server = net.createServer((client) => {
  connections++;
  client.once("data", (chunk) => {
    received.push(chunk.toString());
    client.write('{"ok":true}\n');
    client.end(); // real Coucou: one event per connection, then close
  });
});
await new Promise((r) => server.listen(sockPath, r));

// Live v2.0.21 shapes (data + durable), captured 2026-10-04
const events = [
  { id: "evt_1", type: "session.execution.started", data: { sessionID: "ses_proto" }, durable: { aggregateID: "ses_proto" } },
  { id: "evt_2", type: "session.tool.called", data: { sessionID: "ses_proto", id: "call_1", input: { command: "ls" }, executed: false } },
  // unmapped event — must be dropped (no connection, no crash)
  { id: "evt_x", type: "session.reasoning.delta", data: { sessionID: "ses_proto" } },
  { id: "evt_3", type: "session.execution.succeeded", data: { sessionID: "ses_proto" } },
];

process.env.COUCOU_SOCKET_PATH = sockPath;
// Fresh module instance (module-level state + SOCKET_PATH read at load).
const { default: pluginProto } = await import(`../index.ts?p=${process.pid}`);

const sub = async function* (_opts) {
  for (const e of events) yield e;
};
const cleanup2 = await pluginProto.setup({
  location: { directory: "/work/proto" },
  event: { subscribe: sub },
});
assert.equal(typeof cleanup2, "function");

const t0 = Date.now();
while (received.length < 3 && Date.now() - t0 < 5000)
  await new Promise((r) => setTimeout(r, 25));

cleanup2();
assert.equal(received.length, 3, `expected 3 forwarded events, got ${received.length}: ${received.join(" | ")}`);
assert.equal(connections, 3, "each event must use its own connection");
const parsed = received.map((l) => JSON.parse(l.trim()));
assert.deepEqual(parsed[0], { hook_event_name: "SessionStart", session_id: "ses_proto", coucou_agent: "opencode", cwd: "/work/proto" });
assert.deepEqual(parsed[1], { hook_event_name: "PreToolUse", session_id: "ses_proto", coucou_agent: "opencode", tool_name: "shell", tool_input: { command: "ls" }, cwd: "/work/proto" });
assert.deepEqual(parsed[2], { hook_event_name: "Stop", session_id: "ses_proto", coucou_agent: "opencode", cwd: "/work/proto" });

// --- Coucou-down test: dead socket path → setup still resolves, events are
// dropped with a logged error, nothing throws or rejects.
const deadPath = path.join(os.tmpdir(), `coucou-plugin-dead-${process.pid}.sock`);
fs.rmSync(deadPath, { force: true });
process.env.COUCOU_SOCKET_PATH = deadPath;
const { default: pluginDead } = await import(`../index.ts?d=${process.pid}`);

let rejections = 0;
const onReject = (r) => { rejections++; console.error("UNHANDLED:", r); process.exit(1); };
process.on("unhandledRejection", onReject);
const realError = console.error;
let errorLogs = 0;
console.error = () => { errorLogs++; };

const subDead = async function* (_opts) {
  yield { id: "evt_1", type: "session.created", properties: { sessionID: "ses_dead" } };
};
const cleanup3 = await pluginDead.setup({ event: { subscribe: subDead } });
assert.equal(typeof cleanup3, "function");
cleanup3();
await new Promise((r) => setTimeout(r, 300));

console.error = realError;
process.removeListener("unhandledRejection", onReject);
assert.equal(rejections, 0);
assert.ok(errorLogs >= 1, "connect failure must be logged");

await new Promise((r) => server.close(r));
fs.rmSync(sockPath, { force: true });
console.log("plugin.test.mjs PASS");
