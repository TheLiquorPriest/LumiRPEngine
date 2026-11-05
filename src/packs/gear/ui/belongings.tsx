// Play → Me → Belongings (ITEMS-SPEC §10.3; DESIGN §12), phone first at 390 px: everything the player
// character wears, carries and keeps, changed at once, off screen, each change one ✎ fix with its
// Undo in the notice over the list (the palette's taps and typed words stay the story's).
//  - Top: search, the filter chips (All · Wearing · Carried · Arsenal · Home · Here · Lent), Select
//    and + Add (none under Hold me to the world).
//  - The outfit bar (Gear 3): the saved outfit worn now; its sheet changes into one in a tap.
//  - Sections: Wearing (by slot; a weapon Ready or Stow), Carried (bags open inline with their
//    load), Here, Home storage (what is at home, by what keeps it), Elsewhere, Lent and borrowed,
//    and Vehicles (n), which opens the Garage.
//  - A row: two lines, one main verb (Wear, Take off, Ready, Stow, Put in, Take, Take back or Give
//    back) and ⋯ for Move to…, Put away, Drop, Owner & use…, Rename and Size.
//  - Select: a tap picks a row; the bar moves, puts away, wears or takes off, gives or lends what
//    is picked, as one ✎ fix with one Undo.
// The model (sections, search, verbs, requests) is pure; the rows and the bar are hook-free.

import { useMemo, useState } from "preact/hooks";
import type { ChatId, EntityId, PlaceId } from "../../../shared/ids";
import { FIX_THINGS_MAX } from "../../../shared/protocol";
import type { StateView } from "../../../shared/state-view";
import type { ItemFix, Size } from "../../../shared/things";
import { SIZE_LABELS, THING_NAME_MAX } from "../../../shared/things";
import type { LoanChoice } from "../../../shared/thing-gm";
import { sizeLabel } from "../../../shared/thing-view";
import { pushSheet, showPanel, useApp } from "../../../frontend/app";
import { OverflowMenu, type MenuItem } from "../../../frontend/build/chrome";
import { FormSheet } from "../../../frontend/build/form-kit";
import { wordsOf } from "../../../frontend/character/places";
import { Badge, Button, Empty, HostSelect, IdText, List, ListRow, Meter, Section, Seg } from "../../../frontend/components";
import { Icon } from "../../../frontend/icons";
import { PickBox, SelectBar, useSelection, type Selection } from "../../../frontend/multi-select";
import type { Req } from "../../../frontend/requests";
import { AtOnceNotice, thingsFix, useAtOnce, type ThingsFixRequest } from "../../../frontend/things/at-once";
import { MoveSheet, thingNames, type MoveThing } from "../../../frontend/things/move-sheet";
import { OwnerUseSheet, type OwnerUseThing } from "../../../frontend/things/owner-sheet";
import { SizeChoices } from "../../../frontend/things/what-it-is";
import type { WornAs } from "../core/feed";
import type { GearHolder, GearItem, GearView } from "../core/view";
import { addPolicy, PlayAddSheet } from "./add-sheet";
import { playChoices, povOf } from "./choices";
import { outfitBarText, SetsSheet } from "./sets-sheet";

// ---------------------------------------------------------------- the model

export const FILTERS = ["all", "wearing", "carried", "arsenal", "home", "here", "lent"] as const;
export type BelongingsFilter = (typeof FILTERS)[number];

export const FILTER_LABEL: Readonly<Record<BelongingsFilter, string>> = { all: "All", wearing: "Wearing", carried: "Carried", arsenal: "Arsenal", home: "Home", here: "Here", lent: "Lent" };

/** The filters a Gear level offers: Wearing only where slots are tracked (Gear 3). */
export function filtersAt(level: number): BelongingsFilter[] {
  return FILTERS.filter((f) => f !== "wearing" || level >= 3);
}

/** Where a row is, which decides its verbs. */
export type RowAt = "wearing" | "carried" | "here" | "home" | "elsewhere" | "lent" | "borrowed";

/** Rows under one heading of a section: a holder at home, what is in the room here, what is lent out. */
export interface RowGroup {
  key: string;
  title?: string;
  sub?: string;
  at: RowAt;
  items: GearItem[];
}

export type SectionKey = "wearing" | "carried" | "arsenal" | "here" | "home" | "elsewhere" | "lent";

export interface BelongingsSection {
  key: SectionKey;
  title: string;
  groups: RowGroup[];
  /** What it says with nothing in it; a section without one is left out when empty. */
  empty?: string;
}

/** The categories the Arsenal chip shows (DESIGN §28.16, descriptive only). */
const ARSENAL: Readonly<Record<string, true>> = { weapon: true, armor: true, ammo: true };

/** Whether a thing is of the arsenal: a weapon, armor or ammunition. */
export function inArsenal(item: GearItem): boolean {
  return item.category !== undefined && ARSENAL[item.category] === true;
}

/** A thing and everything in it, depth first. */
function flat(items: readonly GearItem[]): GearItem[] {
  return items.flatMap((i) => [i, ...flat(i.children ?? [])]);
}

/** A thing's ids and every id in it. */
function idsIn(items: readonly GearItem[]): string[] {
  return flat(items).map((i) => i.id);
}

