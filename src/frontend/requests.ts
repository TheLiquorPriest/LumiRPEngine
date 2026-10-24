// Every user interaction becomes exactly one of these protocol requests (ARCHITECTURE §4).
// Kept pure so the mapping from a tap to its message is tested directly.

import type { ClaimsPolicy } from "../shared/claims";
import type { InferredChecks } from "../shared/inferred";
import type { JsonObject, JsonValue } from "../shared/json";
import type { ChatId, DomainId, EntityId, InterruptClass, InterruptPolicy, Level, TierId, WorldId } from "../shared/ids";
import type { EntityUpgradePick, KeepLine, ResolveScope, TimeControl, TimelapseTarget, TimeScope, UpgradePicks } from "../shared/ledger";
import { parseMoneyInput } from "../shared/money";
import type { EditOp, UpgradePreview } from "../shared/protocol";
import type { Chip, FieldFixTarget, GmEntity, GmView, HudView, PaletteEntry, PaletteOption, StateView, TimelapseView } from "../shared/state-view";
import { chipRegenerates } from "../shared/state-view";
import type { AdjudicationDef, FacetId, FacetValueId, WorldCurrency } from "../shared/world";
import { PARTY_RELATION } from "../shared/party";
import type { RequestBody } from "./registry";

/** The request body of one protocol type. */
export type Req<K extends RequestBody["type"]> = Extract<RequestBody, { type: K }>;

/**
 * What a chip button does. `regenerate` (the Retry chip on an empty reply, D32) runs the host's
 * own Regenerate: only the frontend can start it. A swipe option (`renarrate`, `rerun`), a
 * contradiction's Re-narrate, the Retry of an unread action (`read_failed`, a Re-run) and the
 * answer to a claim's question (Add, Not an action: the turn waiting on it resumes) record the
 * one-shot choice with `lre.chip`, then run the same Regenerate. Every other choice, the pause
 * chip's Keep and Discard included, is `lre.chip {chip, choice: action.id}`, with the value an
 * action's input asked for as its payload.
 */
export interface ChipIntent {
  request: Req<"lre.chip"> | null;
  regenerate: boolean;
}

/**
 * An Upgrade with the owner's picks (DESIGN §4.3 `migrate`): only the changes whose choice differs
 * from the default travel, written at every target (both sides of a relation pair); the fold works
 * the defaults out itself. Even with no picks the Upgrade brings the definition changes in.
 */
export function upgradeRequest(chatId: ChatId, preview: UpgradePreview, choices: Readonly<Record<string, EntityUpgradePick>>): Req<"lre.world"> {
  const merge: UpgradePicks = {};
  for (const row of preview.entities) {
    for (const change of row.changes) {
      const choice = choices[change.id] ?? change.pick;
      if (choice === change.pick) continue;
      for (const t of change.targets) {
        const picks = (merge[t.entity] ??= {});
        if (t.part === "entity") picks.entity = choice;
        else if (choice === "remove") continue;
        else if (t.part === "field") (picks.fields ??= {})[t.field] = choice;
        else if (t.part === "relation") ((picks.relations ??= {})[t.rel] ??= {})[t.to] = choice;
        else picks[t.part] = choice;
      }
    }
  }
  return { type: "lre.world", op: "upgrade", chatId, to: preview.to, merge };
}

export function chipIntent(chip: Chip, choice: string, chatId: ChatId, payload?: JsonObject): ChipIntent {
  if (choice === "regenerate") return { request: null, regenerate: true };
  const request: Req<"lre.chip"> = payload ? { type: "lre.chip", chatId, chip: chip.id, choice, payload } : { type: "lre.chip", chatId, chip: chip.id, choice };
  return { request, regenerate: chipRegenerates(chip.kind, choice) };
}

/** Convert one Keep-report entry; markers have no event ref and cannot be converted. */
export function convertRequest(line: KeepLine, chatId: ChatId): Req<"lre.keep"> | null {
  if ("marker" in line.ref) return null;
  return { type: "lre.keep", chatId, choice: "convert", messageId: line.messageId, parentPath: line.parentPath, refs: [line.ref] };
}

/** A chain of palette picks (an option, then its second-step choices); params merge in order, then a free amount (cents) and the entry's required number. */
export function paletteRequest(entry: PaletteEntry, picks: readonly PaletteOption[], chatId: ChatId, amountCents?: number, count?: number): Req<"lre.action"> {
  const params: JsonObject = Object.assign({}, ...picks.map((pick) => pick.params));
  if (entry.amount && amountCents !== undefined) params[entry.amount.param] = Math.round(amountCents);
  if (entry.number && count !== undefined) params[entry.number.param] = count;
  return { type: "lre.action", chatId, action: entry.action, params, source: "palette" };
}

/**
 * A timelapse: only the overrides that differ from the current policy travel in the intent.
 * `followRoutine` travels only when given (the palette always gives it): true lets the POV live its
 * routine through the skip, false holds it where the story has it; absent, the world's default decides.
 */
