// The economy's events and the state they fold into (DESIGN §25.4, §25.6): the transaction
// journal per account (with monthly totals by category and the average-daily-balance accrual),
// private notes, statement cycles and delinquency, flow runs, holds and settlement, opened
// accounts and statuses, credit history and scores, card spending, price modifiers and level-1
// anchors. The events of chats recorded before the rebuild (`anchor`, `txn`, `note`, `modifier`,
// `statement`, `card_paid`, `decline`) fold here unchanged.

import type { JsonObject, JsonValue } from "../../../shared/json";
import type { EntityId } from "../../../shared/ids";
import type { PackEvent } from "../../../shared/ledger";
import { ACCOUNT_STATUSES, DELINQUENCY_STAGES, FINANCE_EVENTS, isCredit, type AccountStatus, type CycleState, type DelinquencyStage, type FlowRunState, type JournalEntry } from "../../../shared/finance";
import { formatMoney } from "../../../shared/world";
import { calendarOf, dateAt } from "../../../engine/calendar";
import { mutableSlice, numOf, objOf, own, sliceOf, sliceRecord, strOf } from "../../../engine/pack-kit";
import type { EventTypeDef, ReadContext, Rejection } from "../../../engine/registry";
import type { WorldState } from "../../../engine/state";
import { availableOf, balance, classOf } from "./model";

/** Journal lines kept per account, notes per party, months of totals per account, credit entries and scores per person. */
export const JOURNAL_CAP = 40;
export const NOTES_CAP = 12;
const MONTHS_KEPT = 13;
const CREDIT_CAP = 60;
const SCORES_KEPT = 24;
const STATEMENTS_KEPT = 6;

export function reject(code: string, reason: string): Rejection {
  return { code, reason };
}

export function str(e: PackEvent, k: string): string {
  return typeof e.data[k] === "string" ? (e.data[k] as string) : "";
}

/** A month's key in the economy's totals: `YYYY-MM` in the world's calendar. */
export function monthKey(ctx: Pick<ReadContext, "world">, at: number): string {
  const d = dateAt(calendarOf(ctx.world), at);
  return `${String(d.year).padStart(4, "0")}-${String(d.month).padStart(2, "0")}`;
}

// ---------------------------------------------------------------- reads of the folded state

export function journalOf(state: Readonly<WorldState>, account: EntityId): JournalEntry[] {
  const raw = own(objOf(sliceOf(state, "economy").journal), account);
  return Array.isArray(raw) ? raw.map((x) => objOf(x) as unknown as JournalEntry) : [];
}

export function cycleOf(state: Readonly<WorldState>, account: EntityId): CycleState | null {
  const raw = objOf(own(objOf(sliceOf(state, "economy").cycles), account));
  if (Object.keys(raw).length === 0) return null;
  return {
    closing: numOf(raw.closing),
    interest: numOf(raw.interest),
    fees: numOf(raw.fees),
    minimum: numOf(raw.minimum),
    due: numOf(raw.due),
    paid: numOf(raw.paid),
    at: numOf(raw.at),
    apr: numOf(raw.apr),
    stage: (DELINQUENCY_STAGES as readonly string[]).includes(strOf(raw.stage)) ? (strOf(raw.stage) as DelinquencyStage) : "current",
    grace: raw.grace !== false,
    past_due: numOf(raw.past_due),
    lates: numOf(raw.lates),
    penalty: raw.penalty === true,
    ...(typeof raw.months_left === "number" ? { months_left: raw.months_left } : {}),
    streak: numOf(raw.streak),
    ontime: numOf(raw.ontime),
    late30: numOf(raw.late30),
    late60: numOf(raw.late60),
    late90: numOf(raw.late90),
  };
}

