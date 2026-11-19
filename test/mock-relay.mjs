// Shared mock relay for mocktest.mjs and screens.mjs. No network, no key, no cost.
// It serves docs/index.html with the relay URL swapped for a local one, and answers /api/step with canned replies.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export const RELAY = "http://localhost:8787";
export const GOOD = "good-code-1234";
export const VERIFIED = "https://www.census.gov/quickfacts/coloradosprings";

export function startSite() {
  const cfg = JSON.parse(fs.readFileSync(new URL("../config.json", import.meta.url), "utf8"));
  let site = fs.readFileSync(new URL("../docs/index.html", import.meta.url), "utf8");
  const prod = `const RELAY = "${cfg.relayUrl.replace(/\/+$/, "")}"`;
  if (!site.includes(prod)) throw new Error("docs/index.html is stale: run node build.mjs");
  site = site.replace(prod, `const RELAY = "${RELAY}"`);
  const srv = http.createServer((q, s) => { s.writeHead(200, { "Content-Type": "text/html" }); s.end(site); }).listen(0);
  return { srv, url: "http://localhost:" + srv.address().port + "/" };
}

export function findChromium() {
  const edge = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
  if (fs.existsSync(edge)) return edge;   // the bundled Chromium would not launch on Jim's machine
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, "/opt/pw-browsers", path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), ".cache"), "ms-playwright")].filter((r) => r && fs.existsSync(r));
  for (const root of roots) {
    const dir = fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().pop();
    if (!dir) continue;
    const c = ["chrome-win64/chrome.exe", "chrome-win/chrome.exe", "chrome-linux64/chrome", "chrome-linux/chrome"].map((p) => path.join(root, dir, p));
    const hit = c.find((p) => fs.existsSync(p));
    if (hit) return hit;
  }
  return undefined;
}

const TAGSETS = [["no_debt", "day_job", "cheap_start"], ["team_up", "day_job"], ["own_it"], ["no_debt", "fast_sale", "day_job"], ["team_up", "fast_sale"], ["own_it", "made_up_tag"]];
const NAMES = ["Rent court time", "Partner with a club", "Build and borrow", "Sell clinics first", "Join a rec center", "Raise and build"];
export const shortRoute = (i) => ({ id: "r" + (i + 1), name: NAMES[i], summary: NAMES[i] + " summary.", money_at_risk_first: "$" + (i + 1) * 50, first_paying: "month " + (i + 1),
  ownership: i % 2 ? "shared" : "you", betting_on: "demand", time_to_destination: (i + 2) + " to " + (i + 4) + " years", tags: TAGSETS[i],
  first_stop: i < 4 ? { key: "ask", title: "Ask three coaches", when: "this week" } : { key: "visit" + i, title: "Visit a rec center", when: "this week" } });

