import express from "express";
import { timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";
import { createClient } from "./t3-client.mjs";
import { ReplayHub, replayCursor } from "../../shared/replay.mjs";

const provider = "claude"; // Even Terminal compatibility, independent of the T3 model.
export function wireState(thread) {
  if (thread.pendingRequestCount || thread.status === "waiting") return "awaiting";
  return ["running", "preparing", "starting", "queued"].includes(thread.status) ? "busy" : "idle";
}
export function createBridge({ token = process.env.BRIDGE_TOKEN, client = createClient(), interval = 1500, log = console.log } = {}) {
  if (!token?.trim()) throw new Error("BRIDGE_TOKEN is required");
  const app = express(), hub = new ReplayHub({ log }), watched = new Map();
  let stopped = false;
  app.use((req, res, next) => {
    const supplied = req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7) : req.query.token;
    const a = Buffer.from(typeof supplied === "string" ? supplied : ""), b = Buffer.from(token);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return res.status(401).json({ error: "Unauthorized" });
    next();
  });
  app.use(express.json({ limit: "1mb" }));
  const route = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
  function valid(id) { return typeof id === "string" && id.length > 0 && id.length <= 256 && !id.startsWith("-") && !/[\x00-\x20]/.test(id); }
  function requireId(req, res, next) {
    const id = req.query.sessionId ?? req.params.sessionId ?? req.body?.sessionId;
    if (!valid(id)) return res.status(400).json({ error: "Invalid sessionId" });
    req.sessionId = id; watch(id); next();
  }
  function watch(id) {
    if (!watched.has(id)) watched.set(id, { messages: null, thread: null, state: null, inflight: null, touched: Date.now() });
    const current = watched.get(id); current.touched = Date.now(); return current;
  }
  async function snapshot(id) {
    const current = watched.get(id) ?? watch(id);
    if (current.inflight) return current.inflight;
    current.inflight = (async () => {
      const data = await client.read(id);
      if (stopped) return data;
      const next = wireState(data.thread);
      // The first snapshot is history. Subsequent changes are live output.
      if (current.messages) {
        const old = current.messages;
        let start = 0;
        // CLI returns the latest 100 messages. Align that sliding window.
        if (data.messages.length && old.length) {
          const offset = old.findIndex(m => m.runId === data.messages[0].runId && m.role === data.messages[0].role && m.text === data.messages[0].text);
          if (offset > 0) start = offset;
        }
        data.messages.forEach((m, i) => {
          const previous = old[i + start];
          if (m.role !== "assistant") return;
          const same = previous?.role === m.role && previous?.runId === m.runId;
          const before = same ? previous.text : "";
          if (m.text !== before) hub.emit(id, { type: "text_delta", text: m.text.startsWith(before) ? m.text.slice(before.length) : m.text });
        });
      }
      if (current.state && current.state !== "idle" && next === "idle") {
        const text = data.messages.filter(m => m.role === "assistant" && m.runId === data.thread.latestRunId).map(m => m.text).join("\n");
        hub.emit(id, { type: "result", text: text || "Turn complete.", success: !["failed", "cancelled"].includes(data.thread.status), sessionId: id, provider });
      }
      if (next !== current.state) {
        hub.emit(id, { type: "status", state: next, sessionId: id });
        if (next === "awaiting") hub.emit(id, { type: "notification", message: "Open T3 Code to answer the question or approve the action." });
      }
      current.thread = data.thread; current.messages = data.messages; current.state = next;
      return data;
    })().finally(() => { current.inflight = null; });
    return current.inflight;
  }
  app.get("/api/info", route(async (_req, res) => { await client.list(); res.json({ account: {}, model: "T3 Code", version: "1.0.0", provider }); }));
  app.get("/api/sessions", route(async (_req, res) => {
    const threads = await client.list();
    res.json({ sessions: threads.filter(t => !t.parentThreadId).map(t => ({ id: t.threadId, title: t.title, timestamp: t.updatedAt, cwd: process.env.PROJECT_DIR ?? process.cwd(), provider, status: wireState(t) })) });
  }));
  app.post("/api/prompt", route(async (req, res) => {
    const { text, sessionId, cwd } = req.body ?? {};
    if (typeof text !== "string" || !text.trim()) return res.status(400).json({ error: "Missing text" });
    if (sessionId !== undefined && !valid(sessionId)) return res.status(400).json({ error: "Invalid sessionId" });
    if (cwd !== undefined && (typeof cwd !== "string" || !cwd.startsWith("/"))) return res.status(400).json({ error: "cwd must be an absolute project path" });
    let id = sessionId;
    if (id) { await snapshot(id); await client.send(id, text); }
    else {
      const created = await client.start(text, cwd); id = created.threadId;
      if (!valid(id)) throw new Error("T3 returned no thread ID");
      watch(id).messages = []; // Include output produced before the first poll.
    }
    hub.emit(id, { type: "user_prompt", text, sessionId: id });
    hub.emit(id, { type: "status", state: "busy", sessionId: id });
    watch(id).state = "busy";
    res.status(202).json({ ok: true, sessionId: id, provider });
  }));
  app.get("/api/status", requireId, route(async (req, res) => {
    const data = await snapshot(req.sessionId);
    res.json({ state: wireState(data.thread), sessionId: req.sessionId, provider });
  }));
  app.get("/api/messages", requireId, route(async (req, res) => {
    let after;
    try { if (req.query.after !== undefined) after = replayCursor(req.query.after); }
    catch (e) { return res.status(400).json({ error: e.message }); }
    const data = await snapshot(req.sessionId);
    res.json({ history: after === undefined ? data.messages.map(({ role, text }) => ({ role, text })) : undefined,
      messages: (hub.messages.get(req.sessionId) ?? []).filter(m => after === undefined || m.id > after), after: hub.cursor(req.sessionId), state: wireState(data.thread), sessionId: req.sessionId, provider });
  }));
  app.get("/api/sessions/:sessionId/history", requireId, route(async (req, res) => {
    const data = await snapshot(req.sessionId); res.json({ history: data.messages.map(({ role, text }) => ({ role, text })) });
  }));
  app.get("/api/events", requireId, route(async (req, res) => {
    let after;
    try { after = replayCursor(req.headers["last-event-id"] ?? req.query.after ?? 0); }
    catch (e) { return res.status(400).json({ error: e.message }); }
    await snapshot(req.sessionId);
    hub.subscribe(req.sessionId, res, { after, needReplay: req.query.needReplay === "true" });
    hub.write(res, { type: "status", state: watch(req.sessionId).state, sessionId: req.sessionId });
  }));
  for (const path of ["interrupt", "permission-response", "question-response"]) app.post(`/api/${path}`, (_req, res) => res.status(501).json({ error: "This action requires the T3 Code app. The T3 CLI does not expose it." }));
  app.use((err, _req, res, _next) => {
    if (res.headersSent) return res.end();
    res.status(err.status === 400 ? 400 : 503).json({ error: err.status === 400 ? "Invalid JSON" : "T3 is unavailable. Check the service log and T3 Code app." });
    log(`[bridge] ${err.message}`);
  });
  let timer;
  async function poll() {
    for (const [id, current] of watched) {
      if (stopped) return;
      if (!hub.clients.has(id) && Date.now() - current.touched > 60000) { watched.delete(id); hub.messages.delete(id); continue; }
      try { await snapshot(id); } catch { /* Preserve state during an outage. */ }
    }
    if (!stopped) timer = setTimeout(poll, interval);
  }
  return { app, snapshot, hub, start() { if (!timer && !stopped) timer = setTimeout(poll, interval); }, stop() { stopped = true; clearTimeout(timer); hub.stop(); } };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const bridge = createBridge(); const port = Number(process.env.PORT ?? 3459);
  const server = bridge.app.listen(port, process.env.BIND_HOST ?? "127.0.0.1", (error) => { if (error) { console.error(`Cannot listen: ${error.code}`); process.exit(1); } console.log(`Even Terminal T3 listening on port ${port}`); });
  bridge.start();
  for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => { bridge.stop(); server.close(); });
}
