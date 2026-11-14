// The everyday operations on values (the skills `economy`, `ruleset-and-sheets`, `quests`, `groups`,
// `time`): `pay`, `set`, `fact`, `quest`, `relate` and `horizon`. Each runs through today's own
// systems (the economy's payments, the sheets' fields and progressions, the tracks, regard). What
// does not add up (a payment past what the payer holds, a stat past its bounds, a stage off the
// quest's paths) is applied and reported.

import type { JsonObject, JsonValue } from "rp-harness/contract";
import { isRecord, safeKey } from "../shared/json";
import type { LedgerEvent } from "../shared/ledger";
import { formatMoney } from "../shared/world";
import { fieldBounds, levelsFollowXp, applyEffects } from "../engine/effects";
import { valueProblem } from "../engine/edits";
import { ENGINE_EVENTS } from "../engine/engine-pack";
import { EXTERNAL_ACCOUNT_PREFIX } from "../engine/events";
import { materializeIfNeeded } from "../engine/materialize";
import { optionalService, own } from "../engine/pack-kit";
import { baseWorld } from "../engine/places-in-play";
import { createRng } from "../engine/rng";
import { fieldDef, GONE_FIELD } from "../engine/scope";
import { chatDraftOf, draftEvent } from "../engine/world-draft";
import { accountsOf, external, hasLedger, statusOf } from "../packs/economy/core/model";
import { asUnit, cashAccount, mostPayable, NO_WAY_TO_PAY, payeeSide, posting } from "../packs/economy/core/pay";
import { axesOf } from "../packs/relationships/core/index";
import { FACT_ABOUT, factStore } from "../store/facts";
import { STORE_OPS } from "../store/types";
import type { FactStore } from "./kit";
import { find, findOptional, isUnread, minorUnits, named, notAs, notOneOf, numberArg, type OpContext, type OpDef, textArg, type Unread } from "./ops";
import { textOf } from "./texts";
import { moveTo } from "./ops-things";
import { setClock, timeArg } from "./ops-time";

/** The fact store every `fact` is recorded through: the store's own. */
const FACTS: FactStore = factStore;

/** Whose money a payment moves: the payer's and the payee's, sampled first where the world has not yet, as today's purchases do. */
function materializeMoney(o: OpContext, ids: readonly string[]): void {
  for (const id of ids) materializeIfNeeded(o.reading.registry, o.draft.w, id, "money", o.draft.seed(o.n));
}

/** A payment past what the payer's money covers: who pays whom (no payee: no one in the world), how much, and how today's journal files it. */
export interface PastCover {
  payer: string;
  payee?: string;
  cents: number;
  memo: string;
  kind: "payment" | "purchase";
  category?: string;
  /** Records made with the payment, in its unit (a donation's). */
  with?: readonly LedgerEvent[];
}

/**
 * A payment made from the payer's own money whatever it holds, where today's economy found nothing
 * that covers it (`NO_WAY_TO_PAY`) or declined it: out of their cash, else the first account they
 * spend from, of those still open (today's guard declines a posting from one that is not, past
 * cover or not), else their outside account; into the payee's side; as one unit with its journal
 * lines and what is made with it.
 */
export function payPastCover(o: OpContext, p: PastCover): Unread | undefined {
  const ctx = o.draft.w.ctx;
  const open = [cashAccount(ctx, p.payer), ...accountsOf(ctx, p.payer, "spend")].find((a): a is string => a !== null && statusOf(ctx.state, a) === "open");
  const dest = p.payee !== undefined ? payeeSide(ctx, { payee: p.payee }, p.cents) : { account: `${EXTERNAL_ACCOUNT_PREFIX}world`, extra: [] };
  const lines = [
    { account: open ?? external(p.payer), amount: -p.cents },
    { account: dest.account, amount: p.cents },
  ];
  // Marked as today's story payments past cover are (`overdraw`): it stands past what the accounts cover, on any path.
  const paid = posting(lines, { memo: p.memo, kind: p.kind, payer: p.payer, ...(p.payee !== undefined ? { counterparty: p.payee } : {}), ...(p.category !== undefined ? { category: p.category } : {}), story: true }).map((e): LedgerEvent => (e.type === "post" ? { ...e, overdraw: true } : e));
  const bad = o.draft.applyAll(asUnit([...paid, ...dest.extra, ...(p.with ?? [])]));
  return bad ? { line: "not_applicable", fields: { n: o.n, op: o.op, code: bad.code } } : undefined;
}

