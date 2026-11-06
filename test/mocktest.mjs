// Playwright test that mocks the relay (no network, no key, no cost).
// Run: cd test && npm install && node mocktest.mjs        (build the site first: node ../build.mjs)
import { chromium } from "playwright-core";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const RELAY = "http://localhost:8787";   // the value baked into docs/index.html by config.json
const site = fs.readFileSync(new URL("../docs/index.html", import.meta.url), "utf8");
if (!site.includes(`const RELAY = "${RELAY}"`)) throw new Error("build the site with config.json relayUrl = " + RELAY);
const srv = http.createServer((q, s) => { s.writeHead(200, { "Content-Type": "text/html" }); s.end(site); }).listen(0);
const PAGE = "http://localhost:" + srv.address().port + "/";

function findChromium() {
  const edge = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
  if (fs.existsSync(edge)) return edge;   // the bundled Chromium would not launch on this machine
  const root = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), ".cache"), "ms-playwright");
  const dir = fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().pop();
  const c = [path.join(root, dir, "chrome-win64", "chrome.exe"), path.join(root, dir, "chrome-win", "chrome.exe"), path.join(root, dir, "chrome-linux", "chrome")];
  return c.find((p) => fs.existsSync(p));
}

let failed = 0;
const ok = (c, msg) => { console.log((c ? "PASS " : "FAIL ") + msg); if (!c) failed++; };

const GOOD = "good-code-1234";
const VERIFIED = "https://www.census.gov/quickfacts/coloradosprings";
const route = (id, name, person) => ({ id, name, summary: name + " summary.", money_at_risk_first: "$50", first_paying: "month 2", ownership: "you", betting_on: "demand", time_to_destination: "2 to 3 years",
  stops: [{ key: "ask", title: "Ask three coaches", when: "this week", test: "Ask.", cost: "$0", go_on_when: "two say yes" }, { key: id + "x", title: "Run a clinic", when: "months 1 to 3", test: "Run it.", cost: "$40", go_on_when: "ten sign up" }],
  canvas: [{ block: "Revenue Streams", line: "court fees" }], scarcity_abundance: "scarce", person });
const CANNED = {
  PLAYBACK: { dream: "Indoor courts", persona: "weekend players", problem: "no winter courts", have: "coach", loss: "$500", worry: "building cost", ideas_note: "", safety_note: "", questions: ["Hours per week?"] },
  MAP: { destination: "A facility", routes: [route("r1", "Rent first", { name: "Sam Source", story: "Started renting gym time.", source_url: VERIFIED }), route("r2", "Partner up", { name: "Pat Nosource", story: "Partnered with a rec center.", source_url: "https://example.com/never-searched" })],
    first_move: { key: "ask", why: "cheap" }, hard_parts: ["Money"], note: "Big climb." },
  MARKET: { who_pays: "Players pay.", rough_math: ["Rough: 770,000 people"], alternatives: "Rec centers.", look_up: ["Court rates"], sources: [{ for: "population", title: "Census QuickFacts", url: VERIFIED }, { for: "rates", title: "Fake", url: "https://example.com/invented" }] },
  TEST: { riskiest_guess: "They'd pay.", test_type: "conversations", mvp: "Talk to coaches.", who: "Coaches", how: "Ask open questions.", keep_going_if: "Yes", reroute_if: "No", worst_case: "Awkward.", learn_anyway: "Rates.", first_move: { who: "A coach", what: "Ask three coaches", by_when: "Sunday" }, proof: "Notes" },
  AUDIENCE: { people: [{ who: "Keen", reaction: "Sure.", question: "How much?", would_change_their_mind: "Price." }, { who: "Skeptic", reaction: "Hmm.", question: "Where?", would_change_their_mind: "Location." }, { who: "Meh", reaction: "Whatever.", question: "Why?", would_change_their_mind: "Friends." }], pattern: "Price matters." },
  PLAN: { canvas: [{ block: "Customer Segments", line: "players" }, { block: "Revenue Streams", line: "fees" }], weakest_block: "Revenue Streams", weakest_why: "Unproven.", pixar: { every_day: "a", one_day: "b", because_of_that: "c", until_finally: "d" } },
};
const TEXT = { CRITIQUE: "You asked three clear questions. Say how long it takes.", ROLEPLAY: "Sure, ten minutes works.", FEEDBACK: "Worked: your ask. Change: add a time." };
const nd = (...o) => o.map((x) => JSON.stringify(x)).join("\n") + "\n";
function reply(step) {
  if (CANNED[step]) {
    const body = JSON.stringify(CANNED[step]);
    const src = step === "MAP" ? [{ t: "src", url: VERIFIED + "/", title: "Census" }] : step === "MARKET" ? [{ t: "src", url: VERIFIED, title: "Census" }] : [];
    return nd({ t: "text", d: "Let me search." }, { t: "reset" }, ...src, { t: "text", d: body.slice(0, 20) }, { t: "text", d: body.slice(20) }, { t: "usage", in: 1, out: 1, cr: 0, cw: 0, ws: 0 }, { t: "done", stop: "end_turn" });
  }
  return nd({ t: "text", d: TEXT[step] }, { t: "done", stop: "end_turn" });
}