/** The arsenal among some things, each as a row of its own (a magazine in a bag shows by itself), what is in it kept under it. */
function arsenalOf(items: readonly GearItem[]): GearItem[] {
  return flat(items).filter(inArsenal);
}

/**
 * The sections a filter shows. All: every section with something in it (Wearing and Carried
 * always, Wearing from Gear 3); a chip: its own section, saying so when it is empty. Arsenal lists
 * the weapons, armor and ammunition worn, carried and at home, each by itself.
 */
export function belongingsSections(view: GearView, filter: BelongingsFilter): BelongingsSection[] {
  const here = view.here;
  const atHome = new Set(view.stored.flatMap((s) => idsIn(s.items)));
  const hereIds = new Set(here ? idsIn([...here.room, ...here.lying, ...here.inside.flatMap((h) => h.items)]) : []);
  const wearing: BelongingsSection = { key: "wearing", title: "Wearing", groups: [{ key: "wearing", at: "wearing", items: view.outfit }], empty: "You wear nothing the story keeps track of." };
  const carried: BelongingsSection = { key: "carried", title: "Carried", groups: [{ key: "carried", at: "carried", items: view.carried }], empty: "You carry nothing." };
  const hereSection: BelongingsSection = {
    key: "here",
    title: here ? `Here · ${here.place}` : "Here",
    groups: here ? [{ key: "room", title: "In the room", at: "here", items: here.room }, { key: "lying", title: "Lying here", at: "here", items: here.lying }, ...here.inside.map((h): RowGroup => ({ key: `in:${h.holder.id}`, title: `In ${h.holder.name}`, at: "here", items: h.items }))] : [],
    ...(filter === "here" ? { empty: here ? "Nothing you can see lies here." : "You are nowhere you can see." } : {}),
  };
  const home: BelongingsSection = {
    key: "home",
    title: view.home ? `Home storage · ${view.home.name}` : "Home storage",
    groups: view.stored.map((s, i): RowGroup => ({ key: s.holder ? `holder:${s.holder.id}` : `loose:${i}`, title: s.holder ? s.holder.name : "Loose at home", sub: s.where, at: "home", items: s.items })),
    ...(filter === "home" ? { empty: view.home ? "Nothing of yours is kept at home." : "You have no home in this world." } : {}),
  };
  // What is yours elsewhere that is neither at home nor here.
  const elsewhere: BelongingsSection = { key: "elsewhere", title: "Elsewhere", groups: [{ key: "elsewhere", at: "elsewhere", items: view.elsewhere.filter((i) => !atHome.has(i.id) && !hereIds.has(i.id)) }] };
  const lent: BelongingsSection = {
    key: "lent",
    title: "Lent and borrowed",
    groups: [
      { key: "lent", title: "Lent out", at: "lent", items: view.lent },
      { key: "borrowed", title: "Borrowed", at: "borrowed", items: view.borrowed },
    ],
    ...(filter === "lent" ? { empty: "Nothing lent out or borrowed." } : {}),
  };
  switch (filter) {
    case "wearing":
      return [wearing];
    case "carried":
      return [carried];
    case "here":
      return [hereSection];
    case "home":
      return [home];
    case "lent":
      return [lent];
    case "arsenal":
      return [
        {
          key: "arsenal",
          title: "Arsenal",
          groups: [
            { key: "worn", title: "Wearing", at: "wearing", items: arsenalOf(view.outfit) },
            { key: "carried", title: "Carried", at: "carried", items: arsenalOf(view.carried) },
            { key: "home", title: "At home", at: "home", items: arsenalOf(view.stored.flatMap((s) => s.items)) },
          ],
          empty: "No weapons, armor or ammunition.",
        },
      ];
    case "all":
      return [...(view.level >= 3 ? [wearing] : []), carried, hereSection, home, elsewhere, lent];
  }
}

/** Whether a name has every word of a query, each a word's beginning. */
function named(name: string, want: readonly string[]): boolean {
  const words = wordsOf(name);
  return want.every((q) => words.some((w) => w.startsWith(q)));
}

/** A tree cut to what a search finds: a thing named so, whole; else only what in it is. */
export function searchItems(items: readonly GearItem[], want: readonly string[]): GearItem[] {
  if (want.length === 0) return [...items];
  return items.flatMap((item) => {
    if (named(item.name, want)) return [item];
    const inside = searchItems(item.children ?? [], want);
    return inside.length > 0 ? [{ ...item, children: inside }] : [];
  });
}

/** The sections a search leaves: each group cut to what it finds, an empty group or section left out (all of them, with nothing found). */
export function searchSections(sections: readonly BelongingsSection[], query: string): BelongingsSection[] {
  const want = wordsOf(query);
  if (want.length === 0) return [...sections];
  return sections.flatMap((s) => {
    const groups = s.groups.map((g) => ({ ...g, items: searchItems(g.items, want) })).filter((g) => g.items.length > 0);
    return groups.length > 0 ? [{ ...s, groups, empty: undefined }] : [];
  });
}

/** How many things a section shows at its top level. */
export function sectionCount(section: BelongingsSection): number {
  return section.groups.reduce((n, g) => n + g.items.length, 0);
}