export function flowRunOf(state: Readonly<WorldState>, flow: string): FlowRunState {
  const raw = objOf(own(objOf(sliceOf(state, "economy").flows), flow));
  const retry = objOf(raw.retry);
  return {
    done: numOf(raw.done),
    missed: numOf(raw.missed),
    ...(typeof raw.last === "number" ? { last: raw.last } : {}),
    ...(typeof retry.at === "number" ? { retry: { at: retry.at, left: numOf(retry.left), cents: numOf(retry.cents) } } : {}),
    ...(numOf(raw.deferred) > 0 ? { deferred: numOf(raw.deferred) } : {}),
    ...(raw.ended === true ? { ended: true } : {}),
  };
}

/** Whether an account's opening balance has posted: recorded as opened, or (an account an older chat holds) its opener's money is open. */
export function isOpened(state: Readonly<WorldState>, account: EntityId, opener: EntityId | null): boolean {
  if (own(objOf(sliceOf(state, "economy").opened), account) === true) return true;
  return opener !== null && Object.prototype.hasOwnProperty.call(state.materialized, `${opener}:money`);
}

/** The average daily balance accrual of an account: since when, the last change, and balance × minutes so far. */
export function accrualOf(state: Readonly<WorldState>, account: EntityId): { from: number; at: number; sum: number; spent: number } | null {
  const raw = objOf(own(objOf(sliceOf(state, "economy").adb), account));
  return typeof raw.from === "number" ? { from: raw.from, at: numOf(raw.at, raw.from), sum: numOf(raw.sum), spent: numOf(raw.spent) } : null;
}

/** The average balance over `[from, now]`, from the accrual (the current balance when nothing accrued). */
export function averageBalance(state: Readonly<WorldState>, account: EntityId, now: number): number {
  const a = accrualOf(state, account);
  const b = balance(state, account);
  if (!a || now <= a.from) return b;
  return (a.sum + b * Math.max(0, now - a.at)) / (now - a.from);
}

export function spendOf(state: Readonly<WorldState>, card: EntityId, day: number): { purchase: number; atm: number } {
  const raw = objOf(own(objOf(sliceOf(state, "economy").spend), card));
  return numOf(raw.day, NaN) === day ? { purchase: numOf(raw.purchase), atm: numOf(raw.atm) } : { purchase: 0, atm: 0 };
}

// ---------------------------------------------------------------- reducers

function pushCapped(list: JsonValue | undefined, entry: JsonValue, cap: number): JsonValue[] {
  return [...(Array.isArray(list) ? list.slice(-(cap - 1)) : []), entry];
}

/** Files one journal line, its month's total, and the average-daily-balance accrual. */
function fileLine(state: WorldState, ctx: ReadContext, account: EntityId, amount: number, at: number, data: JsonObject, seq: number): void {
  const journal = sliceRecord(state, "economy", "journal");
  const status = data.status === "pending" ? "pending" : "posted";
  const entry: JsonObject = { id: `j${seq}`, at, account, cents: amount, memo: strOf(data.memo), status };
  for (const k of ["kind", "category", "counterparty", "card", "flow"] as const) if (typeof data[k] === "string" && data[k] !== "") entry[k] = data[k];
  if (status === "pending" && typeof data.settles === "number") entry.settles = data.settles;
  journal[account] = pushCapped(journal[account], entry, JOURNAL_CAP);

  const totals = sliceRecord(state, "economy", "totals");
  const months = objOf(totals[account]);
  const key = monthKey(ctx, at);
  const month = objOf(months[key]);
  const category = strOf(data.category) || "other";
  const cell = objOf(month[category]);
  month[category] = { in: numOf(cell.in) + Math.max(0, amount), out: numOf(cell.out) + Math.max(0, -amount) };
  months[key] = month;
  for (const old of Object.keys(months).sort().slice(0, -MONTHS_KEPT)) delete months[old];
  totals[account] = months;
}

function accrue(state: WorldState, account: EntityId, amount: number, at: number, purchase: boolean): void {
  const adb = sliceRecord(state, "economy", "adb");
  const cur = objOf(adb[account]);
  const before = balance(state, account) - amount;
  if (typeof cur.from !== "number") {
    adb[account] = { from: at, at, sum: 0, spent: purchase ? -amount : 0 };
    return;
  }
  const last = numOf(cur.at, cur.from);
  const dt = Math.max(0, at - last);
  adb[account] = { from: cur.from, at: Math.max(last, at), sum: numOf(cur.sum) + before * dt, spent: numOf(cur.spent) + (purchase ? -amount : 0) };
}

