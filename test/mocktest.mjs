// Playwright test that mocks the relay (no network, no key, no cost).
// Run: node build.mjs, then: cd test && npm install && node mocktest.mjs
import { chromium } from "playwright-core";
import fs from "node:fs";
import { startSite, findChromium, mockRelay, GOOD, VERIFIED } from "./mock-relay.mjs";

let failed = 0;
const ok = (c, msg) => { console.log((c ? "PASS " : "FAIL ") + msg); if (!c) failed++; };
const count = (calls, step) => calls.filter((c) => c.step === step).length;
const last = (calls, step) => calls.filter((c) => c.step === step).pop();

// Static check: the Worker runs only the new steps.
const worker = fs.readFileSync(new URL("../worker/src/index.js", import.meta.url), "utf8");
const cfgBlock = worker.slice(worker.indexOf("const STEP_CFG"), worker.indexOf("const COMMON_VARS"));
ok(!/AUDIENCE|CRITIQUE/.test(cfgBlock) && /ROUTE_DETAIL/.test(cfgBlock) && /MAP:\s*\{[^}]*search: 0/.test(cfgBlock), "Worker STEP_CFG: AUDIENCE and CRITIQUE removed, ROUTE_DETAIL added, MAP has no web search");

const { srv, url: PAGE } = startSite();
const browser = await chromium.launch({ executablePath: findChromium(), headless: true });
const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 800 } });
await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: PAGE.replace(/\/$/, "") });
await ctx.addInitScript(() => { try { delete Navigator.prototype.share; } catch (e) {} });   // test the copy fallback first
const page = await ctx.newPage();
const { calls, outside, setMode } = await mockRelay(page, PAGE, { delay: { ROLEPLAY: 400 } });
page.on("pageerror", (e) => { console.log("pageerror:", e.message); failed++; });
const clip = () => page.evaluate(() => navigator.clipboard.readText());
const state = () => page.evaluate(() => JSON.parse(localStorage.getItem("wbm-state")));
await page.goto(PAGE);

