// Counters only. Nothing a student types is ever stored here.
// One Durable Object (SQLite-backed) so increments are atomic, which Workers KV cannot promise.
import { DurableObject } from "cloudflare:workers";

const KEEP_DAYS = 14;

export class Counter extends DurableObject {
  async #cleanup(day) {
    if ((await this.ctx.storage.get("lastDay")) === day) return;
    const cutoff = new Date(Date.parse(day + "T12:00:00Z") - KEEP_DAYS * 86400000).toISOString().slice(0, 10);
    for (const prefix of ["n:", "g:", "u:"]) {
      const all = await this.ctx.storage.list({ prefix });
      const old = [...all.keys()].filter((k) => k.split(":")[1] < cutoff);
      if (old.length) await this.ctx.storage.delete(old);
    }
    const hourNow = Math.floor(Date.now() / 3600000);
    const bad = await this.ctx.storage.list({ prefix: "b:" });
    const oldBad = [...bad.keys()].filter((k) => Number(k.split(":")[1]) < hourNow - 48);
    if (oldBad.length) await this.ctx.storage.delete(oldBad);
    await this.ctx.storage.put("lastDay", day);
  }

  // Count one call for this passcode label. Returns { ok } or { ok:false, reason: "passcode_cap" | "global_cap" }.
  async hit(label, day, perCode, globalCap) {
    await this.#cleanup(day);
    const nk = `n:${day}:${label}`, gk = `g:${day}`;
    const [n, g] = await Promise.all([this.ctx.storage.get(nk), this.ctx.storage.get(gk)]);
    if ((g || 0) >= globalCap) return { ok: false, reason: "global_cap" };
    if ((n || 0) >= perCode) return { ok: false, reason: "passcode_cap" };
    await this.ctx.storage.put({ [nk]: (n || 0) + 1, [gk]: (g || 0) + 1 });
    return { ok: true, used: (n || 0) + 1 };
  }

  // Token totals per label per day, for estimating spend. Numbers only.
  async addUsage(day, label, u) {
    for (const k of [`u:${day}:${label}`, `u:${day}:*`]) {
      const cur = (await this.ctx.storage.get(k)) || { calls: 0, in: 0, out: 0, cr: 0, cw: 0, ws: 0 };
      cur.calls++; cur.in += u.in; cur.out += u.out; cur.cr += u.cr; cur.cw += u.cw; cur.ws += u.ws;
      await this.ctx.storage.put(k, cur);
    }
  }

  async bad(ipKey) {
    const k = `b:${Math.floor(Date.now() / 3600000)}:${ipKey}`;
    await this.ctx.storage.put(k, ((await this.ctx.storage.get(k)) || 0) + 1);
  }
  async isBlocked(ipKey, limit) {
    return ((await this.ctx.storage.get(`b:${Math.floor(Date.now() / 3600000)}:${ipKey}`)) || 0) >= limit;
  }

  async report(day) {
    const out = { today: day, calls: {}, global: {}, tokens: {} };
    for (const [k, v] of await this.ctx.storage.list({ prefix: "n:" })) { const [, d, l] = k.split(":"); (out.calls[d] ||= {})[l] = v; }
    for (const [k, v] of await this.ctx.storage.list({ prefix: "g:" })) out.global[k.split(":")[1]] = v;
    for (const [k, v] of await this.ctx.storage.list({ prefix: "u:" })) { const [, d, l] = k.split(":"); (out.tokens[d] ||= {})[l] = v; }
    return out;
  }
}
