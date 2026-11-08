// A sandbox (DESIGN §23): a scratch copy of a chat's head on this machine, played by the bundled
// engine with no model. It opens from the chat's export (`lre.chat.export`, behind the GM gate),
// plays typed turns as Playtest does (money said in words too: "send $500 to Danny"), and moves its
// clock up to a year at a time as Check world moves a day, each month told in a digest of its
// money: postings by holder; bills, pays and standing payments; what was dropped, failed or
// leaked; and its slowest processes, wall clock. An advance given a time budget stops when it runs
// out, with a cursor that goes on from there. Nothing it does reaches the chat or the host. A
// process holds at most SANDBOX_MAX, each until it is closed or the process ends.

import { calendarOf, clockAt, dateAt, formatClock, monthName, type Calendar } from "../engine/calendar";
import { ENGINE_EVENTS } from "../engine/engine-pack";
import type { GmWorldPart } from "../engine/gm-view";
import type { WorldState } from "../engine/state";
import { FINANCE_EVENTS, ownersIn } from "../shared/finance";
import { GM_KEYED_PARTS, GM_PARTS, keyedItem, type GmOutline, type GmReadPart } from "../shared/gm-parts";
import { isRecord, type JsonObject } from "../shared/json";
import type { LedgerEvent } from "../shared/ledger";
import type { ChatExport } from "../shared/protocol";
import { formatMs } from "../shared/timeouts";
import type { WorldDoc } from "../shared/world";
import { ENGINE_VERSION, formatMoney } from "../shared/world";
import { ToolError } from "../shared/tool-args";
import { sandboxGmCount, sandboxGmPart, sandboxGmWorld, sandboxSpan, sandboxTurn } from "./local-engine";
import { noneNamed, type GmReadPick, type GmSource } from "../shared/chat-reads";

/** How many sandboxes one process holds at once: each is a whole world and its state. */
export const SANDBOX_MAX = 3;
/** The most days one advance moves: a leap year's. */
export const ADVANCE_MAX_DAYS = 366;
/** The most typed turns one call plays. */
export const TURNS_MAX = 50;
/** How long an MCP server's advance runs by default before it stops with a cursor: its client waits on the call, and gives up on a long one. */
export const SANDBOX_BUDGET_MS = 20_000;

const DAY_MINUTES = 24 * 60;

/** One holder's money over a span: what came into their accounts and went out, and how many postings moved it. A joint account's holders are one holder, named together. */
export interface HolderMoney {
  holder: string;
  ids: string[];
  in: string;
  out: string;
  net: string;
  postings: number;
}

/** A statement a loan or card closed: what it owed with the interest charged in it, and the payment due. */
export interface Bill {
  account: string;
  id: string;
  owed: string;
  interest: string;
  minimum: string;
  due: string;
}

/** A paycheck: whose, for which job, gross and net, and the day it pays through. */
export interface Pay {
  worker: string;
  job: string;
  gross: string;
  net: string;
  through: string;
}

/** A standing payment's runs in a month: how many, what they paid, and how each ended (`paid`, `short`, `declined`…). */
export interface FlowRuns {
  flow: string;
  id: string;
  runs: number;
  paid: string;
  outcomes: Record<string, number>;
}

/** A finding, and how many times it came up. */
export interface Seen {
  what: string;
  times: number;
}

/** One calendar month of an advance (or the part of it the advance covered). */
export interface MonthDigest {
  month: string;
  from: string;
  to: string;
  postings: HolderMoney[];
  bills: Bill[];
  pays: Pay[];
  flows: FlowRuns[];
  dropped: Seen[];
  failed: Seen[];
  /** Read at the month's end, and at the advance's. */
  leaks: Seen[];
  /**
   * The month's five slowest simulated processes, by their time over all its days, wall clock
   * ("Slowest processes: economy.flows 1.2 s · castlife.agents 340 ms"); absent when none ran. Timing
   * only: it differs from run to run, so no state, event or comparison reads it.
   */
  slowest?: string;
}

/** One typed turn, as its answer tells it. */
export interface SandboxTurn {
  user: string;
  reply: string;
  notes: string[];
  clock: string;
  money: HolderMoney[];
}

/** One advance: from when to when, each month's digest, why it stopped short when it did, and where it goes on from when its time ran out. */
export interface Advance {
  from: string;
  to: string;
  days: number;
  months: MonthDigest[];
  stopped?: string;
  /** The advance ran out of time short of `until`: `goOn` takes `cursor` to go on there. */
  goesOn?: { cursor: string; until: string };
}

