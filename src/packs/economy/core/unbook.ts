// What the economy booked about a business's months, a party's basis in something and the clock of a business's last distribution,
// taken off again as the Undo of the event that booked it (`economy.unbook`, `reverse` of `economy.payout`, `economy.invoice_paid`
// and `economy.acquire`). The months a booking went to follow from the clock it was made at (`at`), through the world's calendar, which
// only an event's `apply` has, so the event carries what to take off and when it was made, and the apply finds the month.

import type { EntityId } from "../../../shared/ids";
import { isRecord, type JsonObject, type JsonValue } from "../../../shared/json";
import type { PackEvent } from "../../../shared/ledger";
import { say } from "../../../shared/lines";
import { numOf, objOf, own, sliceRecord, strOf } from "../../../engine/pack-kit";
import type { EventTypeDef } from "../../../engine/registry";
import { addToBooks, BOOK_KEYS, type MonthBook, monthOf } from "./books";
import { reject } from "./assets";
import { setBasisRecord, unrecordGain } from "./records";

export const UNBOOK = "economy.unbook";

/** What one `economy.unbook` takes off: booked amounts of a business (in `month`, else the month of `at`), a party's basis put back, realised gains (the year of `at`) and a business's last distribution put back. */
export interface Unbooking {
  /** The clock the booking was made at. */
  at: number;
  books?: { business: EntityId; month?: string; entries: Partial<MonthBook> }[];
  basis?: { entity: EntityId; party: EntityId; was: { basis: number; since: number | null } | null }[];
  gains?: { party: EntityId; term: "short" | "long"; gain: number; proceeds: number; basis: number; label: string; qty: number; home?: boolean }[];
  distributed?: { business: EntityId; was: number | null }[];
}

/** An `economy.unbook` event's data for `what`. */
export function unbooking(what: Unbooking): JsonObject {
  return { at: what.at, visibility: "secret", ...(what.books ? { books: what.books as unknown as JsonValue } : {}), ...(what.basis ? { basis: what.basis as unknown as JsonValue } : {}), ...(what.gains ? { gains: what.gains as unknown as JsonValue } : {}), ...(what.distributed ? { distributed: what.distributed as unknown as JsonValue } : {}) };
}

function rows(v: JsonValue | undefined): JsonObject[] {
  return Array.isArray(v) ? v.filter((x): x is JsonObject => isRecord(x)) : [];
}

/** The event that takes booked amounts off the books (and puts basis and distribution clocks back). */
export const UNBOOK_EVENT: EventTypeDef<PackEvent> = {
  type: UNBOOK,
  validate: (e) => (typeof e.data.at === "number" && Number.isFinite(e.data.at) ? null : reject("bad_event", say("why_taking_a_booking_off_needs_when_it_was"))),
  apply: (e, state, ctx) => {
    for (const b of rows(e.data.books)) {
      const taken: Partial<MonthBook> = {};
      for (const k of BOOK_KEYS) if (typeof objOf(b.entries)[k] === "number") taken[k] = -numOf(objOf(b.entries)[k]);
      addToBooks(state, strOf(b.business), strOf(b.month) || monthOf(ctx.world, numOf(e.data.at)), taken);
    }
    for (const r of rows(e.data.basis)) {
      const was = isRecord(r.was) ? { basis: numOf(r.was.basis), since: typeof r.was.since === "number" ? r.was.since : null } : null;
      setBasisRecord(state, strOf(r.entity), strOf(r.party), was);
    }
    for (const g of rows(e.data.gains)) {
      unrecordGain(state, ctx.world, strOf(g.party), numOf(e.data.at), { term: g.term === "long" ? "long" : "short", gain: numOf(g.gain), proceeds: numOf(g.proceeds), basis: numOf(g.basis), label: strOf(g.label), qty: numOf(g.qty), ...(g.home === true ? { home: true } : {}) });
    }
    for (const d of rows(e.data.distributed)) {
      const distributed = sliceRecord(state, "economy", "distributed");
      if (typeof d.was === "number") distributed[strOf(d.business)] = d.was;
      else if (own(distributed, strOf(d.business)) !== undefined) delete distributed[strOf(d.business)];
    }
  },
  describe: () => "",
};
