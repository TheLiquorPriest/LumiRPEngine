// The sums of a long stretch (the skill `time`): what a span would bring someone, as data: each of their
// accounts' money in and out by category and by month (wages, rent and upkeep among them, as the journal
// books them) as `pass_time` would record it over the span, the same run on a copy, and where each need
// they keep would stand at its end. It is run on copies of the state and read off: nothing is recorded,
// applied or moved, and the state the call reads has no part in it.

import type { JsonObject, JsonValue } from "rp-harness/contract";
import { calendarOf, formatClock } from "../../engine/calendar";
import { advance, ALL_NOTE } from "../../engine/simulate";
import { standingRun } from "../../engine/standing";
import { clampUnitCap } from "../../engine/time-limits";
import { Working } from "../../engine/working";
import { NEED_IDS, needsSettingsOf } from "../../shared/needs";
import { balance, ownersOf } from "../../packs/economy/core/model";
import { monthsBetween, totalsOf } from "../../packs/economy/core/books";
import { needValue } from "../../packs/castlife/core";
import { TEXT } from "../kit";
import { timeFrom } from "../ops-time";
import { foundIn, readTool } from "./run";

const FAMILY = "time";

/** Money in and out of an account over the span, by category, month by month: what the run added to what the journal already held. */
function moneyOf(before: Working["state"], after: Working["state"], world: Working["ctx"]["world"], account: string, from: number, to: number): JsonObject {
  const months: JsonObject = {};
  for (const month of monthsBetween(world, from, to)) {
    const was = totalsOf(before, account, month);
    const now = totalsOf(after, account, month);
    const by: JsonObject = {};
    for (const [category, v] of Object.entries(now)) {
      const din = v.in - (was[category]?.in ?? 0);
      const dout = v.out - (was[category]?.out ?? 0);
      if (din !== 0 || dout !== 0) by[category] = { in: din, out: dout };
    }
    if (Object.keys(by).length > 0) months[month] = by;
  }
  return { account, from: balance(before, account), to: balance(after, account), months };
}

const totals = readTool({
  name: "time_totals",
  family: FAMILY,
  properties: { at: TEXT, until: TEXT },
  required: ["until"],
  example: { at: "Wren", until: "30 days" },
  read(r, args, reply, call) {
    const said = args.until;
    const to = typeof said === "string" ? timeFrom(r, r.state.world, said) : null;
    if (to === null) return { line: "unreadable", fields: { field: "until", value: JSON.stringify(said ?? null), wants: r.lines.line("wants_time") ?? "" } };
    const from = r.state.world.clock;
    if (to <= from) return { line: "unreadable", fields: { field: "until", value: JSON.stringify(said), wants: r.lines.line("wants_time") ?? "" } };
    const who = args.at === undefined || args.at === null ? { id: r.world.pov, name: r.nameOf(r.world.pov) } : foundIn(r, "at", args.at, "person");
    if ("line" in who) return who;
    // The span's money is what pass_time would record over it: the same run (`standingRun`) on a copy, so each slot counts once, the part of
    // one before now and the one the span ends in as pass_time counts them. The needs are where the engine's own days lived would leave each,
    // read from a second copy; both stop at the same minute, which is `reached`.
    const seed = `totals:${call.scope.chat}`;
    const kept = (upto: number) => {
      const w = new Working(r.registry, r.doc, r.state.world);
      return { w, run: standingRun(r.registry, w, upto, { runSeed: seed, cause: "advance" }) };
    };
    const lived = (upto: number) => {
      const w = new Working(r.registry, r.doc, r.state.world);
      return { w, run: advance(r.registry, w, upto, { runSeed: seed, mode: "timelapse", cause: "advance", includePov: true, povRoutine: false, interrupts: ALL_NOTE, unitCap: clampUnitCap(r.state.world.time.unitCap) }) };
    };
    let books = kept(to);
    const days = lived(books.run.to);
    if (days.run.to < books.run.to) books = kept(days.run.to);
    const reached = Math.min(books.run.to, days.run.to);
    const accounts = Object.keys(r.state.world.entities).filter((id) => r.state.world.entities[id].kind === "account" && ownersOf(r.state.world, id).some((o) => o.party === who.id));
    const tuned = needsSettingsOf(r.world);
    const needs: JsonObject = {};
    for (const need of NEED_IDS) {
      if (tuned[need].on) needs[need] = { from: Math.round(needValue(r.ctx, who.id, need, from)), to: Math.round(needValue(days.w.ctx, who.id, need, reached)) };
    }
    const cal = calendarOf(r.world);
    if (reached < to) reply.line("totals_cut_short", { reached: formatClock(cal, reached), until: formatClock(cal, to) });
    reply.data({ who: who.id, name: who.name, from: formatClock(cal, from), until: formatClock(cal, reached), minutes: reached - from, money: accounts.map((a) => moneyOf(r.state.world, books.w.state, r.world, a, from, reached)) as unknown as JsonValue, needs });
    return undefined;
  },
});

export const TOTALS_TOOLS = [totals];