export type SandboxLog = { turn: SandboxTurn } | { advance: Advance };

export interface Sandbox {
  id: string;
  chatId: string;
  worldId: string;
  revision: string;
  runSeed: string;
  world: WorldDoc;
  state: WorldState;
  /** The clock it opened at. */
  opened: number;
  /** Turns and spans played: each draws from its own seed. */
  steps: number;
  /** What it did, oldest first, each advance with every month's digest whole. */
  log: SandboxLog[];
}

const open = new Map<string, Sandbox>();
let made = 0;

/** The open sandboxes as answers list them. */
export function openList(): JsonObject[] {
  return [...open.values()].map((sb) => ({ sandbox: sb.id, chatId: sb.chatId, world: sb.world.name, clock: clockLabel(sb, sb.state.clock), turns: sb.log.filter((l) => "turn" in l).length, days: Math.floor((sb.state.clock - sb.opened) / DAY_MINUTES) }));
}

/** An open sandbox by its id; refused with the open ones when there is none. */
export function sandboxOf(id: string): Sandbox {
  const sb = open.get(id);
  if (sb) return sb;
  const ids = [...open.keys()];
  throw new ToolError(`There is no sandbox ${id} in this process${ids.length > 0 ? `; open: ${ids.join(", ")}` : ""}. A sandbox lives as long as the process that opened it: an MCP server's until it stops, a command line's for that one command (give lre_sandbox_open its turns and days there). lre_sandbox_open opens one.`);
}

export function closeSandbox(id: string): void {
  sandboxOf(id);
  open.delete(id);
}

/**
 * A sandbox from a chat's export: refused when LumiRPEngine on the host runs another engine than
 * this client bundles (its days would play differently), when the export isn't a chat head, and
 * when SANDBOX_MAX are open.
 */
export function openSandbox(exported: ChatExport): Sandbox {
  if (exported.engine !== ENGINE_VERSION) throw new ToolError(`Not opened: chat ${exported.chatId} runs on engine ${exported.engine} on your Lumiverse, and this client bundles engine ${ENGINE_VERSION}, so a sandbox would play differently from the chat. Use the client that matches (an MCP server that follows LumiRPEngine's kit does), or update the older of the two.`);
  const state = exported.state as unknown;
  if (!isRecord(exported.world) || !isRecord(state) || typeof state.clock !== "number" || !isRecord(state.entities)) throw new ToolError(`Not opened: LumiRPEngine sent no head of chat ${exported.chatId} to copy.`);
  if (open.size >= SANDBOX_MAX) throw new ToolError(`Not opened: ${SANDBOX_MAX} sandboxes are open in this process (${[...open.keys()].join(", ")}), each a whole world. Close one with lre_sandbox_close first.`);
  const sb: Sandbox = { id: `sb${++made}`, chatId: exported.chatId, worldId: exported.worldId, revision: exported.revision, runSeed: exported.runSeed, world: exported.world, state: state as unknown as WorldState, opened: exported.clock, steps: 0, log: [] };
  open.set(sb.id, sb);
  return sb;
}

function clockLabel(sb: Sandbox, clock: number): string {
  return formatClock(calendarOf(sb.world), clock);
}

/** Typed turns on the sandbox, one after another, each as Playtest plays it, with the money each moved. */
export function playTurns(sb: Sandbox, turns: readonly string[]): SandboxTurn[] {
  return turns.map((user) => {
    const step = sandboxTurn(sb.world, sb.state, user, sb.runSeed, sb.steps++);
    sb.state = step.state;
    const tally = new Tally();
    tally.add(sb, step.events);
    const turn: SandboxTurn = { ...step.turn, clock: clockLabel(sb, sb.state.clock), money: tally.money(sb) };
    sb.log.push({ turn });
    return turn;
  });
}

/**
 * Moves the sandbox's clock `days` days on, a span at a time as Check world moves a day, every
 * interrupt at `note`: each span ends at the next local midnight, the last at the target, so each
 * lies in one day and each month's digest holds its own days. The narrator's sections are read for
 * leaks at each month's end and at the target. A span whose clock stops short (a paused clock, a
 * timelapse that can't run) stops the advance there. With `budgetMs`, a span starts only while that
 * much time hasn't passed since the advance began (the first always does): one left out stops it at
 * that midnight with a cursor, and going on from the cursor plays the spans this advance would have.
 */
