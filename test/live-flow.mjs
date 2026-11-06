// One full pass through every step against a relay, using a short tennis-facility idea. Prints usage and cost per call.
// Usage: RELAY=https://... CODE=... node test/live-flow.mjs
import { call, cost, parse } from "./relay-client.mjs";
const relay = process.env.RELAY, code = process.env.CODE;
const dump = "i want to build an indoor tennis and pickleball facility in colorado springs. i play tennis a lot and coach kids on weekends at a rec center. i know a few other coaches. i can lose maybe $500 and 5 hrs a week. worried the building costs way too much";
const rows = []; let total = 0;
const log = (name, r) => {
  if (r.status !== 200) { console.log(name.padEnd(10), "FAILED", r.status, JSON.stringify(r.error)); process.exit(1); }
  const c = cost(r.usage); total += c;
  rows.push({ name, ...r.usage, usd: +c.toFixed(4), s: +(r.ms / 1000).toFixed(1), stop: r.stop, srcs: r.srcs.length });
  console.log(name.padEnd(10), `in ${r.usage.in} cw ${r.usage.cw} cr ${r.usage.cr} out ${r.usage.out} search ${r.usage.ws}  $${c.toFixed(4)}  ${(r.ms / 1000).toFixed(1)}s  ${r.stop}  srcs ${r.srcs.length}`);
};
const pb = await call(relay, code, "PLAYBACK", { dump }); log("PLAYBACK", pb);
const p = parse(pb.text);
const cards = [["The dream, fully built", p.dream], ["Who it's for", p.persona], ["What they already have", p.have], ["What they could afford to lose", p.loss || "$500 and 5 hours a week"], ["Their worry", p.worry]]
  .filter(([, v]) => v).map(([k, v]) => "- " + k + ": " + v).join("\n");
const answers = (p.questions || []).slice(0, 3).map((q, i) => "- Q: " + q + "\n  A: " + ["I coach 3 days a week and play in a league", "$500", "5 hours"][i]).join("\n") || "(no questions asked)";
const base = { cards, answers };
const mk = await call(relay, code, "MARKET", base); log("MARKET", mk);
const market = parse(mk.text);
const mp = await call(relay, code, "MAP", { ...base, market: "\nA rough market check you already gave them (rough; check it):\n- Who pays: " + market.who_pays + "\n- Alternatives: " + market.alternatives + "\n" }); log("MAP", mp);
const map = parse(mp.text);
const route = map.routes[0];
const firstKey = map.first_move && map.first_move.key;
const firstStop = (map.routes.flatMap((r) => r.stops).find((s) => s.key === firstKey) || route.stops[0]).title;
const ts = await call(relay, code, "TEST", { ...base, route: JSON.stringify(route), first: firstStop }); log("TEST", ts);
const test = parse(ts.text);
const au = await call(relay, code, "AUDIENCE", { cards, test: JSON.stringify(test), pitch: "I'm opening a few indoor courts so weekend players in the Springs have somewhere to play in winter. Would you pay for a monthly spot?" }); log("AUDIENCE", au);
const fm = test.first_move || {};
const move = `${fm.what} (who: ${fm.who}; by ${fm.by_when})`;
const cr = await call(relay, code, "CRITIQUE", { cards, move, draft: "Hi coach, I'm trying to see if players would pay for winter court time. Can I ask you 3 quick questions this week?" }); log("CRITIQUE", cr);
const chat = [{ role: "user", content: "Hi, I'm a student working on an indoor court idea. Do you have 10 minutes this week to tell me what winter court time costs your players now?" }];
const r1 = await call(relay, code, "ROLEPLAY", { cards, who: fm.who || "a local coach", what: fm.what || "ask about winter court time" }, chat); log("ROLEPLAY1", r1);
chat.push({ role: "assistant", content: r1.text }, { role: "user", content: "Mostly I want to know how many of your players would pay for guaranteed winter time." });
const r2 = await call(relay, code, "ROLEPLAY", { cards, who: fm.who || "a local coach", what: fm.what || "ask about winter court time" }, chat); log("ROLEPLAY2", r2);
const transcript = chat.map((m) => (m.role === "user" ? "Student: " : "Them: ") + m.content).join("\n") + "\nThem: " + r2.text;
const fb = await call(relay, code, "FEEDBACK", { move, chat: transcript }); log("FEEDBACK", fb);
const pl = await call(relay, code, "PLAN", { ...base, route: JSON.stringify(route), test: JSON.stringify(test) }); log("PLAN", pl);
console.log("\nTOTAL (14 calls incl. 2 roleplay turns):", "$" + total.toFixed(4));
const person = route.person || {};
console.log("route person:", person.name, "| source_url:", person.source_url, "| in search results:", mp.srcs.includes(person.source_url));
console.log("market sources:", JSON.stringify(market.sources));
console.log("MAP search results urls:", mp.srcs.length, "MARKET:", mk.srcs.length);