// passcode gate: wrong code, then right code
await page.fill("#dump", "i want to build indoor courts in the springs. i coach.");
await page.click("#go-playback");
ok(await page.isVisible("#pass-overlay"), "asks for a passcode on the first call");
await page.fill("#pass-in", "wrong-code-0000"); await page.click("#pass-go");
await page.waitForFunction(() => /didn't work/.test(document.getElementById("pass-msg").textContent));
ok(!(await page.evaluate(() => localStorage.getItem("fht-passcode"))), "wrong passcode is not remembered");
await page.fill("#pass-in", GOOD); await page.click("#pass-go");
await page.waitForSelector("#heard-cards .card");
ok((await page.evaluate(() => localStorage.getItem("fht-passcode"))) === GOOD, "right passcode is remembered in localStorage");
ok(calls[0].step === "PLAYBACK" && calls[0].vars.dump.includes("indoor courts") && !("prompt" in calls[0]), "PLAYBACK sends a step name and the student's inputs, not a prompt");

// map with 6 routes in short form
await page.click("#heard-ok");
await page.fill("#q-answer", "5 hours"); await page.click("#q-next");
await page.waitForSelector("#routes .rl");
const mapCall = last(calls, "MAP");
ok(mapCall && /5 hours/.test(mapCall.vars.answers), "MAP call carries the student's answers");
ok((await page.locator("#routes .rl").count()) === 6 && (await page.locator("#map-svg svg g.lane").count()) === 6, "six routes show as six list lines and six lanes on the map");
ok(count(calls, "ROUTE_DETAIL") === 0, "no route details load until a route is tapped");
const s1 = await state();
ok(typeof s1.deadline === "number" && Math.abs(s1.deadline - Date.now() - 48 * 3600e3) < 120e3, "the 48-hour deadline is saved when the map creates the first move");
ok(!(await page.textContent("#routes")).includes("made_up_tag") && !(await page.textContent("#routes")).includes("made up"), "tags not on the fixed list are dropped");
ok(!/No web search/.test(await page.textContent("#s-map")), "market card no longer says there's no web search");

// open route 1, close it, open it again: one ROUTE_DETAIL call
await page.click("#route-0 .rl-line");
await page.waitForSelector("#route-0 ol.stops li:nth-child(3)");
ok(count(calls, "ROUTE_DETAIL") === 1, "tapping a route loads its details once");
ok((await page.locator("#route-0 .alert-line").count()) === 1 && (await page.locator("#map-svg svg path[fill]").filter({ has: page.locator("title") }).count()) === 1, "one valid alert shows on its stop and as a marker on the map (the alert pinned to a missing stop is dropped)");
ok((await page.locator("#route-0 a[href^='https://www.census.gov']").count()) === 1, "a person whose source appeared in the search shows the source link");
const st1 = await state();
ok(st1.details.r1.stops[0].key === "ask", "the first stop keeps the map's key even if ROUTE_DETAIL changed it");
ok(await page.evaluate(() => { const g = document.querySelector("#map-svg g.lane[data-id='r2']"); return g && Number(g.getAttribute("opacity")) < 1; }), "opening a route greys out the other lanes");
await page.click("#route-0 .rl-line");
ok((await page.locator("#route-0 .rl-detail").count()) === 0, "tapping again closes the route");
await page.click("#route-0 .rl-line");
await page.waitForSelector("#route-0 ol.stops li:nth-child(3)");
ok(count(calls, "ROUTE_DETAIL") === 1, "reopening a route makes no new call");

// a second route: Claude gets the stops already used
await page.click("#route-1 .rl-line");
await page.waitForSelector("#route-1 ol.stops li:nth-child(3)");
ok(count(calls, "ROUTE_DETAIL") === 2 && /r1-clinic/.test(last(calls, "ROUTE_DETAIL").vars.keys), "second ROUTE_DETAIL call carries the stop keys from the first route");
ok(/Not checked against a source/.test(await page.textContent("#route-1")) && (await page.locator("#route-1 a").count()) === 0, "an unsearched link is not shown; label stays unverified");

// filter chip: sorts matching routes to the top and dims the rest, no call
const before = calls.length;
await page.click("#filters button[data-tag='fast_sale']");
const order = await page.$$eval("#routes .rl", (els) => els.map((e) => e.dataset.id + (e.classList.contains("dim") ? ":dim" : "")));
ok(order[0] === "r4" && order[1] === "r5" && order.slice(2).every((x) => x.endsWith(":dim")), "'Fastest first sale' puts matching routes first and dims the rest");
ok(calls.length === before, "filter chips make no Claude call");
await page.click("#filters button[data-tag='fast_sale']");
ok((await page.locator("#routes .rl.dim").count()) === 0, "tapping the chip again clears the filter");

// market check with sources
await page.click("#go-market");
await page.waitForSelector("#market-out li a");
ok((await page.locator("#market-out a[href='" + VERIFIED + "']").count()) === 1 && !/example\.com\/invented/.test(await page.innerHTML("#market-out")), "market shows verified sources only");

// take route 1: TEST on its first stop, with the saved deadline
await page.click("#route-0 .rl-line");
await page.click("#route-0 .rl-detail .btn.primary");
await page.waitForSelector("#s-next .nav .what");
const t1 = last(calls, "TEST");
const dlText = await page.evaluate(() => { const s = JSON.parse(localStorage.getItem("wbm-state")); const d = new Date(s.deadline); return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }) + " at " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }); });
ok(t1 && /Ask three coaches/.test(t1.vars.stop) && t1.vars.deadline === dlText && mapCall.vars.deadline === dlText, "TEST gets the stop as input and the same saved deadline as MAP");
ok(/^1 day 2[23] hours left$/.test(await page.textContent("#countdown")), "countdown shows days and hours left (" + (await page.textContent("#countdown")) + ")");
ok(!(await page.evaluate(() => document.getElementById("next-details").open)), "the test details start collapsed");
ok((await page.locator("#howgo").count()) === 0, "no 'How did it go?' right after making the test");

// share: copy fallback, then the share sheet
await page.click("#share");
await page.waitForFunction(() => /Copied/.test(document.getElementById("next-msg").textContent));
const shared = await clip();
ok(/^My next step: Ask three coaches/.test(shared) && shared.includes(dlText), "without a share sheet, 'Tell someone' copies a line with the move and deadline");
await page.evaluate(() => { window.__shared = null; navigator.share = (d) => { window.__shared = d; return Promise.resolve(); }; });
await page.click("#share");
ok((await page.evaluate(() => window.__shared && window.__shared.text)) === shared, "with a share sheet, it opens it with the same line");

