import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { ReplayHub, replayCursor } from "../replay.mjs";

test("replay cursors validate arrays, non-integers and empty strings", () => {
  for (const value of [[], {}, "", "NaN", "-1", "1.5", Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => replayCursor(value));
  assert.equal(replayCursor("12"), 12);
});

test("ReplayHub bounds event count and stop clears heartbeat timers", () => {
  const hub = new ReplayHub({ log() {}, limit: 2 });
  const response = new EventEmitter();
  response.setHeader = () => {};
  response.flushHeaders = () => {};
  response.write = () => true;
  response.end = () => {};
  hub.subscribe("ses_a", response);
  for (let i = 0; i < 4; i++) hub.emit("ses_a", { type: "text_delta", text: String(i) });
  assert.deepEqual(hub.messages.get("ses_a").map(m => m.id), [3, 4]);
  assert.equal(hub.heartbeats.size, 1);
  hub.stop();
  assert.equal(hub.heartbeats.size, 0);
  assert.equal(hub.clients.size, 0);
});