/** Every thing the sections show, by id, with where it is: the first section that shows it. */
export function rowIndex(sections: readonly BelongingsSection[]): Map<string, { item: GearItem; at: RowAt }> {
  const out = new Map<string, { item: GearItem; at: RowAt }>();
  for (const s of sections) for (const g of s.groups) for (const item of flat(g.items)) if (!out.has(item.id)) out.set(item.id, { item, at: g.at });
  return out;
}

// ---------------------------------------------------------------- verbs

/** What a row's button or ⋯ does. */
export type RowAction = "wear" | "take_off" | "ready" | "stow" | "put_in" | "take" | "take_back" | "give_back" | "move" | "away" | "drop" | "owner" | "rename" | "size";

export const ACTION_LABEL: Readonly<Record<RowAction, string>> = {
  wear: "Wear",
  take_off: "Take off",
  ready: "Ready",
  stow: "Stow",
  put_in: "Put in",
  take: "Take",
  take_back: "Take back",
  give_back: "Give back",
  move: "Move to…",
  away: "Put away",
  drop: "Drop",
  owner: "Owner & use…",
  rename: "Rename",
  size: "Size",
};

/** A weapon readies in hand and stows back in its own slot (its holster, sheath, quiver). */
export function readies(item: GearItem): boolean {
  return item.category === "weapon" && item.wearable === true;
}

/** What a row's context adds to its verbs: the Gear level, and whether there is anything to put a thing in. */
export interface VerbCtx {
  level: number;
  canPutIn: boolean;
  /** Where the player character is: Drop puts a thing down there. */
  here: PlaceId | null;
}

/**
 * A row's one main verb: Take off what is worn (a weapon: Ready from its holster, Stow from the
 * hand); Wear what can be (a weapon carried: Ready), else Put in; Take what is here; Wear or Take
 * what is at home; Take back what is lent out and Give back what is borrowed; none for someone
 * else's thing, or one elsewhere.
 */
export function mainVerb(item: GearItem, at: RowAt, ctx: VerbCtx): RowAction | null {
  if (at === "borrowed") return "give_back";
  if (at === "lent") return "take_back";
  if (item.mine !== true) return null;
  const worn = ctx.level >= 3 && item.wearable === true;
  switch (at) {
    case "wearing":
      return readies(item) ? (item.as === "hand" ? "stow" : "ready") : "take_off";
    case "carried":
      return worn ? (readies(item) ? "ready" : "wear") : ctx.canPutIn ? "put_in" : null;
    case "here":
      return "take";
    case "home":
      return worn ? "wear" : "take";
    case "elsewhere":
      return null;
  }
}

/** The ⋯ menu's actions for a row, the main verb left out: Move to…, Put away, Drop (what is on you, with somewhere to drop it), the wear verbs it hasn't, Owner & use…, Rename and Size. */
export function rowActions(item: GearItem, at: RowAt, ctx: VerbCtx): RowAction[] {
  if (item.mine !== true) return [];
  const main = mainVerb(item, at, ctx);
  const onYou = at === "wearing" || at === "carried";
  const wearVerbs: RowAction[] = ctx.level < 3 || item.wearable !== true ? [] : at === "wearing" ? (readies(item) ? ["stow", "ready", "take_off"] : ["take_off"]) : readies(item) ? ["ready", "wear"] : ["wear"];
  const all: RowAction[] = ["move", ...(ctx.canPutIn && onYou ? (["put_in"] as const) : []), "away", ...(onYou && ctx.here !== null ? (["drop"] as const) : []), ...wearVerbs, "owner", "rename", "size"];
  return [...new Set(all)].filter((a) => a !== main && !(a === "stow" && item.as !== "hand") && !(a === "ready" && item.as === "hand"));
}

/** The fix a one-tap verb makes, or null for one that opens a sheet or is an action. */
export function verbFix(action: RowAction, item: GearItem, ctx: { pov: EntityId | null; here: PlaceId | null }): ItemFix | null {
  switch (action) {
    case "wear":
    case "stow":
      return { do: "wear", item: item.id };
    case "take_off":
      return { do: "wear", item: item.id, off: true };
    case "ready":
      return { do: "wear", item: item.id, slot: "hand_held" };
    case "take":
      return ctx.pov !== null ? { do: "move", item: item.id, to: { in: ctx.pov } } : null;
    case "drop":
      return ctx.here !== null ? { do: "move", item: item.id, to: { place: ctx.here } } : null;
    case "away":
      return { do: "away", item: item.id };
    default:
      return null;
  }
}

/** What a one-tap verb did, as the notice says it. */
export function verbWords(action: RowAction, name: string): string {
  switch (action) {
    case "wear":
      return `You put on ${name}.`;
    case "take_off":
      return `You took off ${name}; you still have it.`;
    case "ready":
      return `${name} is ready in your hand.`;
    case "stow":
      return `You stowed ${name}.`;
    case "take":
      return `You took ${name}.`;
    case "drop":
      return `You put ${name} down here.`;
    case "away":
      return `${name} is put away where it is kept.`;
    case "take_back":
      return `You took back ${name}.`;
    case "give_back":
      return `You gave ${name} back.`;
    default:
      return name;
  }
}

/** The gear action Take back and Give back send at once, off screen (the hand-overs, told). */
export function handoverRequest(chatId: ChatId, action: "reclaim" | "give_back", item: EntityId): Req<"lre.action"> {
  return { type: "lre.action", chatId, action, params: { item }, source: "palette", offstage: true };
}

