// Play → Me → Belongings (DESIGN §12; ITEMS-SPEC §10.3): the gear pack's panel, `belongings.tsx`'s
// Belongings over the gear core's `GearView`, decoded here from the state push.

import { isRecord } from "../../../shared/json";
import { ACCESS_BASES, GRANT_BASES, isSize, SET_KINDS, SIZES, type SizeClass } from "../../../shared/things";
import type { LoanChoice } from "../../../shared/thing-gm";
import type { AccessChip } from "../../../shared/thing-view";
import { Empty, JsonView } from "../../../frontend/components";
import { list, num, obj, oneOf, optNum, optStr, str, strings } from "../../../frontend/decode";
import type { PanelProps } from "../../../frontend/registry";
import type { WornAs } from "../core/feed";
import type { GearHolder, GearItem, GearSet, GearView } from "../core/view";
import { Belongings } from "./belongings";

/** The Gear view's lists of things by who has them, in the order the item sheet looks a thing up. */
export const SECTIONS = ["on", "holding", "elsewhere", "lent", "borrowed"] as const;
export type GearSection = (typeof SECTIONS)[number];
export const SECTION_LABEL: Record<GearSection, string> = { on: "On you", holding: "Holding for others", elsewhere: "Yours elsewhere", lent: "Lent out", borrowed: "Borrowed" };

const AS_VALUES: readonly WornAs[] = ["worn", "pocket", "hand"];

const SIZE_CLASSES: readonly SizeClass[] = [...SIZES, "part", "vehicle", "unknown"];

/** A holder as the view names it: a wardrobe, a dresser, a bag, a place, a person. */
function decodeHolder(value: unknown): GearHolder | null {
  const holder = obj(value);
  return holder && typeof holder.id === "string" ? { id: holder.id, name: str(holder.name, holder.id) } : null;
}

/** Who may use a thing on one ground, as the engine names it. */
function decodeChip(entry: Record<string, unknown>): AccessChip | null {
  return typeof entry.label === "string" ? { basis: oneOf(entry.basis, ACCESS_BASES, "grant"), label: entry.label, who: strings(entry.who) } : null;
}

function decodeItem(entry: Record<string, unknown>): GearItem | null {
  if (typeof entry.id !== "string") return null;
  const load = obj(entry.load);
  const kit = obj(entry.kit);
  const lent = obj(entry.lent);
  const borrowed = obj(entry.borrowed);
  const children = list(entry.children, decodeItem);
  const use = list(entry.use, decodeChip);
  const grants = list(entry.grants, (g) => (typeof g.who === "string" ? { who: g.who, name: str(g.name, g.who), basis: oneOf(g.basis, GRANT_BASES, "assign"), ...(typeof g.until === "string" ? { until: g.until } : {}), ...(g.overdue === true ? { overdue: true as const } : {}) } : null));
  return {
    id: entry.id,
    name: str(entry.name, entry.id),
    qty: optNum(entry.qty),
    condition: optNum(entry.condition),
    slot: optStr(entry.slot),
    as: AS_VALUES.find((v) => v === entry.as),
    load: load ? { used: num(load.used), capacity: num(load.capacity), unit: "l" } : undefined,
    kit: kit ? { complete: kit.complete === true, present: num(kit.present), total: num(kit.total), missing: strings(kit.missing) } : undefined,
    whose: optStr(entry.whose),
    why: optStr(entry.why),
    kept: optStr(entry.kept),
    where: optStr(entry.where),
    lent: lent ? { to: str(lent.to), until: optStr(lent.until), overdue: lent.overdue === true, ...(lent.hold === true ? { hold: true as const } : {}) } : undefined,
    borrowed: borrowed ? { from: str(borrowed.from), until: optStr(borrowed.until), overdue: borrowed.overdue === true, ...(borrowed.assigned === true ? { assigned: true as const } : {}) } : undefined,
    ...(entry.wearable === true ? { wearable: true as const } : {}),
    ...(isSize(entry.holds) ? { holds: entry.holds } : {}),
    ...(SIZE_CLASSES.some((s) => s === entry.size) ? { size: entry.size as SizeClass } : {}),
    ...(entry.mine === true ? { mine: true as const } : {}),
    ...(typeof entry.ownerId === "string" || entry.ownerId === null ? { ownerId: entry.ownerId } : {}),
    ...(use.length > 0 ? { use } : {}),
    ...(grants.length > 0 ? { grants } : {}),
    ...(typeof entry.category === "string" ? { category: entry.category } : {}),
    children: children.length > 0 ? children : undefined,
  };
}

/** A saved outfit or loadout: its pieces by name, the missing ones flagged, and whether it is all on now. */
function decodeSet(entry: Record<string, unknown>): GearSet | null {
  if (typeof entry.id !== "string" || typeof entry.name !== "string") return null;
  return {
    id: entry.id,
    name: entry.name,
    kind: oneOf(entry.kind, SET_KINDS, "outfit"),
    pieces: list(entry.pieces, (p) => (typeof p.item === "string" ? { item: p.item, name: str(p.name, p.item), ...(typeof p.slot === "string" ? { slot: p.slot } : {}), ...(p.missing === true ? { missing: true as const } : {}) } : null)),
    ...(entry.on === true ? { on: true as const } : {}),
  };
}

export function decodeGearView(value: unknown): GearView | null {
  if (!isRecord(value) || !SECTIONS.some((section) => Array.isArray(value[section]))) return null;
  const here = obj(value.here);
  return {
    level: num(value.level, 1),
    on: list(value.on, decodeItem),
    holding: list(value.holding, decodeItem),
    elsewhere: list(value.elsewhere, decodeItem),
    lent: list(value.lent, decodeItem),
    borrowed: list(value.borrowed, decodeItem),
    outfit: list(value.outfit, decodeItem),
    carried: list(value.carried, decodeItem),
    wardrobe: list(value.wardrobe, (w) => ({ holder: decodeHolder(w.holder), where: str(w.where), items: list(w.items, decodeItem) })),
    here: here
      ? {
          place: str(here.place),
          room: list(here.room, decodeItem),
          lying: list(here.lying, decodeItem),
          inside: list(here.inside, (h) => {
            const holder = decodeHolder(h.holder);
            return holder ? { holder, items: list(h.items, decodeItem) } : null;
          }),
        }
      : null,
    stored: list(value.stored, (s) => ({ holder: decodeHolder(s.holder), where: str(s.where), items: list(s.items, decodeItem) })),
    sets: list(value.sets, decodeSet),
    people: list(value.people, decodeHolder),
    vehicles: num(value.vehicles),
    loans: list(value.loans, (l): LoanChoice | null => (typeof l.label === "string" && typeof l.until === "number" ? { label: l.label, until: l.until } : null)),
    household: decodeHolder(value.household),
    home: decodeHolder(value.home),
    ceiling: isSize(value.ceiling) ? value.ceiling : "armful",
  };
}

export function GearPanel(props: PanelProps) {
  const view = decodeGearView(props.view);
  if (props.view === null || props.view === undefined) return <Empty icon="bag">Gear is off in this world.</Empty>;
  if (!view) return <JsonView value={props.view} />;
  return (
    <div data-lre-panel="gear.gear">
      <Belongings chatId={props.chatId} state={props.state} view={view} />
    </div>
  );
}
