// The everyday operations on values (the skills `economy`, `ruleset-and-sheets`, `quests`, `groups`,
// `time`): `pay`, `set`, `fact`, `quest`, `relate` and `horizon`. Each runs through today's own
// systems (the economy's payments, the sheets' fields and progressions, the tracks, regard). What
// does not add up (a payment past what the payer holds, a stat past its bounds, a stage off the
// quest's paths) is applied and reported.

import type { JsonObject, JsonValue } from "rp-harness/contract";
import { isRecord, safeKey } from "../shared/json";
import type { LedgerEvent } from "../shared/ledger";
import { formatMoney } from "../shared/world";
import { fieldBounds, type LevelOffer, levelsFollowXp, applyEffects } from "../engine/effects";
import { levelProgression, progressOf } from "../engine/ruleset";
import { valueProblem } from "../engine/edits";
import { ENGINE_EVENTS } from "../engine/engine-pack";
import { EXTERNAL_ACCOUNT_PREFIX } from "../engine/events";
import { optionalService, own } from "../engine/pack-kit";
import { baseWorld } from "../engine/places-in-play";
import { createRng } from "../engine/rng";
import { fieldDef, formulaFigure, GONE_FIELD, isGone, placeOfEntity } from "../engine/scope";
import { applyItemOp } from "../engine/thing-ops";
import { isThing, possessorOf } from "../engine/things";
import { chatDraftOf, draftEvent } from "../engine/world-draft";
import { accountsOf, balance, classOf, external, hasLedger, holdersOf, statusOf, traitsOf } from "../packs/economy/core/model";
import { asUnit, cashAccount, isParty, type PayMethod, payeeSide, posting, waysOf, wayFor } from "../packs/economy/core/pay";
import { LIGHT_FIELD } from "../packs/space/core/light";
import { axesOf } from "../packs/relationships/core/index";
import { findQuest, newQuestId, QUEST_KINDS, QUEST_OPS, QUEST_STORE_AREA, type QuestDoc, type QuestOp, type QuestSlice, questSliceOf } from "../quests";
import { storySliceOf } from "../story";
import { baseOf, PLACE_OPS, placeSliceOf } from "../places/fold";
import { isPlaceFactPart, PLACE_FACT_PARTS } from "../places/parts";
import { BASE_KEYS, drawnAgainst } from "../places/prepare";
import { FACT_ABOUT, factStore } from "../store/facts";
import { STORE_OPS } from "../store/types";
import { HORIZON } from "../store/view";
import type { FactStore } from "./kit";
import { nearestOf, type Want } from "./reading";
import type { Draft } from "./writing";
import { find, findOptional, isUnread, itemOptions, minorUnits, named, notAs, notOneOf, numberArg, type OpContext, type OpDef, outsideList, refusedAs, textArg, type Unread } from "./ops";
import type { Provenance } from "./source";
import { textOf } from "./texts";
import { moveTo } from "./ops-things";
import { setClock, timeArg } from "./ops-time";

/** The fact store every `fact` is recorded through: the store's own. */
const FACTS: FactStore = factStore;

/** What a world's own authored openings are recorded as: the owner set them in his world, so they stand established, from the player (plan §6.6). */
const AUTHORED: Provenance = { source: { from: "player" }, precision: null, standing: "established", marks: [] };

/**
 * Opens the accounts the world gave each of `ids` that nobody has opened yet, so a sum starts from
 * what the world gave: for a party that holds accounts, the world's money opens them by posting
 * their authored openings (`openingBalances`) and nothing else. Someone the world gave no accounts
 * is given none here; the world's tables fill those in only when an agent asks (`fill_in_detail`).
 * What is opened is no part of what the call said, so it is a change of its own (`Draft.fill`), and
 * it stands established from the player: the owner set it in his world.
 * What could not be applied, when something could not.
 */