function isCreditAccount(ctx: ReadContext, account: EntityId): boolean {
  const c = classOf(ctx, account);
  return c !== null && isCredit(c);
}

export const EVENTS: EventTypeDef<PackEvent>[] = [
  {
    type: FINANCE_EVENTS.anchor,
    validate: (e, ctx) => (own(ctx.state.entities, str(e, "entity")) && typeof e.data.typical === "number" && typeof e.data.base === "number" ? null : reject("bad_event", "anchor needs entity, typical and base")),
    apply: (e, state) => {
      sliceRecord(state, "economy", "anchors")[str(e, "entity")] = { band: str(e, "band"), typical: numOf(e.data.typical), base: numOf(e.data.base) };
    },
    describe: (e) => `${str(e, "entity")} is ${str(e, "band")}`,
    // An anchor is an assignment: in a record only the last per entity matters.
    coarsen: { key: (e) => str(e, "entity"), merge: (_a, b) => b },
  },
  {
    // A posting's journal lines, one per account in the world it touches, filed with the account.
    type: FINANCE_EVENTS.txn,
    validate: () => null,
    apply: (e, state, ctx) => {
      const lines = Array.isArray(e.data.lines) ? e.data.lines.map((l) => objOf(l)) : [];
      const at = typeof e.data.at === "number" ? e.data.at : state.clock;
      const s = mutableSlice(state, "economy");
      let seq = numOf(s.seq);
      const totals = new Map<string, number>();
      for (const l of lines) {
        const account = strOf(l.account);
        if (!own(state.entities, account)) continue;
        totals.set(account, (totals.get(account) ?? 0) + Math.round(numOf(l.amount)));
      }
      for (const [account, amount] of totals) {
        seq += 1;
        fileLine(state, ctx, account, amount, at, e.data, seq);
        accrue(state, account, amount, at, e.data.kind === "purchase" && isCreditAccount(ctx, account));
      }
      mutableSlice(state, "economy").seq = seq;
    },
    describe: (e) => str(e, "memo"),
  },
  {
    // Someone's payday, bill or decline note, kept for the GM view. It is secret, so it never becomes
    // a player line, and it isn't a signal, so it never stops or joins the POV's timelapse.
    type: FINANCE_EVENTS.note,
    validate: (e, ctx) => (own(ctx.state.entities, str(e, "entity")) && str(e, "text") !== "" ? null : reject("bad_event", "a money note needs a party and its text")),
    apply: (e, state) => {
      const notes = sliceRecord(state, "economy", "notes");
      notes[str(e, "entity")] = pushCapped(notes[str(e, "entity")], { at: typeof e.data.at === "number" ? e.data.at : state.clock, class: str(e, "class"), text: str(e, "text") }, NOTES_CAP);
    },
    describe: (e) => str(e, "text"),
  },
  {
    // A price multiplier (festival, storm, scarcity) by category and place, until a time or until replaced.
    type: FINANCE_EVENTS.modifier,
    validate: (e) => (str(e, "id") !== "" && (e.data.mult === undefined || (typeof e.data.mult === "number" && e.data.mult > 0)) ? null : reject("bad_event", "a price modifier needs an id and a positive multiplier")),
    apply: (e, state) => {
      const mods = sliceRecord(state, "economy", "modifiers");
      if (typeof e.data.mult !== "number") delete mods[str(e, "id")];
      else mods[str(e, "id")] = { scope: strOf(e.data.scope, "all"), place: strOf(e.data.place), mult: e.data.mult, ...(typeof e.data.until === "number" ? { until: e.data.until } : {}) };
    },
    describe: (e) => (typeof e.data.mult === "number" ? `Prices ×${e.data.mult}` : "Prices back to normal"),
  },
  {
    // A credit account's statement closes: the cycle's whole state, and its accrual starts again.
    type: FINANCE_EVENTS.statement,
    validate: (e, ctx) => (isCreditAccount(ctx, str(e, "account")) ? null : reject("bad_event", "statements are for credit accounts")),
    apply: (e, state) => {
      const account = str(e, "account");
      const at = typeof e.data.at === "number" ? e.data.at : state.clock;
      const d = e.data;
      const cycle: JsonObject = { closing: numOf(d.closing), interest: numOf(d.interest), fees: numOf(d.fees), minimum: numOf(d.minimum), due: numOf(d.due), paid: 0, at, apr: numOf(d.apr), stage: strOf(d.stage, "current"), grace: d.grace !== false, past_due: numOf(d.past_due), lates: numOf(d.lates), penalty: d.penalty === true };
      for (const k of ["months_left", "streak", "ontime", "late30", "late60", "late90"] as const) if (typeof d[k] === "number") cycle[k] = d[k];
      const cycles = sliceRecord(state, "economy", "cycles");
      // The statement before stays in the account's history, as it ended.
      if (cycles[account] !== undefined) {
        const past = sliceRecord(state, "economy", "statements");
        past[account] = pushCapped(past[account], cycles[account] as JsonValue, STATEMENTS_KEPT);
      }
      cycles[account] = cycle;
      sliceRecord(state, "economy", "adb")[account] = { from: at, at, sum: 0, spent: 0 };
    },
    describe: (e, ctx) => `Statement: ${formatMoney(numOf(e.data.closing), ctx.world.currency)}, minimum ${formatMoney(numOf(e.data.minimum), ctx.world.currency)}`,
  },
  {
    // A payment toward a credit account's statement.
    type: FINANCE_EVENTS.cardPaid,
    validate: (e, ctx) => (isCreditAccount(ctx, str(e, "account")) ? null : reject("bad_event", "statement payments are for credit accounts")),
    apply: (e, state) => {
      const cycles = sliceRecord(state, "economy", "cycles");
      const account = str(e, "account");
      const cur = objOf(cycles[account]);
      if (Object.keys(cur).length > 0) cycles[account] = { ...cur, paid: numOf(cur.paid) + numOf(e.data.cents) };
    },
    describe: (e, ctx) => `Payment ${formatMoney(numOf(e.data.cents), ctx.world.currency)}`,
  },
  {
    // A credit account moves to a delinquency stage, or back to current.
    type: FINANCE_EVENTS.delinquency,
    validate: (e, ctx) => (isCreditAccount(ctx, str(e, "account")) && (DELINQUENCY_STAGES as readonly string[]).includes(str(e, "stage")) ? null : reject("bad_event", "a delinquency stage needs a credit account and a stage")),
    apply: (e, state) => {
      const cycles = sliceRecord(state, "economy", "cycles");
      const account = str(e, "account");
      const cur = objOf(cycles[account]);
      const next: JsonObject = { ...cur, stage: str(e, "stage"), past_due: numOf(e.data.past_due), lates: numOf(e.data.lates), penalty: e.data.penalty === true };
      for (const k of ["streak", "ontime", "late30", "late60", "late90"] as const) if (typeof e.data[k] === "number") next[k] = e.data[k];
      cycles[account] = next;
    },
    describe: (e) => `Payment status: ${str(e, "stage")}`,
    coarsen: { key: (e) => str(e, "account"), merge: (_a, b) => b },
  },
  {
    // What one occurrence of a flow did; carries the flow's whole run state after it.
    type: FINANCE_EVENTS.flowRun,
    validate: (e) => (str(e, "flow") !== "" && typeof e.data.state === "object" ? null : reject("bad_event", "a flow run needs its flow and state")),
    apply: (e, state) => {
      sliceRecord(state, "economy", "flows")[str(e, "flow")] = objOf(e.data.state);
    },
    describe: (e) => `${str(e, "label") || str(e, "flow")}: ${str(e, "outcome")}`,
    coarsen: { key: (e) => str(e, "flow"), merge: (_a, b) => b },
  },
  {
    // A standing payment renamed in play: the flow entity's name, which its journal lines and views show.
    type: FINANCE_EVENTS.flowRenamed,
    validate: (e, ctx) => {
      const name = str(e, "name");
      return own(ctx.state.entities, str(e, "flow"))?.kind === "flow" && name.trim() !== "" && name.length <= 80 ? null : reject("bad_event", "a rename needs a standing payment and a name of up to 80 characters");
    },
    apply: (e, state) => {
      const flow = own(state.entities, str(e, "flow"));
      if (flow) flow.name = str(e, "name");
    },
    describe: (e, _ctx, viewer) => (viewer ? "" : `Standing payment renamed ${str(e, "name")}`),
    // Play's name, so an Upgrade that renames the flow too keeps the chat's.
    touches: (e) => [{ entity: str(e, "flow"), aspect: "name" }],
    coarsen: { key: (e) => str(e, "flow"), merge: (_a, b) => b },
  },
  {
    // Money set aside on an account (a deposit not yet available, a card authorisation), or a hold let go.
    type: FINANCE_EVENTS.hold,
    validate: (e, ctx) => {
      const account = str(e, "account");
      if (!own(ctx.state.entities, account) || str(e, "id") === "") return reject("bad_event", "a hold needs an account and an id");
      if (e.data.release === true) return null;
      const cents = numOf(e.data.cents);
      if (!(cents > 0) || typeof e.data.until !== "number") return reject("bad_event", "a hold needs an amount and an end");
      return e.data.kind === "authorization" && availableOf(ctx, account) < cents ? reject("declined", `${own(ctx.state.entities, account)?.name ?? account} can't cover ${formatMoney(cents, ctx.world.currency)}`) : null;
    },
    apply: (e, state) => {
      const holds = sliceRecord(state, "economy", "holds");
      const account = str(e, "account");
      const mine = objOf(holds[account]);
      for (const [id, h] of Object.entries(mine)) if (numOf(objOf(h).until) <= state.clock) delete mine[id];
      if (e.data.release === true) delete mine[str(e, "id")];
      else mine[str(e, "id")] = { cents: Math.round(numOf(e.data.cents)), until: numOf(e.data.until), kind: e.data.kind === "authorization" ? "authorization" : "deposit", memo: str(e, "memo") };
      holds[account] = mine;
    },
    describe: (e, ctx) => (e.data.release === true ? "Hold released" : `Hold of ${formatMoney(numOf(e.data.cents), ctx.world.currency)}`),
  },
  {
    // An account's pending journal lines up to a time post.
    type: FINANCE_EVENTS.settle,
    validate: (e, ctx) => (own(ctx.state.entities, str(e, "account")) && typeof e.data.upto === "number" ? null : reject("bad_event", "settling needs an account and a time")),
    apply: (e, state) => {
      const journal = sliceRecord(state, "economy", "journal");
      const account = str(e, "account");
      const upto = numOf(e.data.upto);
      const list = Array.isArray(journal[account]) ? journal[account] : [];
      journal[account] = list.map((x) => {
        const o = objOf(x);
        if (o.status !== "pending" || numOf(o.settles) > upto) return x;
        const { settles: _settles, ...rest } = o;
        return { ...rest, status: "posted" };
      });
    },
    describe: () => "Card payments posted",
    coarsen: { key: (e) => str(e, "account"), merge: (_a, b) => b },
  },
  {
    // Something enters a person's credit history.
    type: FINANCE_EVENTS.credit,
    validate: (e, ctx) => (own(ctx.state.entities, str(e, "person")) && str(e, "kind") !== "" ? null : reject("bad_event", "a credit entry needs a person and a kind")),
    apply: (e, state) => {
      const credit = sliceRecord(state, "economy", "credit");
      const person = str(e, "person");
      const cur = objOf(credit[person]);
      const { person: _person, ...entry } = e.data;
      credit[person] = { ...cur, entries: pushCapped(cur.entries, { ...entry, at: typeof e.data.at === "number" ? e.data.at : state.clock }, CREDIT_CAP) };
    },
    describe: (e) => `Credit report: ${str(e, "kind")}`,
  },
  {
    // A person's monthly score.
    type: FINANCE_EVENTS.score,
    validate: (e, ctx) => (own(ctx.state.entities, str(e, "person")) && typeof e.data.score === "number" ? null : reject("bad_event", "a score needs a person and a number")),
    apply: (e, state) => {
      const credit = sliceRecord(state, "economy", "credit");
      const person = str(e, "person");
      const cur = objOf(credit[person]);
      const at = typeof e.data.at === "number" ? e.data.at : state.clock;
      credit[person] = { ...cur, score: numOf(e.data.score), factors: objOf(e.data.factors), at, history: pushCapped(cur.history, { at, score: numOf(e.data.score) }, SCORES_KEPT) };
    },
    describe: (e) => `Credit score ${numOf(e.data.score)}`,
  },
  {
    // A card's spending today: its new totals (an assignment, so a record keeps only the last).
    type: FINANCE_EVENTS.spend,
    validate: (e, ctx) => (own(ctx.state.entities, str(e, "card")) && typeof e.data.day === "number" ? null : reject("bad_event", "card spending needs a card and a day")),
    apply: (e, state) => {
      sliceRecord(state, "economy", "spend")[str(e, "card")] = { day: numOf(e.data.day), purchase: numOf(e.data.purchase), atm: numOf(e.data.atm) };
    },
    describe: () => "Card spending",
    coarsen: { key: (e) => str(e, "card"), merge: (_a, b) => b },
  },
  {
    // Accounts whose opening balances have posted. Each opens once.
    type: FINANCE_EVENTS.open,
    validate: (e, ctx) => {
      const list = Array.isArray(e.data.accounts) ? e.data.accounts : [];
      const opened = objOf(sliceOf(ctx.state, "economy").opened);
      for (const a of list) {
        if (typeof a !== "string" || !own(ctx.state.entities, a)) return reject("bad_event", "only accounts open");
        if (own(opened, a) === true) return reject("opened", `${own(ctx.state.entities, a)?.name ?? a} is already open`);
      }
      return list.length > 0 ? null : reject("bad_event", "nothing to open");
    },
    apply: (e, state) => {
      const opened = sliceRecord(state, "economy", "opened");
      for (const a of Array.isArray(e.data.accounts) ? e.data.accounts : []) if (typeof a === "string") opened[a] = true;
    },
    describe: () => "Accounts opened",
  },
  {
    type: FINANCE_EVENTS.status,
    validate: (e, ctx) => (own(ctx.state.entities, str(e, "account"))?.kind === "account" && (ACCOUNT_STATUSES as readonly string[]).includes(str(e, "status")) ? null : reject("bad_event", "a status needs an account and a status")),
    apply: (e, state) => {
      sliceRecord(state, "economy", "status")[str(e, "account")] = str(e, "status") as AccountStatus;
    },
    describe: (e, ctx) => `${own(ctx.state.entities, str(e, "account"))?.name ?? str(e, "account")}: ${str(e, "status").replace(/_/g, " ")}`,
    coarsen: { key: (e) => str(e, "account"), merge: (_a, b) => b },
  },
  {
    // An interest period ends: the account's average daily balance starts again.
    type: FINANCE_EVENTS.accrue,
    validate: (e, ctx) => (own(ctx.state.entities, str(e, "account")) && typeof e.data.at === "number" ? null : reject("bad_event", "an accrual needs an account and a time")),
    apply: (e, state) => {
      const at = numOf(e.data.at);
      sliceRecord(state, "economy", "adb")[str(e, "account")] = { from: at, at, sum: 0, spent: 0 };
    },
    describe: () => "Interest period",
  },
  // A decline recorded by an older build: it moves nothing.
  { type: FINANCE_EVENTS.decline, validate: () => null, apply: () => undefined, describe: (e) => `Declined: ${str(e, "memo")}` },
];