/** The one request a one-tap verb sends, or null for one that opens a sheet. */
export function verbRequest(chatId: ChatId, action: RowAction, item: GearItem, ctx: { pov: EntityId | null; here: PlaceId | null }): Req<"lre.action"> | Req<"lre.fix"> | null {
  if (action === "take_back") return handoverRequest(chatId, "reclaim", item.id);
  if (action === "give_back") return handoverRequest(chatId, "give_back", item.id);
  const fix = verbFix(action, item, ctx);
  return fix ? thingsFix(chatId, [fix], verbWords(action, item.name)) : null;
}

/** What a picked thing is for the bar: the thing and where its row is. */
export interface Picked {
  item: GearItem;
  at: RowAt;
}

/** The bar's Wear or Take off for what is picked: Take off when every one is worn, else Wear what can be worn and isn't; null when neither. */
export function wearToggle(picked: readonly Picked[], level: number): { action: "wear" | "take_off"; things: GearItem[] } | null {
  if (level < 3 || picked.length === 0) return null;
  if (picked.every((p) => p.at === "wearing")) return { action: "take_off", things: picked.map((p) => p.item) };
  const wear = picked.filter((p) => p.at !== "wearing" && p.item.wearable === true).map((p) => p.item);
  return wear.length > 0 ? { action: "wear", things: wear } : null;
}

/** A bulk change in a sentence: "Backpack, Flashlight and Rope are put away, each where it is kept." */
export function bulkWords(action: "wear" | "take_off" | "away" | "drop", things: readonly { name: string }[]): string {
  const { names, many } = thingNames(things);
  switch (action) {
    case "wear":
      return `You put on ${names}.`;
    case "take_off":
      return `You took off ${names}; you still have ${many ? "them" : "it"}.`;
    case "away":
      return many ? `${names} are put away, each where it is kept.` : `${names} is put away where it is kept.`;
    case "drop":
      return `You put ${names} down here.`;
  }
}

/** The one request a bulk change sends: a fix a thing, all in one `lre.fix` with one Undo. */
export function bulkRequest(chatId: ChatId, action: "wear" | "take_off" | "away" | "drop", things: readonly GearItem[], here: PlaceId | null): ThingsFixRequest | null {
  const fixes = things.flatMap((t): ItemFix[] => (action === "wear" ? [{ do: "wear", item: t.id }] : action === "take_off" ? [{ do: "wear", item: t.id, off: true }] : action === "away" ? [{ do: "away", item: t.id }] : here !== null ? [{ do: "move", item: t.id, to: { place: here } }] : []));
  return fixes.length === 0 || fixes.length > FIX_THINGS_MAX ? null : thingsFix(chatId, fixes, bulkWords(action, things));
}

