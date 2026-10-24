// A list's multi-select mode (GM → World and Minds, Build → Entities and Places): while choosing, a
// row's tap picks it instead of opening it, and a bar under the list says how many are picked, picks
// every row the list shows (its search and filters as they stand) or exactly one group (by level or
// tier, a button each, so they never pass for the list's own filters), clears, and holds the list's
// actions. The selection is the list's own state: in GM mode it lives behind the GM gate and goes
// when the gate closes, and no player surface ever reads it.

import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import type { SelectGroup } from "./batch";
import { Button } from "./components";

export interface Selection {
  /** Whether the list is choosing. */
  on: boolean;
  ids: readonly string[];
  start(): void;
  /** Leaves choosing and drops the selection. */
  stop(): void;
  toggle(id: string): void;
  set(ids: readonly string[]): void;
}

export function useSelection(): Selection {
  const [on, setOn] = useState(false);
  const [ids, setIds] = useState<readonly string[]>([]);
  return {
    on,
    ids,
    start: () => setOn(true),
    stop: () => {
      setOn(false);
      setIds([]);
    },
    toggle: (id) => setIds(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]),
    set: (next) => setIds([...new Set(next)]),
  };
}

/** A row's checkbox while choosing: the row's own tap toggles it, so the box takes no focus of its own. */
export function PickBox(props: { label: string; checked: boolean }) {
  return <input type="checkbox" class="lre-pick" aria-label={props.label} checked={props.checked} tabIndex={-1} />;
}

/** A selection bar's group picks: one button per level or tier, which selects exactly its rows. */
export function GroupPicks(props: { label: string; groups: readonly SelectGroup[]; onPick(group: SelectGroup): void }) {
  return (
    <div class="lre-selectbar-groups" role="group" aria-label={props.label}>
      <span class="lre-selectbar-groups-label">{props.label}</span>
      {props.groups.map((g) => (
        <Button key={g.id} size="sm" variant="secondary" onClick={() => props.onPick(g)}>
          {`${g.label} · ${g.ids.length}`}
        </Button>
      ))}
    </div>
  );
}

/**
 * The bar under a choosing list. `all` is every row the list has, so a row its search hides stays
 * picked and counts; `shown` is what the list shows now, which Select all adds; a group replaces the
 * selection with exactly its rows. The list's actions are its children, for what's picked.
 */
export function SelectBar(props: { label: string; selection: Selection; all: readonly string[]; shown: readonly string[]; groups?: readonly SelectGroup[]; groupLabel?: string; children?: ComponentChildren }) {
  const { selection } = props;
  const count = selection.ids.filter((id) => props.all.includes(id)).length;
  return (
    <div class="lre-selectbar" role="group" aria-label={props.label}>
      <div class="lre-selectbar-row">
        <span class="lre-selectbar-count">{count === 1 ? "1 selected" : `${count} selected`}</span>
        <Button size="sm" variant="ghost" icon="checklist" disabled={props.shown.length === 0} onClick={() => selection.set([...selection.ids, ...props.shown])}>
          {`Select all ${props.shown.length}`}
        </Button>
        <Button size="sm" variant="ghost" disabled={count === 0} onClick={() => selection.set([])}>
          Clear
        </Button>
      </div>
      {props.groups && props.groups.length > 0 ? <GroupPicks label={props.groupLabel ?? "Select a level"} groups={props.groups} onPick={(group) => selection.set(group.ids)} /> : null}
      {props.children !== undefined ? <div class="lre-selectbar-actions">{props.children}</div> : null}
    </div>
  );
}
