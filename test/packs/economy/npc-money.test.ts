// Everyone's money moves both ways and can be inspected (issue 13): a bill paid to a person in the
// world lands in their account, the money processes open the authored accounts of the people they
// act for, people pay bills and living costs, and their lines and notes are kept for the GM view
// without ever reaching the player or stopping the player's timelapse.
import { describe, expect, test } from "bun:test";
import type { LedgerEvent } from "../../../src/shared/ledger";
import type { GmView } from "../../../src/shared/state-view";
import type { WorldDoc } from "../../../src/shared/world";
import { buildGmWorld } from "../../../src/engine/gm-view";
import { materializeAll } from "../../../src/engine/materialize";
import { playerLines } from "../../../src/engine/player-events";
import { createRegistry } from "../../../src/engine/registry-impl";
import { ALL_NOTE } from "../../../src/engine/simulate";
import { runTimelapse } from "../../../src/engine/time";
import { Working } from "../../../src/engine/working";
import { ALL_PACKS, STARTER_WORLDS } from "../../../src/packs/index";
import { startState, trialBalance } from "../support";

const reg = createRegistry(ALL_PACKS);
const PEOPLE = ["danny_okafor", "priya_nair", "jess_kowalczyk", "nora_whitfield", "dale_whitcomb", "helen_kowalczyk", "marcus_delgado"];

/** Port Alder at its own (Simulation) levels as a chat starts it: only the POV materialized. */
function portAlder(patch: (world: WorldDoc) => void = () => undefined): Working {
  const make = STARTER_WORLDS.modern_slice_of_life;
  if (!make) throw new Error("no Port Alder starter");
  const world = make("pa", "Port Alder");
  patch(world);
  const w = new Working(reg, world, startState(world));
  materializeAll(reg, w, world.pov, "run");
  return w;
}

function lapse(w: Working, days: number, overrides: Record<string, "stop" | "note" | "ignore"> = ALL_NOTE) {
  const out = runTimelapse(reg, w, { type: "duration", minutes: days * 1440 }, { runSeed: "run", overrides });
  if ("code" in out) throw new Error(out.reason);
  return out;
}

function gm(w: Working): Pick<GmView, "money"> {
  return buildGmWorld(reg, w.world, w.state);
}

/** Each account's postings over the run, in and out. */
function moved(events: readonly LedgerEvent[], account: string): { in: number; out: number } {
  const m = { in: 0, out: 0 };
  for (const e of events) {
    if (e.type !== "post") continue;
    for (const l of e.lines) if (l.account === account) m[l.amount >= 0 ? "in" : "out"] += Math.abs(l.amount);
  }
  return m;
}

