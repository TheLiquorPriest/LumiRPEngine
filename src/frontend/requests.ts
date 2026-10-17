// Every user interaction becomes exactly one of these protocol requests (ARCHITECTURE §4).
// Kept pure so the mapping from a tap to its message is tested directly.

import type { JsonObject, JsonValue } from "../shared/json";
import type { ChatId, DomainId, InterruptClass, InterruptPolicy, Level } from "../shared/ids";
import type { KeepLine, ResolveScope, TimeControl, TimelapseTarget, TimeScope } from "../shared/ledger";
import type { Chip, FixTarget, PaletteEntry, PaletteOption, TimelapseView } from "../shared/state-view";
import type { RequestBody } from "./registry";

/** The request body of one protocol type. */
export type Req<K extends RequestBody["type"]> = Extract<RequestBody, { type: K }>;

/**
 * What a chip button does. `regenerate` (the Retry chip on an empty reply, D32) runs the host's
 * own Regenerate: only the frontend can start it. A swipe option (`renarrate`, `rerun`) and a
 * contradiction's Re-narrate record the one-shot choice with `lre.chip`, then run the same
 * Regenerate. Every other choice, the pause chip's Keep and Discard included, is
 * `lre.chip {chip, choice: action.id}`.
 */
export interface ChipIntent {
  request: Req<"lre.chip"> | null;
  regenerate: boolean;
}

export function chipIntent(chip: Chip, choice: string, chatId: ChatId, payload?: JsonObject): ChipIntent {
  if (choice === "regenerate") return { request: null, regenerate: true };
  const request: Req<"lre.chip"> = payload ? { type: "lre.chip", chatId, chip: chip.id, choice, payload } : { type: "lre.chip", chatId, chip: chip.id, choice };
  return { request, regenerate: (chip.kind === "swipe_option" && (choice === "renarrate" || choice === "rerun")) || (chip.kind === "contradiction" && choice === "renarrate") };
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

/** A timelapse: only the overrides that differ from the current policy travel in the intent. */
export function timelapseRequest(view: TimelapseView, target: TimelapseTarget, overrides: Partial<Record<InterruptClass, InterruptPolicy>>, chatId: ChatId, source: "palette" | "command" = "palette"): Req<"lre.action"> {
  const changed: JsonObject = {};
  for (const [cls, policy] of Object.entries(overrides)) {
    if (policy !== undefined && view.interrupts[cls as InterruptClass] !== policy) changed[cls] = policy;
  }
  return { type: "lre.action", chatId, action: view.action, params: { target: { ...target }, overrides: changed }, source };
}

/** A map tap on a travel option (move or drive). */
export function travelRequest(action: string, params: JsonObject, chatId: ChatId): Req<"lre.action"> {
  return { type: "lre.action", chatId, action, params: { ...params }, source: "map" };
}

export function fixRequest(target: FixTarget, value: JsonValue, chatId: ChatId): Req<"lre.fix"> {
  return { type: "lre.fix", chatId, entity: target.entity, field: target.field, value };
}

/** A `time` marker on the running chat (Play → Calendar, HUD ⏸, palette Pause/Resume). */
export function timeMarker(chatId: ChatId, control: TimeControl, scope: TimeScope, to: JsonValue, preview = false): Req<"lre.marker"> {
  return preview ? { type: "lre.marker", chatId, kind: "time", control, scope, to, preview: true } : { type: "lre.marker", chatId, kind: "time", control, scope, to };
}

/** A `resolve` marker: promote or demote a domain on the running chat, optionally as a preview. */
export function resolveMarker(chatId: ChatId, domain: DomainId, scope: ResolveScope, to: Level, preview = false): Req<"lre.marker"> {
  return preview ? { type: "lre.marker", chatId, kind: "resolve", domain, scope, to, preview: true } : { type: "lre.marker", chatId, kind: "resolve", domain, scope, to };
}
