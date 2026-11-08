// The budget dial's ceilings (DEPTH-PLAN §4.7, §6.5; D-7): Settings → Depth → Budget's per-turn and
// per-day ceilings over depth's model work, in tokens (sent and written, reasoning included).
//
//   per turn  everything one turn's work spends: its scene in the foreground, walk-ons included (what
//             the turn's metered port counts), then the step after its reply (`AfterReply.spent`
//             carries its record's on) and the work off screen that step starts
//   per day   everything depth spent for the user today (a UTC day, as `author.spend` names it),
//             across chats and whatever a swipe later discarded, since that money is spent; the
//             bootstrap apart, which has its own cap (§8.3). Every depth call but the bootstrap's
//             adds to it as it is answered (`depthPort`), kept in the user's storage so a restart
//             keeps the day's count
//
// When a ceiling binds the work spends less and says what it put off, never skipping silently. A
// turn's author reads what the ceilings leave it at its setup and each step (`budgetWords`) and
// spends by it, the author's call (§4.4, §6.5): once one binds, whoever still plays as their own
// agent is played by the author from then on, and the scene plays on as far as the author judges,
// within the turn's steps; a real-time line plays as a scene. The step after the reply puts off
// what it hasn't started, and off-screen work waits. What binds is arithmetic, and so is that slide
// to the cheaper rung; what the scene does with what is left is the author's.

import { AUTHOR_SPEND, authorData, type SpendCost, type SpendData } from "../../shared/author";
import type { DepthBudget } from "../../shared/depth-settings";
import { tokensText } from "../../shared/depth-views";
import type { UserId } from "../../shared/ids";
import { isRecord } from "../../shared/json";
import type { LedgerEvent } from "../../shared/ledger";
import type { HostPort } from "../host";

/** Where a user's spend today is kept (their own storage). */
export const DAY_SPEND_PATH = "depth/day-spend.json";

/** The real day a moment falls in, as `author.spend` names it: its UTC date (`YYYY-MM-DD`). */
export function dayOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** A cost in tokens as the ceilings count it: sent and written, reasoning included. */
export function costTokens(cost: Pick<SpendCost, "tokensIn" | "tokensOut">): number {
  return cost.tokensIn + cost.tokensOut;
}

/** The tokens a turn's record spent: every `author.spend` among its events, its scene's and each walk-on's (which is `for` its draft). */
export function recordedTokens(events: readonly LedgerEvent[]): number {
  let tokens = 0;
  for (const e of events) {
    const d = authorData<SpendData>(e, AUTHOR_SPEND);
    if (d) tokens += costTokens(d.cost);
  }
  return tokens;
}

/** Which ceiling binds: its limit, what was spent against it, and the words the player and the treatment log read. */
export interface CeilingBind {
  which: "turn" | "day";
  limit: number;
  spent: number;
  words: string;
}

/** The ceiling that binds once `turn` tokens were spent this turn and `day` today, or null; the day's is said first, since it binds every turn after. */
export function ceilingBinds(budget: Pick<DepthBudget, "perTurn" | "perDay">, turn: number, day: number): CeilingBind | null {
  if (budget.perDay !== "none" && day >= budget.perDay) {
    return { which: "day", limit: budget.perDay, spent: day, words: `today's depth work has spent ${tokensText(day)} tokens, at its ceiling of ${tokensText(budget.perDay)} (Settings → Depth → Budget → Per day)` };
  }
  if (budget.perTurn !== "none" && turn >= budget.perTurn) {
    return { which: "turn", limit: budget.perTurn, spent: turn, words: `this turn has spent ${tokensText(turn)} tokens, at its ceiling of ${tokensText(budget.perTurn)} (Settings → Depth → Budget → Per turn)` };
  }
  return null;
}

/** One user's day: which day it is and the tokens spent on it. */
interface Day {
  day: string;
  tokens: number;
}

/**
 * What depth spent per user today. Each answered call adds to it (`add`), in memory at once and in
 * the user's storage after; `load` reads the stored day once, so a check right after it (`tokens`)
 * is synchronous. A day that has passed reads as nothing spent.
 */
export class DaySpend {
  private readonly days = new Map<UserId, Day>();
  private readonly loading = new Map<UserId, Promise<void>>();
  private readonly writing = new Map<UserId, Promise<void>>();

  constructor(
    private readonly host: Pick<HostPort, "storage" | "log">,
    private readonly now: () => number = Date.now,
  ) {}