export function openAuthored(o: OpContext, ids: readonly string[]): Unread | undefined {
  for (const id of ids) {
    if (!hasLedger(o.draft.w.ctx, id)) continue;
    const bad = o.draft.fill(o.n, id, "money", AUTHORED);
    if (bad) return { line: "not_applicable", fields: { n: o.n, op: o.op, code: bad.code } };
  }
  return undefined;
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
 * A payment made from the payer's own money whatever it holds, for a caller whose way found nothing
 * that covers it (`NO_WAY_TO_PAY`) or declined it: out of their cash, else the first account they
 * spend from that is open, else their outside account; into the payee's side; as one unit with its
 * journal lines and what is made with it. The funds guard advises on it where it runs past cover; it
 * does not decline it. `pay` does not come here: the way it names is the way it pays.
 */
export function payPastCover(o: OpContext, p: PastCover): Unread | undefined {
  const ctx = o.draft.w.ctx;
  const open = [cashAccount(ctx, p.payer), ...accountsOf(ctx, p.payer, "spend")].find((a): a is string => a !== null && statusOf(ctx.state, a) === "open");
  const dest = p.payee !== undefined ? payeeSide(ctx, { payee: p.payee }, p.cents) : { account: `${EXTERNAL_ACCOUNT_PREFIX}world`, extra: [] };
  const lines = [
    { account: open ?? external(p.payer), amount: -p.cents },
    { account: dest.account, amount: p.cents },
  ];
  const paid = posting(lines, { memo: p.memo, kind: p.kind, payer: p.payer, ...(p.payee !== undefined ? { counterparty: p.payee } : {}), ...(p.category !== undefined ? { category: p.category } : {}), story: true });
  const bad = o.draft.applyAll(asUnit([...paid, ...dest.extra, ...(p.with ?? [])]));
  return bad ? { line: "not_applicable", fields: { n: o.n, op: o.op, code: bad.code } } : undefined;
}

/**
 * What a payment of `cents` by `payer` came to, from the state after it (its events from `from`
 * on): from the payer's money outside the world's accounts, when the world keeps none for them,
 * is said; from outside money though the payer holds accounts none of which could pay, is reported,
 * with what that way could have paid (nothing). What an account it took from held, past cover or
 * not open, is the funds guard's advice on the posting, reported as the operation is recorded.
 */
export function paidLines(o: OpContext, payer: string, cents: number, from: number): void {
  const ctx = o.draft.w.ctx;
  const lines = o.draft.w.events.slice(from).flatMap((e) => (e.type === "post" ? e.lines : []));
  if (!lines.some((l) => l.account === external(payer) && l.amount < 0)) return;
  const fields = { n: o.n, op: o.op, payer: named(o.reading, payer) };
  if (!hasLedger(ctx, payer)) o.reply.line("paid_from_outside", fields);
  else o.reply.report("paid_past_held", { ...fields, amount: formatMoney(cents, o.reading.doc.currency), held: formatMoney(0, o.reading.doc.currency) });
}

/** The fixed ways of paying a call's `method` may name; any other it names is one of the payer's own accounts or cards, by id or exact name. */
const FIXED_WAYS: readonly PayMethod[] = ["cash", "card", "credit", "debit", "charge", "checking", "savings", "account"];

/**
 * The way a call's `method` names: one of the fixed ways, or an account or card of the payer's by its id or its exact name. Nothing
 * is read out of the words. Anything else is refused with the fixed ways and the payer's own listed as the choices.
 */
function wayNamed(o: OpContext, payer: string, said: string): { way: PayMethod } | { source: string } | Unread {
  const text = said.trim();
  const lower = text.toLowerCase();
  const fixed = FIXED_WAYS.find((m) => m === lower);
  if (fixed !== undefined) return { way: fixed };
  const ways = waysOf(o.draft.w.ctx, payer);
  const byId = ways.filter((w) => w.id === text);
  const hits = byId.length > 0 ? byId : ways.filter((w) => w.name.trim().toLowerCase() === lower);
  const [hit, other] = hits;
  if (hit !== undefined && other === undefined) return { source: hit.id };
  if (hit !== undefined) return { line: "several", fields: { n: o.n, op: o.op, field: "method", name: text, several: textOf(hits.map((w) => `${w.name} [${w.id}]`)) } };
  const choices = [...FIXED_WAYS, ...ways.map((w) => `${w.name} [${w.id}]`)];
  return { line: "unreadable_op", fields: { n: o.n, op: o.op, field: "method", value: JSON.stringify(said), choices: textOf(choices) }, data: { field: "method", choices } };
}

/** A payer or payee that names a thing, not someone or a group the economy keeps money for: the answer names `give` for a thing that holds coin. */
function notParty(u: Unread): Unread {
  return u.line === "unknown" && u.fields.other !== "" ? { ...u, line: "use_give" } : u;
}

/** The recorded things the words of a payment's goods name exactly: by id, or by the whole name. */
function goodsNamed(o: OpContext, said: string): string[] {
  const w = o.draft.w;
  const key = said.trim().replace(/\s+/g, " ").toLowerCase();
  if (key === "") return [];
  return Object.entries(w.state.entities)
    .filter(([id, e]) => isThing(w.ctx, id) && !isGone(w.state, id) && (id === said.trim() || e.name.trim().replace(/\s+/g, " ").toLowerCase() === key))
    .map(([id]) => id);
}

/**
 * A thing a payment bought, changing hands through the things model with advice: to a person as sold (a seller who did not hold it is
 * reported; a built-in thing moves and is advised), to anyone else (a group, a business) made theirs where it stands.
 */
function handOver(o: OpContext, thing: string, to: string, seller: string | undefined): Unread | undefined {
  const w = o.draft.w;
  const holder = possessorOf(w.ctx, thing);
  if (seller !== undefined && holder !== seller) o.reply.report("not_holding", { n: o.n, op: o.op, from: named(o.reading, seller), what: named(o.reading, thing), holder: holder === null ? "" : named(o.reading, holder) });
  const op = o.reading.isPerson(to) ? { do: "hand" as const, item: thing, to, basis: "sale" as const, why: "" } : { do: "own" as const, item: thing, owner: to, why: "" };
  const out = applyItemOp(w, op, { ...itemOptions(o), advise: true });
  if ("code" in out) return out.code === "no_change" ? undefined : refusedAs(o, out, "goods", "thing");
  if (out.filled !== undefined) o.draft.markFilled(out.filled);
  for (const advice of out.advice ?? []) o.draft.adviseOp(o.n, advice);
  return undefined;
}

const pay: OpDef = {
  name: "pay",
  lane: "engine",
  needs: ["who", "amount"],
  takes: ["who", "to", "amount", "for", "goods", "qty", "reason", "method", "world_terms"],
  example: { op: "pay", who: "wren", to: "bram", amount: 3, for: "a room for the night", goods: "Cask of cider", reason: "purchase", source: { from: "prose", message: "m-0018" } },
  run(o) {
    const w = o.draft.w;
    const payer = find(o, "who", "party");
    if (isUnread(payer)) return notParty(payer);
    const toFound = findOptional(o, "to", "entity");
    if (isUnread(toFound)) return toFound;
    // A payee is someone, a group, or one of their accounts (the money lands in that account as it is).
    const account = toFound !== undefined && own(w.state.entities, toFound.id)?.kind === "account" ? toFound.id : undefined;
    if (toFound !== undefined && account === undefined && !isParty(w.ctx, toFound.id)) {
      const asParty = find(o, "to", "party");
      if (isUnread(asParty)) return notParty(asParty);
    }
    const payee = account !== undefined ? holdersOf(w.state, account).find((h) => own(w.state.entities, h) !== undefined && isParty(w.ctx, h)) : toFound?.id;
    const amount = numberArg(o.args, "amount");
    if (amount === undefined || !(amount > 0)) return notAs(o, "amount", o.args.amount ?? null, "amount");
    if (o.args.qty !== undefined && !(typeof o.args.qty === "number" && Number.isInteger(o.args.qty) && o.args.qty >= 1)) return notAs(o, "qty", o.args.qty, "qty");
    const cents = minorUnits(o.reading, amount);
    const goods = textArg(o.args, "goods");
    // The journal line is the call's own words, else none.
    const memo = textArg(o.args, "for") ?? textArg(o.args, "reason") ?? goods ?? "";
    const said = textArg(o.args, "method");
    const way = said === undefined ? undefined : wayNamed(o, payer.id, said);
    if (way !== undefined && isUnread(way)) return way;
    const from = w.events.length;
    const unopened = openAuthored(o, [payer.id, ...(payee !== undefined ? [payee] : [])]);
    if (unopened) return unopened;
    const ctx = w.ctx;
    const fixed = way !== undefined && "way" in way ? way.way : undefined;
    const picked = fixed !== undefined ? wayFor(ctx, payer.id, fixed, cents) : null;
    const source = way !== undefined && "source" in way ? way.source : picked !== null ? (picked.card ?? picked.account) : undefined;
    // What a card or loan owed before this payment, for a payment into it.
    const owing = account !== undefined && traitsOf(ctx, account)?.liability === true ? Math.max(0, -balance(w.state, account)) : undefined;
    const terms = o.args.world_terms === true ? { before: [] as LedgerEvent[], after: [] as LedgerEvent[] } : undefined;
    const charge = optionalService(ctx, "economy.charge");
    const before = w.events.length;
    if (charge !== null) {
      const ownAccount = account !== undefined && payee === payer.id;
      const events = charge(ctx, payer.id, cents, memo, {
        given: true,
        kind: goods !== undefined ? "purchase" : ownAccount && owing === undefined ? "transfer" : "payment",
        ...(payee !== undefined ? { payee } : account === undefined ? { counterparty: `${EXTERNAL_ACCOUNT_PREFIX}world` } : {}),
        ...(account !== undefined ? { deposit: account } : {}),
        ...(source !== undefined ? { source } : {}),
        ...(terms !== undefined ? { terms, sale: { place: placeOfEntity(w.state, payer.id), item: goods ?? memo } } : {}),
      });
      if (!Array.isArray(events)) return refusedAs(o, events, "to", "party");
      const early = terms === undefined ? null : o.draft.fillWith(terms.before);
      const bad = early ?? o.draft.applyAll(events) ?? (terms === undefined ? null : o.draft.fillWith(terms.after));
      if (bad) return { line: "not_applicable", fields: { n: o.n, op: o.op, code: bad.code } };
    }
    if (w.events.length === before) o.reply.report("money_untracked", { n: o.n, op: o.op, payer: named(o.reading, payer.id) });
    else paidLines(o, payer.id, cents, before);
    const money = (c: number): string => formatMoney(c, o.reading.doc.currency);
    if (account !== undefined && owing !== undefined && cents > owing) o.reply.report("paid_past_owed", { n: o.n, op: o.op, account: named(o.reading, account), amount: money(cents), owed: money(owing), past: money(cents - owing) });
    if (fixed !== undefined && picked === null) o.reply.report("way_not_held", { n: o.n, op: o.op, payer: named(o.reading, payer.id), way: fixed });
    const added = terms === undefined ? [] : [...terms.before, ...terms.after].filter((e) => e.type === "post");
    if (added.length > 0) o.reply.report("terms_added", { n: o.n, op: o.op, count: added.length, sums: textOf(added.map((e) => money(e.type === "post" ? e.lines.reduce((sum, l) => sum + Math.max(0, l.amount), 0) : 0))) });
    // Goods that are a recorded thing change hands; any other words stay words on the payment's journal line, and nothing is made.
    if (goods !== undefined) {
      const found = goodsNamed(o, goods);
      const held = payee === undefined ? [] : found.filter((id) => possessorOf(w.ctx, id) === payee);
      const sold = found.length === 1 ? found[0] : held.length === 1 ? held[0] : undefined;
      if (sold === undefined) o.reply.report("goods_words", { n: o.n, op: o.op, goods, ...(found.length > 1 ? { several: textOf(found.map((id) => named(o.reading, id))) } : {}) });
      else {
        const failed = handOver(o, sold, payer.id, payee);
        if (failed) return failed;
      }
    }
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

/** A sum in the world's main coin as an argument gives it: a number, or a number sent as text ("40"); anything else is none. */
function amountOf(v: JsonValue | undefined): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v.trim()) : Number.NaN;
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Corrects someone's cash as the GM's edit corrects it: a balanced posting against the outside
 * correction account that brings what their cash accounts hold `to` a sum, or moves it `by` one.
 * Past nothing, one correction takes all of it and the rest off their carried cash, below nothing, and
 * the funds guard advises that it held less (`corrected_past_held`).
 * Null when they keep no cash account: their cash is then a field like any other.
 */
function correctCash(o: OpContext, entity: string, change: { to: number } | { by: number }): Unread | undefined | null {
  const unopened = openAuthored(o, [entity]);
  if (unopened) return unopened;
  const ctx = o.draft.w.ctx;
  const wallet = cashAccount(ctx, entity);
  if (wallet === null) return null;
  const held = accountsOf(ctx, entity, "spend").filter((id) => classOf(ctx, id) === "cash").reduce((sum, id) => sum + balance(ctx.state, id), 0);
  const target = "by" in change ? held + minorUnits(o.reading, change.by) : minorUnits(o.reading, change.to);
  const corrected = target >= 0 ? (optionalService(ctx, "economy.set_cash")?.(ctx, entity, target) ?? null) : (optionalService(ctx, "economy.adjust")?.(ctx, wallet, target - held) ?? null);
  if (corrected === null) return null;
  const bad = Array.isArray(corrected) ? o.draft.applyAll(corrected) : corrected;
  if (bad) return { line: "not_applicable", fields: { n: o.n, op: o.op, code: bad.code } };
  return undefined;
}

/**
 * Sets a field of someone or something as the story gives it: today's `set`, or `add` for a number. A field the rules work out takes
 * the value and the answer gives the rules' own figure; a level that follows experience takes it and the answer says the two now
 * disagree; experience brings its level as a sum and offers the level-up gains, never running them; a number added to a field that
 * holds none is recorded and the field stays as it was.
 */
function setField(o: OpContext, entity: string, key: string, value: JsonValue | undefined, add: number | undefined): Unread | undefined {
  const reg = o.reading.registry;
  const w = o.draft.w;
  const e = own(w.state.entities, entity);
  if (!e) return refusedAs(o, { code: "missing_entity", reason: `no entity ${entity}` }, "at", "entity");
  if (!safeKey(key) || key === GONE_FIELD) return notAs(o, "key", key, "key");
  const def = fieldDef(reg, w.ctx.world, e.kind, key);
  if (key === "cash") {
    // Cash is a sum, set to one or moved by one; a number sent as text is that number.
    const to = amountOf(value);
    const change = add !== undefined ? { by: add } : to !== undefined ? { to } : undefined;
    if (change === undefined) return notAs(o, "value", value ?? null, "amount_any");
    const corrected = correctCash(o, entity, change);
    if (corrected !== null) return corrected;
    if (to !== undefined) value = to;
  }
  const event: LedgerEvent = add !== undefined ? { type: "add", entity, field: key, delta: add } : { type: "set", entity, field: key, value: value ?? null };
  const bad = o.draft.applyAll([event]);
  if (bad) return refusedAs(o, bad, "at", "entity");
  const name = named(o.reading, entity);
  if (def?.derived !== undefined) {
    // Kept as given over the formula; a value of null returns the field to it. The rules' own figure is said.
    if (value !== null && value !== undefined) o.draft.adviseOp(o.n, { code: "derived", values: { name, key, value: JSON.stringify(value), figure: String(formulaFigure(reg, w.ctx, entity, key) ?? "") } });
  } else {
    const now = own(w.state.entities, entity)?.fields[key];
    const off = now === undefined ? null : offSheet(o, entity, key, now);
    if (off !== null) o.reply.report("off_the_sheet", off);
  }
  // A level that follows experience is kept as stated; where the two disagree it is said.
  const following = levelProgression(reg, w.ctx.world, e.kind, key);
  const reading = following === null ? null : progressOf(reg, w.ctx, entity, following);
  if (following !== null && reading !== null && reading.level !== reading.reached) o.draft.adviseOp(o.n, { code: "level_beside_xp", values: { who: name, field: following.label, level: reading.level, reached: reading.reached, xp: reading.xp } });
  // Experience brings its level as a sum, and the level-up gains come back offered: none is run, and nothing is thrown away.
  const followed = levelsFollowXp(reg, w, [event], { bindings: { self: entity }, rng: createRng(o.draft.seed(o.n)), literal: true, offers: true });
  for (const advice of followed.advice ?? []) o.draft.adviseOp(o.n, advice);
  for (const refused of followed.rejected) o.reply.report("not_applied", { n: o.n, op: o.op, code: refused.rejection.code });
  const offered = new Map<string, LevelOffer[]>();
  for (const offer of followed.offered ?? []) offered.set(`${offer.entity}\u0000${offer.progression}`, [...(offered.get(`${offer.entity}\u0000${offer.progression}`) ?? []), offer]);
  for (const offers of offered.values()) {
    const [first] = offers;
    const last = offers[offers.length - 1];
    if (first === undefined || last === undefined) continue;
    o.reply.report("level_offers", { n: o.n, op: o.op, who: named(o.reading, first.entity), field: own(w.ctx.world.ruleset?.progression ?? {}, first.progression)?.label ?? first.progression, level: last.level, from: first.from, levels: textOf(offers.map((x) => String(x.level))), effects: JSON.stringify(first.effects) });
  }
  return undefined;
}

/**
 * Sets a value on a place of this chat's own world (its own field, which the places inside it take unless they set theirs), as today's
 * chat draft writes a place. A number added to a field that holds none is recorded and the field stays as it was.
 */
function setPlaceField(o: OpContext, placeId: string, key: string, value: JsonValue | undefined, add: number | undefined): Unread | undefined {
  const w = o.draft.w;
  const played = w.ctx.world;
  const def = own(played.places, placeId);
  if (!def) return refusedAs(o, { code: "missing_place", reason: `no place ${placeId}` }, "at", "place");
  if (!safeKey(key)) return notAs(o, "key", key, "key");
  const fields: JsonObject = { ...def.fields };
  if (add !== undefined) {
    const cur = fields[key];
    if (cur !== undefined && typeof cur !== "number") o.draft.adviseOp(o.n, { code: "not_numeric", values: { entity: def.name, field: key } });
    else fields[key] = (typeof cur === "number" ? cur : 0) + add;
  } else if (value === null || value === undefined) delete fields[key];
  else fields[key] = value;
  const event = draftEvent(baseWorld(played), chatDraftOf(w.state), { collection: "places", id: placeId, value: { ...(def as unknown as JsonObject), fields } });
  const bad = o.draft.applyAll([event]);
  if (bad) return refusedAs(o, bad, "at", "place");
  // A light that is neither lit nor dark is recorded as given, and said to read as unset (`packs/space/core/light.ts`).
  if (key === LIGHT_FIELD) {
    const found = o.call.deps.grid.light({ state: { ...o.reading.state, world: w.state }, env: o.call.deps.env, place: placeId, value: fields[key] });
    if (found) o.reply.reported(found.line, { n: o.n, op: o.op, ...found.fields }, found.words);
  }
  return undefined;
}

/**
 * (S17Story, places) A place's base, the words that stand for what it is and looks like: today's `description` and `base` are one part with
 * one home, the places' area. It is written as that area's change, drawn against the entries bound to the place as the call read them
 * (`prepareBases`), and the answer gives the base as it now reads. Nothing is written into the chat's draft of its world.
 */
function setPlaceBase(o: OpContext, place: string, value: JsonValue | undefined): Unread | undefined {
  if (typeof value !== "string" || value.trim() === "") return notAs(o, "value", value ?? null, "words");
  if (!own(o.draft.w.ctx.world.places, place)) return refusedAs(o, { code: "missing_place", reason: `no place ${place}` }, "at", "place");
  o.draft.recordStoreOp(o.n, o.op, "engine", o.prov, { op: PLACE_OPS.base, value: { place, text: value.trim(), drawn: drawnAgainst(o.call, place) } });
  o.after((state) => ({ base: baseOf(placeSliceOf(state), place)?.text ?? null }));
  return undefined;
}

/**
 * Sets a value at the world's own level: any key, as the world's own value (`store.value`) with the call's provenance, said where the
 * world's setup does not list it, and said where one of its systems keeps that value itself, which then stands in the tree and in the sums.
 */
function setWorldValue(o: OpContext, key: string, value: JsonValue | undefined, add: number | undefined): Unread | undefined {
  if (!safeKey(key)) return notAs(o, "key", key, "key");
  const values = o.reading.state.values ?? {};
  const current = Object.hasOwn(values, key) ? values[key] : undefined;
  let next: JsonValue;
  if (add === undefined) next = value ?? null;
  else if (current !== undefined && typeof current !== "number") {
    next = current;
    o.draft.adviseOp(o.n, { code: "not_numeric", values: { entity: "the world", field: key } });
  } else next = (typeof current === "number" ? current : 0) + add;
  const system = Object.hasOwn(values, key) ? undefined : o.reading.view().values("world").find((line) => line.key === key);
  o.draft.adviseOp(o.n, { code: "world_unlisted", values: { key, value: JSON.stringify(next) } });
  if (system !== undefined) o.draft.adviseOp(o.n, { code: "system_keeps", values: { key, system: system.from !== undefined && "system" in system.from && typeof system.from.system === "string" ? system.from.system : "the world's setup", kept: String(system.value), value: JSON.stringify(next) } });
  o.draft.recordStoreOp(o.n, o.op, "engine", o.prov, { op: STORE_OPS.value, value: { at: "world", key, value: next } });
  return undefined;
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
    // A number added that reads as none is refused naming the field, never taken for no number at all.
    if (add === undefined && o.args.add !== undefined && o.args.add !== null) return notAs(o, "add", o.args.add, "amount_any");
    if ((value === undefined) === (add === undefined)) return { line: "needs_one", fields: { n: o.n, op: o.op, fields: ["value", "add"] } };
    const at = find(o, "at", "point");
    if (isUnread(at)) return at;
    const from = o.draft.w.events.length;
    let failed: Unread | undefined;
    if (at.ref === "world" && !CLOCK_KEYS[key]) return setWorldValue(o, key, value as JsonValue | undefined, add);
    if (at.ref === "world") {
      const to = add !== undefined ? o.draft.w.state.clock + Math.round(add) : timeArg({ ...o, args: { ...o.args, value } }, "value");
      if (to === undefined || isUnread(to)) return to ?? { line: "needs", fields: { n: o.n, op: o.op, fields: ["value"] } };
      failed = setClock(o, to);
    } else if (at.ref.startsWith("place:") && BASE_KEYS.includes(key)) {
      // (S17Story, places) The base is the place's one description: written as its own record, never into the chat's draft of its world.
      const written = setPlaceBase(o, at.id, add === undefined ? (value as JsonValue | undefined) : undefined);
      if (written) return written;
      return undefined;
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
  lanes: ["engine", "story"],
  needs: ["about", "key", "value"],
  takes: ["about", "key", "value", "replaces", "part", "beat"],
  example: { op: "fact", about: "wren", key: "coin", value: "spent most of what she had", precision: "vague", source: { from: "prose", message: "m-0019" } },
  run(o) {
    const about = find(o, "about", "point");
    if (isUnread(about)) return about;
    if (!FACT_ABOUT.test(about.ref)) return notAs(o, "about", o.args.about ?? null, "point");
    const key = textArg(o.args, "key");
    const value = textArg(o.args, "value");
    if (key === undefined || value === undefined) return { line: "needs", fields: { n: o.n, op: o.op, fields: ["key", "value"] } };
    const replaces = textArg(o.args, "replaces");
    // (S17Story, places) The part of a place's record the fact belongs to, and the beat that caused it; a part is a place's alone.
    const part = textArg(o.args, "part");
    if (part !== undefined && !about.ref.startsWith("place:")) return { line: "fact_part_place", fields: { n: o.n, op: o.op, about: o.args.about ?? null, choices: textOf(PLACE_FACT_PARTS) } };
    if (part !== undefined && !isPlaceFactPart(part)) return notOneOf(o, "part", part, PLACE_FACT_PARTS);
    const beat = textArg(o.args, "beat");
    if (beat !== undefined) {
      const items = storySliceOf(o.draft.base.state).items;
      if (!Object.hasOwn(items, beat) || items[beat]?.part !== "beat") {
        const ids = Object.values(items).filter((i) => i.part === "beat").map((i) => i.id);
        return { line: "unknown_beat", fields: { n: o.n, op: o.op, beat, near: textOf(nearestOf(beat, ids, o.call.settings).slice(0, o.call.settings.nearMatches)) } };
      }
    }
    // The lane its writer names; with none named it is the engine's, and the answer says so.
    if (o.args.lane === undefined || o.args.lane === null) o.reply.report("fact_lane_default", { n: o.n, op: o.op, lane: o.lane });
    o.draft.recordStoreOp(o.n, o.op, o.lane, o.prov, FACTS.change({ about: about.ref, key, value, ...(replaces !== undefined ? { replaces } : {}), ...(part !== undefined ? { part } : {}), ...(beat !== undefined ? { beat } : {}) }));
    o.after((state) => ({ facts: FACTS.of(state, about.ref) }));
    return undefined;
  },
};

const OUTCOMES = ["met", "failed"] as const;
/** What a stage is called on an opened quest: met, failed, or open again. */
const CALLS = [...OUTCOMES, "open"] as const;

/** The quests' slice as this call stands: what the turn's base held, with what the call's earlier operations wrote. */
const QUESTS_IN_CALL = new WeakMap<Draft, QuestSlice>();

function questsOf(o: OpContext): QuestSlice {
  return QUESTS_IN_CALL.get(o.draft) ?? questSliceOf(o.draft.base.state);
}

/** Records one change of the quests' area on the draft, in the engine lane, and carries the call's own slice on. */
function writeQuest(o: OpContext, op: QuestOp, value: JsonObject): void {
  o.draft.recordStoreOp(o.n, o.op, "engine", o.prov, { op: QUEST_OPS[op], value });
  const out = QUEST_STORE_AREA.ops[op]?.apply(questsOf(o) as unknown as JsonObject, { op, value, turn: "", n: 0, by: null, standing: null, precision: null, source: null, cite: null });
  if (out !== undefined && !("applied" in out)) QUESTS_IN_CALL.set(o.draft, out.slice as unknown as QuestSlice);
}

/** The refs a list of names names (one name, or a list), found as `want`; the first that names nothing, as the operation could not read it. */
function refsOf(o: OpContext, field: string, want: Want): string[] | Unread | undefined {
  const given = o.args[field];
  if (given === undefined || given === null) return undefined;
  const refs: string[] = [];
  for (const name of Array.isArray(given) ? given : [given]) {
    const r = find(o, field, want, false, name);
    if (isUnread(r)) return r;
    refs.push(r.ref);
  }
  return refs;
}

/** The thread a quest belongs to, by its id in the story record; one the record does not hold is answered with the ids it does. */
function threadArg(o: OpContext): string | Unread | undefined {
  const thread = textArg(o.args, "thread");
  if (thread === undefined) return undefined;
  const items = storySliceOf(o.draft.base.state).items;
  if (isRecord(items) && Object.hasOwn(items, thread) && (items[thread] as { part: string }).part === "thread") return thread;
  const near = Object.values(items).filter((i) => i.part === "thread").map((i) => i.id);
  return { line: "unknown_thread", fields: { n: o.n, op: o.op, thread, near: textOf(near) } };
}

/** One stage a call names, as an object with its `stage` id (or `id`), and its label, condition and place among the stages. */
function stageList(o: OpContext): { stage: string; label?: string; condition?: string; after?: string | null; drop?: true }[] | Unread | undefined {
  const given = o.args.stages;
  if (given === undefined || given === null) return undefined;
  if (!Array.isArray(given)) return notAs(o, "stages", given, "list");
  const out: { stage: string; label?: string; condition?: string; after?: string | null; drop?: true }[] = [];
  for (const s of given) {
    const id = isRecord(s) ? (typeof s.stage === "string" ? s.stage : typeof s.id === "string" ? s.id : "") : "";
    if (!isRecord(s) || id.trim() === "") return notAs(o, "stages", s ?? null, "stage");
    out.push({
      stage: id.trim(),
      ...(typeof s.label === "string" ? { label: s.label } : {}),
      ...(typeof s.condition === "string" ? { condition: s.condition } : {}),
      ...(s.after === null || typeof s.after === "string" ? { after: s.after } : {}),
      ...(s.drop === true ? { drop: true as const } : {}),
    });
  }
  return out;
}

/** What the player is shown, as the call says it: `all`, `none`, a list of stages, or `default` to leave it to the quest's own visibility. */
function shownArg(o: OpContext): "all" | "none" | string[] | null | Unread | undefined {
  const given = o.args.show;
  if (given === undefined) return o.args.reveal === true ? "all" : undefined;
  if (given === "all" || given === "none") return given;
  if (given === "default" || given === null) return null;
  if (Array.isArray(given) && given.every((s) => typeof s === "string" && s.trim() !== "")) return given.map((s) => String(s).trim());
  return notAs(o, "show", given, "stage_list");
}

/** The stage of an opened quest a word names: its id, or its label. */
function stageOf(stages: readonly { id: string; label: string }[], said: string): string | undefined {
  const lower = said.toLowerCase();
  return stages.find((s) => s.id === said)?.id ?? stages.find((s) => s.id.toLowerCase() === lower || s.label.toLowerCase() === lower)?.id;
}

/**
 * What a call writes to a quest of the story's: what it is, its stakes and rewards, its thread, its stages, who and where and what it
 * involves, a stage called, what the player is shown, how it closed. Everything is read first; nothing is recorded if something cannot be.
 */
function writeParts(o: OpContext, id: string, name: string, opened: boolean): Unread | undefined {
  const plan: [QuestOp, JsonObject][] = [];
  const parts: string[] = [];
  const add = (op: QuestOp, part: string, value: JsonObject): void => {
    plan.push([op, { quest: id, ...value }]);
    parts.push(part);
  };
  const objective = textArg(o.args, "objective");
  const matters = textArg(o.args, "matters");
  if (objective !== undefined || matters !== undefined) add("what", "what", { ...(objective !== undefined ? { objective } : {}), ...(matters !== undefined ? { why: matters } : {}) });
  const stakes = textArg(o.args, "stakes");
  const rewards = textArg(o.args, "rewards");
  if (stakes !== undefined || rewards !== undefined) add("stakes", "stakes", { ...(stakes !== undefined ? { stakes } : {}), ...(rewards !== undefined ? { rewards } : {}) });
  const thread = threadArg(o);
  if (isUnread(thread)) return thread;
  if (thread !== undefined) add("thread", "thread", { thread });
  const stages = stageList(o);
  if (isUnread(stages)) return stages;
  for (const s of stages ?? []) add("stage", `stage ${s.stage}`, s);
  const unbind = o.args.unbind === true;
  for (const [field, want, key] of [["who", "entity", "who"], ["where", "place", "where"], ["things", "thing", "things"]] as const) {
    const refs = refsOf(o, field, want);
    if (isUnread(refs)) return refs;
    if (refs !== undefined) add("bind", field, { [key]: refs, ...(unbind ? { unbind: true } : {}) });
  }
  const outcome = textArg(o.args, "outcome");
  const said = textArg(o.args, "stage");
  const why = textArg(o.args, "why");
  if (opened && said !== undefined) {
    if (outcome === undefined || !(CALLS as readonly string[]).includes(outcome)) return outcome === undefined ? { line: "needs_any", fields: { n: o.n, op: o.op, fields: ["outcome"] } } : notOneOf(o, "outcome", outcome, CALLS);
    // The stages the call itself wrote count: a stage can be written and called in one call.
    const known = [...(questsOf(o).quests[id]?.stages ?? []), ...(stages ?? []).map((s) => ({ id: s.stage, label: s.label ?? s.stage }))];
    const stage = stageOf(known, said);
    if (stage === undefined) return notOneOf(o, "stage", said, known.map((s) => `${s.label} [${s.id}]`));
    add("call", `stage ${stage} ${outcome}`, { stage, state: outcome, ...(why !== undefined ? { why } : {}) });
  }
  const shown = shownArg(o);
  if (isUnread(shown)) return shown;
  if (shown !== undefined) add("show", "show", { shown });
  const closing = textArg(o.args, "close");
  if (closing !== undefined) add("close", closing === "reopen" ? "reopen" : `close ${closing}`, { outcome: closing === "reopen" ? null : closing, ...(why !== undefined ? { why } : {}) });
  for (const [op, value] of plan) writeQuest(o, op, value);
  if (parts.length > 0) o.reply.line("quest_written", { n: o.n, op: o.op, what: `${name} [${id}]`, parts: textOf(parts) });
  return undefined;
}

/** What a call may carry that only a quest of the story's takes. */
const OPENED_ONLY = ["objective", "matters", "stakes", "rewards", "thread", "stages", "who", "where", "things", "unbind"] as const;

/** Opens a quest the story starts, with what the same call writes to it; a name a quest already has stands for it. */
function openQuest(o: OpContext, said: string, kind: string, mine: QuestDoc | undefined): Unread | undefined {
  if (!(QUEST_KINDS as readonly string[]).includes(kind)) return notOneOf(o, "open", kind, QUEST_KINDS);
  const lower = said.toLowerCase();
  const world = Object.values(o.draft.w.ctx.world.tracks).find((t) => t.id === said || t.label.toLowerCase() === lower);
  if (mine !== undefined || world !== undefined) {
    o.reply.line("quest_exists", { n: o.n, op: o.op, what: `${mine?.name ?? world?.label ?? said} [${mine?.id ?? world?.id ?? said}]` });
    return mine !== undefined ? writeParts(o, mine.id, mine.name, true) : worldQuest(o);
  }
  // Checked before the quest is made: what a call that names a thread the record lacks would leave is nothing.
  const thread = threadArg(o);
  if (isUnread(thread)) return thread;
  const id = newQuestId(o.draft.seed(o.n).slice(0, 10));
  writeQuest(o, "open", { quest: id, kind, name: said });
  o.reply.line("quest_opened", { n: o.n, op: o.op, what: `${said} [${id}]`, kind });
  return writeParts(o, id, said, true);
}

/** A call on a quest the world defines: today's stage move, with its reason and outcome kept as the stage's call, and what the player is shown or how it closed. */
function worldQuest(o: OpContext): Unread | undefined {
  const track = find(o, "quest", "track");
  if (isUnread(track)) return track;
  const w = o.draft.w;
  const def = own(w.ctx.world.tracks, track.id);
  if (!def) return { line: "not_applicable", fields: { n: o.n, op: o.op, code: "missing_track" } };
  const current = own(w.state.tracks, track.id)?.stage ?? def.start;
  const said = textArg(o.args, "stage");
  const outcome = textArg(o.args, "outcome");
  if (outcome !== undefined && !(OUTCOMES as readonly string[]).includes(outcome)) return notOneOf(o, "outcome", outcome, OUTCOMES);
  const shown = shownArg(o);
  if (isUnread(shown)) return shown;
  const closing = textArg(o.args, "close");
  if (said === undefined && shown === undefined && closing === undefined) return { line: "needs_any", fields: { n: o.n, op: o.op, fields: ["stage", "show", "close"] } };
  const what = `${def.label} [${track.id}]`;
  const apart = OPENED_ONLY.filter((f) => o.args[f] !== undefined && o.args[f] !== null);
  if (apart.length > 0) o.reply.report("quest_world_part", { n: o.n, op: o.op, what, fields: textOf(apart) });
  let stage: string | undefined;
  if (said !== undefined) {
    const lower = said.toLowerCase();
    stage = Object.keys(def.stages).find((id) => id === said) ?? Object.entries(def.stages).find(([id, s]) => id.toLowerCase() === lower || s.label.toLowerCase() === lower)?.[0];
    if (stage === undefined) return notOneOf(o, "stage", said, Object.entries(def.stages).map(([id, s]) => `${s.label} [${id}]`));
  }
  const why = textArg(o.args, "why");
  const from = w.events.length;
  const events: LedgerEvent[] = [];
  if (stage !== undefined) {
    if (stage === current) o.reply.line("already_so", { n: o.n, op: o.op, what });
    else {
      // The reason and how it went are kept with the move, and as the stage's call in the quests' record; the engine's move holds only where the quest stands now.
      events.push({ type: "stage", track: track.id, to: stage, from: current, ...(why !== undefined ? { why } : {}), ...(outcome !== undefined ? { outcome } : {}) } as LedgerEvent);
      const paths = own(def.stages, current)?.next.map((n) => n.to) ?? [];
      if (!paths.includes(stage)) o.reply.report("off_path", { n: o.n, op: o.op, quest: what, from: own(def.stages, current)?.label ?? current, to: own(def.stages, stage)?.label ?? stage });
    }
  }
  if (o.args.reveal === true) events.push({ type: ENGINE_EVENTS.revealed, data: { track: track.id, stage: stage ?? current } });
  const bad = o.draft.applyAll(events);
  if (bad) return { line: "not_applicable", fields: { n: o.n, op: o.op, code: bad.code } };
  o.draft.record(o.n, o.op, "engine", o.prov, from);
  if (stage !== undefined && outcome !== undefined) writeQuest(o, "call", { quest: track.id, stage, state: outcome, ...(why !== undefined ? { why } : {}) });
  if (shown !== undefined) writeQuest(o, "show", { quest: track.id, shown });
  if (closing !== undefined) writeQuest(o, "close", { quest: track.id, outcome: closing === "reopen" ? null : closing, ...(why !== undefined ? { why } : {}) });
  return undefined;
}

const quest: OpDef = {
  name: "quest",
  lane: "engine",
  needs: ["quest"],
  takes: ["quest", "open", "stage", "outcome", "why", "reveal", "show", "close", "objective", "matters", "stakes", "rewards", "thread", "stages", "who", "where", "things", "unbind"],
  example: { op: "quest", quest: "errand", stage: "done", outcome: "met", why: "The letter reached the warden's hand.", reveal: true, source: { from: "prose", message: "m-0020" } },
  run(o) {
    const said = textArg(o.args, "quest") ?? "";
    const kind = textArg(o.args, "open");
    const mine = findQuest(questsOf(o), said);
    if (kind !== undefined) return openQuest(o, said, kind, mine);
    if (mine !== undefined) return writeParts(o, mine.id, mine.name, true);
    return worldQuest(o);
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
    if (axis !== undefined && !axes.some((a) => a.id === axis)) return outsideList(o, "axis", axis, axes.map((a) => a.id));
    const from = w.events.length;
    const why = textArg(o.args, "why");
    // As given: on the axis named (else every axis), at any realism level and toward oneself, never spread and never clamped; past its range the event reports it.
    const out = applyEffects(o.reading.registry, w, [{ type: "relationships.adjust", args: { from: who.id, to: to.id, delta: change, asGiven: true, ...(axis !== undefined ? { axis } : {}), ...(why !== undefined ? { why } : {}) } }], { bindings: {}, rng: createRng(o.draft.seed(o.n)), literal: true });
    const failed = out.rejected[0];
    if (failed) return refusedAs(o, failed.rejection, "who", "entity");
    o.draft.record(o.n, o.op, "story", o.prov, from);
    return undefined;
  },
};

/** An entry written as a tree reference, the way the tree names a place, someone or something. */
const REF = /^(?:place|entity):/;

// The Author's own note of what it expects to matter: it changes nothing in the world, so it takes no provenance.
const horizon: OpDef = {
  name: "horizon",
  lane: "story",
  needs: ["list"],
  takes: ["list"],
  provenance: false,
  example: { op: "horizon", list: ["common_room", { at: "market_square", depth: 1 }, "odile"] },
  run(o) {
    const given = o.args.list;
    if (!Array.isArray(given)) return notAs(o, "list", given ?? null, "list");
    const entries: { at: string; depth: number | "full" }[] = [];
    for (const item of given) {
      // An entry is a name or words, or { at, depth }: how deep the world state shows it (a whole number from 0, or "full"; none given is "full").
      const said = isRecord(item) ? item.at : item;
      const depth = isRecord(item) && typeof item.depth === "number" && Number.isInteger(item.depth) && item.depth >= 0 ? item.depth : "full";
      const r = find(o, "list", "point", false, said);
      // Words that name no place, person or thing are kept as they were given: a note of what the Author expects to matter.
      // An entry written as a reference (`place:…`, `entity:…`) is a name, not words: one that names nothing is not there, with its near names.
      if (isUnread(r) && r.line === "unknown" && typeof said === "string" && !REF.test(said.trim())) {
        entries.push({ at: said.trim(), depth });
        o.reply.line("horizon_words", { n: o.n, op: o.op, words: said.trim(), near: r.fields.near });
        continue;
      }
      if (isUnread(r)) return r;
      entries.push({ at: r.ref, depth });
    }
    o.draft.recordStoreOp(o.n, o.op, "story", o.prov, { op: HORIZON.op, value: { list: entries } });
    o.draft.storeState.horizon = entries.map((e) => e.at);
    return undefined;
  },
};

/** The operations on values. */
export const VALUE_OPS: readonly OpDef[] = [pay, set, fact, quest, relate, horizon];