export const CANNED = {
  PLAYBACK: { dream: "Indoor courts", persona: "weekend players", problem: "no winter courts", have: "coach", loss: "", worry: "building cost", ideas_note: "", safety_note: "", questions: ["Hours per week?"] },
  MAP: { destination: "A facility", first_move: { key: "ask", why: "cheap" }, note: "Big climb.", routes: [0, 1, 2, 3, 4, 5].map(shortRoute) },
  MARKET: { who_pays: "Players pay.", rough_math: ["Rough: 770,000 people"], alternatives: "Rec centers.", look_up: ["Court rates"], sources: [{ for: "population", title: "Census QuickFacts", url: VERIFIED }, { for: "rates", title: "Fake", url: "https://example.com/invented" }] },
  TEST: { riskiest_guess: "They'd pay.", test_type: "conversations", mvp: "Talk to coaches.", who: "Coaches", how: "Ask open questions.", keep_going_if: "Yes", reroute_if: "No", worst_case: "Awkward.", learn_anyway: "Rates.", first_move: { who: "Coach Dana", what: "Ask three coaches what winter court time costs" }, proof: "Notes" },
  PLAN: { canvas: [{ block: "Customer Segments", line: "players" }, { block: "Revenue Streams", line: "fees" }, { block: "Channels", line: "" }], weakest_block: "Revenue Streams", weakest_why: "Unproven.", pixar: { every_day: "a", one_day: "b", because_of_that: "c", until_finally: "" } },
  ADD_ROUTE: { id: "r7", name: "My own way", summary: "Weaker, kindly.", money_at_risk_first: "$0", first_paying: "month 1", ownership: "you", betting_on: "friends", time_to_destination: "5 years", tags: ["own_it"], first_stop: { key: "ask", title: "Ask three coaches", when: "this week" } },
};
export function detailFor(route) {
  const r = JSON.parse(route);
  return { stops: [{ key: "WRONG-KEY", title: r.first_stop.title, when: "this week", test: "Ask.", cost: "$0", go_on_when: "two say yes" },
    { key: r.id + "-clinic", title: "Run a clinic for " + r.name, when: "months 1 to 3", test: "Run it.", cost: "$40", go_on_when: "ten sign up" },
    { key: r.id + "-lease", title: "Lease a space", when: "year 2", test: "Sign a short lease.", cost: "$5,000", go_on_when: "full for 3 months" }],
    alerts: [{ stop: r.id + "-clinic", problem: "Court time is hard to book in winter", get_past: "Book weekday mornings" }, { stop: "not-a-stop", problem: "dropped", get_past: "x" }],
    canvas: [{ block: "Revenue Streams", line: "clinic fees" }], scarcity_abundance: "scarce",
    person: r.id === "r1" ? { name: "Sam Source", story: "Started renting gym time.", source_url: VERIFIED } : { name: "Pat Nosource", story: "Partnered with a rec center.", source_url: "https://example.com/never-searched" } };
}
export function rerouteFor(vars) {
  const m = JSON.parse(vars.map);
  const routes = m.routes.slice(0, 3).map((r, i) => ({ ...r, changed: i === 1 }));
  routes.push({ ...shortRoute(5), id: "r9", name: "Pop-up courts", first_stop: { key: "popup", title: "Price a pop-up court", when: "this week" } });
  return { ...m, first_move: { key: "popup", why: "new info" }, routes, change_note: "Coaches said no. So the map now starts with a pop-up.", pivot: false };
}
const TEXT = { ROLEPLAY: "Sure, ten minutes works. What's this for?", FEEDBACK: "Worked: \"what winter court time costs\" is a clear ask.\nChange: say how long it takes." };
const nd = (...o) => o.map((x) => JSON.stringify(x)).join("\n") + "\n";
function jsonReply(obj, srcs) {
  const body = JSON.stringify(obj), parts = [];
  for (let i = 0; i < body.length; i += 40) parts.push({ t: "text", d: body.slice(i, i + 40) });   // many small deltas, like a real stream
  return nd({ t: "text", d: "Let me search." }, { t: "reset" }, ...srcs.map((u) => ({ t: "src", url: u, title: "Census" })), ...parts, { t: "usage", in: 1, out: 1, cr: 0, cw: 0, ws: 0 }, { t: "done", stop: "end_turn" });
}
export function reply(step, vars) {
  if (step === "ROUTE_DETAIL") return jsonReply(detailFor(vars.route), [VERIFIED + "/"]);
  if (step === "REROUTE") return jsonReply(rerouteFor(vars), []);
  if (CANNED[step]) return jsonReply(CANNED[step], step === "MARKET" ? [VERIFIED] : []);
  return nd({ t: "text", d: TEXT[step] || "?" }, { t: "done", stop: "end_turn" });
}

// Route every request from the page. Returns { calls, outside, setMode }.
export async function mockRelay(page, pageUrl, { delay = {} } = {}) {
  const outside = [], calls = [];
  let mode = "ok";
  await page.route("**/*", async (r) => {
    const u = r.request().url();
    if (u.startsWith(pageUrl) || u.startsWith("data:") || u.startsWith("blob:")) return r.continue();
    if (u.startsWith(RELAY)) {
      const req = r.request(), code = req.headers()["x-passcode"] || "";
      if (mode === "down") return r.abort();
      if (u.endsWith("/api/check")) return code === GOOD ? r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }) : r.fulfill({ status: 401, contentType: "application/json", body: '{"error":"bad_passcode"}' });
      if (code !== GOOD) return r.fulfill({ status: 401, contentType: "application/json", body: '{"error":"bad_passcode"}' });
      const b = JSON.parse(req.postData());
      calls.push({ step: b.step, vars: b.vars, messages: b.messages });
      if (mode === "cap") return r.fulfill({ status: 429, contentType: "application/json", body: '{"error":"passcode_cap"}' });
      if (delay[b.step]) await new Promise((res) => setTimeout(res, delay[b.step]));
      return r.fulfill({ status: 200, contentType: "application/x-ndjson", body: reply(b.step, b.vars) });
    }
    if (/fonts\.(googleapis|gstatic)\.com/.test(u)) return r.abort();   // no network needed for the test
    outside.push(u); return r.abort();
  });
  return { calls, outside, setMode: (m) => { mode = m; } };
}