export function advance(sb: Sandbox, days: number, budgetMs: number | null = null): Advance {
  return advanceTo(sb, sb.state.clock + days * DAY_MINUTES, budgetMs);
}

/** Goes on with an advance its budget stopped, to the target it was moving to; refused for a cursor that isn't this sandbox's, or whose advance is done. */
export function goOn(sb: Sandbox, cursor: string, budgetMs: number | null = null): Advance {
  const parsed = /^(sb\d+)@(-?\d+)$/.exec(cursor.trim());
  const target = Number(parsed?.[2]);
  if (!parsed || !Number.isSafeInteger(target) || target - sb.state.clock > ADVANCE_MAX_DAYS * DAY_MINUTES) throw new ToolError(`${JSON.stringify(cursor)} isn't a cursor an advance gave: give the cursor its answer holds, or days.`);
  if (parsed[1] !== sb.id) throw new ToolError(`That cursor goes on with sandbox ${parsed[1] ?? ""}'s advance, not ${sb.id}'s.`);
  if (target <= sb.state.clock) throw new ToolError(`That advance is done: sandbox ${sb.id} stands at ${clockLabel(sb, sb.state.clock)}, past ${clockLabel(sb, target)}, where it was going. Give days to move it on.`);
  return advanceTo(sb, target, budgetMs);
}

function advanceTo(sb: Sandbox, target: number, budgetMs: number | null): Advance {
  const began = performance.now();
  const cal = calendarOf(sb.world);
  const start = sb.state.clock;
  const ends: number[] = [];
  for (let at = nextMidnight(cal, start); at < target; at = nextMidnight(cal, at)) ends.push(at);
  ends.push(target);
  const months: { key: string; label: string; from: number; to: number; tally: Tally }[] = [];
  let stopped: string | undefined;
  let goesOn: Advance["goesOn"];
  for (const end of ends) {
    const from = sb.state.clock;
    if (from >= end) continue;
    if (budgetMs !== null && from > start && performance.now() - began >= budgetMs) {
      goesOn = { cursor: `${sb.id}@${target}`, until: clockLabel(sb, target) };
      break;
    }
    const day = dateAt(cal, from);
    const after = dateAt(cal, end);
    const monthEnds = end === target || after.month !== day.month || after.year !== day.year;
    const step = sandboxSpan(sb.world, sb.state, sb.runSeed, sb.steps++, end, monthEnds);
    sb.state = step.state;
    const key = `${day.year}-${day.month}`;
    let month = months.at(-1);
    if (month?.key !== key) {
      month = { key, label: `${monthName(cal, day.month)} ${day.year}`, from, to: from, tally: new Tally() };
      months.push(month);
    }
    month.to = sb.state.clock;
    month.tally.add(sb, step.events, step.findings);
    month.tally.time(step.turn.processMs);
    if (sb.state.clock < end) {
      // Why it stopped: the span's failure, else the engine's note that the timelapse couldn't run (a paused clock).
      const note = step.events.map((e) => (e.type === ENGINE_EVENTS.note ? text(dataOf(e).text) : "")).find((t) => t.startsWith("Timelapse not run"));
      stopped = `The clock stopped at ${clockLabel(sb, sb.state.clock)}: ${step.findings.failed[0] ?? note ?? "the day's timelapse didn't reach its end"}.`;
      break;
    }
  }
  const done: Advance = {
    from: clockLabel(sb, start),
    to: clockLabel(sb, sb.state.clock),
    days: Math.floor((sb.state.clock - start) / DAY_MINUTES),
    months: months.map((m) => m.tally.digest(sb, m.label, m.from, m.to)),
    ...(stopped !== undefined ? { stopped } : {}),
    ...(goesOn !== undefined ? { goesOn } : {}),
  };
  sb.log.push({ advance: done });
  return done;
}

function nextMidnight(cal: Calendar, clock: number): number {
  return clockAt(cal, dateAt(cal, clock).dayIndex + 1, 0);
}

const dataOf = (e: LedgerEvent): JsonObject => ("data" in e && isRecord(e.data) ? e.data : {});
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const text = (v: unknown): string => (typeof v === "string" ? v : "");

/** How many processes a month's digest names as its slowest. */
const SLOWEST = 5;