const browser = await chromium.launch({ executablePath: findChromium(), headless: true });
const ctx = await browser.newContext({ acceptDownloads: true });
const page = await ctx.newPage();
const outside = [], calls = [];
let mode = "ok";
await page.route("**/*", async (r) => {
  const u = r.request().url();
  if (u.startsWith(PAGE) || u.startsWith("data:")) return r.continue();
  if (u.startsWith(RELAY)) {
    const req = r.request(), code = req.headers()["x-passcode"] || "";
    if (mode === "down") return r.abort();
    if (u.endsWith("/api/check")) return code === GOOD ? r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }) : r.fulfill({ status: 401, contentType: "application/json", body: '{"error":"bad_passcode"}' });
    if (code !== GOOD) return r.fulfill({ status: 401, contentType: "application/json", body: '{"error":"bad_passcode"}' });
    const b = JSON.parse(req.postData());
    calls.push({ step: b.step, vars: b.vars, messages: b.messages });
    if (mode === "cap") return r.fulfill({ status: 429, contentType: "application/json", body: '{"error":"passcode_cap"}' });
    return r.fulfill({ status: 200, contentType: "application/x-ndjson", body: reply(b.step) });
  }
  if (/fonts\.(googleapis|gstatic)\.com/.test(u)) return r.abort();   // no network needed for the test
  outside.push(u); return r.abort();
});
page.on("pageerror", (e) => { console.log("pageerror:", e.message); failed++; });
await page.goto(PAGE);

// passcode gate: wrong code, then right code
await page.fill("#dump", "i want to build indoor courts in the springs. i coach. $500.");
await page.click("#go-playback");
ok(await page.isVisible("#pass-overlay"), "asks for a passcode on the first call");
await page.fill("#pass-in", "wrong-code-0000"); await page.click("#pass-go");
await page.waitForFunction(() => /didn't work/.test(document.getElementById("pass-msg").textContent));
ok(!(await page.evaluate(() => localStorage.getItem("fht-passcode"))), "wrong passcode is not remembered");
await page.fill("#pass-in", GOOD); await page.click("#pass-go");
await page.waitForSelector("#heard-cards .card");
ok((await page.evaluate(() => localStorage.getItem("fht-passcode"))) === GOOD, "right passcode is remembered in localStorage");
ok(calls[0].step === "PLAYBACK" && calls[0].vars.dump.includes("indoor courts") && typeof calls[0].vars.now === "string" && !("prompt" in calls[0]), "PLAYBACK sends a step name and the student's inputs, not a prompt");

// flow to the map
await page.click("#heard-ok");
await page.fill("#q-answer", "5 hours"); await page.click("#q-next");
await page.waitForSelector("#routes .route");
ok(calls.some((c) => c.step === "MAP" && /5 hours/.test(c.vars.answers)), "MAP call carries the student's answers");
const mapText = await page.textContent("#routes");
ok((await page.locator("#route-0 a[href^='https://www.census.gov']").count()) === 1, "a person whose source appeared in the search shows the source link");
ok(/Not checked against a source/.test(await page.textContent("#route-1")) && (await page.locator("#route-1 a").count()) === 0, "an unsearched link is not shown; label stays unverified");

// market check with sources
await page.click("#go-market");
await page.waitForSelector("#market-out li a");
const mk = await page.textContent("#market-out");
ok((await page.locator("#market-out a[href='" + VERIFIED + "']").count()) === 1 && !/example\.com\/invented/.test(await page.innerHTML("#market-out")), "market shows verified sources only");
ok(/unverified and rough/.test(mk), "market keeps an 'unverified' label for unsourced claims");

// test, audience, ask, roleplay, plan
await page.click("#route-0 .btn.primary");
await page.waitForSelector("#test-out .card.hot");
await page.fill("#aud-pitch", "pitch"); await page.click("#go-aud"); await page.waitForSelector("#aud-out .aud");
await page.click("#go-ask");
await page.fill("#draft", "hey coach can I ask 3 questions"); await page.click("#go-critique");
await page.waitForFunction(() => document.getElementById("critique").textContent.includes("three clear questions"));
await page.fill("#rp-say", "Hi, got 10 minutes?"); await page.click("#rp-send");
await page.waitForSelector(".bubble.them");
const rp = calls.filter((c) => c.step === "ROLEPLAY").pop();
ok(rp && rp.messages.length === 1 && rp.messages[0].role === "user" && rp.vars.who === "A coach", "ROLEPLAY sends the chat as messages and the rules stay on the server");
await page.click("#rp-done"); await page.waitForFunction(() => document.getElementById("rp-feedback").textContent.includes("Worked"));
await page.click("#go-plan"); await page.waitForSelector("#plan .bmc");
const dl = page.waitForEvent("download");
await page.click("#ics");
const d = await dl;
ok(d.suggestedFilename() === "my-first-move.ics", "calendar file downloads through a normal browser download");
const ics = fs.readFileSync(await d.path(), "utf8");
ok(ics.startsWith("BEGIN:VCALENDAR") && ics.includes("Ask three coaches"), "calendar file has the first move");

// cap and unreachable fall back with a plain reason
mode = "cap";
await page.click("#back-map2"); await page.waitForSelector("#routes .route");
await page.fill("#own-route", "my own route"); await page.click("#add-route");
await page.waitForSelector("#s-fallback:not(.hidden)");
ok(/used all of your Claude calls for today/.test(await page.textContent("#fallback-why")), "per-passcode cap shows the fallback with a plain message");
ok((await page.inputValue("#fallback-text")).includes("planning coach"), "fallback prompt is still offered");
mode = "down";
await page.click("#fallback-back"); await page.waitForSelector("#routes .route");
await page.click("#add-route");
await page.waitForSelector("#s-fallback:not(.hidden)");
ok(/can't reach the From Here to There server/.test(await page.textContent("#fallback-why")), "unreachable relay shows the fallback with a plain message");

ok(outside.length === 0, "the page only talks to the relay (blocked other requests: " + outside.length + ")");
await browser.close(); srv.close();
console.log(failed ? `\n${failed} FAILED` : "\nALL PASSED");
process.exit(failed ? 1 : 0);
