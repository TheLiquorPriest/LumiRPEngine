// Build's page chrome, shared by the shell and every editor page: how Build
// names each collection, an item's display name, the overflow menu, an item page's header (its
// name, its id under Show ids, Delete in the overflow), Delete itself, and + New, which asks for a
// name and derives the id from it. A leaf module: the editors import it and it imports none
// of them, so the shell (build.tsx), which imports the editors, never sits in an import cycle.

import type { ComponentChildren } from "preact";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { WorldId } from "../../shared/ids";
import { hasOwn, isRecord, safeKey } from "../../shared/json";
import type { WorldCollection, WorldPart } from "../../shared/protocol";
import type { App, BuildRoute } from "../app";
import { useApp } from "../app";
import { Button, Disclosure, Field, IdText, PageHeader, useShowIds } from "../components";
import { humanize } from "../format";
import type { IconName } from "../icons";
import { Icon } from "../icons";
import type { Send } from "../registry";
import { deriveId } from "./schema";

export interface CollectionInfo {
  label: string;
  /** One line on what it holds. */
  hint: string;
  /** One item of it, in a sentence: "New entity", "Delete the entity …". */
  noun: string;
  icon: IconName;
}

/** Each collection as Build names it. */
export const COLLECTION_INFO: Readonly<Record<WorldCollection, CollectionInfo>> = {
  entities: { label: "Entities", hint: "People, things, vehicles", noun: "entity", icon: "users" },
  kinds: { label: "Kinds", hint: "Types and their fields", noun: "kind", icon: "layers" },
  classifications: { label: "Classifications", hint: "Story roles, allegiances: your own facets", noun: "classification", icon: "star" },
  relations: { label: "Relations", hint: "How entities connect", noun: "relation", icon: "link" },
  places: { label: "Places", hint: "Where things happen", noun: "place", icon: "pin" },
  maps: { label: "Maps", hint: "Floor plans and town maps, as lre-map-v1", noun: "map", icon: "map" },
  routes: { label: "Routes", hint: "Travel between places", noun: "route", icon: "route" },
  grids: { label: "Grids", hint: "Maps inside places", noun: "grid", icon: "grid" },
  actions: { label: "Actions", hint: "What the player can do", noun: "action", icon: "bolt" },
  checks: { label: "Checks", hint: "Dice and outcome bands", noun: "check", icon: "dice" },
  rules: { label: "Rules", hint: "When this, do that", noun: "rule", icon: "branch" },
  routines: { label: "Routines", hint: "How people's days usually go: the world's, a group's, a kind's or someone's own", noun: "routine", icon: "clock" },
  schedules: { label: "Schedules", hint: "Shifts, opening hours, weather: one field slot by slot", noun: "schedule", icon: "calendar" },
  tracks: { label: "Tracks", hint: "Quests, secrets, puzzles, agendas", noun: "track", icon: "flag" },
  lore: { label: "Lore", hint: "Entries, lookup table, indexing", noun: "lore entry", icon: "book" },
  tables: { label: "Data tables", hint: "Prices, jobs, regions…", noun: "data table", icon: "table" },
  sections: { label: "Sections", hint: "What the narrator reads", noun: "section", icon: "scroll" },
  steps: { label: "Step templates", hint: "Prompted model steps", noun: "step template", icon: "sparkle" },
  packs: { label: "Packs", hint: "Enabled domain packs", noun: "pack", icon: "box" },
};

/** Each world part (the singletons) as Build names it. */
export const PART_INFO: Readonly<Record<WorldPart, { label: string; hint: string; icon: IconName }>> = {
  meta: { label: "World", hint: "Name, point of view, start, currency and map", icon: "globe" },
  calendar: { label: "Calendar", hint: "Dates, months and holidays", icon: "calendar" },
  realism: { label: "Realism defaults", hint: "How closely new chats simulate each part of life", icon: "sliders" },
  tiers: { label: "Tiers", hint: "How deeply each person is simulated", icon: "layers" },
  time: { label: "Time defaults", hint: "How time passes in new chats", icon: "clock" },
  ruleset: { label: "Ruleset", hint: "Character fields, checks, levels, the sheet and combat", icon: "shield" },
  loreIndex: { label: "Lore lookup table", hint: "Terms and topics that lead to lore entries", icon: "search" },
  minds: { label: "Minds", hint: "How closely characters think, what they remember, and their prompts", icon: "sparkle" },
  lorePins: { label: "Pinned lore", hint: "Lore every call for a character, or at a place, always reads", icon: "pin" },
  routineSettings: { label: "Routines and the story", hint: "How firmly routines hold against the story, and who invites whom", icon: "route" },
};

