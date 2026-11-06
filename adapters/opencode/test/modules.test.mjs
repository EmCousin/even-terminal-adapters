import test from "node:test";
import assert from "node:assert/strict";
import { loadTurnHistory, createTurnFinisher } from "../history.mjs";
import { discoverConnection, createOpenCodeClient } from "../opencode-client.mjs";

test("pagination rejects repeated cursors instead of silently reporting a partial turn", async () => {
  await assert.rejects(() => loadTurnHistory(async () => ({ data: [], cursor: { next: "same" } }), "ses_a"), /repeated/);
});

test("pagination stops immediately when its generation is obsolete", async () => {
  let calls = 0;
  const result = await loadTurnHistory(async () => { calls++; return { data: [], cursor: { next: "older" } }; }, "ses_a", () => false);
  assert.equal(result, null);
  assert.equal(calls, 1);
});

test("OpenCode connection discovery honors explicit configuration without reading a service file", async () => {
  const connection = await discoverConnection({ OPENCODE_URL: "http://stub/", OPENCODE_SERVER_PASSWORD: "stub-password", OPENCODE_SERVICE_FILE: "/nonexistent" });
  assert.equal(connection.base, "http://stub");
  assert.equal(connection.authorization, "Basic " + Buffer.from("opencode:stub-password").toString("base64"));
});

test("OpenCode requests discover credentials each time and sanitize upstream failures", async () => {
  let calls = 0;
  const request = createOpenCodeClient({ connection: async () => ({ base: "http://stub", authorization: "Basic " + (++calls) }), fetchImpl: async (url, options) => {
    assert.equal(options.headers.authorization, "Basic " + calls);
    assert.ok(options.signal instanceof AbortSignal);
    if (url.endsWith("/error")) return new Response("private upstream detail", { status: 401 });
    return new Response(null, { status: 204 });
  } });
  assert.equal(await request("/ok"), null);
  await assert.rejects(() => request("/error"), error => error.message === "OpenCode request failed (401)");
  assert.equal(calls, 2);
});

test("turn finisher ignores an obsolete completion without clearing a newer finisher", async () => {
  const state = { generation: 1, finishing: null, state: "busy", busySince: Date.now() };
  const requests = [];
  const events = [];
  const finish = createTurnFinisher({ request: () => new Promise(resolve => requests.push(resolve)), state: () => state,
    translator: { translate() {}, block() {} }, emit: (id, message) => events.push(message), provider: "claude", isStopped: () => false });
  const oldTurn = finish("ses_a");
  state.generation = 2;
  const newTurn = finish("ses_a");
  requests[0]({ data: [{ id: "msg_old", type: "assistant", content: [{ type: "text", text: "Old" }] }], cursor: {} });
  await oldTurn;
  assert.equal(state.finishing, 2);
  assert.equal(state.state, "busy");
  assert.equal(events.length, 0);
  requests[1]({ data: [{ id: "msg_new", type: "assistant", content: [{ type: "text", text: "New" }] }], cursor: {} });
  await newTurn;
  assert.equal(events.find(message => message.type === "result").text, "New");
  assert.equal(state.state, "idle");
});
