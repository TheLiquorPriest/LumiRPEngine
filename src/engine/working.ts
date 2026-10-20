// A validated working state (DESIGN §3 Effects → Events). Every engine step that produces events
// (resolution, rules, tracks, simulation, materialization) appends through one Working, so each
// event is validated against exactly the state it will see on re-fold, then applied.

import type { LedgerEvent } from "../shared/ledger";
import type { WorldDoc } from "../shared/world";
import { applyEvent, validateEvent } from "./events";
import type { ReadContext, Rejection } from "./registry";
import type { Registry } from "./registry-impl";
import type { WorldState } from "./state";

export interface Dropped {
  event: LedgerEvent;
  rejection: Rejection;
}

/** A state snapshot plus the event counts, for an all-or-nothing step (`Working.mark`). */
export interface WorkingMark {
  state: WorldState;
  events: number;
  dropped: number;
}

export class Working {
  readonly reg: Registry;
  readonly world: WorldDoc;
  readonly state: WorldState;
  readonly ctx: ReadContext;
  /** Events applied, in order. */
  readonly events: LedgerEvent[] = [];
  /** Events that failed validation and were not applied. */
  readonly dropped: Dropped[] = [];

  /** Starts from a copy of `state`; the caller's object is never mutated. */
  constructor(reg: Registry, world: WorldDoc, state: Readonly<WorldState>) {
    this.reg = reg;
    this.world = world;
    this.state = structuredClone(state) as WorldState;
    this.ctx = reg.context(world, this.state);
  }

  /** Validates and applies one event; returns the rejection when it was dropped. */
  apply(event: LedgerEvent): Rejection | null {
    const rejection = validateEvent(this.reg, event, this.ctx);
    if (rejection) {
      this.dropped.push({ event, rejection });
      return rejection;
    }
    applyEvent(this.reg, event, this.state, this.ctx);
    this.events.push(event);
    return null;
  }

  /** Applies events in order; returns the ones that were applied. */
  applyAll(events: readonly LedgerEvent[]): LedgerEvent[] {
    const out: LedgerEvent[] = [];
    for (const e of events) if (!this.apply(e)) out.push(e);
    return out;
  }

  /** A state snapshot plus the event counts, for an all-or-nothing step. */
  mark(): WorkingMark {
    return { state: structuredClone(this.state), events: this.events.length, dropped: this.dropped.length };
  }

  /** Restores a mark: the state and the event lists return to what they were. */
  restore(mark: WorkingMark): void {
    // Every WorldState key is required, so assigning a copy replaces each one in place and the
    // read context (which holds this object) stays valid.
    Object.assign(this.state, structuredClone(mark.state));
    this.events.length = mark.events;
    this.dropped.length = mark.dropped;
  }
}