/** What a span's events did to money, what its findings say, and how long its processes took, added up. */
class Tally {
  private readonly holders = new Map<string, { ids: string[]; in: number; out: number; postings: number }>();
  private readonly bills: Bill[] = [];
  private readonly pays: Pay[] = [];
  private readonly flows = new Map<string, { label: string; runs: number; paid: number; outcomes: Record<string, number> }>();
  private readonly found = { dropped: new Map<string, number>(), failed: new Map<string, number>(), leaks: new Map<string, number>() };
  private readonly processMs = new Map<string, number>();

  add(sb: Sandbox, events: readonly LedgerEvent[], findings?: { dropped: string[]; failed: string[]; leaks: string[] }): void {
    const { state, world } = sb;
    const cal = calendarOf(world);
    const money = (c: number): string => formatMoney(c, world.currency);
    const named = (id: string): string => state.entities[id]?.name ?? id;
    for (const e of events) {
      if (e.type === "post") {
        const touched = new Set<string>();
        for (const line of e.lines) {
          // An account outside the world (a payee's, a lender's) is no one's here.
          const account = state.entities[line.account];
          if (account === undefined) continue;
          const ids = [...new Set(ownersIn(account.fields).map((o) => o.party))];
          const whose = ids.length > 0 ? ids : [line.account];
          const key = whose.join("+");
          const row = this.holders.get(key) ?? { ids: whose, in: 0, out: 0, postings: 0 };
          if (line.amount > 0) row.in += line.amount;
          else row.out -= line.amount;
          if (!touched.has(key)) row.postings++;
          touched.add(key);
          this.holders.set(key, row);
        }
        continue;
      }
      const d = dataOf(e);
      if (e.type === FINANCE_EVENTS.statement) this.bills.push({ account: named(text(d.account)), id: text(d.account), owed: money(num(d.closing)), interest: money(num(d.interest)), minimum: money(num(d.minimum)), due: formatClock(cal, num(d.due)) });
      else if (e.type === "economy.payslip") this.pays.push({ worker: named(text(d.worker)), job: named(text(d.job)), gross: money(num(d.gross)), net: money(num(d.net)), through: formatClock(cal, num(d.through)) });
      else if (e.type === FINANCE_EVENTS.flowRun) {
        const id = text(d.flow);
        const row = this.flows.get(id) ?? { label: text(d.label) || id, runs: 0, paid: 0, outcomes: {} };
        row.runs++;
        const outcome = text(d.outcome) || "ran";
        if (outcome !== "declined") row.paid += num(d.cents);
        row.outcomes[outcome] = (row.outcomes[outcome] ?? 0) + 1;
        this.flows.set(id, row);
      }
    }
    if (!findings) return;
    for (const kind of ["dropped", "failed", "leaks"] as const) for (const what of findings[kind]) this.found[kind].set(what, (this.found[kind].get(what) ?? 0) + 1);
  }

  /** A span's time per simulated process (`PlaytestTurn.processMs`), added to each one's. */
  time(ms: Readonly<Record<string, number>> | undefined): void {
    for (const [id, spent] of Object.entries(ms ?? {})) this.processMs.set(id, (this.processMs.get(id) ?? 0) + spent);
  }

  /** Each holder's money, the most moved first. */
  money(sb: Sandbox): HolderMoney[] {
    const money = (c: number): string => formatMoney(c, sb.world.currency);
    return [...this.holders.values()]
      .sort((a, b) => b.in + b.out - (a.in + a.out))
      .map((h) => ({ holder: h.ids.map((id) => sb.state.entities[id]?.name ?? id).join(" & "), ids: h.ids, in: money(h.in), out: money(h.out), net: `${h.in > h.out ? "+" : ""}${money(h.in - h.out)}`, postings: h.postings }));
  }

  digest(sb: Sandbox, month: string, from: number, to: number): MonthDigest {
    const money = (c: number): string => formatMoney(c, sb.world.currency);
    const seen = (found: Map<string, number>): Seen[] => [...found].map(([what, times]) => ({ what, times })).sort((a, b) => b.times - a.times);
    return {
      month,
      from: clockLabel(sb, from),
      to: clockLabel(sb, to),
      postings: this.money(sb),
      bills: this.bills,
      pays: this.pays,
      flows: [...this.flows].map(([id, f]) => ({ flow: f.label, id, runs: f.runs, paid: money(f.paid), outcomes: f.outcomes })).sort((a, b) => b.runs - a.runs || a.flow.localeCompare(b.flow)),
      dropped: seen(this.found.dropped),
      failed: seen(this.found.failed),
      leaks: seen(this.found.leaks),
      ...(this.processMs.size > 0 ? { slowest: `Slowest processes: ${[...this.processMs].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, SLOWEST).map(([id, ms]) => `${id} ${formatMs(ms)}`).join(" · ")}` } : {}),
    };
  }
}