describe("people's money (Port Alder at Simulation over a month)", () => {
  test("rent paid to Helen lands in her account; everyone pays outgoings; the GM view shows it; the books balance", () => {
    const w = portAlder();
    const start = w.events.length;
    lapse(w, 31);
    const events = w.events.slice(start);
    expect(trialBalance(w.state)).toBe(0);
    expect(w.dropped).toEqual([]);
    // The player's rent reaches Helen's checking, not an outside account named after her.
    const rent = events.find((e) => e.type === "post" && e.memo === "Rent, Unit 2B");
    expect(rent?.type === "post" ? rent.lines : null).toEqual([
      { account: "acct_pov_checking", amount: -99500 },
      { account: "acct_helen_checking", amount: 99500 },
    ]);
    // Their authored opening balances were posted before their bills drew on them.
    for (const who of PEOPLE) expect(w.state.materialized[`${who}:money`]).toBeDefined();
    // Money moves both ways for everyone with income and outgoings.
    const accounts = Object.entries(w.world.entities).filter(([, e]) => e.kind === "account" && PEOPLE.includes(String(e.fields.owner)));
    expect(accounts.length).toBe(PEOPLE.length);
    for (const [id] of accounts) {
      const m = moved(events, id);
      expect(m.in).toBeGreaterThan(0);
      expect(m.out).toBeGreaterThan(0);
    }
    // The GM view lists their money with the lines and notes the processes kept.
    const view = gm(w);
    const helen = view.money.find((m) => m.entity === "helen_kowalczyk");
    expect(helen?.accounts.map((a) => [a.id, a.cents])).toEqual([["acct_helen_checking", w.state.accounts.acct_helen_checking ?? 0]]);
    expect(helen?.recent.some((r) => r.memo === "Rent, Unit 2B" && r.cents === 99500)).toBe(true);
    expect(helen?.recent.some((r) => r.memo === "Household share, 1A" && r.cents === 30000)).toBe(true);
    const danny = view.money.find((m) => m.entity === "danny_okafor");
    expect(danny?.notes.some((n) => n.text.startsWith("Payday:"))).toBe(true);
    expect(danny?.recent.some((r) => r.memo === "Living costs" && r.cents < 0)).toBe(true);
    expect(view.money.some((m) => m.entity === w.world.pov)).toBe(false);
    // None of it reaches the player: their notes and postings are no player line.
    const lines = playerLines(reg, w.world, w.state, w.world.pov, events, 1000);
    expect(lines.some((l) => l.includes("Unit 2A") || l.includes("Household share") || l.includes("Living costs"))).toBe(false);
  });

  test("an NPC's declined bill is a private note: it never stops the player's timelapse", () => {
    const w = portAlder((world) => {
      const fields = world.entities.danny_okafor?.fields;
      if (fields) fields.bills = [{ label: "Boat loan", payee: "Lakeshore Credit Union", amountCents: 9_000_000, every: "month", day: 20, from: "acct_danny_checking" }];
    });
    const start = w.events.length;
    // Mon 14 to Thu 24 September: the bill falls due on the 20th, and declines stop this run.
    const out = lapse(w, 10, { ...ALL_NOTE, decline: "stop" });
    expect(out.result.stop).toBe("target");
    const events = w.events.slice(start);
    expect(events.some((e) => e.type === "economy.decline")).toBe(false);
    expect(events.some((e) => e.type === "engine.signal" && "data" in e && e.data.entity === "danny_okafor" && (e.data.class === "decline" || e.data.class === "bill"))).toBe(false);
    const danny = gm(w).money.find((m) => m.entity === "danny_okafor");
    expect(danny?.notes.some((n) => n.text.includes("Boat loan") && n.text.includes("declined"))).toBe(true);
  });

  test("two bills due the same morning that only one covers: the first pays, the second declines, nothing is dropped", () => {
    const w = portAlder((world) => {
      const fields = world.entities.jess_kowalczyk?.fields;
      if (fields) fields.bills = [{ label: "First", payee: "Somewhere", amountCents: 50000, every: "month", day: 1, from: "acct_jess_checking" }, { label: "Second", payee: "Somewhere", amountCents: 50000, every: "month", day: 1, from: "acct_jess_checking" }];
      const acct = world.entities.acct_jess_checking;
      if (acct) acct.fields.opening = 0;
      // Jess's pay alone, about 445 a week, covers one of the two bills by the 1st.
      if (fields) fields.hourly_cents = 1650;
    });
    lapse(w, 20);
    expect(w.dropped).toEqual([]);
    expect(trialBalance(w.state)).toBe(0);
    const jess = gm(w).money.find((m) => m.entity === "jess_kowalczyk");
    expect(jess?.notes.some((n) => n.text.startsWith("First:") && n.text.endsWith("paid."))).toBe(true);
    expect(jess?.notes.some((n) => n.text.startsWith("Second") && n.text.includes("declined"))).toBe(true);
  });

  test("living costs follow a world's own amounts by wealth band, and never charge the POV", () => {
    const w = portAlder((world) => {
      const economy = world.packs.economy;
      if (economy) economy.config = { livingCosts: { broke: 100, poor: 200, modest: 300, comfortable: 400, rich: 500, wealthy: 600 } };
    });
    const start = w.events.length;
    lapse(w, 8);
    const living = w.events.slice(start).filter((e) => e.type === "post" && e.memo === "Living costs");
    expect(living.length).toBeGreaterThan(0);
    for (const e of living) {
      if (e.type !== "post") continue;
      const paid = e.lines.find((l) => l.amount < 0);
      const owner = String(w.world.entities[paid?.account ?? ""]?.fields.owner ?? "");
      expect(owner).not.toBe(w.world.pov);
      expect([100, 200, 300, 400, 500, 600]).toContain(-(paid?.amount ?? 0));
    }
  });
});