export function timelapseRequest(view: TimelapseView, target: TimelapseTarget, overrides: Partial<Record<InterruptClass, InterruptPolicy>>, chatId: ChatId, followRoutine?: boolean, source: "palette" | "command" = "palette"): Req<"lre.action"> {
  const changed: JsonObject = {};
  for (const [cls, policy] of Object.entries(overrides)) {
    if (policy !== undefined && view.interrupts[cls as InterruptClass] !== policy) changed[cls] = policy;
  }
  return { type: "lre.action", chatId, action: view.action, params: { target: { ...target }, overrides: changed, ...(followRoutine === undefined ? {} : { followRoutine }) }, source };
}

/** A map tap on a travel option (move or drive). */
export function travelRequest(action: string, params: JsonObject, chatId: ChatId): Req<"lre.action"> {
  return { type: "lre.action", chatId, action, params: { ...params }, source: "map" };
}

/** The staged action sent again (DESIGN §11): as tapped, which clears it, or with `now`, which plays it at once. */
export function stagedRequest(chatId: ChatId, staged: NonNullable<StateView["staged"]>, now: boolean): Req<"lre.action"> {
  return { type: "lre.action", chatId, action: staged.action, params: { ...staged.params }, source: staged.source, ...(now ? { now: true } : {}) };
}

export function fixRequest(target: FieldFixTarget, value: JsonValue, chatId: ChatId): Req<"lre.fix"> {
  return { type: "lre.fix", chatId, entity: target.entity, field: target.field, value };
}

/**
 * The ✎ "Where are they?" on someone in People: the player character's own place ✎, aimed at them.
 * It offers the places that ✎ offers (those the POV may know, never a hidden one) and starts at the
 * POV's place when they're here, else at no place, since where they are when away isn't shown.
 */
export function whereFixTarget(hud: Pick<HudView, "fixes"> | null, entity: EntityId, here: boolean): FieldFixTarget | null {
  const pov = hud?.fixes.place;
  return pov ? { ...pov, entity, value: here ? pov.value : null } : null;
}

/** The clock's ✎ (DESIGN §12): the clock set to `time`, a date and time of day (`YYYY-MM-DD HH:MM`) in the world's calendar, local to where the POV is. */
export function timeFixRequest(time: string, chatId: ChatId): Req<"lre.fix"> {
  return { type: "lre.fix", chatId, time };
}

/** A GM edit: the operations in order, applied all or none as one fix with its own Undo (DESIGN §7). */
export function editRequest(chatId: ChatId, ops: EditOp[]): Req<"lre.edit"> {
  return { type: "lre.edit", chatId, ops };
}

/** The GM's simulation edit of an entity: only what the form changed (tier, agent flag, each domain's override; null hands a domain back to the tier). Null when nothing changed. */
export function entityStateOp(entity: GmEntity, tier: TierId, agent: boolean, levels: Partial<Record<DomainId, number | null>>): EditOp | null {
  const changed: Partial<Record<DomainId, number | null>> = {};
  for (const l of entity.levels) {
    const to = levels[l.domain];
    if (to !== undefined && to !== l.override) changed[l.domain] = to;
  }
  const levelsChanged = Object.keys(changed).length > 0;
  if (tier === entity.tier && agent === entity.agent && !levelsChanged) return null;
  return { op: "entity", entity: entity.id, ...(tier !== entity.tier ? { tier } : {}), ...(agent !== entity.agent ? { agent } : {}), ...(levelsChanged ? { levels: changed } : {}) };
}

/** The GM's classification edit of an entity: its classes and tags, both whole. Null when they read as they are now. */
export function classifyOp(entity: GmEntity, classes: Readonly<Record<FacetId, FacetValueId[]>>, tags: readonly string[]): EditOp | null {
  const same = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((x) => b.includes(x));
  const facets = new Set([...Object.keys(classes), ...Object.keys(entity.class)]);
  const unchanged = [...facets].every((f) => same(classes[f] ?? [], entity.class[f] ?? [])) && same(tags, entity.tags);
  return unchanged ? null : { op: "classify", entity: entity.id, class: Object.fromEntries(Object.entries(classes).filter(([, v]) => v.length > 0)), tags: [...tags] };
}

/** The GM's life edit of an entity (DESIGN §8): its state when the form changed it, and who is told it. Null when there is nothing to send. */
export function lifeEditOp(entity: GmEntity, to: string, tell: readonly EntityId[]): EditOp | null {
  const changes = to !== entity.life.state;
  if (!changes && tell.length === 0) return null;
  return { op: "life", entity: entity.id, ...(changes ? { to } : {}), ...(tell.length > 0 ? { tell: [...tell] } : {}) };
}

/**
 * A relation's fields from the GM's inputs, one per field its type declares: a number within the
 * field's bounds, one of an enum's values, yes or no, else the text. An empty input leaves the
 * field out; fields the relation holds that its type doesn't declare are kept. Null when an input
 * doesn't fit its field.
 */
