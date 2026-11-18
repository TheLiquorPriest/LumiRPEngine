// What the store refuses (plan §6.1): input that cannot be read. A change whose operation does not
// apply is never refused here; it is recorded with a report.

import { isRecord } from "../shared/json";
import { validMarkerBody } from "../engine/events";
import { FACT_ABOUT } from "./facts";
import { LANES, PRECISIONS, SOURCES, STANDINGS, STORE_OPS, StoreInputError, type ChangeInput } from "./types";
import type { Areas } from "./areas";

const oneOf = (list: readonly string[], v: unknown): boolean => v === undefined || v === null || (typeof v === "string" && list.includes(v));
const text = (v: unknown): boolean => v === undefined || v === null || typeof v === "string";

/** Throws `StoreInputError` when `c` cannot be read as a change: an area's operation (`areas`) by its own check. */
export function checkChange(c: ChangeInput, index: number, areas?: Areas): void {
  const at = `change ${index}`;
  if (!isRecord(c)) throw new StoreInputError(`${at} is not an object`);
  if (!(LANES as readonly string[]).includes(c.lane)) throw new StoreInputError(`${at}: lane must be one of ${LANES.join(", ")}`);
  if (typeof c.op !== "string" || c.op === "") throw new StoreInputError(`${at}: op must name an operation`);
  if (!oneOf(STANDINGS, c.standing)) throw new StoreInputError(`${at}: standing must be one of ${STANDINGS.join(", ")}`);
  if (!oneOf(PRECISIONS, c.precision)) throw new StoreInputError(`${at}: precision must be one of ${PRECISIONS.join(", ")}`);
  if (!oneOf(SOURCES, c.source)) throw new StoreInputError(`${at}: source must be one of ${SOURCES.join(", ")}, or none`);
  if (!text(c.by) || !text(c.handle) || !text(c.job)) throw new StoreInputError(`${at}: by, handle and job are text`);
  if (JSON.stringify(c.value) === undefined) throw new StoreInputError(`${at}: value is not JSON`);
  if (c.cite !== undefined && c.cite !== null && JSON.stringify(c.cite) === undefined) throw new StoreInputError(`${at}: cite is not JSON`);
  if (c.reports !== undefined && (!Array.isArray(c.reports) || !c.reports.every((r) => isRecord(r) && typeof r.code === "string" && r.code !== "" && (r.values === undefined || isRecord(r.values))))) {
    throw new StoreInputError(`${at}: reports are [{ code, values? }]`);
  }
  const v = c.value;
  const found = areas?.of(c.op);
  if (found) {
    const why = found.def.check(v);
    if (why !== null) throw new StoreInputError(`${at}: ${why}`);
    return;
  }
  if (!c.op.startsWith("store.")) {
    if (!isRecord(v) || v.type !== c.op) throw new StoreInputError(`${at}: an event's value is the event, with type ${c.op}`);
    return;
  }
  switch (c.op) {
    case STORE_OPS.note:
      if (!isRecord(v) || typeof v.at !== "string" || v.at === "" || typeof v.text !== "string") throw new StoreInputError(`${at}: a note is { at, text }`);
      return;
    case STORE_OPS.marker:
      if (!validMarkerBody(v)) throw new StoreInputError(`${at}: not a marker`);
      return;
    case STORE_OPS.fact:
      if (!isRecord(v) || typeof v.id !== "string" || v.id === "" || typeof v.about !== "string" || !FACT_ABOUT.test(v.about) || typeof v.key !== "string" || v.key === "" || typeof v.value !== "string" || !text(v.replaces)) {
        throw new StoreInputError(`${at}: a fact is { id, about: a tree ref (world, place:<id>, entity:<id>), key, value, replaces? }`);
      }
      return;
    case STORE_OPS.value:
      if (!isRecord(v) || v.at !== "world" || typeof v.key !== "string" || v.key === "" || !("value" in v)) throw new StoreInputError(`${at}: a world value is { at: "world", key, value }`);
      return;
    default:
      throw new StoreInputError(`${at}: the store has no operation ${c.op}`);
  }
}
