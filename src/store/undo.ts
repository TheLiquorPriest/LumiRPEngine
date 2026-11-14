// Undo of one change (plan §6.8: one review card per turn, with an undo for each change; §6.3: the
// player's own edits are changes with source `player`, placed after the newest reply). An undo is a
// new change that reverses an earlier one; nothing recorded is taken away. A change of a unit (events
// that share a group) is undone with its whole unit, as one unit of its own.
//
// What would be left is said as codes with values. A part a later change has written since is not
// the change's to take back: then nothing of the unit is undone. A part the store keeps no reverse for
// (something made, a journal line whose posting is not in its unit) stays, and the rest of the unit is
// undone. A journal line is taken back as the economy takes one back (`reverseLine`, `reversedAs`).

import type { JsonObject, JsonValue } from "../shared/json";
import { isRecord } from "../shared/json";
import { jsonEqual } from "../shared/json-patch";
import { FINANCE_EVENTS } from "../shared/finance";
import type { LedgerEvent, PostEvent } from "../shared/ledger";
import { ENGINE_EVENTS } from "../engine/engine-pack";
import { own, strOf } from "../engine/pack-kit";
import { reversedAs, txn } from "../packs/economy/core/pay";
import { factStore, standing } from "./facts";
import { eventOf } from "./fold";
import { STORE_OPS, type ChangeInput, type ChangeRow, type Report, type StoreState } from "./types";

/** What undoing a change records, and what of it would be left. */
export interface UndoPlan {
  /** The changes that reverse it, in the order they are recorded. */
  inputs: ChangeInput[];
  /** What is not reversed, each as a code (`changed_since`, `not_reversible`) with the change and its operation. */
  left: Report[];
}

const leftOf = (code: "changed_since" | "not_reversible", c: ChangeRow): Report => ({ code, values: { change: c.id, op: c.op } });

/**
 * A journal line taken back the way the economy takes back what a payment brought when it is paid
 * another way (`otherWay`, `packs/economy/core/pay.ts`): the lines of its posting, the one of its unit
 * with the same memo, the other way, filed as the economy files a posting taken back (`reversedAs`),
 * in its category. None when its posting is not in its unit.
 */
function reverseLine(data: JsonObject, unit: readonly ChangeRow[]): LedgerEvent | null {
  const memo = strOf(data.memo);
  const paid = unit.filter((u) => u.applied).map((u) => eventOf(u.op, u.value)).find((e): e is PostEvent => e?.type === "post" && e.memo === memo);
  if (paid === undefined) return null;
  const reversed = paid.lines.map((l) => ({ account: l.account, amount: -l.amount }));
  const category = strOf(data.category);
  return txn(reversed, { ...reversedAs(paid), ...(category ? { category } : {}) });
}

