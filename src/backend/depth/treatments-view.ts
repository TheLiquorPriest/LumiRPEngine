// GM → Depth → Treatments (DEPTH-PLAN §4.7, §6.5, §7): what got which depth and why, what it cost, and
// what the budget dial leaves, read per chat and chain as the fold reads it, so work a swipe discarded
// gives its spend back here too:
//
//   asks        the episodes held for the player past an allowance, worded and answered as their
//               chips are (`offscreen/asks.ts`)
//   log         newest first: each turn's scene (the effort each character played at, with the
//               author's reason, and its walk-ons), each step after a reply, each episode off screen
//               (each part's treatment with the author's grade, and where its draft stands), each ask
//               with the player's answer; each with what it cost and every line a ceiling put off
//   meter       what was spent per story interval, newest first: per lane (on screen, after the reply,
//               off screen), per treatment off screen with the episodes it bought, and per role
//   budget      this story interval's allowances and the parts the drafts on the chain spent of them;
//               the ceilings: the latest turn's spend (everything at its reply: its scene, the step
//               after it and the work off screen that step started) and today's (a UTC day, every
//               chat, the bootstrap apart); Ask me and the threshold
//
// Bookkeeping only: nothing here judges. Nothing is withheld (§1.4, D-9).

import { AUTHOR_ASK, AUTHOR_SPEND, authorData, type SpendCost, type SpendData } from "../../shared/author";
import { DEPTH_ROLES, DEPTH_TREATMENT_LABEL, DEPTH_TREATMENTS, type DepthBudget, type DepthTreatment } from "../../shared/depth-settings";
import { DEPTH_EFFORT_LABEL, type DepthAllowance, type DepthAt, type DepthCeiling, type DepthCost, type DepthLane, type DepthLogEntry, type DepthMeterRow, type DepthOpenAsk, type DepthTreatmentsView } from "../../shared/depth-views";
import { STORY_DRAFT } from "../../shared/episodes";
import type { ChatId, EntityId, MessageId, UserId } from "../../shared/ids";
import { sceneOf, STORY_SCENE, type SceneData } from "../../shared/scene";
import type { UserSettings } from "../../shared/settings";
import type { Chip } from "../../shared/state-view";
import type { StoryContainer } from "../../shared/story";
import { calendarOf, dateAt, formatClock, monthName, weekdayName, type Calendar } from "../../engine/calendar";
import type { ChainMessage } from "../../engine/ledger/chain";
import type { LedgerCore } from "../../engine/ledger/journal";
import { own } from "../../engine/pack-kit";
import { depthOptedIn } from "../bootstrap/service";
import type { Runtime } from "../runtime";
import { costTokens, dayOf, daySpendOf } from "./budget";
import { chatBudget } from "./chat-allowances";
import { ASK_TYPES, askChipsOn, asksOn, askWords } from "./offscreen/asks";
import { DRAFT_TYPES, draftsOn, draftWithTexts, type DraftBlobs } from "./offscreen/drafts";
import { spentIn, type JobsRt } from "./offscreen/jobs";
import { addCost, intervalAt, INTERVAL_MINUTES, NO_COST, SPEND_TYPES } from "./spend";
import { chainNumbers } from "./chat-numbers";

/** What the Treatments view reads of the runtime (`Runtime` is one): the chat's chain and fold, the asks' chips off the chat's core, the budget dial, and the host's day store. */
export type TreatmentsRt = Pick<Runtime, "host"> & {
  readonly settings: { get(userId: UserId): Promise<UserSettings> };
  /** Where its drafts' words are read from. */
  readonly blobs: DraftBlobs;
  readonly ledger: Pick<JobsRt["ledger"], "basisFor" | "foldAtBasis" | "chainBases"> & {
    with(chatId: ChatId, userId: UserId, op: (core: LedgerCore, observed: ChainMessage[]) => void | Promise<void>): Promise<void>;
  };
};

/** The event types the view reads off the chain. */
const TREATMENT_TYPES: readonly string[] = [STORY_SCENE, ...SPEND_TYPES, ...ASK_TYPES, ...DRAFT_TYPES];

const LANES: readonly DepthLane[] = ["scene", "after", "offscreen"];

/** The lane a spend's work ran in (§2.4). */
function laneOf(treatment: SpendData["treatment"]): DepthLane {
  return treatment === "scene" || treatment === "walk-on" ? "scene" : treatment === "after" ? "after" : "offscreen";
}