// calendar uses the saved deadline
const dl1 = page.waitForEvent("download");
await page.click("#ics-next");
const ics = fs.readFileSync(await (await dl1).path(), "utf8");
const dtstart = (await state()).deadline; const want = new Date(dtstart).toISOString().replace(/[-:]/g, "").slice(0, 13);
ok(ics.startsWith("BEGIN:VCALENDAR") && ics.includes("DTSTART:" + want) && ics.includes("Ask three coaches"), "calendar file uses the saved deadline");

// "I'm ready" skips practice
await page.click("#ready");
await page.waitForSelector("#plan .bmc");
ok(count(calls, "ROLEPLAY") === 0 && count(calls, "FEEDBACK") === 0, "'I'm ready' goes to the plan with no practice calls");
const planHtml = await page.textContent("#plan");
ok(!/afford to lose/.test(planHtml) && !/My ask/.test(planHtml) && !/Until finally/.test(planHtml), "empty fields (afford to lose, ask, empty Pixar line) are hidden on the plan");
ok(/Court time is hard to book/.test(planHtml), "the route's alert shows on the plan");
await page.click("#copy-plan");
const planTxt = await clip();
ok(!/afford to lose/.test(planTxt) && !/Channels:/.test(planTxt) && /Watch for:/.test(planTxt) && /BUSINESS MODEL CANVAS/.test(planTxt), "copied plan hides empty lines and keeps the full content");
await page.fill("#jim-q", "Is this realistic?");
const body = decodeURIComponent((await page.getAttribute("#mailto", "href")).split("&body=")[1]);
ok(/^My question: Is this realistic\?/.test(body) && /My next step: Ask three coaches/.test(body) && body.includes(dlText) && /My route: Rent court time/.test(body) && /3\. Lease a space \(year 2\)/.test(body) && /The dream: Indoor courts/.test(body), "email has question, next step with deadline, dream, route and stop titles with when");
ok(!/CANVAS|PIXAR|cut short/.test(body) && body.length < 1000, "email is the short version (" + body.length + " chars)");

// practice: text thread, typing dots, two-line feedback, ask on the plan
await page.click("#back-next"); await page.click("#practice");
ok((await page.textContent("#pr-name")) === "Coach Dana", "practice thread shows the person's name at the top");
await page.fill("#pr-say", "Hi Coach Dana, got 10 minutes to tell me what winter court time costs?");
await page.click("#pr-send");
await page.waitForSelector("#typing .typing");
ok(true, "typing dots show while Claude answers");
await page.waitForSelector("#thread .bubble.them:not(#typing)");
const rp = last(calls, "ROLEPLAY");
ok(rp && rp.messages.length === 1 && rp.messages[0].role === "user" && rp.vars.who === "Coach Dana", "ROLEPLAY sends the thread as messages and plays the first move's who");
ok((await page.locator("#thread .bubble.me").count()) === 1 && (await page.locator("#thread .bubble.them").count()) === 1, "student on the right, them on the left");
await page.click("#pr-done");
await page.waitForFunction(() => document.querySelectorAll("#pr-feedback .card p").length === 2);
ok(/^Worked:/.test(await page.textContent("#pr-feedback .card p:nth-of-type(1)")), "Done gives two lines out of character");
await page.click("#pr-plan"); await page.waitForSelector("#plan .first-move");
ok(/My ask, in my words: Hi Coach Dana/.test(await page.textContent("#plan .first-move")), "the plan shows the opening message as 'My ask, in my words'");
ok(count(calls, "PLAN") === 1, "the plan is not fetched twice");

// coming back: Done it -> next stop -> Turn this into a test
await page.reload();
await page.waitForSelector("#howgo");
ok(await page.isVisible("#s-next") && /Ask three coaches/.test(await page.textContent("#next-main")), "a return visit opens on the next-step screen with 'How did it go?'");
await page.click("#howgo-done");
await page.waitForSelector("#turn-test");
ok(/Run a clinic for Rent court time/.test(await page.textContent("#next-main")) && (await state()).done.includes("ask") && (await state()).deadline === null, "'Done it' marks the stop done and shows the next stop");
await page.waitForTimeout(1100);
await page.click("#turn-test");
await page.waitForSelector("#countdown");
const t2 = last(calls, "TEST"), s2 = await state();
ok(/Run a clinic/.test(t2.vars.stop) && s2.stopKey === "r1-clinic" && s2.deadline > s1.deadline, "'Turn this into a test' runs TEST on that stop with a new 48-hour deadline");

