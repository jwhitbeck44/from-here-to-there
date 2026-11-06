// Small client for the relay, used by the live test and the cap test. Never prints the passcode.
// Usage: RELAY=https://... CODE=... node test/relay-client.mjs [flow|check|one STEP]
export async function call(relay, code, step, vars = {}, messages) {
  const now = new Date(), dl = new Date(now.getTime() + 48 * 3600e3);
  const f = (d) => d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }) + " at " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const body = { step, vars: { cards: "- The dream: " + (vars.__dream || "(see dump)"), answers: "(no questions asked)", now: f(now), deadline: f(dl), push: false, ...vars }, ...(messages ? { messages } : {}) };
  delete body.vars.__dream;
  const t0 = Date.now();
  const res = await fetch(relay + "/api/step", { method: "POST", headers: { "Content-Type": "application/json", "X-Passcode": code }, body: JSON.stringify(body) });
  if (!res.ok) return { status: res.status, error: await res.json().catch(() => ({})), ms: Date.now() - t0 };
  let text = "", usage = null, stop = "", srcs = [];
  const dec = new TextDecoder(); let buf = "";
  for await (const chunk of res.body) {
    buf += dec.decode(chunk, { stream: true });
    let i; while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      const m = JSON.parse(line);
      if (m.t === "text") text += m.d; else if (m.t === "reset") text = ""; else if (m.t === "src") srcs.push(m.url);
      else if (m.t === "usage") usage = m; else if (m.t === "done") stop = m.stop; else if (m.t === "err") stop = "ERR:" + m.code;
    }
  }
  return { status: 200, text, usage, stop, srcs, ms: Date.now() - t0 };
}
export const PRICE = { in: 4, out: 20, cr: 0.2, cw: 5, ws: 0.01 };   // $/M tokens; ws is $ per search
export const cost = (u) => (u.in * PRICE.in + u.out * PRICE.out + u.cr * PRICE.cr + u.cw * PRICE.cw) / 1e6 + u.ws * PRICE.ws;
export const parse = (t) => { const i = t.indexOf("{"), j = t.lastIndexOf("}"); return JSON.parse(t.slice(i, j + 1)); };

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, "/").replace(/^([A-Za-z]):/, "/$1:")}` || process.argv[1].endsWith("relay-client.mjs")) {
  const relay = process.env.RELAY, code = process.env.CODE, mode = process.argv[2] || "check";
  if (mode === "check") {
    const r = await fetch(relay + "/api/check", { method: "POST", headers: { "X-Passcode": code || "" } });
    console.log("check:", r.status, await r.text());
  } else if (mode === "one") {
    const r = await call(relay, code, process.argv[3], { dump: "I want to build an indoor tennis and pickleball facility in Colorado Springs." });
    console.log(JSON.stringify({ ...r, text: (r.text || "").slice(0, 600) }, null, 1));
  }
}