/** A spend's cost as the views show it. */
function costOf(c: SpendCost): DepthCost {
  return { calls: c.calls, tokens: costTokens(c), ...(c.reasoningOut !== undefined ? { reasoning: c.reasoningOut } : {}), ...(c.money !== undefined ? { money: c.money } : {}) };
}

/** What several spends cost together. */
function summed(spends: readonly SpendCost[]): DepthCost {
  return costOf(spends.reduce(addCost, NO_COST));
}

/** Where a live event rides: its record, its post entry or its layer entry. */
function containerKey(from: StoryContainer): string {
  return "rec" in from ? `rec:${from.messageId}:${from.swipeId}:${from.rec}` : "post" in from ? `post:${from.messageId}:${from.swipeId}:${from.post}` : `layer:${from.layer}`;
}

/** A story day in words: "Monday 4 May 2026". */
function dateWords(cal: Calendar, clock: number): string {
  const d = dateAt(cal, clock);
  return `${weekdayName(cal, d.weekday)} ${d.day} ${monthName(cal, d.month)} ${d.year}`;
}

/** A story interval in words: "Story week: Monday 4 May 2026 – Sunday 10 May 2026". */
function intervalWords(cal: Calendar, unit: DepthBudget["interval"], from: number): string {
  return unit === "day" ? `Story day: ${dateWords(cal, from)}` : `Story ${unit}: ${dateWords(cal, from)} – ${dateWords(cal, from + INTERVAL_MINUTES[unit] - 1)}`;
}

/** Each treatment's allowance this story interval, beside the parts the drafts on the chain spent of it. */
function allowancesOf(budget: DepthBudget, spent: Readonly<Record<DepthTreatment, number>>): DepthAllowance[] {
  return DEPTH_TREATMENTS.map((t) => {
    const a = budget.allowances[t];
    return { treatment: t, allowance: a === "none" ? null : a, spent: spent[t] };
  });
}

/** The ceilings: the latest turn's spend, and today's. */
function ceilingsOf(budget: DepthBudget, turn: { spent: number; of: string }, today: number): DepthCeiling[] {
  const limit = (l: DepthBudget["perTurn"]): number | null => (l === "none" ? null : l);
  const perTurn = limit(budget.perTurn);
  const perDay = limit(budget.perDay);
  return [
    { which: "turn", limit: perTurn, spent: turn.spent, of: turn.of, reached: perTurn !== null && turn.spent >= perTurn },
    { which: "day", limit: perDay, spent: today, of: `Today, ${dayOf(Date.now())}, a UTC day (it starts again at midnight UTC): depth's work in every chat, the bootstrap apart`, reached: perDay !== null && today >= perDay },
  ];
}

