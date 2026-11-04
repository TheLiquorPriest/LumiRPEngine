// Play → Me → Gear (DESIGN §12; ITEMS-SPEC §10.3): On you (worn, in pockets, in hand, in bags) ·
// Holding for others · Yours elsewhere, with where · Lent out · Borrowed, each a section of item
// trees, the empty ones but On you left out. Containers nest their contents with a load meter;
// kits show completeness and missing pieces; lent and borrowed things show the grant and are
// flagged once overdue (DESIGN §9.3). Each item opens its item sheet. The view model is the gear
// core's `GearView`.

import { useState } from "preact/hooks";
import { isRecord } from "../../../shared/json";
import { pushSheet, useApp } from "../../../frontend/app";
import { Badge, Button, Empty, IdText, JsonView, Meter, Section, useBusy } from "../../../frontend/components";
import { list, num, obj, optNum, optStr, str, strings } from "../../../frontend/decode";
import { Icon } from "../../../frontend/icons";
import type { PanelProps } from "../../../frontend/registry";
import type { WornAs } from "../core/feed";
import type { GearItem, GearView } from "../core/view";

export const SECTIONS = ["on", "holding", "elsewhere", "lent", "borrowed"] as const;
export type GearSection = (typeof SECTIONS)[number];
export const SECTION_LABEL: Record<GearSection, string> = { on: "On you", holding: "Holding for others", elsewhere: "Yours elsewhere", lent: "Lent out", borrowed: "Borrowed" };

/** How a thing is on you, as its row says it. */
export const AS_LABEL: Record<WornAs, string> = { worn: "worn", pocket: "in a pocket", hand: "in hand" };

const AS_VALUES: readonly WornAs[] = ["worn", "pocket", "hand"];

function decodeItem(entry: Record<string, unknown>): GearItem | null {
  if (typeof entry.id !== "string") return null;
  const load = obj(entry.load);
  const kit = obj(entry.kit);
  const lent = obj(entry.lent);
  const borrowed = obj(entry.borrowed);
  const children = list(entry.children, decodeItem);
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
    children: children.length > 0 ? children : undefined,
  };
}

export function decodeGearView(value: unknown): GearView | null {
  if (!isRecord(value) || !SECTIONS.some((section) => Array.isArray(value[section]))) return null;
  return { level: num(value.level, 1), on: list(value.on, decodeItem), holding: list(value.holding, decodeItem), elsewhere: list(value.elsewhere, decodeItem), lent: list(value.lent, decodeItem), borrowed: list(value.borrowed, decodeItem) };
}

/** Who has a thing of yours, until when: lent to them, or holding it for you. */
export function lentText(lent: NonNullable<GearItem["lent"]>): string {
  return lent.hold ? `${lent.to} is holding it for you` : `lent to ${lent.to}${lent.until ? ` until ${lent.until}` : ""}`;
}

/** Whose a thing you have on loan is, until when, or that it is assigned to you to use. */
export function borrowedText(borrowed: NonNullable<GearItem["borrowed"]>): string {
  return borrowed.assigned ? `${borrowed.from}'s, yours to use` : `borrowed from ${borrowed.from}${borrowed.until ? ` until ${borrowed.until}` : ""}`;
}

/** The flag an item carries in a list: overdue back from a loan either way, an incomplete kit, or out with someone. */
export function itemBadge(item: GearItem) {
  if (item.lent?.overdue || item.borrowed?.overdue) return <Badge tone="warn">Overdue</Badge>;
  if (item.kit && !item.kit.complete) return <Badge tone="warn">Incomplete</Badge>;
  if (item.lent) return <Badge>{item.lent.hold ? "Held" : "Lent"}</Badge>;
  return null;
}

