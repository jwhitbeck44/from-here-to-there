// Screenshots of every screen at phone and laptop size, against the mock relay. Also checks for sideways scrolling.
// Run: node build.mjs, then: cd test && node screens.mjs        Output: _local/screens-<YYMMDD>/
import { chromium } from "playwright-core";
import fs from "node:fs";
import { startSite, findChromium, mockRelay, GOOD } from "./mock-relay.mjs";

const d = new Date(), p2 = (n) => String(n).padStart(2, "0");
const out = new URL(`../_local/screens-${String(d.getFullYear()).slice(2)}${p2(d.getMonth() + 1)}${p2(d.getDate())}/`, import.meta.url);
fs.mkdirSync(out, { recursive: true });
const { srv, url: PAGE } = startSite();
const browser = await chromium.launch({ executablePath: findChromium(), headless: true });
const problems = [];

for (const [label, vp, scale] of [["phone", { width: 390, height: 844 }, 2], ["laptop", { width: 1280, height: 800 }, 1]]) {
  for (const scheme of ["light", "dark"]) {
    if (scheme === "dark" && label === "laptop") continue;
    const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: scale, colorScheme: scheme, acceptDownloads: true });
    const page = await ctx.newPage();
    await mockRelay(page, PAGE);
    page.on("pageerror", (e) => problems.push(label + " pageerror: " + e.message));
    const shot = async (name) => {
      await page.waitForTimeout(150);
      const sw = await page.evaluate(() => document.documentElement.scrollWidth);
      if (sw > vp.width) problems.push(`${label}/${name}: page is ${sw}px wide in a ${vp.width}px window`);
      await page.screenshot({ path: new URL(`${label}${scheme === "dark" ? "-dark" : ""}-${name}.png`, out).pathname.replace(/^\/([A-Za-z]:)/, "$1"), fullPage: true });
    };
    await page.goto(PAGE);
    if (scheme === "light") await shot("01-dump");
    await page.fill("#dump", "i want to build an indoor tennis and pickleball place in colorado springs. i coach kids on weekends.");
    await page.click("#go-playback"); await page.waitForSelector("#heard-cards .card");
    if (scheme === "light") await shot("02-heard");
    await page.click("#heard-ok"); await page.waitForSelector("#q-text");
    if (scheme === "light") await shot("03-questions");
    await page.fill("#q-answer", "5 hours a week"); await page.click("#q-next");
    await page.waitForSelector("#routes .rl");
    await shot("04-map");
    await page.click("#route-0 .rl-line"); await page.waitForSelector("#route-0 ol.stops li:nth-child(3)");
    await shot("05-map-route-open");
    await page.click("#filters button[data-tag='day_job']");
    if (scheme === "light") await shot("06-map-filter");
    await page.click("#filters button[data-tag='day_job']");
    await page.click("#route-0 .rl-detail .btn.primary"); await page.waitForSelector("#countdown");
    await shot("07-next-step");
    await page.click("#next-details summary");
    if (scheme === "light") await shot("08-next-step-details");
    await page.click("#practice");
    await page.fill("#pr-say", "Hi Coach Dana, I'm a UCCS student. Got 10 minutes this week to tell me what winter court time costs your players?");
    await page.click("#pr-send"); await page.waitForSelector("#thread .bubble.them:not(#typing)");
    await page.click("#pr-done"); await page.waitForSelector("#pr-feedback .card");
    await shot("09-practice");
    await page.click("#pr-plan"); await page.waitForSelector("#plan .bmc");
    await shot("10-plan");
    await page.reload(); await page.waitForSelector("#howgo");
    await shot("11-return-howgo");
    await page.click("#howgo-block");
    if (scheme === "light") await shot("12-return-roadblock");
    await page.click("#howgo-done"); await page.waitForSelector("#turn-test");
    if (scheme === "light") await shot("13-return-next-stop");
    await page.evaluate(() => localStorage.setItem("wbm-state", JSON.stringify({ step: 4, dump: "old dump text", map: {} })));
    await page.reload(); await page.waitForSelector("#old-state .note");
    if (scheme === "light") await shot("14-old-state");
    await ctx.close();
  }
}
await browser.close(); srv.close();
console.log("screenshots in", out.pathname);
console.log(problems.length ? "PROBLEMS:\n" + problems.join("\n") : "no sideways scrolling, no page errors");
process.exit(problems.length ? 1 : 0);