/** A month's digest with each list cut to `cap` entries, saying how many more each holds. */
export function cutDigest(m: MonthDigest, cap: number): JsonObject {
  const cut = <T>(key: string, list: readonly T[]): JsonObject => ({ [key]: JSON.parse(JSON.stringify(list.slice(0, cap))) as JsonObject[], ...(list.length > cap ? { [`more${key[0]?.toUpperCase() ?? ""}${key.slice(1)}`]: list.length - cap } : {}) });
  return { month: m.month, from: m.from, to: m.to, ...cut("postings", m.postings), ...cut("bills", m.bills), ...cut("pays", m.pays), ...cut("flows", m.flows), ...cut("dropped", m.dropped), ...cut("failed", m.failed), ...cut("leaks", m.leaks), ...(m.slowest !== undefined ? { slowest: m.slowest } : {}) };
}

// ---------------------------------------------------------------- the GM view of a sandbox

/** The parts of the GM view a sandbox has: the world's, as it stands. The chat's own (its edits, refused and held writes, minds) stay the chat's. */
export const SANDBOX_PARTS: readonly GmWorldPart[] = GM_PARTS.filter((p): p is GmWorldPart => !["edits", "refused", "held", "minds"].includes(p));

/** A sandbox as a GM read reads it (`gmRead`): its world parts, each built alone, keyed by id or name as `lre.gm.part` keys them, some by ids or of a kind as it picks them. */
export function sandboxGm(sb: Sandbox): GmSource {
  const part = (asked: GmReadPart, pick: GmReadPick = {}): { id: string | null; value: unknown } => {
    const world = SANDBOX_PARTS.find((p) => p === asked);
    if (world === undefined) throw new ToolError(`A sandbox has no ${asked}: its parts are ${SANDBOX_PARTS.join(", ")}. The chat's own (its edits, refused and held writes, and minds) are read with lre_gm.`);
    const keyed = GM_KEYED_PARTS.find((p) => p === world);
    const id = pick.id;
    if (keyed === undefined || id === undefined) return { id: null, value: sandboxGmPart(sb.world, sb.state, world, { ...(pick.ids ? { ids: pick.ids } : {}), ...(pick.kind !== undefined ? { kind: pick.kind } : {}) }) };
    const ambiguous = (ids: string[]): ToolError => new ToolError(`${ids.length} have the name ${JSON.stringify(id)}: ${ids.join(", ")}; name one by its id.`);
    if (keyed === "orgs") {
      const orgs = sandboxGmPart(sb.world, sb.state, "orgs");
      const named = keyedItem(orgs, id, (o) => o.page.id, (o) => o.page.name);
      if (named && "ambiguous" in named) throw ambiguous(named.ambiguous);
      return named ? { id: named.item.page.id, value: [named.item] } : { id, value: [] };
    }
    const named = keyedItem(
      Object.entries(sb.state.entities).map(([e, def]) => ({ id: e, name: def.name })),
      id,
      (e) => e.id,
      (e) => e.name,
    );
    if (named && "ambiguous" in named) throw ambiguous(named.ambiguous);
    return named ? { id: named.item.id, value: sandboxGmPart(sb.world, sb.state, keyed, { ids: [named.item.id] }) } : { id, value: [] };
  };
  return {
    what: `sandbox ${sb.id} (a scratch copy of chat ${sb.chatId}, now ${clockLabel(sb, sb.state.clock)})`,
    parts: SANDBOX_PARTS,
    part: async (asked, pick) => part(asked, pick),
    outline: async (): Promise<GmOutline> => SANDBOX_PARTS.map((p) => ({ part: p, count: sandboxGmCount(sb.world, sb.state, p) })),
    whole: async () => sandboxGmWorld(sb.world, sb.state),
    noneNamed: (keyed, said) => noneNamed(keyed, said, `sandbox ${sb.id}`),
  };
}
