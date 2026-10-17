// Play → Gear (DESIGN §12): Owned / Worn / Carried / Stored. Containers nest their contents with
// a load bar; kits show completeness and missing pieces; lent items show the use grant and are
// flagged once overdue (DESIGN §9.3). The view model is the gear core's `GearView`.

import { useState } from "preact/hooks";
import { isRecord } from "../../../shared/json";
import { useApp } from "../../../frontend/app";
import { Empty, JsonView, Seg, useBusy } from "../../../frontend/components";
import { list, num, obj, optNum, optStr, str, strings } from "../../../frontend/decode";
import type { PanelProps } from "../../../frontend/registry";
import type { GearItem, GearView } from "../core/view";

const SECTIONS = ["owned", "worn", "carried", "stored"] as const;
type Section = (typeof SECTIONS)[number];

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
  const subs = [
    item.slot,
    item.condition !== undefined ? `condition ${Math.round(item.condition)}%` : null,
    item.kit ? (item.kit.complete ? `kit complete (${item.kit.total})` : `kit ${item.kit.present}/${item.kit.total}${item.kit.missing.length > 0 ? ` · missing ${item.kit.missing.join(", ")}` : ""}`) : null,
    item.lent ? `lent to ${item.lent.to}${item.lent.until ? ` until ${item.lent.until}` : ""}` : null,
  ].filter((part) => part);
  return (
    <div>
      <div class="lre-row">
        <span class="k">
          {children.length > 0 ? (
            <button type="button" class="lre-btn small ghost" aria-expanded={open} aria-label={`Contents of ${item.name}`} onClick={() => setOpen(!open)}>
              <span aria-hidden="true">{open ? "▾" : "▸"}</span>
            </button>
          ) : null}
          {item.name}
          {item.qty !== undefined && item.qty !== 1 ? <span class="lre-muted"> ×{item.qty}</span> : null}
          {subs.length > 0 ? <span class="sub">{subs.join(" · ")}</span> : null}
          {item.load ? (
            <span class="sub">
              <span class={item.load.used > item.load.capacity ? "lre-bar low" : "lre-bar"} style={{ display: "block", marginTop: "4px" }}>
                <span style={{ width: `${item.load.capacity > 0 ? Math.min(100, (item.load.used / item.load.capacity) * 100) : 0}%` }} />
              </span>
              {item.load.used} / {item.load.capacity} {item.load.unit}
            </span>
          ) : null}
        </span>
        {item.lent?.overdue ? <span class="lre-badge warn">overdue</span> : item.kit && !item.kit.complete ? <span class="lre-badge warn">incomplete</span> : null}
        {item.load && children.length === 0 ? (
          <button type="button" class="lre-btn small" disabled={busy} onClick={lookInside}>
            Look inside
          </button>
        ) : null}
      </div>
      {open && children.length > 0 ? (
        <div class="lre-tree">
          {children.map((child) => (
            <ItemRow key={child.id} item={child} depth={props.depth + 1} chatId={props.chatId} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

const SECTION_LABEL: Record<Section, string> = { owned: "Owned", worn: "Worn", carried: "Carried", stored: "Stored" };

export function GearPanel(props: PanelProps) {
  const view = decodeGearView(props.view);
  const [section, setSection] = useState<Section>("carried");
  if (props.view === null || props.view === undefined) return <Empty>Gear is off in this world.</Empty>;
  if (!view) return <JsonView value={props.view} />;
  const items = view[section];
  return (
    <div class="lre-stack" data-lre-panel="gear.gear">
      <Seg<Section> label="Gear section" value={section} options={SECTIONS.map((s) => ({ value: s, label: `${SECTION_LABEL[s]} ${view[s].length}` }))} onChange={(next) => setSection(next)} />
      <section class="lre-card">{items.length === 0 ? <Empty>Nothing {SECTION_LABEL[section].toLowerCase()}.</Empty> : items.map((item) => <ItemRow key={item.id} item={item} depth={0} chatId={props.chatId} />)}</section>
    </div>
  );
}
