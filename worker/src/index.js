// From Here to There relay.
// The browser sends a step name plus the student's inputs. This Worker fills the prompt itself (prompts.gen.js),
// so a leaked passcode can only run this tool's steps, not act as a general Opus proxy.
// It never logs or stores what students type. The only thing kept is counters (Durable Object).
import { COACH, NOTE, PUSH, STEPS } from "./prompts.gen.js";
import { Counter } from "./counter.js";
export { Counter };

const API_URL = "https://api.anthropic.com/v1/messages";
const MAX_BODY = 160_000;

// max = max_tokens ceiling (it includes the model's thinking, so keep headroom). search = web_search max_uses.
const STEP_CFG = {
  PLAYBACK:  { vars: ["dump"], max: 8000, search: 0 },
  MAP:       { vars: ["market"], max: 24000, search: 3 },
  REROUTE:   { vars: ["map", "route", "stop", "kind", "what"], max: 24000, search: 2 },
  ADD_ROUTE: { vars: ["map", "idea", "id"], max: 12000, search: 2 },
  TEST:      { vars: ["route", "first"], max: 10000, search: 0 },
  AUDIENCE:  { vars: ["test", "pitch"], max: 8000, search: 0 },
  CRITIQUE:  { vars: ["move", "draft"], max: 5000, search: 0 },
  ROLEPLAY:  { vars: ["who", "what"], max: 3000, search: 0, chat: true },
  FEEDBACK:  { vars: ["move", "chat"], max: 3000, search: 0 },
  PLAN:      { vars: ["route", "test"], max: 10000, search: 0 },
  MARKET:    { vars: [], max: 12000, search: 4 },
};
const COMMON_VARS = ["cards", "answers", "now", "deadline"];
const VAR_MAX = { dump: 8000, cards: 6000, answers: 6000, map: 40000, route: 20000, test: 12000, chat: 20000, market: 5000,
  draft: 4000, pitch: 4000, what: 4000, idea: 4000, move: 1500, who: 400, stop: 300, first: 400, kind: 40, id: 10, now: 80, deadline: 80 };

const enc = new TextEncoder();
const json = (obj, status = 200, headers = {}) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", ...headers } });

function corsFor(request, env) {
  const origin = request.headers.get("Origin");
  if (!origin) return { ok: true, headers: {} };   // not a browser (curl, tests); the passcode still applies
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim().replace(/\/+$/, "")).filter(Boolean);
  const local = env.ALLOW_LOCALHOST === "1" && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  if (!allowed.includes(origin) && !local) return { ok: false, headers: {} };
  return { ok: true, headers: {
    "Access-Control-Allow-Origin": origin, "Vary": "Origin",
    "Access-Control-Allow-Headers": "Content-Type, X-Passcode", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Max-Age": "86400" } };
}

async function sha(text) { return new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(text))); }
function sameBytes(a, b) { let d = a.length ^ b.length; for (let i = 0; i < a.length && i < b.length; i++) d |= a[i] ^ b[i]; return d === 0; }
const hex = (u8) => [...u8].map((b) => b.toString(16).padStart(2, "0")).join("");

// PASSCODES secret: "label=code" pairs separated by commas or newlines. Returns the label for a matching code, else null.
async function labelFor(env, candidate) {
  if (!candidate || candidate.length > 100) return null;
  const want = await sha(candidate);
  let found = null;
  for (const part of String(env.PASSCODES || "").split(/[,\n\r]+/)) {
    const m = part.trim().match(/^([A-Za-z0-9_-]{1,32})=(\S{8,100})$/);
    if (!m) continue;
    if (sameBytes(want, await sha(m[2])) && !found) found = m[1];   // keep looping so timing doesn't reveal which entry matched
  }
  return found;
}

function denverDay() { return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Denver", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }
const fill = (t, vars) => t.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? vars[k] : ""));

