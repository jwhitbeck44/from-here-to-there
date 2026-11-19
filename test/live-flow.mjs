// One pass through the round-2 flow against a relay, using a short tennis-facility idea. Prints usage and cost per call.
// Flow: PLAYBACK, MAP, ROUTE_DETAIL x2 (two routes opened), TEST, ROLEPLAY x1 (one practice exchange), FEEDBACK, PLAN.
// Add MARKET=1 to include the optional market check.
// Usage: RELAY=http://localhost:8787 CODE=... node test/live-flow.mjs        (local: cd worker && npx wrangler dev)
import { call, cost, parse } from "./relay-client.mjs";
const relay = process.env.RELAY, code = process.env.CODE;
const dump = "i want to build an indoor tennis and pickleball facility in colorado springs. i play tennis a lot and coach kids on weekends at a rec center. i know a few other coaches. i can lose maybe $500 and 5 hrs a week. worried the building costs way too much";
const rows = []; let total = 0;
const log = (name, r) => {
  if (r.status !== 200) { console.log(name.padEnd(13), "FAILED", r.status, JSON.stringify(r.error)); process.exit(1); }
  const c = cost(r.usage); total += c;
  rows.push({ name, ...r.usage, usd: +c.toFixed(4), s: +(r.ms / 1000).toFixed(1), stop: r.stop, srcs: r.srcs.length });
  console.log(name.padEnd(13), `in ${r.usage.in} cw ${r.usage.cw} cr ${r.usage.cr} out ${r.usage.out} search ${r.usage.ws}  $${c.toFixed(4)}  ${(r.ms / 1000).toFixed(1)}s  ${r.stop}  srcs ${r.srcs.length}`);
};
const pb = await call(relay, code, "PLAYBACK", { dump }); log("PLAYBACK", pb);
const p = parse(pb.text);
console.log("  playback fields:", JSON.stringify({ have: p.have, loss: p.loss, worry: p.worry }));
const cards = [["The dream, fully built", p.dream], ["Who it's for", p.persona], ["What they already have", p.have], ["What they could afford to lose", p.loss || "$500 and 5 hours a week"], ["Their worry", p.worry]]
  .filter(([, v]) => v).map(([k, v]) => "- " + k + ": " + v).join("\n");
const answers = (p.questions || []).slice(0, 3).map((q, i) => "- Q: " + q + "\n  A: " + ["I coach 3 days a week and play in a league", "$500", "5 hours"][i]).join("\n") || "(no questions asked)";
const base = { cards, answers };
let market = "";
if (process.env.MARKET === "1") {
  const mk = await call(relay, code, "MARKET", base); log("MARKET", mk);
  const m = parse(mk.text); market = "\nA rough market check you already gave them (rough; check it):\n- Who pays: " + m.who_pays + "\n- Alternatives: " + m.alternatives + "\n";
}
const mp = await call(relay, code, "MAP", { ...base, market }); log("MAP", mp);
const map = parse(mp.text);
console.log("  routes:", map.routes.length, map.routes.map((r) => `${r.name} [${(r.tags || []).join(",")}] first=${r.first_stop && r.first_stop.key}`).join(" | "));
console.log("  first move:", JSON.stringify(map.first_move));
const short = JSON.stringify({ destination: map.destination, note: map.note, first_move: map.first_move, routes: map.routes });
const d1 = await call(relay, code, "ROUTE_DETAIL", { ...base, map: short, route: JSON.stringify(map.routes[0]), keys: "(none yet)" }); log("ROUTE_DETAIL1", d1);
const det1 = parse(d1.text);
const keys = det1.stops.map((s) => "- " + s.key + ": " + s.title).join("\n");
const d2 = await call(relay, code, "ROUTE_DETAIL", { ...base, map: short, route: JSON.stringify(map.routes[1]), keys }); log("ROUTE_DETAIL2", d2);
const det2 = parse(d2.text);
for (const [r, d, res] of [[map.routes[0], det1, d1], [map.routes[1], det2, d2]]) {
  const person = d.person || {};
  console.log(`  ${r.name}: ${d.stops.length} stops, ${(d.alerts || []).length} alerts, person ${person.name || "(none)"} | source in search results: ${!person.source_url || res.srcs.includes(person.source_url)}`);
}
const route = { ...map.routes[0], stops: det1.stops, canvas: det1.canvas, alerts: det1.alerts };
const s0 = det1.stops[0];
const stop = `${s0.title} (${s0.when}). ${s0.test} Cost: ${s0.cost}. Go on when: ${s0.go_on_when}`;
const ts = await call(relay, code, "TEST", { ...base, route: JSON.stringify(route), stop }); log("TEST", ts);
const test = parse(ts.text);
const fm = test.first_move || {};
const chat = [{ role: "user", content: "Hi, I'm a UCCS student working on an indoor court idea. Do you have 10 minutes this week to tell me what winter court time costs your players now?" }];
const r1 = await call(relay, code, "ROLEPLAY", { cards, who: fm.who || "a local coach", what: fm.what || "ask about winter court time" }, chat); log("ROLEPLAY", r1);
console.log("  them:", r1.text.trim());
const transcript = chat.map((m) => "Student: " + m.content).join("\n") + "\nThem: " + r1.text;
const fb = await call(relay, code, "FEEDBACK", { move: `${fm.what} (who: ${fm.who})`, chat: transcript }); log("FEEDBACK", fb);
console.log("  feedback:", fb.text.trim().replace(/\n+/g, " / "));
const pl = await call(relay, code, "PLAN", { ...base, route: JSON.stringify(route), test: JSON.stringify(test) }); log("PLAN", pl);
console.log(`\nTOTAL (${rows.length} calls): $${total.toFixed(4)}`);
console.log("Per student at this flow:", "$" + total.toFixed(2), "| 30 students:", "$" + (total * 30).toFixed(2));
