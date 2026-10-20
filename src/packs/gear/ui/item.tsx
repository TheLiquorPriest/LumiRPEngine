// The item sheet: one thing from the Gear view: where it is (and what it's
// inside), whether it's yours, its condition, slot and quantity, a kit's pieces, a loan, and its
// contents with the load. Opening it is a player-facing observation of the item (DESIGN §9.2),
// sent once on mount; for a container that may bring its contents into view.

import { useEffect, useState } from "preact/hooks";
import { useApp } from "../../../frontend/app";
import { Badge, Banner, Empty, IdText, List, ListRow, Meter, PageHeader, Section } from "../../../frontend/components";
import type { SheetProps } from "../../../frontend/registry";
import type { GearItem, GearView } from "../core/view";
import type { GearSection } from "./panel";
import { decodeGearView, itemBadge, lentText, SECTION_LABEL } from "./panel";

export interface FoundItem {
  item: GearItem;
  /** Where it is: the first of worn, carried, stored and owned that holds it. */
  section: GearSection;
  /** The containers it sits in, outermost first. */
  path: GearItem[];
  /** It's in the POV's owned things. */
  owned: boolean;
}

function search(items: readonly GearItem[], id: string, path: GearItem[]): { item: GearItem; path: GearItem[] } | null {
  for (const item of items) {
    if (item.id === id) return { item, path };
    const inside = search(item.children ?? [], id, [...path, item]);
    if (inside) return inside;
  }
  return null;
}

/** An item of the Gear view by id: where it is, what holds it, and whether the POV owns it. */
export function findItem(view: GearView, id: string): FoundItem | null {
  const owned = search(view.owned, id, []) !== null;
  // Owned lists what the POV owns wherever it is, so where the item is comes from the others first.
  for (const section of ["worn", "carried", "stored", "owned"] as const) {
    const hit = search(view[section], id, []);
    if (hit) return { ...hit, section, owned };
  }
  return null;
}

export function ItemSheet(props: SheetProps) {
  const app = useApp();
  const [nothingMore, setNothingMore] = useState(false);
  useEffect(() => {
    setNothingMore(false);
    void app.request({ type: "lre.view.open", chatId: props.chatId, panel: "gear.gear", entity: props.id }).then((result) => {
      if (result?.pending) app.toast("Details appear when the reply finishes.", "info");
      else if (result && !result.materialized) setNothingMore(true);
    });
  }, [props.chatId, props.id]);
  const view = decodeGearView(props.state.panels["gear.gear"]);
  const found = view ? findItem(view, props.id) : null;
  if (!found) {
    return (
      <div class="lre-stack lre-me">
        <PageHeader title="Item" onBack={props.close} />
        <Empty icon="box">This isn't in your gear any more.</Empty>
      </div>
    );
  }
  const { item, section, path, owned } = found;
  const holder = path[path.length - 1];
  const children = item.children ?? [];
  const where = [SECTION_LABEL[section], holder ? `in ${holder.name}` : null].filter((part) => part !== null).join(" · ");
  return (
    <div class="lre-stack lre-me" data-lre-sheet-item={item.id}>
      <PageHeader title={item.qty !== undefined && item.qty !== 1 ? `${item.name} ×${item.qty}` : item.name} subtitle={where} onBack={props.close} />
      <IdText id={item.id} />
      {item.lent?.overdue ? (
        <Banner tone="warn" title="Overdue">
          {item.lent.to} hasn't given it back{item.lent.until ? ` (due ${item.lent.until})` : ""}.
        </Banner>
      ) : null}
      <Section title="Details" flush>
        <List>
          <ListRow icon="pin" title="Where" value={SECTION_LABEL[section]} />
          {path.map((container) => (
            <ListRow key={container.id} icon="box" title="Inside" subtitle={container.name} chevron onClick={() => props.open({ kind: "item", id: container.id })} />
          ))}
          {owned ? <ListRow icon="user" title="Owner" value="You" /> : null}
          {item.slot ? <ListRow icon="shield" title="Slot" value={item.slot} /> : null}
          {item.qty !== undefined ? <ListRow icon="layers" title="Quantity" value={String(item.qty)} /> : null}
          {item.lent ? <ListRow icon="user-plus" title="On loan" subtitle={lentText(item.lent)} badge={item.lent.overdue ? <Badge tone="warn">Overdue</Badge> : undefined} /> : null}
        </List>
      </Section>
      {item.condition !== undefined ? (
        <Section>
          <Meter label={`Condition ${Math.round(item.condition)}%`} value={Math.round(item.condition)} max={100} tone={item.condition <= 25 ? "neg" : "accent"} />
        </Section>
      ) : null}
      {item.kit ? (
        <Section title="Kit" aside={item.kit.complete ? <Badge tone="pos">Complete</Badge> : <Badge tone="warn">Incomplete</Badge>}>
          <div class="lre-stack">
            <Meter label={`${item.kit.present} of ${item.kit.total} pieces`} value={item.kit.present} max={item.kit.total} tone={item.kit.complete ? "pos" : "warn"} />
            {item.kit.missing.length > 0 ? <span class="lre-small lre-muted">Missing: {item.kit.missing.join(", ")}</span> : null}
          </div>
        </Section>
      ) : null}
      {item.load || children.length > 0 ? (
        <Section title="Contents" flush aside={children.length > 0 ? <Badge>{children.length}</Badge> : undefined}>
          {item.load ? (
            <div class="lre-me-pad">
              <Meter label={`Load ${item.load.used} / ${item.load.capacity} ${item.load.unit}`} value={item.load.used} max={item.load.capacity} tone={item.load.used > item.load.capacity ? "neg" : "accent"} />
            </div>
          ) : null}
          {children.length > 0 ? (
            <List>
              {children.map((child) => (
                <ListRow key={child.id} icon={child.children ? "box" : undefined} title={child.qty !== undefined && child.qty !== 1 ? `${child.name} ×${child.qty}` : child.name} subtitle={child.children ? `${child.children.length} inside` : undefined} id={child.id} badge={itemBadge(child)} chevron onClick={() => props.open({ kind: "item", id: child.id })} />
              ))}
            </List>
          ) : (
            <Empty icon="box">{nothingMore ? `Nothing more inside ${item.name}.` : "Nothing seen inside yet."}</Empty>
          )}
        </Section>
      ) : null}
    </div>
  );
}