  /** Reads the user's stored day, once; a missing or unreadable file reads as nothing spent. */
  load(userId: UserId): Promise<void> {
    let done = this.loading.get(userId);
    if (!done) {
      done = (async () => {
        let raw: unknown = null;
        try {
          raw = JSON.parse((await this.host.storage.read(DAY_SPEND_PATH, userId)) ?? "null");
        } catch {
          raw = null;
        }
        const stored: Day | null = isRecord(raw) && typeof raw.day === "string" && typeof raw.tokens === "number" && Number.isFinite(raw.tokens) ? { day: raw.day, tokens: raw.tokens } : null;
        // A call answered while the file was read is kept beside what the file held.
        const meanwhile = this.days.get(userId);
        const today = dayOf(this.now());
        const kept = stored?.day === today ? stored.tokens : 0;
        this.days.set(userId, { day: today, tokens: kept + (meanwhile?.day === today ? meanwhile.tokens : 0) });
      })();
      this.loading.set(userId, done);
    }
    return done;
  }

  /** The tokens spent today so far (as loaded, with every call added since). */
  tokens(userId: UserId): number {
    const d = this.days.get(userId);
    return d && d.day === dayOf(this.now()) ? d.tokens : 0;
  }

  /** Adds one answered call's tokens to today's, and keeps the day in the user's storage. */
  add(userId: UserId, tokens: number): void {
    if (!(tokens > 0)) return;
    const today = dayOf(this.now());
    const d = this.days.get(userId);
    this.days.set(userId, { day: today, tokens: (d && d.day === today ? d.tokens : 0) + tokens });
    const write = (this.writing.get(userId) ?? Promise.resolve())
      .then(() => this.load(userId))
      .then(async () => {
        const day = this.days.get(userId) ?? { day: today, tokens: 0 };
        await this.host.storage.write(`${DAY_SPEND_PATH}.tmp`, JSON.stringify({ v: 1, day: day.day, tokens: day.tokens }), userId);
        await this.host.storage.move(`${DAY_SPEND_PATH}.tmp`, DAY_SPEND_PATH, userId);
      })
      .catch((error: unknown) => this.host.log("warn", `[LumiRPEngine] today's depth spend wasn't kept for after a restart (${error instanceof Error ? error.message : String(error)})`, userId));
    this.writing.set(userId, write);
  }

  /** Every write so far kept (for a test, or before a shutdown). */
  async settled(userId: UserId): Promise<void> {
    await this.writing.get(userId);
  }
}

/** One day store per runtime's host: every depth port of that runtime adds to it, every ceiling reads it. */
const stores = new WeakMap<object, DaySpend>();

/** The day store of `host`, made at its first use. */
export function daySpendOf(host: Pick<HostPort, "storage" | "log">): DaySpend {
  let store = stores.get(host);
  if (!store) {
    store = new DaySpend(host);
    stores.set(host, store);
  }
  return store;
}

/** What is left under each ceiling, in tokens: null where none is set. */
export interface CeilingRoom {
  turn: number | null;
  day: number | null;
}

/** What each ceiling leaves once `turn` tokens were spent this turn and `day` today. */
export function ceilingRoom(budget: Pick<DepthBudget, "perTurn" | "perDay">, turn: number, day: number): CeilingRoom {
  return { turn: budget.perTurn === "none" ? null : Math.max(0, budget.perTurn - turn), day: budget.perDay === "none" ? null : Math.max(0, budget.perDay - day) };
}

/** What a turn asks of the budget once it has spent `turnTokens`: the ceiling that binds, or null; and what each ceiling leaves it. */
export interface TurnBudget {
  binds(turnTokens: number): CeilingBind | null;
  left(turnTokens: number): CeilingRoom;
}

/**
 * The budget as a turn's author reads it (§6.5), once the turn has spent `turnTokens`: what each
 * ceiling leaves, or the one that binds and what the turn does about it; null when neither ceiling
 * is set, so nothing would ever bind.
 */
export function budgetWords(budget: TurnBudget, turnTokens: number): string | null {
  const bind = budget.binds(turnTokens);
  if (bind) return `The budget binds: ${bind.words}. Spend less from here: anyone you would give their own agent (a call each time they act) you play yourself (one call for several) or handle as part of the world. Anyone still playing as their own agent you play from now on. How far the scene goes this turn is yours to judge.`;
  const left = budget.left(turnTokens);
  const parts = [...(left.turn !== null ? [`this turn has spent ${tokensText(turnTokens)} tokens, with about ${tokensText(left.turn)} left under its ceiling (Settings → Depth → Budget → Per turn)`] : []), ...(left.day !== null ? [`today's depth work has about ${tokensText(left.day)} tokens left under its ceiling (Per day)`] : [])];
  return parts.length > 0 ? `The budget: ${parts.join("; ")}. Spend by it: once a ceiling binds, whoever still plays as their own agent is played by you.` : null;
}

/** The budget of one piece of work for `userId`: the ceilings as Settings → Depth sets them, against today's spend (read before it starts) and the work's own. */
export async function budgetFor(day: DaySpend, userId: UserId, budget: Pick<DepthBudget, "perTurn" | "perDay">): Promise<TurnBudget> {
  await day.load(userId);
  return { binds: (turnTokens) => ceilingBinds(budget, turnTokens, day.tokens(userId)), left: (turnTokens) => ceilingRoom(budget, turnTokens, day.tokens(userId)) };
}