/** Shows a Build page: the route is Build's whole stack position (Worlds → World → Collection → Item). */
export function go(app: Pick<App, "ui">, build: BuildRoute): void {
  app.ui.update((ui) => ({ ...ui, build }));
}

/**
 * An item's name as Build lists it: its name, label or title; a route by the places it joins (named
 * when `places` is given). An item without one reads as its id in words, since ids show only under
 * Show ids.
 */
export function itemLabel(collection: WorldCollection, id: string, value: unknown, places?: Readonly<Record<string, { name: string }>>): string {
  if (isRecord(value)) {
    if (typeof value.name === "string" && value.name) return value.name;
    if (typeof value.label === "string" && value.label) return value.label;
    if (typeof value.title === "string" && value.title) return value.title;
    if (collection === "routes" && typeof value.from === "string") {
      const [from, to] = [value.from, value.to].map((place) => (typeof place === "string" && places && hasOwn(places, place) ? (places[place]?.name ?? place) : String(place)));
      return `${from} → ${to}`;
    }
  }
  return humanize(id);
}

// ---------------------------------------------------------------- overflow menu

export interface MenuItem {
  label: string;
  icon?: IconName;
  /** Destructive: shown in the danger colour. */
  danger?: boolean;
  disabled?: boolean;
  onSelect(): void;
}

/**
 * The ⋯ button and the menu of less frequent actions it opens. Arrow keys move
 * between the items; Escape, Tab or a tap elsewhere closes it, Escape returning focus to the button.
 * It opens upward when there's no room below.
 */
