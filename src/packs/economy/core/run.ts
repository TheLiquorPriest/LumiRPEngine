// A money process step's own view of the books (DESIGN §25.5): everything it records inside one
// slot is applied to a copy of the state as it goes, so the next payment that slot sees the last
// one (two bills due the same morning can't both spend what covers one, a statement closes before
// the autopay that pays it). It keeps whole units only, so what it returns applies the same way,
// event by event, when the step's events are folded after it.

import type { LedgerEvent } from "../../../shared/ledger";
import { applyEvent, eventUnits, validateEvent } from "../../../engine/events";
import { own } from "../../../engine/pack-kit";
import type { ReadContext } from "../../../engine/registry";
import type { WorldState } from "../../../engine/state";
import { noted } from "./pay";

/**
 * A copy of the state that this step may write: the account balances and the economy's slice are
 * copied, entities and other slices only when an event writes them.
 */
function scratchOf(state: Readonly<WorldState>): WorldState {
  return { ...state, entities: { ...state.entities }, accounts: { ...state.accounts }, packs: { ...state.packs, economy: structuredClone(state.packs.economy ?? {}) }, materialized: { ...state.materialized } } as WorldState;
}

export class Run {
  readonly state: WorldState;
  readonly ctx: ReadContext;
  readonly out: LedgerEvent[] = [];
  private readonly copied = new Set<string>(["economy"]);
  private readonly ownEntities = new Set<string>();

  constructor(base: ReadContext) {
    this.state = scratchOf(base.state);
    this.ctx = base.registry.context(base.world, this.state);
  }

  /** Copies what an event writes before it writes it. */
  private touch(e: LedgerEvent): void {
    const entity = e.type === "set" || e.type === "add" ? e.entity : e.type === "link" || e.type === "unlink" ? e.from : null;
    if (entity !== null && !this.ownEntities.has(entity)) {
      const cur = own(this.state.entities, entity);
      if (cur) this.state.entities[entity] = { ...cur, fields: { ...cur.fields }, relations: [...cur.relations] };
      this.ownEntities.add(entity);
    }
    const dot = e.type.indexOf(".");
    const pack = dot > 0 ? e.type.slice(0, dot) : null;
    if (pack !== null && !this.copied.has(pack)) {
      const slice = own(this.state.packs, pack);
      if (slice) this.state.packs[pack] = structuredClone(slice);
      this.copied.add(pack);
    }
  }

  /** Whether every event of a unit validates in turn: its postings checked against the balances the ones before them leave. */
  private fits(unit: readonly LedgerEvent[]): boolean {
    if (unit.length === 1) return unit[0] !== undefined && validateEvent(this.ctx.registry, unit[0], this.ctx) === null;
    const trial: WorldState = { ...this.state, accounts: { ...this.state.accounts } };
    const ctx = this.ctx.registry.context(this.ctx.world, trial);
    for (const e of unit) {
      if (validateEvent(this.ctx.registry, e, ctx)) return false;
      if (e.type === "post") for (const l of e.lines) trial.accounts[l.account] = (own(trial.accounts, l.account) ?? 0) + l.amount;
    }
    return true;
  }

  /** Applies the units that fit, in order (signals for anyone but the POV become their private notes); returns what applied. */
  emit(events: readonly LedgerEvent[]): LedgerEvent[] {
    const list = noted(this.ctx, [...events]);
    const applied: LedgerEvent[] = [];
    for (const [from, to] of eventUnits(list)) {
      const unit = list.slice(from, to);
      if (!this.fits(unit)) continue;
      for (const e of unit) {
        this.touch(e);
        applyEvent(this.ctx.registry, e, this.state, this.ctx);
        applied.push(e);
      }
    }
    this.out.push(...applied);
    return applied;
  }
}