function validate(body) {
  if (!body || typeof body !== "object") return null;
  const cfg = STEP_CFG[body.step];
  if (!cfg || !STEPS[body.step]) return null;
  const v = body.vars && typeof body.vars === "object" ? body.vars : {};
  const vars = {};
  for (const k of [...COMMON_VARS, ...cfg.vars]) {
    const val = v[k] == null ? "" : v[k];
    if (typeof val !== "string" || val.length > (VAR_MAX[k] || 4000)) return null;
    vars[k] = val;
  }
  vars.push = v.push === true ? PUSH : "";
  let messages = null;
  if (cfg.chat) {
    const m = body.messages;
    if (!Array.isArray(m) || m.length < 1 || m.length > 40) return null;
    messages = [];
    for (const x of m) {
      if (!x || (x.role !== "user" && x.role !== "assistant") || typeof x.content !== "string" || !x.content.trim() || x.content.length > 2500) return null;
      messages.push({ role: x.role, content: x.content });
    }
    if (messages[0].role !== "user" || messages[messages.length - 1].role !== "user") return null;
  }
  return { step: body.step, cfg, vars, messages };
}

function buildRequest(env, { step, cfg, vars, messages }) {
  const note = fill(NOTE, vars);
  const stepText = fill(STEPS[step], vars);
  const req = {
    model: env.MODEL || "claude-opus-5-5",
    max_tokens: cfg.max,
    stream: true,
    output_config: { effort: "medium" },
    system: [
      { type: "text", text: COACH, cache_control: { type: "ephemeral" } },   // identical on every call, so it is cached
      { type: "text", text: messages ? note + "\n\n" + stepText : note },
    ],
    messages: messages || [{ role: "user", content: stepText }],
  };
  if (cfg.search > 0) req.tools = [{ type: "web_search_20250305", name: "web_search", max_uses: cfg.search,
    user_location: { type: "approximate", city: "Colorado Springs", region: "Colorado", country: "US", timezone: "America/Denver" } }];
  return req;
}

