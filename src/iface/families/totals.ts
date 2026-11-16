// The sums of a long stretch (the skill `time`): what today's engine would bring someone over a span, as
// data: each of their accounts' money in and out by category and by month (wages, rent and upkeep among
// them, as the journal books them) and where each need they keep would stand at its end. It is today's own
// simulation run on a copy of the state and read off: nothing is recorded, applied or moved, and the
// state the call reads has no part in it.

import type { JsonObject, JsonValue } from "rp-harness/contract";
import { calendarOf, formatClock } from "../../engine/calendar";
import { advance, ALL_NOTE } from "../../engine/simulate";
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
    // Today's engine run over the span on a copy: its books and its needs at the end are what the span would bring.
    const w = new Working(r.registry, r.doc, r.state.world);
    const run = advance(r.registry, w, to, { runSeed: `totals:${call.scope.chat}`, mode: "timelapse", cause: "advance", includePov: true, povRoutine: false, interrupts: ALL_NOTE, unitCap: clampUnitCap(r.state.world.time.unitCap) });
    const accounts = Object.keys(r.state.world.entities).filter((id) => r.state.world.entities[id].kind === "account" && ownersOf(r.state.world, id).some((o) => o.party === who.id));
    const tuned = needsSettingsOf(r.world);
    const needs: JsonObject = {};
    for (const need of NEED_IDS) {
      if (tuned[need].on) needs[need] = { from: Math.round(needValue(r.ctx, who.id, need, from)), to: Math.round(needValue(w.ctx, who.id, need, run.to)) };
    }
    const cal = calendarOf(r.world);
    if (run.stop !== "target") reply.line("totals_cut_short", { reached: formatClock(cal, run.to), until: formatClock(cal, to) });
    reply.data({ who: who.id, name: who.name, from: formatClock(cal, from), until: formatClock(cal, run.to), minutes: run.to - from, money: accounts.map((a) => moneyOf(r.state.world, w.state, r.world, a, from, run.to)) as unknown as JsonValue, needs });
    return undefined;
  },
});

export const TOTALS_TOOLS = [totals];