const pay: OpDef = {
  name: "pay",
  lane: "engine",
  needs: ["who", "amount"],
  takes: ["who", "to", "amount", "for", "goods", "qty", "reason", "method"],
  example: { op: "pay", who: "wren", to: "bram", amount: 3, for: "a room for the night", goods: "Cask of cider", reason: "purchase", source: { from: "prose", message: "m-0018" } },
  run(o) {
    const payer = find(o, "who", "entity");
    if (isUnread(payer)) return payer;
    const payee = findOptional(o, "to", "entity");
    if (isUnread(payee)) return payee;
    const amount = numberArg(o.args, "amount");
    if (amount === undefined || !(amount > 0)) return notAs(o, "amount", o.args.amount ?? null, "amount");
    const cents = minorUnits(o.reading, amount);
    const goods = textArg(o.args, "goods");
    const memo = textArg(o.args, "for") ?? textArg(o.args, "reason") ?? textArg(o.args, "goods") ?? "Payment";
    const method = textArg(o.args, "method");
    const reason = textArg(o.args, "reason");
    const w = o.draft.w;
    const from = w.events.length;
    materializeMoney(o, [payer.id, ...(payee ? [payee.id] : [])]);
    const ctx = w.ctx;
    const ledger = hasLedger(ctx, payer.id);
    const held = ledger ? mostPayable(ctx, payer.id, cents, { till: false, overdraft: true }) : null;
    const qty = typeof o.args.qty === "number" && Number.isInteger(o.args.qty) && o.args.qty > 0 ? o.args.qty : 1;
    // Money and goods as one change: today's purchase, the seller's own thing changing hands, or a new one made.
    const spec = goods !== undefined
      ? { type: "economy.buy", args: { payer: payer.id, item: goods, qty, price: cents, exact: true, story: true, ...(payee ? { seller: payee.id } : {}), ...(method !== undefined ? { method } : {}), ...(reason !== undefined ? { category: reason } : {}) } as Record<string, JsonValue> }
      : { type: "economy.transfer", args: { from: payer.id, to: payee?.id ?? `${EXTERNAL_ACCOUNT_PREFIX}world`, cents, memo, story: true, ...(method !== undefined ? { method } : {}) } as Record<string, JsonValue> };
    const before = w.events.length;
    const out = applyEffects(o.reading.registry, w, [spec], { bindings: {}, rng: createRng(o.draft.seed(o.n)), literal: true });
    const refused = out.rejected[0]?.rejection;
    const unpaid = w.events.slice(before).find((e) => e.type === "economy.txn" && "data" in e && isRecord(e.data) && typeof e.data.unpaid === "number");
    let short = false;
    if (refused !== undefined) {
      if (refused.code !== NO_WAY_TO_PAY && refused.code !== "declined") return { line: "not_applicable", fields: { n: o.n, op: o.op, code: refused.code } };
      const failed = payPastCover(o, { payer: payer.id, ...(payee ? { payee: payee.id } : {}), cents, memo, kind: "payment" });
      if (failed) return failed;
      short = true;
    } else if (unpaid !== undefined) {
      const failed = payPastCover(o, { payer: payer.id, ...(payee ? { payee: payee.id } : {}), cents, memo, kind: "purchase" });
      if (failed) return failed;
      short = true;
    }
    if (short || (held !== null && held < cents)) o.reply.report("paid_past_held", { n: o.n, op: o.op, payer: named(o.reading, payer.id), amount: formatMoney(cents, o.reading.doc.currency), held: formatMoney(Math.max(0, held ?? 0), o.reading.doc.currency) });
    if (w.events.length === from) o.reply.report("money_untracked", { n: o.n, op: o.op, payer: named(o.reading, payer.id) });
    o.draft.record(o.n, o.op, "engine", o.prov, from);
    return undefined;
  },
};

