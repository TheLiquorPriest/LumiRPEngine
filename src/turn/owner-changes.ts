// His own changes placed before a turn (plan §6.3 l.632, §10.10, R-22), as the data of the briefing's
// `player-edit` items: each edit of his (a tap, a ✎ or World-page correction, a drag on the map, an Undo)
// once, with what he pressed, the changes it made that took effect there and those that did not. The
// store places each just before the first turn to begin after it, so the turn it is placed before tells
// it, and a swipe of that turn does again; a continue begins no new reading and tells none. An edit he
// chose not to tell (`cite.tell` false) is left out, applied and shown all the same; one he made no choice
// on follows the chat's out-of-play settings for its group (`taps.tell.*`): a payment to someone else from
// the amount they set, a fix of things as hand-overs or things, every other correction told. An Undo is
// told as the undo of what it undid, when that was told. The words are the notices part's.

import { isRecord, type JsonObject, type JsonValue } from "../shared/json";
import { fixGroupOf, type OffstageSettings, toldByDefault } from "../shared/offstage";
import { parseItemFix, type ItemFix } from "../shared/things";
import type { WorldDoc } from "../shared/world";
import type { ChangeRow, UserStore } from "../store";

/** An edit of his placed before a turn, as its `player_edit` line's fields. */
export interface OwnerEditTold {
  edit: string;
  fields: JsonObject;
}

/** A value as a line shows it. */
const textOf = (value: JsonValue): string => (typeof value === "string" ? value : JSON.stringify(value));

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

/** What he pressed, in words: a tap by its action's label and values, any other edit by what it asked. */
function whatOf(request: JsonValue | undefined, world: WorldDoc | undefined): string {
  if (!isRecord(request)) return "";
  if (typeof request.action === "string") {
    const label = world?.actions[request.action]?.label ?? request.action;
    return isRecord(request.params) && Object.keys(request.params).length > 0 ? `${label} ${JSON.stringify(request.params)}` : label;
  }
  const { type: _type, kind: _kind, ...asked } = request;
  return JSON.stringify(asked);
}

/**
 * The edits of his placed before `turn`, oldest first, that the turn is told: each with its line's fields. `tell` is the chat's
 * out-of-play settings, `world` the world his edits were made on (for an action's label and its money's decimals).
 */
export function ownerEditsBefore(store: UserStore, chat: string, turn: string, tell: OffstageSettings, world: WorldDoc | undefined): OwnerEditTold[] {
  const placed = store.changesBefore(turn).filter((p) => p.change.chat !== null && p.change.job === null);
  if (placed.length === 0) return [];
  const own = new Map(store.ownerChanges(chat).map((c) => [c.id, c]));
  const editOf = (c: ChangeRow): string | null => (isRecord(c.cite) && typeof c.cite.tap === "string" ? c.cite.tap : null);
  const decimals = world?.currency.decimals ?? 0;
  const edits = new Map<string, { undo: boolean; of: string | null; request: JsonValue | undefined; choice: boolean | null; applied: string[]; notApplied: string[] }>();
  for (const { change, applied } of placed) {
    const cite = isRecord(change.cite) ? change.cite : {};
    const undid = typeof cite.undoes === "number" ? own.get(cite.undoes) : undefined;
    const of = undid === undefined ? null : editOf(undid);
    const key = editOf(change) ?? (of !== null ? `undo:${of}` : `change:${change.id}`);
    const entry = edits.get(key) ?? { undo: of !== null, of, request: undefined, choice: null, applied: [], notApplied: [] };
    if (cite.request !== undefined) entry.request = cite.request;
    if (typeof cite.tell === "boolean") entry.choice = cite.tell;
    (applied ? entry.applied : entry.notApplied).push(`${change.op} ${textOf(change.value)}`);
    edits.set(key, entry);
  }
  // An Undo is told when what it undid was: its edit's choice, else that edit's group.
  const toldOf = (edit: string): boolean => {
    const changes = [...own.values()].filter((c) => editOf(c) === edit);
    const cite = changes.map((c) => (isRecord(c.cite) ? c.cite : {})).find((c) => c.request !== undefined);
    return typeof cite?.tell === "boolean" ? cite.tell : toldByGroup(cite?.request, tell, decimals);
  };
  const out: OwnerEditTold[] = [];
  for (const [edit, e] of edits) {
    const told = e.undo && e.of !== null ? toldOf(e.of) : (e.choice ?? toldByGroup(e.request, tell, decimals));
    if (!told) continue;
    const undone = e.undo && e.of !== null ? [...own.values()].find((c) => editOf(c) === e.of && isRecord(c.cite) && c.cite.request !== undefined) : undefined;
    const request = e.undo ? (isRecord(undone?.cite) ? undone.cite.request : undefined) : e.request;
    out.push({
      edit,
      fields: {
        what: whatOf(request, world),
        ...(request !== undefined ? { request: JSON.stringify(request) } : {}),
        changes: { ".": e.applied },
        not_applied: { ".": e.notApplied },
        ...(e.undo ? { undo: true, of: e.of ?? "" } : {}),
      },
    });
  }
  return out;
}