// coming back: Roadblock -> REROUTE -> map with "Rerouting"
await page.reload(); await page.waitForSelector("#howgo");
await page.click("#howgo-block");
await page.fill("#howgo-what", "the coaches said no");
await page.click("#howgo-go");
await page.waitForSelector("#s-map:not(.hidden) #map-change .note");
const rr = last(calls, "REROUTE");
ok(rr && /roadblock/.test(rr.vars.kind) && rr.vars.stop === "Run a clinic for Rent court time" && /coaches said no/.test(rr.vars.what), "'Roadblock' asks what happened and runs REROUTE on the current stop");
ok(/^Rerouting\./.test(await page.textContent("#map-change")), "the change note shows as 'Rerouting'");
const s3 = await state();
ok(s3.details.r1 && !s3.details.r2 && s3.test === null && s3.deadline === null, "unchanged routes keep their stops; changed routes and the old test are cleared");
const rdBefore = count(calls, "ROUTE_DETAIL");
await page.click("#route-0 .rl-line"); if (!(await page.locator("#route-0 .rl-detail").count())) await page.click("#route-0 .rl-line");
await page.waitForSelector("#route-0 ol.stops li:nth-child(3)");
ok(count(calls, "ROUTE_DETAIL") === rdBefore, "opening an unchanged route after rerouting costs nothing");

// coming back: Shortcut
await page.click("#route-0 .rl-detail .btn.primary"); await page.waitForSelector("#countdown");
await page.reload(); await page.waitForSelector("#howgo");
await page.click("#howgo-short"); await page.fill("#howgo-what", "a club has empty courts at noon"); await page.click("#howgo-go");
await page.waitForSelector("#s-map:not(.hidden) #map-change .note");
ok(/shortcut/.test(last(calls, "REROUTE").vars.kind), "'Shortcut' runs REROUTE as a shortcut");

// own route in short form, details on tap
await page.fill("#own-route", "what if i just rent a church gym"); await page.click("#add-route");
await page.waitForFunction(() => document.querySelectorAll("#routes .rl").length === 5);
const ar = last(calls, "ADD_ROUTE");
ok(ar && !/"stops"/.test(ar.vars.map), "ADD_ROUTE sends the short map and returns a short route");
await page.waitForSelector("#routes .rl.sel ol.stops li:nth-child(3)");
ok(true, "a new route's details load on tap like the others");

// cap and unreachable fall back with a plain reason
setMode("cap");
await page.fill("#own-route", "my own route"); await page.click("#add-route");
await page.waitForSelector("#s-fallback:not(.hidden)");
ok(/used all of your Claude calls for today/.test(await page.textContent("#fallback-why")), "per-passcode cap shows the fallback with a plain message");
setMode("down");
await page.click("#fallback-back"); await page.waitForSelector("#routes .rl");
await page.click("#add-route");
await page.waitForSelector("#s-fallback:not(.hidden)");
ok(/can't reach the From Here to There server/.test(await page.textContent("#fallback-why")), "unreachable relay shows the fallback with a plain message");
setMode("ok");

// old saved state from the last version, and unreadable state
await page.evaluate(() => localStorage.setItem("wbm-state", JSON.stringify({ step: 4, reached: 6, dump: "my old dump", map: { routes: [{ id: "r1", stops: [] }], hard_parts: [] }, routeId: "r1", test: { first_move: { what: "x", by_when: "Sunday" } }, draft: "hey" })));
await page.reload();
await page.waitForSelector("#old-state .note");
ok(await page.isVisible("#s-dump") && (await page.inputValue("#dump")) === "my old dump", "old saved state shows a plain message on the start page and keeps the brain dump");
await page.click("#old-start-over");
ok((await state()).v === 2 && (await page.locator("#old-state .note").count()) === 0, "'Start over' replaces the old state");
await page.evaluate(() => localStorage.setItem("wbm-state", "{not json"));
await page.reload(); await page.waitForSelector("#old-state .note");
ok(true, "unreadable saved state shows the same message without crashing");

ok(outside.length === 0, "the page only talks to the relay (blocked other requests: " + outside.length + ")");
await browser.close(); srv.close();
console.log(failed ? `\n${failed} FAILED` : "\nALL PASSED");
process.exit(failed ? 1 : 0);