/** Owner & use…'s view of a thing of the player's: whose it is now (theirs, the household's, nobody's or someone else's), who may use it and its grants. */
export function ownerThing(item: GearItem, pov: EntityId | null, household: GearHolder | null): OwnerUseThing {
  const id = item.ownerId ?? null;
  const owner = id === null ? "nobody" : id === pov ? "self" : household !== null && id === household.id ? "household" : "other";
  return { id: item.id, name: item.name, owner, ...(owner === "other" && item.whose !== undefined ? { ownerName: item.whose.replace(/'s?$/, "") } : {}), use: item.use ?? [], grants: item.grants ?? [] };
}

// ---------------------------------------------------------------- rows

/** How a thing is on you, as its row says it. */
export const AS_LABEL: Readonly<Record<WornAs, string>> = { worn: "worn", pocket: "in a pocket", hand: "in hand" };

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

/** What every row shares: the context of its verbs, the Gear level, choosing, what is picked and open, and what it does. */
export interface RowCtx extends VerbCtx {
  busy: boolean;
  picking: boolean;
  picked: ReadonlySet<string>;
  open: ReadonlySet<string>;
  onToggle(id: string): void;
  onPick(id: string): void;
  onOpen(id: string): void;
  onAction(action: RowAction, item: GearItem, at: RowAt): void;
}

/** A row's second line: how it is on you or its slot, whose it is when it isn't yours, where it is, a loan. */
export function rowSub(item: GearItem, at: RowAt): string {
  const whose = item.whose !== undefined && item.whose !== "yours" && !item.lent && !item.borrowed ? item.whose : null;
  const how = item.as ? AS_LABEL[item.as] : null;
  const parts = [at === "wearing" ? (item.slot ?? null) : null, how !== "worn" ? how : null, whose, at === "elsewhere" || at === "lent" || at === "borrowed" ? (item.where ?? null) : null, item.lent ? lentText(item.lent) : null, item.borrowed ? borrowedText(item.borrowed) : null, item.kit && !item.kit.complete && item.kit.missing.length > 0 ? `missing ${item.kit.missing.join(", ")}` : null];
  return parts.filter((p): p is string => p !== null && p !== "").join(" · ");
}

/** One thing as a row: its two lines, its main verb and ⋯; a bag's load under it and, open, what is in it; while choosing, its box. Hook-free. */
export function BelongingsRow(props: { item: GearItem; at: RowAt; depth: number; ctx: RowCtx }) {
  const { item, at, ctx } = props;
  const children = item.children ?? [];
  const open = ctx.open.has(item.id);
  const main = ctx.picking ? null : mainVerb(item, at, ctx);
  const more = ctx.picking ? [] : rowActions(item, at, ctx);
  const pickable = ctx.picking && item.mine === true;
  const picked = ctx.picked.has(item.id);
  const sub = rowSub(item, at);
  const title = item.qty !== undefined && item.qty !== 1 ? `${item.name} ×${item.qty}` : item.name;
  const menu: MenuItem[] = more.map((action) => ({ label: ACTION_LABEL[action], disabled: ctx.busy, onSelect: () => ctx.onAction(action, item, at) }));
  return (
    <div class={picked ? "lre-bel-item picked" : "lre-bel-item"} role="listitem" data-lre-bel-row={item.id} data-lre-bel-at={at}>
      <div class="lre-bel-line" style={{ "--lre-depth": String(Math.min(props.depth, 4)) }}>
        {children.length > 0 ? <button type="button" class="lre-iconbtn ghost" aria-expanded={open} aria-label={`${open ? "Close" : "Open"} ${item.name}`} title={`${open ? "Close" : "Open"} ${item.name}`} onClick={() => ctx.onToggle(item.id)}><Icon name={open ? "chevron-down" : "chevron-right"} /></button> : <span class="lre-bel-gap" aria-hidden="true" />}
        <button type="button" class="lre-bel-open" aria-pressed={ctx.picking ? picked : undefined} disabled={ctx.picking && !pickable} aria-label={ctx.picking ? `Pick ${item.name}` : `Open ${item.name}`} onClick={() => (ctx.picking ? ctx.onPick(item.id) : ctx.onOpen(item.id))}>
          {ctx.picking ? <PickBox label={`Pick ${item.name}`} checked={picked} /> : null}
          <span class="lre-bel-text">
            <span class="lre-bel-name">{title}</span>
            {sub !== "" ? <span class="lre-bel-sub">{sub}</span> : null}
            <IdText id={item.id} />
          </span>
          {itemBadge(item)}
        </button>
        {main ? (
          <Button size="sm" variant="secondary" disabled={ctx.busy} onClick={() => ctx.onAction(main, item, at)}>
            {ACTION_LABEL[main]}
          </Button>
        ) : null}
        {menu.length > 0 ? <OverflowMenu label={`More for ${item.name}`} items={menu} disabled={ctx.busy} /> : null}
      </div>
      {item.load && (at === "carried" || at === "wearing" || at === "home") ? (
        <div class="lre-bel-load" style={{ "--lre-depth": String(Math.min(props.depth, 4)) }}>
          <Meter label={`${item.load.used} of ${item.load.capacity} l`} value={item.load.used} max={item.load.capacity} tone={item.load.used > item.load.capacity ? "neg" : "accent"} />
        </div>
      ) : null}
      {open && children.length > 0 ? (
        <div class="lre-bel-tree" role="list" aria-label={`In ${item.name}`}>
          {children.map((child) => (
            <BelongingsRow key={child.id} item={child} at={at} depth={props.depth + 1} ctx={ctx} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** The sections, each its groups of rows; a section with nothing says so, or is left out. Hook-free. */
export function BelongingsList(props: { sections: readonly BelongingsSection[]; ctx: RowCtx }) {
  return (
    <>
      {props.sections.map((s) => {
        const count = sectionCount(s);
        if (count === 0 && s.empty === undefined) return null;
        return (
          <Section key={s.key} title={s.title} aside={count > 0 ? <Badge>{count}</Badge> : undefined} flush>
            {count === 0 ? (
              <Empty icon="bag">{s.empty}</Empty>
            ) : (
              <div class="lre-bel-groups" data-lre-bel-section={s.key}>
                {s.groups
                  .filter((g) => g.items.length > 0)
                  .map((g) => (
                    <div key={g.key} class="lre-bel-group" data-lre-bel-group={g.key}>
                      {g.title !== undefined ? (
                        <div class="lre-bel-group-head">
                          {g.title}
                          {g.sub ? <span class="lre-bel-group-sub"> · {g.sub}</span> : null}
                        </div>
                      ) : null}
                      <div class="lre-bel-items" role="list" aria-label={g.title ?? s.title}>
                        {g.items.map((item) => (
                          <BelongingsRow key={item.id} item={item} at={g.at} depth={0} ctx={props.ctx} />
                        ))}
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </Section>
        );
      })}
    </>
  );
}

/** The filter chips, one pressed, in a row that scrolls sideways at 390 px. Hook-free. */
export function FilterChips(props: { filters: readonly BelongingsFilter[]; value: BelongingsFilter; onPick(filter: BelongingsFilter): void }) {
  return (
    <div class="lre-bel-chips" role="group" aria-label="Show">
      {props.filters.map((f) => (
        <button key={f} type="button" class="lre-bel-chip" aria-pressed={props.value === f} data-lre-bel-filter={f} onClick={() => props.onPick(f)}>
          {FILTER_LABEL[f]}
        </button>
      ))}
    </div>
  );
}

/** The outfit bar (Gear 3): the saved outfit worn now, which opens Outfits & loadouts. Hook-free. */
export function OutfitBar(props: { view: GearView; onOpen(): void }) {
  if (props.view.level < 3) return null;
  return (
    <button type="button" class="lre-bel-outfit" data-lre-outfit-bar="" onClick={props.onOpen}>
      <Icon name="layers" size={16} />
      <span class="lre-bel-outfit-label">Outfit</span>
      <span class="lre-bel-outfit-name">{outfitBarText(props.view)}</span>
      <Icon name="chevron-right" size={16} class="lre-me-chev" />
    </button>
  );
}

/** The bar's bulk actions, by what is picked. */
export type BulkSheet = "move" | "give" | "size";

/**
 * The bar under Belongings while it chooses: how many are picked, Select all and Clear, and Move
 * to…, Put away, Wear or Take off, Give/Lend… and More (Drop here, Size…), each one ✎ fix of
 * every thing picked with one Undo. Hook-free.
 */
export function BelongingsBar(props: { selection: Selection; all: readonly string[]; shown: readonly string[]; picked: readonly Picked[]; level: number; here: PlaceId | null; people: number; busy: boolean; onBulk(action: "wear" | "take_off" | "away" | "drop"): void; onSheet(sheet: BulkSheet): void }) {
  const n = props.picked.length;
  const over = n > FIX_THINGS_MAX;
  const off = props.busy || n === 0 || over;
  const wear = wearToggle(props.picked, props.level);
  const more: MenuItem[] = [
    { label: "Drop here", disabled: off || props.here === null, onSelect: () => props.onBulk("drop") },
    { label: "Size…", disabled: off, onSelect: () => props.onSheet("size") },
  ];
  return (
    <SelectBar label="Things picked" selection={props.selection} all={props.all} shown={props.shown}>
      {over ? <span class="lre-small lre-muted" data-lre-bel-over="">{`One change holds at most ${FIX_THINGS_MAX} things: pick fewer.`}</span> : null}
      <Button size="sm" icon="pin" disabled={off} onClick={() => props.onSheet("move")}>
        Move to…
      </Button>
      <Button size="sm" icon="home" disabled={off} onClick={() => props.onBulk("away")}>
        Put away
      </Button>
      <Button size="sm" icon="shield" disabled={off || wear === null} onClick={() => wear && props.onBulk(wear.action)}>
        {wear?.action === "take_off" ? "Take off" : "Wear"}
      </Button>
      <Button size="sm" icon="user-plus" disabled={off || props.people === 0} title={props.people === 0 ? "Nobody is here" : undefined} onClick={() => props.onSheet("give")}>
        Give/Lend…
      </Button>
      <OverflowMenu label="More for what is picked" items={more} disabled={off} />
    </SelectBar>
  );
}

// ---------------------------------------------------------------- the small sheets

/** Rename: a thing's name, as the story will call it from now on. */
export function RenameSheet(props: { item: GearItem; busy: boolean; onRename(name: string): void; onClose(): void }) {
  const [name, setName] = useState(props.item.name);
  const trimmed = name.trim();
  return (
    <FormSheet
      title="Rename"
      subtitle={props.item.name}
      onClose={props.onClose}
      actions={
        <Button size="sm" variant="primary" disabled={props.busy || trimmed === "" || trimmed === props.item.name} onClick={() => props.onRename(trimmed)}>
          Rename
        </Button>
      }
    >
      <label class="lre-field">
        <span class="label">Name</span>
        <input class="lre-input" value={name} maxLength={THING_NAME_MAX} onInput={(event) => setName(event.currentTarget.value)} />
        <span class="lre-field-help">What it is called from now on; the story keeps calling it by its old name too.</span>
      </label>
    </FormSheet>
  );
}

/** Size: how big one thing or every thing picked is, in words. */
export function SizeSheet(props: { things: readonly GearItem[]; onPick(size: Size): void; onClose(): void }) {
  const one = props.things.length === 1 ? props.things[0] : undefined;
  return (
    <FormSheet title="Size" subtitle={thingNames(props.things).names} onClose={props.onClose}>
      <div class="lre-stack">
        <span class="lre-small lre-muted">{one?.size !== undefined ? `Now ${sizeLabel(one.size)}. ` : ""}What you can't carry (Heavy or bigger) is put down where it belongs on the next turn.</span>
        <SizeChoices value={null} onPick={props.onPick} />
      </div>
    </FormSheet>
  );
}

/** Give/Lend… for the things picked: to someone here, as a gift, a loan until an end, or to hold for you; the story hears of it. */
function GiveSheet(props: { things: readonly GearItem[]; people: readonly GearHolder[]; loans: readonly LoanChoice[]; busy: boolean; onHand(to: GearHolder, basis: "gift" | "loan" | "hold", until?: LoanChoice): void; onClose(): void }) {
  const [basis, setBasis] = useState<"gift" | "loan" | "hold">("loan");
  const [loan, setLoan] = useState(0);
  const until = props.loans[loan];
  return (
    <FormSheet title="Give or lend" subtitle={thingNames(props.things).names} onClose={props.onClose}>
      <div class="lre-stack" data-lre-bel-give="">
        <Seg<"gift" | "loan" | "hold">
          label="As"
          value={basis}
          options={[
            { value: "loan", label: "Lend", title: "Theirs to use for a while" },
            { value: "gift", label: "Give", title: "Theirs for keeps" },
            { value: "hold", label: "To hold", title: "They hold it for you" },
          ]}
          onChange={setBasis}
        />
        {basis === "loan" && props.loans.length > 0 ? <HostSelect label="Until" value={String(loan)} options={props.loans.map((l, i) => ({ value: String(i), label: l.label }))} onChange={(next) => setLoan(Number(next))} /> : null}
        <List>
          {props.people.map((p) => (
            <ListRow key={p.id} icon="user" title={p.name} chevron disabled={props.busy || (basis === "loan" && !until)} onClick={() => props.onHand(p, basis, basis === "loan" ? until : undefined)} />
          ))}
        </List>
        <span class="lre-field-help">Done at once, off screen; the story hears of it.</span>
      </div>
    </FormSheet>
  );
}

/** What a handover of many says. */
function handManyWords(things: readonly GearItem[], to: string, basis: "gift" | "loan" | "hold", until?: LoanChoice): string {
  const { names, many } = thingNames(things);
  if (basis === "gift") return `${names} ${many ? "are" : "is"} ${to}'s now, a gift.`;
  if (basis === "loan") return `${to} has ${names} on loan${until ? `, ${until.label.charAt(0).toLowerCase()}${until.label.slice(1)}` : ""}.`;
  return `${to} is holding ${names} for you.`;
}

// ---------------------------------------------------------------- the panel

type BelSheet = { kind: "move"; ids: EntityId[] } | { kind: "put"; id: EntityId } | { kind: "owner"; id: EntityId } | { kind: "rename"; id: EntityId } | { kind: "size"; ids: EntityId[] } | { kind: "give"; ids: EntityId[] } | { kind: "add" } | { kind: "sets" };

/** The bags that open by themselves: what is carried or worn with a few things in it. */
function openAtFirst(view: GearView): Set<string> {
  return new Set([...view.outfit, ...view.carried].filter((i) => (i.children ?? []).length > 0 && (i.children ?? []).length <= 6).map((i) => i.id));
}

/** A thing as Move to… moves it. */
const moveThing = (item: GearItem): MoveThing => ({ id: item.id, name: item.name, ...(item.size !== undefined ? { size: item.size } : {}) });

export function Belongings(props: { chatId: ChatId; state: StateView; view: GearView }) {
  const { view, state, chatId } = props;
  const app = useApp();
  const atOnce = useAtOnce(chatId);
  const [filter, setFilter] = useState<BelongingsFilter>("all");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<ReadonlySet<string>>(() => openAtFirst(view));
  const [sheet, setSheet] = useState<BelSheet | null>(null);
  const selection = useSelection();
  const where = useMemo(() => playChoices(view, state), [view, state]);
  const pov = povOf(state);
  const here = state.hud?.place?.id ?? null;
  const shownFilter = filtersAt(view.level).includes(filter) ? filter : "all";
  const sections = useMemo(() => searchSections(belongingsSections(view, shownFilter), query), [view, shownFilter, query]);
  // Every row of every section, for what is picked and for the sheets, whatever the filter shows.
  const index = useMemo(() => rowIndex(belongingsSections(view, "all")), [view]);
  const shownIndex = useMemo(() => rowIndex(sections), [sections]);
  const mineIn = (ids: Iterable<string>): string[] => [...ids].filter((id) => index.get(id)?.item.mine === true);
  const picked = selection.ids.flatMap((id) => index.get(id) ?? []);
  const canPutIn = where.choices.some((c) => c.is === "thing");
  const add = addPolicy(state.controls?.realism.claims ?? null) !== "hidden";
  const close = (): void => setSheet(null);
  const itemOf = (id: EntityId): GearItem | undefined => index.get(id)?.item;
  const onAction = (action: RowAction, item: GearItem): void => {
    if (action === "move") return setSheet({ kind: "move", ids: [item.id] });
    if (action === "put_in") return setSheet({ kind: "put", id: item.id });
    if (action === "owner") return setSheet({ kind: "owner", id: item.id });
    if (action === "rename") return setSheet({ kind: "rename", id: item.id });
    if (action === "size") return setSheet({ kind: "size", ids: [item.id] });
    const request = verbRequest(chatId, action, item, { pov, here });
    if (request) atOnce.send(request, verbWords(action, item.name));
  };
  const ctx: RowCtx = {
    level: view.level,
    canPutIn,
    here,
    busy: atOnce.busy,
    picking: selection.on,
    picked: new Set(selection.ids),
    open,
    onToggle: (id) => {
      const next = new Set(open);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      setOpen(next);
    },
    onPick: (id) => selection.toggle(id),
    onOpen: (id) => app.ui.update((ui) => pushSheet(ui, { kind: "item", id })),
    onAction,
  };
  const sheetThings = (ids: readonly EntityId[]): GearItem[] => ids.flatMap((id) => itemOf(id) ?? []);
  // The one thing a sheet of one is about.
  const one = sheet !== null && "id" in sheet ? itemOf(sheet.id) : undefined;
  const done = (): void => selection.stop();
  const renamed = (item: GearItem, name: string): string => `${item.name} is called ${name} now.`;
  return (
    <div class="lre-stack lre-me lre-bel" data-lre-belongings={shownFilter} data-lre-choosing={selection.on ? "" : undefined}>
      <div class="lre-bel-top">
        <label class="lre-bel-search">
          <Icon name="search" size={16} />
          <input class="lre-input" type="search" aria-label="Search your things" placeholder="Search your things" value={query} onInput={(event) => setQuery(event.currentTarget.value)} />
        </label>
        <Button size="sm" variant={selection.on ? "primary" : "secondary"} icon={selection.on ? "check" : "checklist"} title={selection.on ? undefined : "Pick things to change together"} onClick={() => (selection.on ? selection.stop() : selection.start())}>
          {selection.on ? "Done" : "Select"}
        </Button>
        {add ? (
          <Button size="sm" icon="plus" title="Add something you have" onClick={() => setSheet({ kind: "add" })}>
            Add
          </Button>
        ) : null}
      </div>
      <FilterChips filters={filtersAt(view.level)} value={shownFilter} onPick={setFilter} />
      <OutfitBar view={view} onOpen={() => setSheet({ kind: "sets" })} />
      <AtOnceNotice done={atOnce.done} busy={atOnce.busy} onUndo={atOnce.undo} onDismiss={atOnce.dismiss} />
      {sections.length === 0 ? (
        <Empty icon="search">{query.trim() !== "" ? `Nothing of yours is called “${query.trim()}”.` : "Nothing to show."}</Empty>
      ) : (
        <BelongingsList sections={sections} ctx={ctx} />
      )}
      {shownFilter === "all" && query.trim() === "" && view.vehicles > 0 ? (
        <Section flush>
          <List>
            <ListRow icon="car" title="Vehicles" value={String(view.vehicles)} subtitle="In the Garage" chevron onClick={() => app.ui.update((ui) => showPanel(ui, app.catalog, "vehicles.garage"))} />
          </List>
        </Section>
      ) : null}
      {selection.on ? (
        <BelongingsBar
          selection={selection}
          all={mineIn(index.keys())}
          shown={mineIn(shownIndex.keys())}
          picked={picked}
          level={view.level}
          here={here}
          people={view.people.length}
          busy={atOnce.busy}
          onBulk={(action) => {
            const things = action === "wear" || action === "take_off" ? (wearToggle(picked, view.level)?.things ?? []) : picked.map((p) => p.item);
            const request = bulkRequest(chatId, action, things, here);
            if (request) atOnce.send(request, bulkWords(action, things), done);
          }}
          onSheet={(next) => setSheet({ kind: next, ids: picked.map((p) => p.item.id) })}
        />
      ) : null}
      {sheet?.kind === "move" ? <MoveSheet chatId={chatId} things={sheetThings(sheet.ids).map(moveThing)} choices={where.choices} at={where.at} kept={sheet.ids.length === 1 ? (itemOf(sheet.ids[0] ?? "")?.kept ?? null) : null} blocked={where.blocked} atOnce={atOnce} onClose={close} onMoved={done} /> : null}
      {sheet?.kind === "put" && one ? <MoveSheet chatId={chatId} title={`Put ${one.name} in`} things={[moveThing(one)]} choices={where.choices.filter((c) => c.is === "thing")} at={{ pov: null, here: null, home: null }} blocked={where.blocked} atOnce={atOnce} onClose={close} /> : null}
      {sheet?.kind === "owner" && one ? <OwnerUseSheet chatId={chatId} thing={ownerThing(one, pov, view.household)} people={view.people} loans={view.loans} household={view.household} onClose={close} /> : null}
      {sheet?.kind === "rename" && one ? <RenameSheet item={one} busy={atOnce.busy} onClose={close} onRename={(name) => atOnce.send(thingsFix(chatId, [{ do: "label", item: one.id, name }], renamed(one, name)), renamed(one, name), close)} /> : null}
      {sheet?.kind === "size" ? (
        <SizeSheet
          things={sheetThings(sheet.ids)}
          onClose={close}
          onPick={(size) => {
            const things = sheetThings(sheet.ids);
            const words = `${thingNames(things).names} ${things.length === 1 ? "is" : "are"} ${SIZE_LABELS[size]} now.`;
            atOnce.send(thingsFix(chatId, things.map((t) => ({ do: "size", item: t.id, size })), words), words, () => {
              close();
              if (things.length > 1) done();
            });
          }}
        />
      ) : null}
      {sheet?.kind === "give" ? (
        <GiveSheet
          things={sheetThings(sheet.ids)}
          people={view.people}
          loans={view.loans}
          busy={atOnce.busy}
          onClose={close}
          onHand={(to, basis, until) => {
            const things = sheetThings(sheet.ids);
            const words = handManyWords(things, to.name, basis, until);
            atOnce.send(thingsFix(chatId, things.map((t) => ({ do: "hand", item: t.id, to: to.id, basis, ...(until ? { until: until.until } : {}) })), words), words, () => {
              close();
              done();
            });
          }}
        />
      ) : null}
      {sheet?.kind === "add" ? <PlayAddSheet chatId={chatId} state={state} view={view} atOnce={atOnce} onClose={close} /> : null}
      {sheet?.kind === "sets" ? <SetsSheet chatId={chatId} view={view} atOnce={atOnce} onClose={close} /> : null}
    </div>
  );
}