/** A value as the sheet's field takes it, with what the field allows, for a report of a value outside it. */
function offSheet(o: OpContext, entity: string, key: string, value: JsonValue): JsonObject | null {
  const w = o.draft.w;
  const e = own(w.state.entities, entity);
  const def = e ? fieldDef(o.reading.registry, w.ctx.world, e.kind, key) : undefined;
  if (def === undefined || valueProblem(o.reading.registry, w, entity, def, value) === null) return null;
  const bounds = fieldBounds(o.reading.registry, w.ctx, entity, def);
  return { n: o.n, op: o.op, name: named(o.reading, entity), key, value: JSON.stringify(value), type: def.type, ...(bounds.min !== undefined ? { min: bounds.min } : {}), ...(bounds.max !== undefined ? { max: bounds.max } : {}), ...(def.values ? { choices: textOf(def.values) } : {}) };
}

/** Sets a field of someone or something: today's `set`, or `add` for a number, with a level following its experience as today's progressions have it. */
function setField(o: OpContext, entity: string, key: string, value: JsonValue | undefined, add: number | undefined): Unread | undefined {
  const reg = o.reading.registry;
  const w = o.draft.w;
  const e = own(w.state.entities, entity);
  if (!e) return { line: "not_applicable", fields: { n: o.n, op: o.op, code: "missing_entity" } };
  if (!safeKey(key) || key === GONE_FIELD) return notAs(o, "key", key, "key");
  const def = fieldDef(reg, w.ctx.world, e.kind, key);
  if (def?.derived !== undefined) return { line: "derived", fields: { n: o.n, op: o.op, key } };
  const levelOf = Object.values(w.ctx.world.ruleset?.progression ?? {}).find((p) => p.levelField === key);
  if (levelOf !== undefined) return { line: "follows_xp", fields: { n: o.n, op: o.op, key, xp: levelOf.xpField } };
  if (key === "cash" && typeof value === "number") {
    // Cash is corrected by a balanced posting against the outside correction account, as the GM's edit corrects it.
    materializeMoney(o, [entity]);
    const corrected = optionalService(w.ctx, "economy.set_cash")?.(w.ctx, entity, minorUnits(o.reading, value)) ?? null;
    if (corrected !== null) {
      const bad = Array.isArray(corrected) ? o.draft.applyAll(corrected) : corrected;
      return bad ? { line: "not_applicable", fields: { n: o.n, op: o.op, code: bad.code } } : undefined;
    }
  }
  const event: LedgerEvent = add !== undefined ? { type: "add", entity, field: key, delta: add } : { type: "set", entity, field: key, value: value ?? null };
  const bad = o.draft.applyAll([event]);
  if (bad) return { line: "not_applicable", fields: { n: o.n, op: o.op, code: bad.code } };
  const now = own(w.state.entities, entity)?.fields[key];
  const off = now === undefined ? null : offSheet(o, entity, key, now);
  if (off !== null) o.reply.report("off_the_sheet", off);
  levelsFollowXp(reg, w, [event], { bindings: { self: entity }, rng: createRng(o.draft.seed(o.n)), literal: true });
  return undefined;
}

/** Sets a value on a place of this chat's own world (its own field, which the places inside it take unless they set theirs), as today's chat draft writes a place. */
function setPlaceField(o: OpContext, placeId: string, key: string, value: JsonValue | undefined, add: number | undefined): Unread | undefined {
  const w = o.draft.w;
  const played = w.ctx.world;
  const def = own(played.places, placeId);
  if (!def) return { line: "not_applicable", fields: { n: o.n, op: o.op, code: "missing_place" } };
  if (!safeKey(key)) return notAs(o, "key", key, "key");
  const fields: JsonObject = { ...def.fields };
  if (add !== undefined) {
    const cur = fields[key];
    if (cur !== undefined && typeof cur !== "number") return { line: "not_applicable", fields: { n: o.n, op: o.op, code: "not_numeric" } };
    fields[key] = (typeof cur === "number" ? cur : 0) + add;
  } else if (value === null || value === undefined) delete fields[key];
  else fields[key] = value;
  const event = draftEvent(baseWorld(played), chatDraftOf(w.state), { collection: "places", id: placeId, value: { ...(def as unknown as JsonObject), fields } });
  const bad = o.draft.applyAll([event]);
  return bad ? { line: "not_applicable", fields: { n: o.n, op: o.op, code: bad.code } } : undefined;
}

/** The names the clock is set by. */
const CLOCK_KEYS: Readonly<Record<string, true>> = { time: true, clock: true };

