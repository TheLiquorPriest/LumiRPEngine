// The item sheet: one thing from the Gear view: where it is (and what it's inside), whose it is, why
// you have it and where it is kept (ITEMS-SPEC §10.3), its condition, slot and quantity, a kit's
// pieces, a loan, and its contents with the load; and what you can do with it. In the story: Fetch,
// Put away, Give back and Hand to…, each staged as its palette tap is, from the palette's own
// options for this thing. At once, off screen, for a thing of your own, each with its Undo: Move
// to…, Owner & use…, Rename and Size. A holder of yours is its container page too: its contents
// with Select (Move to…, Put away, Take), Put in from… (things of yours into it, several at once),
// Add here… and Empty into…. Opening the sheet is a player-facing observation of the item (DESIGN
// §9.2), sent once on mount; for a container that may bring its contents into view.

import { useEffect, useState } from "preact/hooks";
import type { ChatId, EntityId } from "../../../shared/ids";
import type { PaletteEntry, PaletteOption, StateView } from "../../../shared/state-view";
import type { WhereChoice } from "../../../shared/thing-view";
import { sizeLabel } from "../../../shared/thing-view";
import { useApp } from "../../../frontend/app";
import { FormSheet } from "../../../frontend/build/form-kit";
import { Badge, Banner, Button, Empty, IdText, List, ListRow, Meter, PageHeader, Section, useBusy } from "../../../frontend/components";
import { PickBox } from "../../../frontend/multi-select";
import type { SheetProps } from "../../../frontend/registry";
import { paletteRequest } from "../../../frontend/requests";
import { toastQueued } from "../../../frontend/queued";
import { AtOnceNotice, thingsFix, useAtOnce, type AtOnce } from "../../../frontend/things/at-once";
import { MoveSheet, thingNames, type MoveThing } from "../../../frontend/things/move-sheet";
import { OwnerUseSheet } from "../../../frontend/things/owner-sheet";
import type { GearItem, GearView } from "../core/view";
import { PlayAddSheet, addPolicy } from "./add-sheet";
import { AS_LABEL, borrowedText, bulkRequest, bulkWords, itemBadge, lentText, ownerThing, RenameSheet, SizeSheet } from "./belongings";
import { playChoices, povOf, type PlayChoices } from "./choices";
import { cannotHold } from "../../../frontend/things/where";
import { decodeGearView, SECTION_LABEL, SECTIONS, type GearSection } from "./panel";

/** Where the sheet found a thing: one of the Gear view's lists by who has it, at home, or here. */
export type FoundIn = GearSection | "home" | "here";

export const FOUND_LABEL: Readonly<Record<FoundIn, string>> = { ...SECTION_LABEL, home: "At home", here: "Here" };