/** The reverse of one change of `unit`, read against the state just before the unit and the state now; or why it has none. */
function reverseOne(c: ChangeRow, unit: readonly ChangeRow[], before: StoreState, now: StoreState, group: string): { op: string; value: JsonValue } | Report {
  const ev = eventOf(c.op, c.value);
  const grouped = (e: JsonObject): { op: string; value: JsonValue } => ({ op: String(e.type), value: { ...e, group } });
  if (ev) {
    const related = (state: StoreState, rel: string, from: string, to: string) => own(state.world.entities, from)?.relations.find((r) => r.type === rel && r.to === to);
    switch (ev.type) {
      case "post":
        return grouped({ type: "post", lines: ev.lines.map((l) => ({ ...l, amount: -l.amount })) as unknown as JsonValue, memo: ev.memo });
      case "link":
        return related(now, ev.rel, ev.from, ev.to) ? grouped({ type: "unlink", rel: ev.rel, from: ev.from, to: ev.to }) : leftOf("changed_since", c);
      case "unlink": {
        const was = related(before, ev.rel, ev.from, ev.to);
        if (!was || related(now, ev.rel, ev.from, ev.to)) return leftOf("changed_since", c);
        return grouped({ type: "link", rel: ev.rel, from: ev.from, to: ev.to, ...(was.fields ? { fields: was.fields } : {}), ...(was.until !== undefined ? { until: was.until } : {}) });
      }
      case "set":
        if (!jsonEqual(own(now.world.entities, ev.entity)?.fields[ev.field], ev.value)) return leftOf("changed_since", c);
        return grouped({ type: "set", entity: ev.entity, field: ev.field, value: own(before.world.entities, ev.entity)?.fields[ev.field] ?? null });
      case "clock":
        return ev.minutes > 0 ? grouped({ type: ENGINE_EVENTS.rewind, data: { minutes: ev.minutes } }) : leftOf("not_reversible", c);
      default: {
        if (ev.type === ENGINE_EVENTS.rewind && "data" in ev && typeof ev.data.minutes === "number") return grouped({ type: "clock", minutes: ev.data.minutes, cause: "advance" });
        const line = ev.type === FINANCE_EVENTS.txn && "data" in ev ? reverseLine(ev.data, unit) : null;
        return line === null ? leftOf("not_reversible", c) : grouped(line as unknown as JsonObject);
      }
    }
  }
  const v = isRecord(c.value) ? c.value : {};
  if (c.op === STORE_OPS.horizon) return jsonEqual(now.horizon, v.list) ? { op: c.op, value: { list: before.horizon } } : leftOf("changed_since", c);
  if (c.op === STORE_OPS.note) {
    const at = typeof v.at === "string" ? v.at : "";
    if ((now.notes[at]?.text ?? "") !== (typeof v.text === "string" ? v.text : "")) return leftOf("changed_since", c);
    return { op: c.op, value: { at, text: before.notes[at]?.text ?? "" } };
  }
  return leftOf("not_reversible", c);
}

/**
 * Undoing a fact: what it replaced stands again (its words, how exact and how sure, under a new id),
 * and where it replaced nothing of its own key, an empty fact of that key takes it off. Left when a
 * later fact has replaced it since.
 */
function reverseFact(c: ChangeRow, now: StoreState): ChangeInput[] | Report {
  const v = isRecord(c.value) ? c.value : {};
  const id = String(v.id);
  const about = String(v.about);
  const key = String(v.key);
  if (!standing(now, about).some((f) => f.id === id)) return leftOf("changed_since", c);
  const replaced = Object.values(now.facts)
    .flat()
    .filter((f) => f.replacedBy === id && f.value !== "");
  const inputs: ChangeInput[] = replaced.map((f) => ({ lane: c.lane, ...factStore.change({ about: f.about, key: f.key, value: f.value, replaces: f.about === about && f.key === key ? null : id }), precision: f.precision, standing: f.standing }));
  if (!replaced.some((f) => f.about === about && f.key === key)) inputs.push({ lane: c.lane, ...factStore.change({ about, key, value: "" }) });
  return inputs;
}

/**
 * What undoing `unit` (a change with the rest of its unit, in order) records: each change that
 * applied, reversed, the last first, as one unit of its own. `before` is the state just before the
 * unit, `now` the chat's state at its newest reply.
 */
export function reversal(unit: readonly ChangeRow[], before: StoreState, now: StoreState): UndoPlan {
  const group = `undo:${unit[0]?.id ?? 0}`;
  const out: UndoPlan = { inputs: [], left: [] };
  for (const c of [...unit].reverse()) {
    if (!c.applied) continue;
    const r = c.op === STORE_OPS.fact ? reverseFact(c, now) : reverseOne(c, unit, before, now, group);
    if (Array.isArray(r)) out.inputs.push(...r);
    else if ("code" in r) out.left.push(r);
    else out.inputs.push({ lane: c.lane, op: r.op, value: r.value, precision: c.precision, standing: c.standing });
  }
  return out.left.some((r) => r.code === "changed_since") ? { inputs: [], left: out.left } : out;
}