const set: OpDef = {
  name: "set",
  lane: "engine",
  needs: ["at", "key"],
  takes: ["at", "key", "value", "add"],
  example: { op: "set", at: "bram", key: "hp", add: -4, source: { from: "gm", roll: "c-41" }, precision: "exact" },
  run(o) {
    const key = textArg(o.args, "key");
    if (key === undefined) return { line: "needs", fields: { n: o.n, op: o.op, fields: ["key"] } };
    const value = o.args.value;
    const add = numberArg(o.args, "add");
    if ((value === undefined) === (add === undefined)) return { line: "needs_one", fields: { n: o.n, op: o.op, fields: ["value", "add"] } };
    const at = find(o, "at", "point");
    if (isUnread(at)) return at;
    const from = o.draft.w.events.length;
    let failed: Unread | undefined;
    if (at.ref === "world") {
      if (!CLOCK_KEYS[key]) return notOneOf(o, "key", key, Object.keys(CLOCK_KEYS));
      const to = add !== undefined ? o.draft.w.state.clock + Math.round(add) : timeArg({ ...o, args: { ...o.args, value } }, "value");
      if (to === undefined || isUnread(to)) return to ?? { line: "needs", fields: { n: o.n, op: o.op, fields: ["value"] } };
      failed = setClock(o, to);
    } else if (at.ref.startsWith("place:")) failed = setPlaceField(o, at.id, key, value, add);
    else if (at.ref.startsWith("entity:")) {
      // A place set on someone or something is a move, through the one move path.
      if (key === "place" && value !== undefined) {
        const to = find(o, "value", "place");
        if (isUnread(to)) return to;
        failed = moveTo(o, at.id, to.id);
      } else failed = setField(o, at.id, key, value as JsonValue | undefined, add);
    } else return notAs(o, "at", o.args.at ?? null, "point");
    if (failed) return failed;
    o.draft.record(o.n, o.op, "engine", o.prov, from);
    return undefined;
  },
};

const fact: OpDef = {
  name: "fact",
  lane: "engine",
  needs: ["about", "key", "value"],
  takes: ["about", "key", "value", "replaces"],
  example: { op: "fact", about: "wren", key: "coin", value: "spent most of what she had", precision: "vague", source: { from: "prose", message: "m-0019" } },
  run(o) {
    const about = find(o, "about", "point");
    if (isUnread(about)) return about;
    if (!FACT_ABOUT.test(about.ref)) return notAs(o, "about", o.args.about ?? null, "point");
    const key = textArg(o.args, "key");
    const value = textArg(o.args, "value");
    if (key === undefined || value === undefined) return { line: "needs", fields: { n: o.n, op: o.op, fields: ["key", "value"] } };
    const replaces = textArg(o.args, "replaces");
    o.draft.recordStoreOp(o.n, o.op, "engine", o.prov, FACTS.change({ about: about.ref, key, value, ...(replaces !== undefined ? { replaces } : {}) }));
    o.after((state) => ({ facts: FACTS.of(state, about.ref) }));
    return undefined;
  },
};

const OUTCOMES = ["met", "failed"] as const;

const quest: OpDef = {
  name: "quest",
  lane: "engine",
  needs: ["quest"],
  takes: ["quest", "stage", "outcome", "why", "reveal"],
  example: { op: "quest", quest: "errand", stage: "done", outcome: "met", why: "The letter reached the warden's hand.", reveal: true, source: { from: "prose", message: "m-0020" } },
  run(o) {
    const track = find(o, "quest", "track");
    if (isUnread(track)) return track;
    const w = o.draft.w;
    const def = own(w.ctx.world.tracks, track.id);
    if (!def) return { line: "not_applicable", fields: { n: o.n, op: o.op, code: "missing_track" } };
    const current = own(w.state.tracks, track.id)?.stage ?? def.start;
    const said = textArg(o.args, "stage");
    const outcome = textArg(o.args, "outcome");
    if (outcome !== undefined && !(OUTCOMES as readonly string[]).includes(outcome)) return notOneOf(o, "outcome", outcome, OUTCOMES);
    if (said === undefined && o.args.reveal !== true) return { line: "needs_any", fields: { n: o.n, op: o.op, fields: ["stage", "reveal"] } };
    let stage: string | undefined;
    if (said !== undefined) {
      const lower = said.toLowerCase();
      stage = Object.keys(def.stages).find((id) => id === said) ?? Object.entries(def.stages).find(([id, s]) => id.toLowerCase() === lower || s.label.toLowerCase() === lower)?.[0];
      if (stage === undefined) return notOneOf(o, "stage", said, Object.entries(def.stages).map(([id, s]) => `${s.label} [${id}]`));
    }
    const from = w.events.length;
    const events: LedgerEvent[] = [];
    if (stage !== undefined) {
      if (stage === current) o.reply.report("already_so", { n: o.n, op: o.op, what: `${def.label} [${track.id}]` });
      else {
        const why = textArg(o.args, "why");
        // The reason and how it went are kept with the move; the move holds only where the quest stands now, as today's stage moves do.
        events.push({ type: "stage", track: track.id, to: stage, from: current, ...(why !== undefined ? { why } : {}), ...(outcome !== undefined ? { outcome } : {}) } as LedgerEvent);
        const paths = own(def.stages, current)?.next.map((n) => n.to) ?? [];
        if (!paths.includes(stage)) o.reply.report("off_path", { n: o.n, op: o.op, quest: `${def.label} [${track.id}]`, from: own(def.stages, current)?.label ?? current, to: own(def.stages, stage)?.label ?? stage });
      }
    }
    if (o.args.reveal === true) events.push({ type: ENGINE_EVENTS.revealed, data: { track: track.id, stage: stage ?? current } });
    const bad = o.draft.applyAll(events);
    if (bad) return { line: "not_applicable", fields: { n: o.n, op: o.op, code: bad.code } };
    o.draft.record(o.n, o.op, "engine", o.prov, from);
    return undefined;
  },
};

