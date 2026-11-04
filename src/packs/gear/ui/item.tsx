// The item sheet: one thing from the Gear view: where it is (and what it's inside), whose it is, why
// you have it and where it is kept (ITEMS-SPEC §10.3), its condition, slot and quantity, a kit's
// pieces, a loan, and its contents with the load; and what you can do with it from here: Fetch,
// Put away, Give back and Hand to…, each staged as its palette tap is, from the palette's own
// options for this thing. Opening it is a player-facing observation of the item (DESIGN §9.2), sent
// once on mount; for a container that may bring its contents into view.

import { useEffect, useState } from "preact/hooks";
import type { PaletteEntry, PaletteOption } from "../../../shared/state-view";
import { useApp } from "../../../frontend/app";
import { Badge, Banner, Button, Empty, IdText, List, ListRow, Meter, PageHeader, Section, useBusy } from "../../../frontend/components";
import type { SheetProps } from "../../../frontend/registry";
import { paletteRequest } from "../../../frontend/requests";
import type { GearItem, GearView } from "../core/view";
import type { GearSection } from "./panel";
import { AS_LABEL, borrowedText, decodeGearView, itemBadge, lentText, SECTION_LABEL, SECTIONS } from "./panel";

export interface FoundItem {
  item: GearItem;
  /** Where it is: the first of the Gear view's sections that holds it. */
  section: GearSection;
  /** The containers it sits in, outermost first. */
  path: GearItem[];
}

function search(items: readonly GearItem[], id: string, path: GearItem[]): { item: GearItem; path: GearItem[] } | null {
  for (const item of items) {
    if (item.id === id) return { item, path };
    const inside = search(item.children ?? [], id, [...path, item]);
    if (inside) return inside;
  }
  return null;
}

/** An item of the Gear view by id: the section it is in and what holds it. */
export function findItem(view: GearView, id: string): FoundItem | null {
  for (const section of SECTIONS) {
    const hit = search(view[section], id, []);
    if (hit) return { ...hit, section };
  }
  return null;
}

/** What the sheet can do with a thing (ITEMS-SPEC §8), by the palette action that does it. */
export const ITEM_ACTIONS = [
  { action: "fetch", label: "Fetch", icon: "route" },
  { action: "put_away", label: "Put away", icon: "box" },
  { action: "give_back", label: "Give back", icon: "undo" },
  { action: "hand_over", label: "Hand to…", icon: "user-plus" },
] as const;

/** The palette's option for this thing in each of the sheet's actions that offers one: what its button stages. */
export function itemActions(entries: readonly PaletteEntry[], id: string): { action: (typeof ITEM_ACTIONS)[number]; entry: PaletteEntry; option: PaletteOption }[] {
  return ITEM_ACTIONS.flatMap((action) => {
    const entry = entries.find((e) => e.action === action.action);
    const option = entry?.options.find((o) => o.params.item === id);
    return entry && option ? [{ action, entry, option }] : [];
  });
}

/** The sheet's actions for one thing: a button for each the palette offers it, and for Hand to… the people it offers next. */
function ItemActions(props: { chatId: string; entries: readonly PaletteEntry[]; id: string }) {
  const app = useApp();
  const [busy, run] = useBusy();
  const [choosing, setChoosing] = useState<string | null>(null);
  const offered = itemActions(props.entries, props.id);
  if (offered.length === 0) return null;
  const stage = (entry: PaletteEntry, picks: readonly PaletteOption[]) =>
    run(async () => {
      if ((await app.request(paletteRequest(entry, picks, props.chatId))) !== null) setChoosing(null);
    });
  const open = offered.find((o) => o.action.action === choosing);
  return (
    <Section title="Do with it">
      <div class="lre-stack" data-lre-item-actions>
        <div class="lre-inline">
          {offered.map(({ action, entry, option }) => (
            <Button key={action.action} size="sm" icon={action.icon} busy={busy} disabled={option.disabled !== undefined} title={option.disabled} onClick={() => (option.next ? setChoosing(choosing === action.action ? null : action.action) : stage(entry, [option]))}>
              {action.label}
            </Button>
          ))}
        </div>
        {offered.filter((o) => o.option.disabled !== undefined).map((o) => (
          <span key={o.action.action} class="lre-small lre-muted">
            {o.action.label}: {o.option.disabled}
          </span>
        ))}
        {open?.option.next ? (
          <List>
            {open.option.next.options.map((pick) => (
              <ListRow key={JSON.stringify(pick.params)} icon="user" title={pick.label} subtitle={pick.disabled ?? pick.detail} disabled={pick.disabled !== undefined} chevron onClick={() => stage(open.entry, [open.option, pick])} />
            ))}
          </List>
        ) : null}
      </div>
    </Section>
  );
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
  const { item, section, path } = found;
  const holder = path[path.length - 1];
  const children = item.children ?? [];
  const where = [SECTION_LABEL[section], holder ? `in ${holder.name}` : (item.where ?? null)].filter((part) => part !== null).join(" · ");
  const upper = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
  const loan = item.lent ?? item.borrowed;
  return (
    <div class="lre-stack lre-me" data-lre-sheet-item={item.id}>
      <PageHeader title={item.qty !== undefined && item.qty !== 1 ? `${item.name} ×${item.qty}` : item.name} subtitle={where} onBack={props.close} />
      <IdText id={item.id} />
      {loan?.overdue ? (
        <Banner tone="warn" title="Overdue">
          {item.lent ? `${item.lent.to} hasn't given it back${item.lent.until ? ` (due ${item.lent.until})` : ""}.` : `It should have gone back${item.borrowed?.until ? ` by ${item.borrowed.until}` : ""}.`}
        </Banner>
      ) : null}
      <Section title="Details" flush>
        <List>
          <ListRow icon="pin" title="Where" value={item.as ? `${SECTION_LABEL[section]}, ${AS_LABEL[item.as]}` : SECTION_LABEL[section]} subtitle={holder ? undefined : item.where} />
          {path.map((container) => (
            <ListRow key={container.id} icon="box" title="Inside" subtitle={container.name} chevron onClick={() => props.open({ kind: "item", id: container.id })} />
          ))}
          {item.whose !== undefined ? <ListRow icon="user" title="Whose" value={upper(item.whose)} /> : null}
          {item.why !== undefined ? <ListRow icon="info" title="Why you have it" subtitle={item.why} /> : null}
          {item.kept !== undefined ? <ListRow icon="home" title="Kept at" value={item.kept} /> : null}
          {item.slot ? <ListRow icon="shield" title="Slot" value={item.slot} /> : null}
          {item.qty !== undefined ? <ListRow icon="layers" title="Quantity" value={String(item.qty)} /> : null}
          {item.lent ? <ListRow icon="user-plus" title="Lent out" subtitle={lentText(item.lent)} badge={item.lent.overdue ? <Badge tone="warn">Overdue</Badge> : undefined} /> : null}
          {item.borrowed ? <ListRow icon="user-plus" title="Borrowed" subtitle={borrowedText(item.borrowed)} badge={item.borrowed.overdue ? <Badge tone="warn">Overdue</Badge> : undefined} /> : null}
        </List>
      </Section>
      <ItemActions chatId={props.chatId} entries={props.state.palette?.entries ?? []} id={item.id} />
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
