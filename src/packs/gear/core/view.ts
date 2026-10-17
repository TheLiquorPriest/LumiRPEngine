// The Gear panel's view model (`gear.gear`): what the POV owns, wears, carries and has stored,
// as item trees. Gear level 1 shows notable items only; kits and slots from level 3.

import type { EntityId } from "../../../shared/ids";
import type { ReadContext } from "../../../engine/registry";
import { calendarOf, formatClock } from "../../../engine/calendar";
import { numOf, strOf, own } from "../../../engine/pack-kit";
import { canSeeEntity } from "../../../engine/visibility";
import { contentsOf, grants, holderOf, isInside, kitStatus, loadOf } from "./model";

export interface GearItem {
  id: EntityId;
  name: string;
  qty?: number;
  condition?: number;
  slot?: string;
  load?: { used: number; capacity: number; unit: "l" };
  kit?: { complete: boolean; present: number; total: number; missing: string[] };
  lent?: { to: string; until?: string; overdue: boolean };
  children?: GearItem[];
}

export interface GearView {
  level: number;
  owned: GearItem[];
  worn: GearItem[];
  carried: GearItem[];
  stored: GearItem[];
}

export function buildGearView(ctx: ReadContext): GearView {
  const pov = ctx.world.pov;
  const level = ctx.levelOf(pov, "gear");
  const cal = calendarOf(ctx.world);
  const lent = new Map(grants(ctx.state).map((g) => [g.thing, g]));
  const shown = (id: EntityId): boolean => {
    const e = own(ctx.state.entities, id);
    return !!e && e.kind !== "account" && canSeeEntity(ctx.world, ctx.state, pov, id) && (level >= 2 || e.fields.notable === true);
  };
  const item = (id: EntityId, depth: number): GearItem => {
    const e = own(ctx.state.entities, id);
    const out: GearItem = { id, name: e?.fields.lost === true ? `${e.name} (lost)` : (e?.name ?? id) };
    if (!e) return out;
    const qty = numOf(e.fields.qty, 1);
    if (level >= 2 && qty !== 1) out.qty = qty;
    if (level >= 3 && typeof e.fields.condition === "number") out.condition = e.fields.condition;
    // A lent thing is with its borrower, so it shows no slot of the owner's.
    if (level >= 3 && strOf(e.fields.slot) && !lent.has(id)) out.slot = strOf(e.fields.slot).replace(/_/g, " ");
    if (level >= 2 && typeof e.fields.capacity_l === "number") {
      const load = loadOf(ctx.state, id);
      out.load = { used: Math.round(load.usedL * 100) / 100, capacity: load.capacityL ?? 0, unit: "l" };
    }
    const kit = level >= 3 ? kitStatus(ctx, id) : null;
    if (kit) out.kit = { complete: kit.complete, present: kit.present, total: kit.total, missing: kit.missing };
    const g = lent.get(id);
    if (g) out.lent = { to: own(ctx.state.entities, g.borrower)?.name ?? g.borrower, ...(g.until !== null ? { until: formatClock(cal, g.until) } : {}), overdue: g.overdue };
    const kids = depth < 8 ? contentsOf(ctx.state, id).filter(shown) : [];
    if (kids.length > 0) out.children = kids.map((k) => item(k, depth + 1));
    return out;
  };
  const ids = Object.keys(ctx.state.entities).sort();
  const worn = level >= 3 ? ids.filter((id) => shown(id) && own(ctx.state.entities, id)?.relations.some((r) => (r.type === "worn_by" || r.type === "equipped") && r.to === pov)) : [];
  const carried = contentsOf(ctx.state, pov).filter((id) => shown(id) && !worn.includes(id));
  const owned = ids.filter((id) => shown(id) && own(ctx.state.entities, id)?.fields.owner === pov);
  // Owned things inside another thing the POV owns (and can see) list under it, not again at the top.
  const nested = (id: EntityId): boolean => {
    const holder = holderOf(ctx.state, id);
    return !!holder && holder !== pov && own(ctx.state.entities, holder)?.fields.owner === pov && shown(holder);
  };
  const stored = owned.filter((id) => own(ctx.state.entities, id)?.fields.lost !== true && !isInside(ctx.state, id, pov) && !(holderOf(ctx.state, id) && own(ctx.state.entities, holderOf(ctx.state, id) ?? "")?.fields.owner === pov));
  return {
    level,
    owned: owned.filter((id) => !nested(id)).map((id) => item(id, 0)),
    worn: worn.map((id) => item(id, 8)),
    carried: carried.map((id) => item(id, 0)),
    stored: stored.map((id) => item(id, 0)),
  };
}
