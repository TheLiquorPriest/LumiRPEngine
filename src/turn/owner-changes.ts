// His own changes placed before a turn (plan §6.3 l.632, §10.10, R-22), as the data of the briefing's
// `player-edit` items: each edit of his (a tap, a ✎ or World-page correction, a drag on the map, an Undo)
// once, with what he pressed, the changes it made that took effect there and those that did not. The
// store places each just before the first turn to begin after it, so the turn it is placed before tells
// it, and a swipe of that turn does again; a continue begins no new reading and tells none. An edit he
// chose not to tell (`cite.tell` false) is left out, applied and shown all the same; one he made no choice
// on follows the chat's out-of-play settings for its group (`taps.tell.*`): a payment to someone else from
// the amount they set, a fix of things as hand-overs or things, every other correction told. An Undo is
// told as the undo of what it undid: an edit of his, when that edit was told; a change a turn made, always.
// The words are the notices part's; each change is said as the turn's card says it: in the GM view's words
// (`changeLine`), else by its kind in the play answers' words, and never as it is written.

import { own } from "../engine/pack-kit";
import type { Registry } from "../engine/registry-impl";
import type { WorldState } from "../engine/state";
import { changeLine } from "../play/due";
import { playAnswers } from "../play/service";
import { isRecord, type JsonObject, type JsonValue } from "../shared/json";
import { fixGroupOf, type OffstageSettings, toldByDefault } from "../shared/offstage";
import { parseItemFix, type ItemFix } from "../shared/things";
import type { WorldDoc } from "../shared/world";
import type { ChangeRow, Part, UserStore } from "../store";
import { RPE_GUIDANCE } from "../tree";

/** An edit of his placed before a turn, as its `player_edit` line's fields. */
export interface OwnerEditTold {
  edit: string;
  fields: JsonObject;
}

/** Whether an edit he made no choice on is told, by its group's out-of-play setting; every correction that is not a tap is. */
function toldByGroup(request: JsonValue | undefined, tell: OffstageSettings, decimals: number): boolean {
  if (!isRecord(request)) return true;
  if (typeof request.action === "string") return toldByDefault(request.action, isRecord(request.params) ? request.params : {}, tell, decimals);
  const fix = isRecord(request.fix) ? request.fix : request;
  if (Array.isArray(fix.things)) {
    const things = fix.things.map(parseItemFix).filter((t): t is ItemFix => t !== null);
    return tell.tell[fixGroupOf(things)];
  }
  return true;
}

/**
 * The kind of edit `request` asked for, by where he made it, as the line's `is.<kind>`: a tap of one of the world's actions (`action`),
 * a ✎ correction (`fix`), an edit on a play view (`edit`), this chat's own settings on the World page (`own`), the HUD's time controls
 * (`time`), the map (`map`), the chat moved to another revision of its world (`migrate`); `other` where nothing says.
 */
function kindOf(request: JsonValue | undefined): string {
  if (!isRecord(request)) return "other";
  if (typeof request.action === "string") return "action";
  if (request.fix !== undefined) return "fix";
  if (request.kind === "own" || request.kind === "time" || request.kind === "map" || request.kind === "migrate") return request.kind;
  return Array.isArray(request.ops) ? "edit" : "other";
}

/**
 * What he pressed, by its name: a tap by the words its press was shown in, kept with it (`pressed`), else by its action's label; a
 * correction of things by the label it was made under. Null where it has none.
 */
function pressedOf(request: JsonValue | undefined, registry: Registry, world: WorldDoc | undefined): string | null {
  if (!isRecord(request)) return null;
  if (typeof request.pressed === "string" && request.pressed !== "") return request.pressed;
  if (typeof request.action === "string") return (world === undefined ? undefined : own(world.actions, request.action)?.label) ?? registry.actions.get(request.action)?.label ?? request.action;
  return isRecord(request.fix) && typeof request.fix.label === "string" && request.fix.label !== "" ? request.fix.label : null;
}

/** Words as a sentence of a line: its first letter a capital, and its end a stop. */
const sentence = (words: string): string => {
  const said = words.charAt(0).toUpperCase() + words.slice(1);
  return /[.!?…]$/.test(said) ? said : `${said}.`;
};