function ItemRow(props: { item: GearItem; depth: number; chatId: string }) {
  const { item } = props;
  const app = useApp();
  const [busy, run] = useBusy();
  const children = item.children ?? [];
  const [open, setOpen] = useState(props.depth === 0 && children.length > 0 && children.length <= 6);
  // Looking inside a container is a player-facing observation: the backend may materialize its contents (DESIGN §9.2).
  const lookInside = () =>
    run(async () => {
      const result = await app.request({ type: "lre.view.open", chatId: props.chatId, panel: "gear.gear", entity: item.id });
      if (result?.pending) app.toast("The contents appear when the reply finishes.", "info");
      else if (result && !result.materialized) app.toast(`Nothing more inside ${item.name}.`, "info");
      setOpen(true);
    });
  // An incomplete kit's count shows on its meter below, so the line names only what's missing.
  const kit = item.kit ? (item.kit.complete ? `kit complete (${item.kit.total})` : item.kit.missing.length > 0 ? `missing ${item.kit.missing.join(", ")}` : null) : null;
  // A thing someone else holds or lends you says whose it is; your own goes without saying.
  const whose = item.whose !== undefined && item.whose !== "yours" && !item.lent && !item.borrowed ? item.whose : null;
  const subs = [item.as ? AS_LABEL[item.as] : null, item.slot, whose, item.where ?? null, item.condition !== undefined ? `condition ${Math.round(item.condition)}%` : null, kit, item.lent ? lentText(item.lent) : null, item.borrowed ? borrowedText(item.borrowed) : null].filter((part) => part);
  return (
    <div class="lre-me-item" role="listitem">
      <div class="lre-me-item-line">
        {children.length > 0 ? (
          <button type="button" class="lre-iconbtn ghost" aria-expanded={open} aria-label={`Contents of ${item.name}`} title={`Contents of ${item.name}`} onClick={() => setOpen(!open)}>
            <Icon name={open ? "chevron-down" : "chevron-right"} />
          </button>
        ) : (
          <span class="lre-me-item-gap" aria-hidden="true" />
        )}
        <button type="button" class="lre-me-item-open" onClick={() => app.ui.update((ui) => pushSheet(ui, { kind: "item", id: item.id }))}>
          <span class="lre-me-item-text">
            <span class="lre-me-item-name">
              {item.name}
              {item.qty !== undefined && item.qty !== 1 ? <span class="lre-muted lre-num"> ×{item.qty}</span> : null}
            </span>
            {subs.length > 0 ? <span class="lre-me-item-sub">{subs.join(" · ")}</span> : null}
            <IdText id={item.id} />
          </span>
          {itemBadge(item)}
          <Icon name="chevron-right" size={16} class="lre-me-chev" />
        </button>
      </div>
      {item.load || (item.kit && !item.kit.complete) ? (
        <div class="lre-me-item-extra">
          {item.load ? <Meter label={`Load ${item.load.used} / ${item.load.capacity} ${item.load.unit}`} value={item.load.used} max={item.load.capacity} tone={item.load.used > item.load.capacity ? "neg" : "accent"} /> : null}
          {item.kit && !item.kit.complete ? <Meter label={`Kit ${item.kit.present} of ${item.kit.total}`} value={item.kit.present} max={item.kit.total} tone="warn" /> : null}
          {item.load && children.length === 0 ? (
            <div>
              <Button size="sm" icon="search" busy={busy} onClick={lookInside}>
                Look inside
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
      {open && children.length > 0 ? (
        <div class="lre-me-tree" role="list" aria-label={`Inside ${item.name}`}>
          {children.map((child) => (
            <ItemRow key={child.id} item={child} depth={props.depth + 1} chatId={props.chatId} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function GearPanel(props: PanelProps) {
  const view = decodeGearView(props.view);
  if (props.view === null || props.view === undefined) return <Empty icon="bag">Gear is off in this world.</Empty>;
  if (!view) return <JsonView value={props.view} />;
  return (
    <div class="lre-stack lre-me" data-lre-panel="gear.gear">
      {SECTIONS.filter((section) => section === "on" || view[section].length > 0).map((section) => (
        <Section key={section} title={SECTION_LABEL[section]} aside={<Badge>{view[section].length}</Badge>} flush>
          {view[section].length === 0 ? (
            <Empty icon="bag">Nothing on you.</Empty>
          ) : (
            <div class="lre-me-items" role="list" aria-label={SECTION_LABEL[section]} data-lre-gear-section={section}>
              {view[section].map((item) => (
                <ItemRow key={item.id} item={item} depth={0} chatId={props.chatId} />
              ))}
            </div>
          )}
        </Section>
      ))}
    </div>
  );
}