export function relationFields(defs: GmView["relationTypes"][number]["fields"], inputs: Readonly<Record<string, string>>, held: JsonObject = {}): JsonObject | null {
  const fields: JsonObject = Object.fromEntries(Object.entries(held).filter(([id]) => !defs.some((d) => d.id === id)));
  for (const def of defs) {
    const text = (inputs[def.id] ?? "").trim();
    if (text === "") continue;
    if (def.type === "number") {
      const n = Number(text);
      if (!Number.isFinite(n) || n < (def.min ?? -Infinity) || n > (def.max ?? Infinity)) return null;
      fields[def.id] = n;
    } else if (def.type === "bool") fields[def.id] = text === "true";
    else if (def.values && !def.values.includes(text)) return null;
    else fields[def.id] = text;
  }
  return fields;
}

/** Money into an account, or out of it with `take`, from the amount typed; null unless it reads as an amount above zero. */
export function adjustOp(account: EntityId, text: string, currency: WorldCurrency, take: boolean): EditOp | null {
  const cents = parseMoneyInput(text, currency);
  return cents !== null && cents > 0 ? { op: "adjust", account, cents: take ? -cents : cents } : null;
}

/** The GM's "Bring to <player character>'s place": a move to where the player character is; null for the player character itself or while it's nowhere. */
export function bringOp(entity: GmEntity, gm: Pick<GmView, "entities">): EditOp | null {
  const pov = gm.entities.find((e) => e.pov);
  return pov && pov.id !== entity.id && pov.place && pov.place !== entity.place ? { op: "move", entity: entity.id, to: pov.place } : null;
}

/** The player character's party (DESIGN §9.3): whether someone travels with it, and the GM's edit that changes that. */
export function partyOf(entity: GmEntity, gm: Pick<GmView, "entities">): { pov: GmEntity; travels: boolean; op: EditOp } | null {
  const pov = gm.entities.find((e) => e.pov);
  if (!pov || pov.id === entity.id) return null;
  const travels = entity.relations.some((r) => r.type === PARTY_RELATION && r.to === pov.id);
  return { pov, travels, op: travels ? { op: "unlink", rel: PARTY_RELATION, from: entity.id, to: pov.id } : { op: "link", rel: PARTY_RELATION, from: entity.id, to: pov.id } };
}

/** The places a picker offers for a search: each word of it in the name, in the list's order. */
export function placesMatching<P extends { name: string }>(places: readonly P[], search: string): P[] {
  const words = search.toLowerCase().split(/\s+/).filter((w) => w !== "");
  return places.filter((p) => words.every((w) => p.name.toLowerCase().includes(w)));
}

/** A `time` marker on the running chat (Play → Calendar, HUD ⏸, palette Pause/Resume). */
export function timeMarker(chatId: ChatId, control: TimeControl, scope: TimeScope, to: JsonValue, preview = false): Req<"lre.marker"> {
  return preview ? { type: "lre.marker", chatId, kind: "time", control, scope, to, preview: true } : { type: "lre.marker", chatId, kind: "time", control, scope, to };
}

/** A `resolve` marker: promote or demote a domain on the running chat, optionally as a preview. */
export function resolveMarker(chatId: ChatId, domain: DomainId, scope: ResolveScope, to: Level, preview = false): Req<"lre.marker"> {
  return preview ? { type: "lre.marker", chatId, kind: "resolve", domain, scope, to, preview: true } : { type: "lre.marker", chatId, kind: "resolve", domain, scope, to };
}

/** An `adjudicate` marker: how checks are decided in the running chat from the next turn (Settings → Checks → This chat). */
export function adjudicateMarker(chatId: ChatId, to: AdjudicationDef): Req<"lre.marker"> {
  return { type: "lre.marker", chatId, kind: "adjudicate", to };
}

/** A `claims` marker: what a typed action's thing the world doesn't have becomes in the running chat from the next turn (GM → This chat → Realism). */
export function claimsMarker(chatId: ChatId, to: ClaimsPolicy): Req<"lre.marker"> {
  return { type: "lre.marker", chatId, kind: "claims", to };
}

/** An `infer` marker: how typed attempts are read as checks in the running chat from the next turn (GM → This chat → Checks). */
export function inferMarker(chatId: ChatId, to: InferredChecks): Req<"lre.marker"> {
  return { type: "lre.marker", chatId, kind: "infer", to };
}

/**
 * The Sheet Designer's live preview (`lre.world sheet`): the ruleset as edited, saved or not, read
 * on the draft's POV unless another entity is named. Absent parts go as absent, so a ruleset
 * without a sheet previews as none.
 */
export function sheetPreviewRequest(worldId: WorldId, ruleset: JsonObject, entity?: EntityId): Req<"lre.world"> {
  return entity === undefined ? { type: "lre.world", op: "sheet", worldId, ruleset } : { type: "lre.world", op: "sheet", worldId, ruleset, entity };
}