export interface FoundItem {
  item: GearItem;
  /** Where it is: the first of the Gear view's lists that holds it. */
  section: FoundIn;
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

/** An item of the Gear view by id: the list it is in and what holds it; what is at home or here, too. */
export function findItem(view: GearView, id: string): FoundItem | null {
  for (const section of SECTIONS) {
    const hit = search(view[section], id, []);
    if (hit) return { ...hit, section };
  }
  for (const store of view.stored) {
    const hit = search(store.items, id, []);
    if (hit) return { ...hit, section: "home" };
  }
  const here = view.here;
  for (const items of here ? [here.room, here.lying, ...here.inside.map((h) => h.items)] : []) {
    const hit = search(items, id, []);
    if (hit) return { ...hit, section: "here" };
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
    <Section title="In the story">
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

/** A thing as Move to… moves it. */
function moveThing(item: GearItem): MoveThing {
  return { id: item.id, name: item.name, ...(item.size !== undefined ? { size: item.size } : {}) };
}

/** The sheets a thing of your own opens. */
type ItemSheetKind = "move" | "owner" | "rename" | "size" | "put_from" | "add" | "empty" | "move_picked";

/**
 * What Put in from… offers for a holder: the things of yours on you, here and at home that aren't
 * already in it, nor it or what holds it, nor anything it is in; each that it can't take says why.
 */
export function putInCandidates(view: GearView, holder: GearItem, path: readonly GearItem[]): { item: GearItem; why: string | null }[] {
  const skip = new Set([holder.id, ...path.map((p) => p.id), ...(holder.children ?? []).map((c) => c.id)]);
  const out = new Map<string, { item: GearItem; why: string | null }>();
  const walk = (items: readonly GearItem[], inside: boolean): void => {
    for (const item of items) {
      if (item.id === holder.id) continue;
      if (!skip.has(item.id) && !inside && item.mine === true && !out.has(item.id)) {
        const why = holder.holds !== undefined && item.size !== undefined ? cannotHold({ id: holder.id, is: "thing", name: holder.name, path: [], parent: null, holds: holder.holds, vehicle: false, whose: null, presumes: { owners: [], presumed: null, at: null }, secret: false }, item.size) : null;
        out.set(item.id, { item, why });
      }
      walk(item.children ?? [], inside);
    }
  };
  walk([...view.outfit, ...view.carried], false);
  if (view.here) walk([...view.here.room, ...view.here.lying], false);
  walk(view.stored.flatMap((s) => s.items), false);
  return [...out.values()];
}

/** Put in from…: the candidates with a box each, and Put N in. */
function PutInFromSheet(props: { holder: GearItem; candidates: readonly { item: GearItem; why: string | null }[]; busy: boolean; onPut(things: GearItem[]): void; onClose(): void }) {
  const [picked, setPicked] = useState<readonly string[]>([]);
  const things = props.candidates.filter((c) => picked.includes(c.item.id)).map((c) => c.item);
  return (
    <FormSheet
      title={`Put in ${props.holder.name}`}
      subtitle="Things of yours on you, here and at home"
      onClose={props.onClose}
      actions={
        <Button size="sm" variant="primary" disabled={props.busy || things.length === 0} onClick={() => props.onPut(things)}>
          {things.length <= 1 ? "Put it in" : `Put ${things.length} in`}
        </Button>
      }
    >
      {props.candidates.length === 0 ? (
        <Empty icon="box">Nothing of yours could go in it.</Empty>
      ) : (
        <div class="lre-bel-items" role="list" data-lre-put-from={props.holder.id}>
          {props.candidates.map(({ item, why }) => {
            const on = picked.includes(item.id);
            return (
              <div key={item.id} class={on ? "lre-bel-item picked" : "lre-bel-item"} role="listitem">
                <div class="lre-bel-line">
                  <button type="button" class="lre-bel-open" aria-pressed={on} disabled={why !== null} aria-label={`Pick ${item.name}`} onClick={() => setPicked(on ? picked.filter((x) => x !== item.id) : [...picked, item.id])}>
                    <PickBox label={`Pick ${item.name}`} checked={on} />
                    <span class="lre-bel-text">
                      <span class="lre-bel-name">{item.name}</span>
                      <span class="lre-bel-sub">{why ?? (item.size !== undefined ? sizeLabel(item.size) : "")}</span>
                    </span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </FormSheet>
  );
}

/**
 * A thing of your own, changed at once, off screen (each with its Undo, in the notice here): Move
 * to…, Owner & use…, Rename and Size; and for a holder, its contents with Select, Put in from…,
 * Add here… and Empty into….
 */
function ThingControls(props: { chatId: ChatId; item: GearItem; path: readonly GearItem[]; view: GearView; state: StateView; onOpen(id: EntityId): void }) {
  const { item, view, state } = props;
  const atOnce = useAtOnce(props.chatId);
  const [sheet, setSheet] = useState<ItemSheetKind | null>(null);
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<readonly string[]>([]);
  const where = playChoices(view, state);
  const pov = povOf(state);
  const here = state.hud?.place?.id ?? null;
  const children = item.children ?? [];
  const holder = item.holds !== undefined || item.load !== undefined;
  const pickedThings = children.filter((c) => picked.includes(c.id) && c.mine === true);
  const close = (): void => setSheet(null);
  const stopPicking = (): void => {
    setPicking(false);
    setPicked([]);
  };
  const addable = addPolicy(state.controls?.realism.claims ?? null) !== "hidden";
  const holderChoice = where.choices.find((c) => c.id === item.id) ?? null;
  const renamed = (name: string): string => `${item.name} is called ${name} now.`;
  return (
    <>
      <Section title="Change it">
        <div class="lre-stack" data-lre-item-fixes={item.id}>
          <AtOnceNotice done={atOnce.done} busy={atOnce.busy} onUndo={atOnce.undo} onDismiss={atOnce.dismiss} />
          <div class="lre-inline">
            <Button size="sm" icon="pin" disabled={atOnce.busy} onClick={() => setSheet("move")}>
              Move to…
            </Button>
            <Button size="sm" icon="user" disabled={atOnce.busy} onClick={() => setSheet("owner")}>
              Owner & use…
            </Button>
            <Button size="sm" icon="edit" disabled={atOnce.busy} onClick={() => setSheet("rename")}>
              Rename
            </Button>
            <Button size="sm" icon="layers" disabled={atOnce.busy} onClick={() => setSheet("size")}>
              Size
            </Button>
          </div>
          <span class="lre-small lre-muted">Done at once, off screen, each with its Undo. To do it in the story, use the palette or say it.</span>
        </div>
      </Section>
      {holder ? (
        <Section title={`In ${item.name}`} flush aside={children.length > 0 ? <Badge>{children.length}</Badge> : undefined}>
          <div class="lre-stack lre-me-pad" data-lre-container={item.id}>
            {item.load ? <Meter label={`Load ${item.load.used} / ${item.load.capacity} ${item.load.unit}`} value={item.load.used} max={item.load.capacity} tone={item.load.used > item.load.capacity ? "neg" : "accent"} /> : null}
            <div class="lre-inline">
              <Button size="sm" icon="box" disabled={atOnce.busy} onClick={() => setSheet("put_from")}>
                Put in from…
              </Button>
              {addable ? (
                <Button size="sm" icon="plus" disabled={atOnce.busy} onClick={() => setSheet("add")}>
                  Add here…
                </Button>
              ) : null}
              {children.some((c) => c.mine === true) ? (
                <Button size="sm" icon="download" disabled={atOnce.busy} onClick={() => setSheet("empty")}>
                  Empty into…
                </Button>
              ) : null}
              {children.length > 0 ? (
                <Button size="sm" variant={picking ? "primary" : "secondary"} icon={picking ? "check" : "checklist"} onClick={() => (picking ? stopPicking() : setPicking(true))}>
                  {picking ? "Done" : "Select"}
                </Button>
              ) : null}
            </div>
          </div>
          {children.length === 0 ? (
            <Empty icon="box">Nothing seen inside yet.</Empty>
          ) : (
            <div class="lre-bel-items" role="list" aria-label={`In ${item.name}`}>
              {children.map((child) => {
                const on = picked.includes(child.id);
                return (
                  <div key={child.id} class={on ? "lre-bel-item picked" : "lre-bel-item"} role="listitem" data-lre-bel-row={child.id}>
                    <div class="lre-bel-line">
                      <button
                        type="button"
                        class="lre-bel-open"
                        aria-pressed={picking ? on : undefined}
                        disabled={picking && child.mine !== true}
                        aria-label={picking ? `Pick ${child.name}` : `Open ${child.name}`}
                        onClick={() => (picking ? setPicked(on ? picked.filter((x) => x !== child.id) : [...picked, child.id]) : props.onOpen(child.id))}
                      >
                        {picking ? <PickBox label={`Pick ${child.name}`} checked={on} /> : null}
                        <span class="lre-bel-text">
                          <span class="lre-bel-name">{child.qty !== undefined && child.qty !== 1 ? `${child.name} ×${child.qty}` : child.name}</span>
                          {child.children ? <span class="lre-bel-sub">{`${child.children.length} inside`}</span> : null}
                          <IdText id={child.id} />
                        </span>
                        {itemBadge(child)}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {picking ? (
            <div class="lre-selectbar" role="group" aria-label="Picked inside">
              <div class="lre-selectbar-row">
                <span class="lre-selectbar-count">{pickedThings.length === 1 ? "1 selected" : `${pickedThings.length} selected`}</span>
              </div>
              <div class="lre-selectbar-actions">
                <Button size="sm" icon="pin" disabled={atOnce.busy || pickedThings.length === 0} onClick={() => setSheet("move_picked")}>
                  Move to…
                </Button>
                <Button
                  size="sm"
                  icon="home"
                  disabled={atOnce.busy || pickedThings.length === 0}
                  onClick={() => {
                    const request = bulkRequest(props.chatId, "away", pickedThings, here);
                    if (request) atOnce.send(request, bulkWords("away", pickedThings), stopPicking);
                  }}
                >
                  Put away
                </Button>
                <Button
                  size="sm"
                  icon="bag"
                  disabled={atOnce.busy || pickedThings.length === 0 || pov === null}
                  onClick={() => {
                    if (pov === null) return;
                    const words = `You took ${thingNames(pickedThings).names}.`;
                    atOnce.send(thingsFix(props.chatId, pickedThings.map((t) => ({ do: "move", item: t.id, to: { in: pov } })), words), words, stopPicking);
                  }}
                >
                  Take
                </Button>
              </div>
            </div>
          ) : null}
        </Section>
      ) : null}
      <ItemSheets chatId={props.chatId} sheet={sheet} item={item} path={props.path} view={view} state={state} atOnce={atOnce} where={where} holderChoice={holderChoice} pickedThings={pickedThings} renamed={renamed} onClose={close} onPicked={stopPicking} />
    </>
  );
}

/** The sheets ThingControls opens, each sending at once through its `atOnce`. */
function ItemSheets(props: { chatId: ChatId; sheet: ItemSheetKind | null; item: GearItem; path: readonly GearItem[]; view: GearView; state: StateView; atOnce: AtOnce; where: PlayChoices; holderChoice: WhereChoice | null; pickedThings: readonly GearItem[]; renamed(name: string): string; onClose(): void; onPicked(): void }) {
  const { item, view, atOnce, where, chatId } = props;
  const children = (item.children ?? []).filter((c) => c.mine === true);
  switch (props.sheet) {
    case null:
      return null;
    case "move":
      return <MoveSheet chatId={chatId} things={[moveThing(item)]} choices={where.choices} at={where.at} kept={item.kept ?? null} blocked={where.blocked} atOnce={atOnce} onClose={props.onClose} />;
    case "move_picked":
      return <MoveSheet chatId={chatId} things={props.pickedThings.map(moveThing)} choices={where.choices} at={where.at} kept={null} blocked={where.blocked} atOnce={atOnce} onClose={props.onClose} onMoved={props.onPicked} />;
    case "empty":
      return <MoveSheet chatId={chatId} title={`Empty ${item.name} into`} things={children.map(moveThing)} choices={where.choices} at={where.at} kept={null} blocked={where.blocked} atOnce={atOnce} onClose={props.onClose} />;
    case "owner":
      return <OwnerUseSheet chatId={chatId} thing={ownerThing(item, where.at.pov, view.household)} people={view.people} loans={view.loans} household={view.household} onClose={props.onClose} />;
    case "rename":
      return <RenameSheet item={item} busy={atOnce.busy} onClose={props.onClose} onRename={(name) => atOnce.send(thingsFix(chatId, [{ do: "label", item: item.id, name }], props.renamed(name)), props.renamed(name), props.onClose)} />;
    case "size":
      return (
        <SizeSheet
          things={[item]}
          onClose={props.onClose}
          onPick={(size) => {
            const words = `${item.name} is ${sizeLabel(size)} now.`;
            atOnce.send(thingsFix(chatId, [{ do: "size", item: item.id, size }], words), words, props.onClose);
          }}
        />
      );
    case "put_from":
      return (
        <PutInFromSheet
          holder={item}
          candidates={putInCandidates(view, item, props.path)}
          busy={atOnce.busy}
          onClose={props.onClose}
          onPut={(things) => {
            const words = `${thingNames(things).names} ${things.length === 1 ? "is" : "are"} in ${item.name} now.`;
            atOnce.send(thingsFix(chatId, things.map((t) => ({ do: "move", item: t.id, to: { in: item.id } })), words), words, props.onClose);
          }}
        />
      );
    case "add":
      return <PlayAddSheet chatId={chatId} state={props.state} view={view} start={{ at: props.holderChoice }} atOnce={atOnce} onClose={props.onClose} />;
  }
}

export function ItemSheet(props: SheetProps) {
  const app = useApp();
  const [nothingMore, setNothingMore] = useState(false);
  useEffect(() => {
    setNothingMore(false);
    void app.request({ type: "lre.view.open", chatId: props.chatId, panel: "gear.gear", entity: props.id }).then((result) => {
      if (!toastQueued(app, result) && result && !result.materialized) setNothingMore(true);
    });
  }, [props.chatId, props.id]);
  const view = decodeGearView(props.state.panels["gear.gear"]);
  const found = view ? findItem(view, props.id) : null;
  if (!found || !view) {
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
  const where = [FOUND_LABEL[section], holder ? `in ${holder.name}` : (item.where ?? null)].filter((part) => part !== null).join(" · ");
  const upper = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
  const loan = item.lent ?? item.borrowed;
  const mine = item.mine === true;
  const container = item.holds !== undefined || item.load !== undefined;
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
          <ListRow icon="pin" title="Where" value={item.as ? `${FOUND_LABEL[section]}, ${AS_LABEL[item.as]}` : FOUND_LABEL[section]} subtitle={holder ? undefined : item.where} />
          {path.map((c) => (
            <ListRow key={c.id} icon="box" title="Inside" subtitle={c.name} chevron onClick={() => props.open({ kind: "item", id: c.id })} />
          ))}
          {item.whose !== undefined ? <ListRow icon="user" title="Whose" value={upper(item.whose)} /> : null}
          {item.why !== undefined ? <ListRow icon="info" title="Why you have it" subtitle={item.why} /> : null}
          {item.kept !== undefined ? <ListRow icon="home" title="Kept at" value={item.kept} /> : null}
          {item.slot ? <ListRow icon="shield" title="Slot" value={item.slot} /> : null}
          {item.size !== undefined ? <ListRow icon="box" title="Size" value={sizeLabel(item.size)} /> : null}
          {item.qty !== undefined ? <ListRow icon="layers" title="Quantity" value={String(item.qty)} /> : null}
          {item.lent ? <ListRow icon="user-plus" title="Lent out" subtitle={lentText(item.lent)} badge={item.lent.overdue ? <Badge tone="warn">Overdue</Badge> : undefined} /> : null}
          {item.borrowed ? <ListRow icon="user-plus" title="Borrowed" subtitle={borrowedText(item.borrowed)} badge={item.borrowed.overdue ? <Badge tone="warn">Overdue</Badge> : undefined} /> : null}
        </List>
      </Section>
      <ItemActions chatId={props.chatId} entries={props.state.palette?.entries ?? []} id={item.id} />
      {mine ? <ThingControls chatId={props.chatId} item={item} path={path} view={view} state={props.state} onOpen={(id) => props.open({ kind: "item", id })} /> : null}
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
      {!(mine && container) && (item.load || children.length > 0) ? (
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