const relate: OpDef = {
  name: "relate",
  lane: "story",
  needs: ["who", "to", "change"],
  takes: ["who", "to", "axis", "change", "why"],
  example: { op: "relate", who: "bram", to: "wren", axis: "trust", change: 10, why: "She kept his secret.", source: { from: "prose", message: "m-0021" } },
  run(o) {
    const who = find(o, "who", "entity");
    if (isUnread(who)) return who;
    const to = find(o, "to", "entity");
    if (isUnread(to)) return to;
    const change = numberArg(o.args, "change");
    if (change === undefined || change === 0) return notAs(o, "change", o.args.change ?? null, "change");
    const w = o.draft.w;
    const axes = axesOf(w.ctx);
    const axis = textArg(o.args, "axis");
    if (axis !== undefined && !axes.some((a) => a.id === axis)) return notOneOf(o, "axis", axis, axes.map((a) => a.id));
    const from = w.events.length;
    const why = textArg(o.args, "why");
    const out = applyEffects(o.reading.registry, w, [{ type: "relationships.adjust", args: { from: who.id, to: to.id, delta: change, ...(axis !== undefined ? { axis } : {}), ...(why !== undefined ? { why } : {}) } }], { bindings: {}, rng: createRng(o.draft.seed(o.n)), literal: true });
    const failed = out.rejected[0];
    if (failed) return { line: "not_applicable", fields: { n: o.n, op: o.op, code: failed.rejection.code } };
    o.draft.record(o.n, o.op, "story", o.prov, from);
    return undefined;
  },
};

// The Author's own note of what it expects to matter: it changes nothing in the world, so it takes no provenance.
const horizon: OpDef = {
  name: "horizon",
  lane: "story",
  needs: ["list"],
  takes: ["list"],
  provenance: false,
  example: { op: "horizon", list: ["common_room", "market_square", "odile"] },
  run(o) {
    const given = o.args.list;
    if (!Array.isArray(given)) return notAs(o, "list", given ?? null, "list");
    const refs: string[] = [];
    const words: string[] = [];
    for (const said of given) {
      const r = find(o, "list", "point", false, said);
      // Words that name no place, person or thing are kept as they were given: a note of what the Author expects to matter.
      if (isUnread(r) && r.line === "unknown" && typeof said === "string") {
        refs.push(said.trim());
        words.push(said.trim());
        continue;
      }
      if (isUnread(r)) return r;
      refs.push(r.ref);
    }
    if (words.length > 0) o.reply.report("horizon_words", { n: o.n, op: o.op, words: textOf(words) });
    o.draft.recordStoreOp(o.n, o.op, "story", o.prov, { op: STORE_OPS.horizon, value: { list: refs } });
    o.draft.storeState.horizon = refs;
    return undefined;
  },
};

/** The operations on values. */
export const VALUE_OPS: readonly OpDef[] = [pay, set, fact, quest, relate, horizon];