// Turn Anthropic's event stream into one small JSON line per event. Thinking text and raw search content never reach the browser.
async function pump(upstream, writer, abort, onUsage) {
  const dec = new TextDecoder();
  const send = (o) => writer.write(enc.encode(JSON.stringify(o) + "\n"));
  let buf = "", usage = {}, stop = "", finished = false;
  const kinds = {};
  const handle = async (line) => {
    if (!line.startsWith("data:")) return;
    let e; try { e = JSON.parse(line.slice(5)); } catch { return; }
    switch (e.type) {
      case "message_start": usage = { ...(e.message && e.message.usage) }; break;
      case "content_block_start": {
        const b = e.content_block || {};
        kinds[e.index] = b.type;
        if (b.type === "server_tool_use" || b.type === "web_search_tool_result") await send({ t: "reset" });
        if (b.type === "web_search_tool_result" && Array.isArray(b.content))
          for (const r of b.content) if (r && typeof r.url === "string") await send({ t: "src", url: r.url, title: String(r.title || "").slice(0, 200) });
        break;
      }
      case "content_block_delta":
        if (e.delta && e.delta.type === "text_delta" && kinds[e.index] === "text") await send({ t: "text", d: e.delta.text });
        break;
      case "message_delta":
        if (e.delta && e.delta.stop_reason) stop = e.delta.stop_reason;
        if (e.usage) usage = { ...usage, ...e.usage };
        break;
      case "message_stop": finished = true; break;
      case "error": await send({ t: "err", code: "upstream" }); finished = true; stop = "error"; break;
    }
  };
  try {
    const reader = upstream.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i; while ((i = buf.indexOf("\n")) >= 0) { await handle(buf.slice(0, i).trimEnd()); buf = buf.slice(i + 1); }
    }
    if (buf) await handle(buf.trim());
    if (stop !== "error") {
      const u = { in: usage.input_tokens || 0, out: usage.output_tokens || 0, cr: usage.cache_read_input_tokens || 0, cw: usage.cache_creation_input_tokens || 0,
        ws: (usage.server_tool_use && usage.server_tool_use.web_search_requests) || 0 };
      await send({ t: "usage", ...u });
      await send(finished ? { t: "done", stop } : { t: "err", code: "upstream" });
      onUsage(u);
    }
  } catch {
    abort();            // browser went away (or upstream broke): stop the Anthropic call so it stops costing money
  } finally {
    try { await writer.close(); } catch {}
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const cors = corsFor(request, env);
    if (!cors.ok) return json({ error: "forbidden_origin" }, 403);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors.headers });

    const stub = env.COUNTER.get(env.COUNTER.idFromName("main"));

    // Admin: today's counts and token totals. curl -H "X-Admin-Token: ..." https://<worker>/api/usage
    if (url.pathname === "/api/usage" && request.method === "GET") {
      const t = request.headers.get("X-Admin-Token") || "";
      if (!env.ADMIN_TOKEN || !sameBytes(await sha(t), await sha(String(env.ADMIN_TOKEN).trim()))) return json({ error: "no" }, 401);
      return json({ ...(await stub.report(denverDay())), limits: { perCodeDaily: Number(env.PER_CODE_DAILY) || 60, globalDaily: Number(env.GLOBAL_DAILY) || 600 } });
    }
    if (request.method !== "POST" || (url.pathname !== "/api/step" && url.pathname !== "/api/check")) return json({ error: "not_found" }, 404, cors.headers);

    // Who is this? Rate-limit wrong guesses per connection (counter only; the address is hashed and expires).
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const ipKey = hex(await sha("fht|" + ip)).slice(0, 16);
    if (await stub.isBlocked(ipKey, Number(env.BAD_TRIES_PER_HOUR) || 20)) return json({ error: "too_many_tries" }, 429, cors.headers);
    const label = await labelFor(env, request.headers.get("X-Passcode") || "");
    if (!label) { await stub.bad(ipKey); return json({ error: "bad_passcode" }, 401, cors.headers); }
    if (url.pathname === "/api/check") return json({ ok: true }, 200, cors.headers);

    // Check the request is one of this tool's steps with sane inputs.
    const raw = await request.text();
    if (raw.length > MAX_BODY) return json({ error: "bad_request" }, 413, cors.headers);
    let parsed; try { parsed = JSON.parse(raw); } catch { return json({ error: "bad_request" }, 400, cors.headers); }
    const v = validate(parsed);
    if (!v) return json({ error: "bad_request" }, 400, cors.headers);

    // Count the call (atomic) before spending money.
    const day = denverDay();
    const hit = await stub.hit(label, day, Number(env.PER_CODE_DAILY) || 60, Number(env.GLOBAL_DAILY) || 600);
    if (!hit.ok) return json({ error: hit.reason }, 429, { ...cors.headers, "Retry-After": "3600" });

    const ctl = new AbortController();
    let upstream;
    try {
      upstream = await fetch(API_URL, { method: "POST", signal: ctl.signal,
        headers: { "x-api-key": String(env.ANTHROPIC_API_KEY || "").trim(), "anthropic-version": env.ANTHROPIC_VERSION || "2026-10-21", "content-type": "application/json" },
        body: JSON.stringify(buildRequest(env, v)) });
    } catch { return json({ error: "upstream" }, 502, cors.headers); }
    if (!upstream.ok) {
      // Report only the status and Anthropic's error type, never the message (it can quote the request).
      let type = ""; try { type = (await upstream.json()).error.type || ""; } catch {}
      return json({ error: "upstream", status: upstream.status, type }, 502, cors.headers);
    }

    const { readable, writable } = new TransformStream();
    const done = pump(upstream, writable.getWriter(), () => ctl.abort(), (u) => ctx.waitUntil(stub.addUsage(day, label, u)));
    ctx.waitUntil(done);
    return new Response(readable, { headers: { ...cors.headers, "Content-Type": "application/x-ndjson", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
  },
};
