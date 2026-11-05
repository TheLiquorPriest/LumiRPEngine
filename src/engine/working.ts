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

/**
 * A state snapshot plus the event counts, for an all-or-nothing step (`Working.mark`). A light mark
 * (`Working.lightMark`) holds no snapshot (`state` null): its state is rebuilt on restore from the
 * Working's checkpoint (`base`) and the events applied between the two.
 */
export interface WorkingMark {
  state: WorldState | null;
  events: number;
  dropped: number;
  base?: WorkingCheckpoint;
}

/** A copy of the working state once `events` events had been applied: what light marks rebuild from. */
export interface WorkingCheckpoint {
  state: WorldState;
  events: number;
}

export class Working {
  readonly reg: Registry;
  readonly state: WorldState;
  readonly ctx: ReadContext;
  /** Events applied, in order. */
  readonly events: LedgerEvent[] = [];
  /** Events that failed validation and were not applied. */
  readonly dropped: Dropped[] = [];

  /** Starts from a copy of `state`; the caller's object is never mutated. */
  constructor(reg: Registry, world: WorldDoc, state: Readonly<WorldState>) {
    this.reg = reg;
    this.state = structuredClone(state) as WorldState;
    this.ctx = reg.context(world, this.state);
  }

  /** The world as the working state plays it (ITEMS-SPEC §6.2): a place made by an event applied here is in it. */
  get world(): WorldDoc {
    return this.ctx.world;
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

  /**
   * Makes the events applied since index `from` one unit, `group` (DESIGN §4.3): a rebased view keeps
   * or drops them together, whatever units they formed before. Nothing to do for fewer than two.
   */
  unite(from: number, group: string): void {
    if (this.events.length - from < 2) return;
    for (let i = from; i < this.events.length; i++) {
      const e = this.events[i];
      if (e) this.events[i] = { ...e, group };
    }
  }

  /** A state snapshot plus the event counts, for an all-or-nothing step. */
  mark(): WorkingMark {
    return { state: structuredClone(this.state), events: this.events.length, dropped: this.dropped.length };
  }

  /** The checkpoint light marks rebuild from: taken at the first light mark, kept while no restore goes back before it. */
  private checkpoint: WorkingCheckpoint | null = null;

  /**
   * A mark that copies nothing as it is taken, for a step whose restore is rare (a timelapse slot,
   * which goes back only when the unit cap trips): the Working copies its state once, at its first
   * light mark, and a restore rebuilds the marked state from that copy by applying again, in order,
   * the events applied between them, each to exactly the state it was validated against, as a
   * re-fold does. Marks are restored innermost first, as every all-or-nothing step does.
   */
  lightMark(): WorkingMark {
    if (this.checkpoint === null || this.checkpoint.events > this.events.length) this.checkpoint = { state: structuredClone(this.state), events: this.events.length };
    return { state: null, events: this.events.length, dropped: this.dropped.length, base: this.checkpoint };
  }

  /** Restores a mark: the state and the event lists return to what they were. */
  restore(mark: WorkingMark): void {
    // Every WorldState key is required, so assigning a copy replaces each one in place and the
    // read context (which holds this object) stays valid.
    if (mark.state !== null) Object.assign(this.state, structuredClone(mark.state));
    else if (mark.base) {
      Object.assign(this.state, structuredClone(mark.base.state));
      for (let i = mark.base.events; i < mark.events; i++) {
        const e = this.events[i];
        if (e) applyEvent(this.reg, e, this.state, this.ctx);
      }
    }
    this.events.length = mark.events;
    this.dropped.length = mark.dropped;
    // A checkpoint past where the events now end was taken on a path the restore left.
    if (this.checkpoint !== null && this.checkpoint.events > this.events.length) this.checkpoint = null;
  }
}
