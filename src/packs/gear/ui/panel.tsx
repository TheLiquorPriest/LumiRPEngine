// Play → Me → Gear (DESIGN §12): Owned / Worn / Carried / Stored. Containers nest their contents
// with a load meter; kits show completeness and missing pieces; lent items show the use grant and
// are flagged once overdue (DESIGN §9.3). Each item opens its item sheet. The view model is the
// gear core's `GearView`.

import { useState } from "preact/hooks";
import { isRecord } from "../../../shared/json";
import { pushSheet, useApp } from "../../../frontend/app";
import { Badge, Button, Empty, IdText, JsonView, Meter, Seg, useBusy } from "../../../frontend/components";
import { list, num, obj, optNum, optStr, str, strings } from "../../../frontend/decode";
import { Icon } from "../../../frontend/icons";
import type { PanelProps } from "../../../frontend/registry";
import type { GearItem, GearView } from "../core/view";

export const SECTIONS = ["owned", "worn", "carried", "stored"] as const;
export type GearSection = (typeof SECTIONS)[number];
export const SECTION_LABEL: Record<GearSection, string> = { owned: "Owned", worn: "Worn", carried: "Carried", stored: "Stored" };

function decodeItem(entry: Record<string, unknown>): GearItem | null {
  if (typeof entry.id !== "string") return null;
  const load = obj(entry.load);
  const kit = obj(entry.kit);
  const lent = obj(entry.lent);
  const children = list(entry.children, decodeItem);
  return {
    id: entry.id,
    name: str(entry.name, entry.id),
    qty: optNum(entry.qty),
    condition: optNum(entry.condition),
    slot: optStr(entry.slot),
    load: load ? { used: num(load.used), capacity: num(load.capacity), unit: "l" } : undefined,
    kit: kit ? { complete: kit.complete === true, present: num(kit.present), total: num(kit.total), missing: strings(kit.missing) } : undefined,
    lent: lent ? { to: str(lent.to), until: optStr(lent.until), overdue: lent.overdue === true } : undefined,
    children: children.length > 0 ? children : undefined,
  };
}

export function decodeGearView(value: unknown): GearView | null {
  if (!isRecord(value) || !SECTIONS.some((section) => Array.isArray(value[section]))) return null;
  return { level: num(value.level, 1), owned: list(value.owned, decodeItem), worn: list(value.worn, decodeItem), carried: list(value.carried, decodeItem), stored: list(value.stored, decodeItem) };
}

/** Who has a lent item, until when. */
export function lentText(lent: NonNullable<GearItem["lent"]>): string {
  return `lent to ${lent.to}${lent.until ? ` until ${lent.until}` : ""}`;
}

/** The flag an item carries in a list: overdue back from a loan, an incomplete kit, or out on loan. */
export function itemBadge(item: GearItem) {
  if (item.lent?.overdue) return <Badge tone="warn">Overdue</Badge>;
  if (item.kit && !item.kit.complete) return <Badge tone="warn">Incomplete</Badge>;
  if (item.lent) return <Badge>Lent</Badge>;
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
  const subs = [item.slot, item.condition !== undefined ? `condition ${Math.round(item.condition)}%` : null, kit, item.lent ? lentText(item.lent) : null].filter((part) => part);
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
  const [section, setSection] = useState<GearSection>("carried");
  if (props.view === null || props.view === undefined) return <Empty icon="bag">Gear is off in this world.</Empty>;
  if (!view) return <JsonView value={props.view} />;
  const items = view[section];
  return (
    <div class="lre-stack lre-me" data-lre-panel="gear.gear">
      <Seg<GearSection> label="Gear section" value={section} options={SECTIONS.map((s) => ({ value: s, label: `${SECTION_LABEL[s]} ${view[s].length}` }))} onChange={(next) => setSection(next)} />
      {items.length === 0 ? (
        <Empty icon="bag">Nothing {SECTION_LABEL[section].toLowerCase()}.</Empty>
      ) : (
        <div class="lre-me-items" role="list" aria-label={SECTION_LABEL[section]}>
          {items.map((item) => (
            <ItemRow key={item.id} item={item} depth={0} chatId={props.chatId} />
          ))}
        </div>
      )}
    </div>
  );
}