export function OverflowMenu(props: { label: string; items: readonly MenuItem[]; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const menuId = useId();
  // Measured before paint, so a menu with no room below opens upward without a flash.
  useLayoutEffect(() => {
    if (!open) return undefined;
    const rect = list.current?.getBoundingClientRect();
    if (rect && rect.bottom > window.innerHeight - 8 && rect.height + 48 < (button.current?.getBoundingClientRect().top ?? 0)) setUp(true);
    list.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
    // The path, not the target: inside a shadow root the target is retargeted to the host.
    const away = (event: Event) => {
      if (root.current && event.composedPath().includes(root.current)) return;
      setOpen(false);
      setUp(false);
    };
    document.addEventListener("pointerdown", away, true);
    return () => document.removeEventListener("pointerdown", away, true);
  }, [open]);
  const close = (refocus: boolean) => {
    setOpen(false);
    setUp(false);
    if (refocus) button.current?.focus();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (!open) return;
    if (event.key === "Escape") {
      // Kept from the host and the sheets around it: Escape here closes only this menu.
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }
    if (event.key === "Tab") {
      close(false);
      return;
    }
    const all = [...(list.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])];
    const at = all.findIndex((entry) => entry === event.target);
    const next = event.key === "ArrowDown" ? (at + 1) % all.length : event.key === "ArrowUp" ? (at <= 0 ? all.length - 1 : at - 1) : event.key === "Home" ? 0 : event.key === "End" ? all.length - 1 : -1;
    if (next < 0 || all.length === 0) return;
    event.preventDefault();
    all[next]?.focus();
  };
  return (
    <div ref={root} class="lre-build-menu" onKeyDown={onKeyDown}>
      <button
        ref={button}
        type="button"
        class="lre-iconbtn ghost"
        aria-label={props.label}
        title={props.label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={props.disabled}
        onClick={() => (open ? close(false) : setOpen(true))}
      >
        <Icon name="more" />
      </button>
      {open ? (
        <div ref={list} id={menuId} class={up ? "lre-build-menu-list up" : "lre-build-menu-list"} role="menu" aria-label={props.label}>
          {props.items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              class={item.danger ? "danger" : undefined}
              disabled={item.disabled}
              onClick={() => {
                close(true);
                item.onSelect();
              }}
            >
              {item.icon ? <Icon name={item.icon} size={16} /> : null}
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- item pages

/**
 * An item page's header under Build's world bar, which holds Back: its name, its id while Show ids
 * is on, any actions, and the overflow with Delete (when `onDelete` is given) and `menu`.
 */
export function ItemHeader(props: { title: ComponentChildren; id: string; subtitle?: ComponentChildren; onDelete?(): void; busy?: boolean; menu?: readonly MenuItem[]; actions?: ComponentChildren }) {
  const showIds = useShowIds();
  const onDelete = props.onDelete;
  const items: MenuItem[] = [...(props.menu ?? []), ...(onDelete ? [{ label: "Delete", icon: "trash" as const, danger: true, disabled: props.busy, onSelect: onDelete }] : [])];
  const subtitle =
    props.subtitle !== undefined || showIds ? (
      <>
        {props.subtitle}
        {props.subtitle !== undefined && showIds ? " · " : null}
        <IdText id={props.id} />
      </>
    ) : undefined;
  const actions =
    props.actions !== undefined || items.length > 0 ? (
      <>
        {props.actions}
        {items.length > 0 ? <OverflowMenu label="Item actions" items={items} /> : null}
      </>
    ) : undefined;
  return <PageHeader title={props.title} subtitle={subtitle} actions={actions} />;
}

/**
 * Deletes an item from the draft once the user confirms, then shows its collection; false when
 * declined or refused. `message` replaces the question when deleting takes more with it.
 */
export async function deleteItem(app: Pick<App, "host" | "ui">, send: Send, item: { worldId: WorldId; collection: WorldCollection; id: string; name?: string; message?: string }): Promise<boolean> {
  const noun = COLLECTION_INFO[item.collection].noun;
  if (!(await app.host.confirm(`Delete ${noun}`, item.message ?? `Delete the ${noun} “${item.name ?? item.id}”? References to it will show in Problems.`, "danger", "Delete"))) return false;
  const message = await send({ type: "lre.editor", worldId: item.worldId, base: null, op: "remove", collection: item.collection, id: item.id });
  if (message.type !== "lre.result") return false;
  go(app, { view: "collection", worldId: item.worldId, collection: item.collection });
  return true;
}

// ---------------------------------------------------------------- + New

/** The names + New gave the items it opened, by `world/collection/id`: an item route carries only `new:<id>`. */
const newNames = new Map<string, string>();

/** The name + New gave the item it opened as `new:<id>`, for its editor's blank value; undefined when it gave none. */
export function newItemName(worldId: WorldId, collection: WorldCollection, id: string): string | undefined {
  return newNames.get(`${worldId}/${collection}/${id}`);
}

/** Opens a new item under the name the user gave it; nothing is in the draft until its editor creates it. */
export function openNewItem(app: Pick<App, "ui">, item: { worldId: WorldId; collection: WorldCollection; id: string; name: string }): void {
  newNames.set(`${item.worldId}/${item.collection}/${item.id}`, item.name);
  go(app, { view: "item", worldId: item.worldId, collection: item.collection, id: `new:${item.id}` });
}

/** Why a typed id can't be used, or null. */
function idProblem(id: string, taken: ReadonlySet<string>, noun: string): string | null {
  if (!id) return "Give it an id.";
  if (taken.has(id)) return `Another ${noun} already has this id.`;
  return safeKey(id) ? null : "This id is reserved. Choose another.";
}

/**
 * + New: asks for a name and derives the id from it (`deriveId`: lower snake case, then
 * `_2`, `_3`… while `taken` holds it). The id is editable under Advanced, or in the open while
 * Show ids is on; once typed, it stops following the name. Continue opens the new item's page.
 */
export function NewItem(props: { worldId: WorldId; collection: WorldCollection; taken: ReadonlySet<string>; onDone(): void }) {
  const app = useApp();
  const showIds = useShowIds();
  const noun = COLLECTION_INFO[props.collection].noun;
  const [name, setName] = useState("");
  const [typed, setTyped] = useState<string | null>(null);
  const nameId = useId();
  const idId = useId();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const id = typed ?? (name.trim() ? deriveId(name.trim(), props.taken) : "");
  const problem = typed === null ? null : idProblem(typed, props.taken, noun);
  const ready = name.trim() !== "" && id !== "" && problem === null;
  const idField = (
    <Field label="Id" for={idId} help="How rules, formulas and other items refer to it. It follows the name until you change it." error={problem}>
      <input
        id={idId}
        class="lre-input lre-build-mono"
        value={id}
        autoComplete="off"
        spellcheck={false}
        aria-invalid={problem !== null || undefined}
        onInput={(event) => setTyped(event.currentTarget.value.replace(/[^\w.-]/g, "_"))}
      />
    </Field>
  );
  return (
    <form
      class="lre-build-new"
      aria-label={`New ${noun}`}
      data-lre-new={props.collection}
      onSubmit={(event) => {
        event.preventDefault();
        if (!ready) return;
        openNewItem(app, { worldId: props.worldId, collection: props.collection, id, name: name.trim() });
        props.onDone();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        props.onDone();
      }}
    >
      <Field label={`Name of the new ${noun}`} for={nameId}>
        <input ref={input} id={nameId} class="lre-input" value={name} autoComplete="off" onInput={(event) => setName(event.currentTarget.value)} />
      </Field>
      {showIds ? idField : <Disclosure summary="Advanced">{idField}</Disclosure>}
      <div class="lre-build-actions">
        <Button type="submit" variant="primary" iconAfter="chevron-right" disabled={!ready}>
          Continue
        </Button>
        <Button variant="ghost" onClick={props.onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