/** Changes in words (see the head of this file), each once; with how many of them have no words of either kind. */
function saidOf(changes: readonly ChangeRow[], answers: Part, registry: Registry, world: WorldDoc | undefined, state: WorldState): { words: string[]; unworded: number } {
  const words = new Set<string>();
  let unworded = 0;
  for (const c of changes) {
    const said = (world === undefined ? undefined : changeLine(registry, world, state, c.op, c.value)) ?? own(answers.keys, c.op);
    if (said === undefined) unworded += 1;
    else words.add(sentence(said));
  }
  return { words: [...words], unworded };
}

/**
 * The edits of his placed before `turn`, oldest first, that the turn is told: each with its line's fields. `tell` is the chat's
 * out-of-play settings, `world` the world his edits were made on (for an action's label, its money's decimals and the names its changes
 * are said with, as they stand where the turn begins).
 */
export async function ownerEditsBefore(store: UserStore, chat: string, turn: string, tell: OffstageSettings, world: WorldDoc | undefined, registry: Registry): Promise<OwnerEditTold[]> {
  const placed = store.changesBefore(turn).filter((p) => p.change.chat !== null && p.change.job === null);
  if (placed.length === 0) return [];
  const mine = store.ownerChanges(chat);
  const editOf = (c: ChangeRow): string | null => (isRecord(c.cite) && typeof c.cite.tap === "string" ? c.cite.tap : null);
  const decimals = world?.currency.decimals ?? 0;
  // Each edit by its key: his edit's own id; an Undo by what it undid, his edit's id or the change of a turn it took back.
  const edits = new Map<string, { undid: ChangeRow | null; of: string | null; request: JsonValue | undefined; choice: boolean | null; applied: ChangeRow[]; notApplied: ChangeRow[] }>();
  for (const { change, applied } of placed) {
    const cite = isRecord(change.cite) ? change.cite : {};
    const undid = typeof cite.undoes === "number" ? store.change(cite.undoes) : null;
    const of = undid === null ? null : editOf(undid);
    const key = editOf(change) ?? (of !== null ? `undo:${of}` : undid !== null ? `undoes:${undid.id}` : `change:${change.id}`);
    const entry = edits.get(key) ?? { undid, of, request: undefined, choice: null, applied: [], notApplied: [] };
    if (cite.request !== undefined) entry.request = cite.request;
    if (typeof cite.tell === "boolean") entry.choice = cite.tell;
    (applied ? entry.applied : entry.notApplied).push(change);
    edits.set(key, entry);
  }
  // An Undo of his edit is told when the edit was: its choice, else its group.
  const changesOf = (edit: string): ChangeRow[] => mine.filter((c) => editOf(c) === edit);
  const requestOf = (edit: string): JsonValue | undefined => changesOf(edit).map((c) => (isRecord(c.cite) ? c.cite : {})).find((c) => c.request !== undefined)?.request;
  const toldOf = (edit: string): boolean => {
    const cite = changesOf(edit).map((c) => (isRecord(c.cite) ? c.cite : {})).find((c) => c.request !== undefined);
    return typeof cite?.tell === "boolean" ? cite.tell : toldByGroup(cite?.request, tell, decimals);
  };
  const told = [...edits].filter(([, e]) => (e.of !== null ? toldOf(e.of) : e.undid !== null || (e.choice ?? toldByGroup(e.request, tell, decimals))));
  if (told.length === 0) return [];
  const answers = await playAnswers(RPE_GUIDANCE);
  const state = store.startOf(turn).state.world;
  const said = (changes: readonly ChangeRow[]) => saidOf(changes, answers, registry, world, state);
  return told.map(([edit, e]) => {
    const undo = e.undid !== null;
    // What was pressed: his edit's own request, or for an Undo of an edit of his, that edit's.
    const request = e.of !== null ? requestOf(e.of) : undo ? undefined : e.request;
    const what = pressedOf(request, registry, world);
    const recorded = said(e.applied);
    const refused = said(e.notApplied);
    // What an Undo took back: what that edit of his had recorded, or the change of a turn.
    const undone = e.of !== null ? said(changesOf(e.of).filter((c) => c.applied)).words : e.undid !== null ? said([e.undid]).words : [];
    const unworded = recorded.unworded + refused.unworded;
    return {
      edit,
      fields: {
        is: { [kindOf(request)]: true },
        ...(what !== null ? { what } : {}),
        changes: recorded.words,
        not_applied: refused.words,
        ...(unworded > 0 ? { unworded } : {}),
        ...(undo ? { undo: true, of: undone, ...(e.of === null ? { by_turn: true } : {}) } : {}),
      },
    };
  });
}