/** GM → Depth → Treatments: the asks waiting on the player, the treatment log, the meter and the budget dial as it stands, for the chat's chain. */
export async function treatmentsView(rt: TreatmentsRt, chatId: ChatId, userId: UserId): Promise<DepthTreatmentsView> {
  const budget = await chatBudget(rt.host, chatId, userId, (await rt.settings.get(userId)).depth.budget);
  const day = daySpendOf(rt.host);
  await day.load(userId);
  const today = day.tokens(userId);
  const optedIn = await depthOptedIn(rt, chatId, userId);
  const basis = await rt.ledger.basisFor(chatId, userId);
  const at = basis ? await rt.ledger.foldAtBasis(chatId, userId, basis, TREATMENT_TYPES) : null;
  const dial = { ask: budget.ask, threshold: budget.threshold, level: budget.level };
  if (!at) {
    return { on: optedIn, asks: [], log: [], meter: [], interval: `This story ${budget.interval}`, allowances: allowancesOf(budget, spentIn([], budget, 0)), ceilings: ceilingsOf(budget, { spent: 0, of: "No turn on this chat has spent anything yet" }, today), ...dial };
  }
  const { world, state } = at;
  const cal = calendarOf(world);
  const name = (id: EntityId): string => own(state.entities, id)?.name ?? id;
  const order = await chainNumbers(rt.host, chatId, userId, (await rt.ledger.chainBases(chatId, userId)).map((b) => b.message));
  const placeOf = (messageId: MessageId): DepthAt => ({ messageId, index: order.get(messageId) ?? 0 });

  // One pass over the chain's live events, in fold order: each turn's scene and on-screen spend by the record it rides in, what each draft's work off screen cost, every spend, and where each ask and draft first appears.
  type TurnRead = { from: StoryContainer; index: number; scene?: SceneData; spends: SpendData[] };
  const turns = new Map<string, TurnRead>();
  const turnAt = (from: StoryContainer, index: number): TurnRead => {
    const key = containerKey(from);
    const had = turns.get(key);
    if (had) return had;
    const made: TurnRead = { from, index, spends: [] };
    turns.set(key, made);
    return made;
  };
  const spends: { data: SpendData; from: StoryContainer; index: number }[] = [];
  const offscreen = new Map<string, SpendCost[]>();
  const firstAt = new Map<string, number>();
  for (const e of at.events) {
    if (!("data" in e.event)) continue;
    if (e.event.type === STORY_SCENE) {
      const scene = sceneOf(e.event.data);
      if (!scene) continue;
      const turn = turnAt(e.from, e.index);
      turn.scene ??= scene;
    } else if (e.event.type === AUTHOR_SPEND) {
      const data = authorData<SpendData>(e.event, AUTHOR_SPEND);
      if (!data) continue;
      spends.push({ data, from: e.from, index: e.index });
      const lane = laneOf(data.treatment);
      if (lane === "scene") turnAt(e.from, e.index).spends.push(data);
      else if (lane === "offscreen") {
        const paid = offscreen.get(data.for);
        if (paid) paid.push(data.cost);
        else offscreen.set(data.for, [data.cost]);
      }
    } else if (e.event.type === AUTHOR_ASK || e.event.type === STORY_DRAFT) {
      const id = e.event.data.id;
      if (typeof id === "string" && !firstAt.has(id)) firstAt.set(id, e.index);
    }
  }
  const drafts = await Promise.all(draftsOn(at.events).map(async (d) => ({ ...d, draft: await draftWithTexts(rt.blobs, userId, d.draft) })));
  const draftById = new Map(drafts.map((d) => [d.draft.id, d]));
  const log: (DepthLogEntry & { index: number })[] = [];

  // Each turn on screen: its scene's cast with the effort each played at, its walk-ons, and what its record spent.
  for (const [key, turn] of turns) {
    const { scene } = turn;
    const walkOns = turn.spends
      .filter((s) => s.treatment === "walk-on")
      .map((s) => {
        const d = draftById.get(s.for);
        const why = d?.settle && containerKey(d.settle.from) === key ? "Settled before the scene played past it" : d?.drop && containerKey(d.drop.from) === key ? `Dropped before the scene played past it: ${d.drop.data.why}` : "Read before the scene played past it";
        return { subject: d ? d.draft.summary : `Draft ${s.for}`, depth: "Walk-on", why };
      });
    log.push({
      kind: "scene",
      title: scene ? `Scene at ${own(world.places, scene.place)?.name ?? scene.place}` : "The turn",
      when: scene ? formatClock(cal, scene.at) : null,
      at: placeOf(turn.from.messageId),
      lines: [...(scene?.cast ?? []).map((c) => ({ subject: name(c.who), depth: DEPTH_EFFORT_LABEL[c.effort], why: c.why })), ...walkOns],
      ...(turn.spends.length > 0 ? { cost: summed(turn.spends.map((s) => s.cost)) } : {}),
      put: turn.spends.flatMap((s) => s.put ?? []),
      index: turn.index,
    });
  }
  // Each step after a reply: what it spent, and what a ceiling put off.
  for (const s of spends) {
    if (s.data.treatment !== "after") continue;
    log.push({ kind: "after", title: "After the reply", when: null, at: placeOf(s.from.messageId), lines: [], cost: costOf(s.data.cost), put: s.data.put ?? [], index: s.index });
  }
  // Each episode off screen: each part's treatment with the author's grade, where its draft stands, and what drafting and settling it cost.
  for (const d of drafts) {
    const paid = offscreen.get(d.draft.id);
    log.push({
      kind: "episode",
      title: d.draft.summary.trim() || d.draft.episode.why,
      when: formatClock(cal, d.draft.at),
      at: placeOf(d.from.messageId),
      lines: d.draft.episode.parts.map((p) => ({ subject: "who" in p.subject ? name(p.subject.who) : p.subject.event, depth: DEPTH_TREATMENT_LABEL[p.treatment], why: p.rationale })),
      ...(paid ? { cost: summed(paid) } : {}),
      put: [],
      state: d.state,
      index: firstAt.get(d.draft.id) ?? 0,
    });
  }
  // Each episode held for the player past an allowance, and his answer.
  for (const a of asksOn(at.events)) {
    log.push({
      kind: "ask",
      title: askWords(a.ask, name).what,
      when: null,
      at: placeOf(a.from.messageId),
      lines: a.ask.parts.map((p) => ({ subject: "who" in p.subject ? name(p.subject.who) : p.subject.event, depth: DEPTH_TREATMENT_LABEL[p.treatment], why: `${p.rationale}${p.major ? " (judged major)" : ""}` })),
      put: [],
      state: a.answer === null ? "waiting" : a.answer.spend ? "spent" : "kept",
      index: firstAt.get(a.ask.id) ?? 0,
    });
  }
  log.sort((x, y) => y.index - x.index);

  // The meter: per story interval, newest first.
  const now = intervalAt(budget.interval, state.clock);
  const intervals = new Map<string, { unit: DepthBudget["interval"]; from: number; spends: SpendData[] }>();
  for (const s of spends) {
    const key = `${s.data.interval.unit}:${s.data.interval.from}`;
    const g = intervals.get(key) ?? { unit: s.data.interval.unit, from: s.data.interval.from, spends: [] };
    g.spends.push(s.data);
    intervals.set(key, g);
  }
  const meter: DepthMeterRow[] = [...intervals.values()]
    .sort((x, y) => y.from - x.from || INTERVAL_MINUTES[x.unit] - INTERVAL_MINUTES[y.unit])
    .map((g) => ({
      label: intervalWords(cal, g.unit, g.from),
      now: g.unit === now.unit && g.from === now.from,
      total: summed(g.spends.map((s) => s.cost)),
      lanes: LANES.map((lane) => ({ lane, cost: summed(g.spends.filter((s) => laneOf(s.treatment) === lane).map((s) => s.cost)) })),
      treatments: DEPTH_TREATMENTS.flatMap((t: DepthTreatment) => {
        const of = g.spends.filter((s) => s.treatment === t);
        return of.length > 0 ? [{ treatment: t, episodes: new Set(of.map((s) => s.for)).size, cost: summed(of.map((s) => s.cost)) }] : [];
      }),
      roles: DEPTH_ROLES.flatMap((role) => {
        const of = g.spends.flatMap((s) => s.roles[role] ?? []);
        return of.length > 0 ? [{ role, cost: summed(of) }] : [];
      }),
      grades: drafts
        .filter((d) => intervalAt(g.unit, d.draft.at).from === g.from)
        .flatMap((d) => d.draft.episode.parts.map((p) => ({ episode: d.draft.summary.trim() || d.draft.episode.why, subject: "who" in p.subject ? name(p.subject.who) : p.subject.event, depth: DEPTH_TREATMENT_LABEL[p.treatment], why: p.rationale }))),
    }));

  // The latest turn's spend: everything at its reply.
  const latest = spends.findLast((s) => laneOf(s.data.treatment) !== "offscreen");
  const turn = latest
    ? { spent: spends.filter((s) => s.from.messageId === latest.from.messageId).reduce((n, s) => n + costTokens(s.data.cost), 0), of: `The latest turn, at message ${placeOf(latest.from.messageId).index}: its scene, the step after its reply and the work off screen that step started` }
    : { spent: 0, of: "No turn on this chat has spent anything yet" };

  // The asks waiting on the player, as their chips under the replies word them.
  let chips: Chip[] = [];
  await rt.ledger.with(chatId, userId, (core, observed) => {
    chips = askChipsOn(core, observed);
  });
  const asks: DepthOpenAsk[] = chips.map((c) => ({ chip: c.id, label: c.label, detail: c.detail ?? "", at: placeOf(c.messageId), actions: c.actions.map((a) => ({ id: a.id, label: a.label, ...(a.style === "primary" ? { primary: true as const } : {}) })) }));

  return {
    on: optedIn || log.length > 0,
    asks,
    log: log.map(({ index: _, ...e }) => e),
    meter,
    interval: intervalWords(cal, budget.interval, now.from),
    allowances: allowancesOf(budget, spentIn(drafts, budget, state.clock)),
    ceilings: ceilingsOf(budget, turn, today),
    ...dial,
  };
}
