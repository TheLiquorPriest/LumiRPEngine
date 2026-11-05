// What a thing is, as every Add asks it (ITEMS-SPEC §10.1; Play → Me → Belongings, GM → Things and
// Build → Things): its kind first, a chip each (Item, Clothing, Container, Kit, Weapon, Armor, Ammo
// or Vehicle), then a type from the catalogs of that kind, searched by name and category, each with
// the size it gives, or Something else, a size in words; a Vehicle is a class from the vehicle
// picker, with its make, model and year. Hook-free but for the sheets.

import { useId, useMemo, useState } from "preact/hooks";
import type { Size, SizeClass, ThingIs } from "../../shared/things";
import { SIZE_LABELS, SIZES, THING_IS, THING_IS_LABEL } from "../../shared/things";
import type { ThingType } from "../../shared/thing-view";
import { SIZE_WORDS, sizeLabel } from "../../shared/thing-view";
import type { VehiclePick } from "../../shared/vehicles";
import { FormSheet } from "../build/form-kit";
import { wordsOf } from "../character/places";
import { Button, Empty, List, ListRow, Section } from "../components";
import { Icon } from "../icons";

/** What a thing added is: what a player's Add says (`ThingIs`), or a vehicle, which the vehicles pack makes from its class. */
export type ThingKind = ThingIs | "vehicle";

export const THING_KINDS: readonly ThingKind[] = [...THING_IS, "vehicle"];

export const THING_KIND_LABEL: Readonly<Record<ThingKind, string>> = { ...THING_IS_LABEL, vehicle: "Vehicle" };

/** The catalog's types of a kind: every type for an Item; the containers' and the kits' own tables; the types whose category is the kind's (by its id) for the rest; none for a vehicle (its classes are the picker's). */
export function typesOfKind(types: readonly ThingType[], kind: ThingKind): ThingType[] {
  switch (kind) {
    case "item":
      return [...types];
    case "container":
      return types.filter((t) => t.table === "gear.containers");
    case "kit":
      return types.filter((t) => t.table === "gear.kits");
    case "vehicle":
      return [];
    default:
      return types.filter((t) => t.categoryId === kind);
  }
}

/** The types whose name or category has every word of the query (each a word's beginning), named by it first; at most this many. */
export const TYPE_LIMIT = 60;

export function searchTypes(types: readonly ThingType[], query: string): ThingType[] {
  const want = wordsOf(query);
  if (want.length === 0) return [];
  const hits: { type: ThingType; own: boolean }[] = [];
  for (const type of types) {
    const name = wordsOf(type.name);
    const category = type.category ? wordsOf(type.category) : [];
    const inName = (q: string): boolean => name.some((n) => n.startsWith(q));
    if (!want.every((q) => inName(q) || category.some((n) => n.startsWith(q)))) continue;
    hits.push({ type, own: want.every(inName) });
  }
  hits.sort((a, b) => Number(b.own) - Number(a.own) || a.type.name.localeCompare(b.type.name));
  return hits.slice(0, TYPE_LIMIT).map((h) => h.type);
}

/** What "What is it?" holds: a type from the catalogs, a size in words (something else), a vehicle's class, or nothing yet. */
export type WhatItIs = { type: ThingType } | { size: Size } | { vehicle: VehiclePick } | null;

/** The size a "What is it?" gives: its type's, the size in words, a vehicle's, or none yet. */
export function sizeOfWhat(what: WhatItIs): SizeClass | null {
  if (what === null) return null;
  return "type" in what ? what.type.size : "size" in what ? what.size : "vehicle";
}

/** A vehicle pick as its row names it: "2021 Ford F-150", else the class's name. */
export function vehicleName(pick: VehiclePick): string {
  const said = [pick.year > 0 ? String(pick.year) : "", pick.make, pick.model].filter((p) => p.trim() !== "").join(" ");
  return said !== "" && (pick.make.trim() !== "" || pick.model.trim() !== "") ? said : pick.name;
}

/** "What is it?" in words, as its field shows it. */
export function whatWords(what: WhatItIs): string {
  if (what === null) return "Not picked yet";
  if ("type" in what) return `${what.type.name} · ${sizeLabel(what.type.size)}`;
  if ("size" in what) return `Something else · ${SIZE_LABELS[what.size]}`;
  return `${what.vehicle.name} · ${vehicleName(what.vehicle)}`;
}

/** The name a pick suggests for a thing not named yet: the type's, or the vehicle's. */
export function suggestedName(what: WhatItIs): string | null {
  if (what === null || "size" in what) return null;
  return "type" in what ? what.type.name : vehicleName(what.vehicle);
}

/** Each size in words, to pick one for something the catalogs don't have. */
export function SizeChoices(props: { value: Size | null; onPick(size: Size): void }) {
  return (
    <div class="lre-thing-sizes" role="radiogroup" aria-label="How big it is">
      {SIZES.map((size) => (
        <button key={size} type="button" role="radio" aria-checked={props.value === size} class="lre-thing-size" data-lre-size-choice={size} onClick={() => props.onPick(size)}>
          <span class="lre-thing-size-name">{SIZE_LABELS[size]}</span>
          <span class="lre-thing-size-means">{SIZE_WORDS[size].means}</span>
          <span class="lre-thing-size-eg">Like {SIZE_WORDS[size].examples}</span>
        </button>
      ))}
    </div>
  );
}

/** The kind chips, one pressed; a tap picks another. Hook-free. */
export function KindChips(props: { value: ThingKind; kinds?: readonly ThingKind[]; disabled?: boolean; onPick(kind: ThingKind): void }) {
  return (
    <div class="lre-thing-kinds" role="group" aria-label="What kind of thing">
      {(props.kinds ?? THING_KINDS).map((kind) => (
        <button key={kind} type="button" class="lre-thing-kind" aria-pressed={props.value === kind} disabled={props.disabled} data-lre-kind={kind} onClick={() => props.onPick(kind)}>
          {THING_KIND_LABEL[kind]}
        </button>
      ))}
    </div>
  );
}

/** "What is it?": the catalogs of the kind searched by name and category, each type with the size it gives, and Something else for a size in words. */
export function TypeSheet(props: { types: readonly ThingType[] | null; kind: ThingKind; value: WhatItIs; onPick(next: WhatItIs): void; onClose(): void }) {
  const [query, setQuery] = useState("");
  const [other, setOther] = useState(props.value !== null && "size" in props.value);
  const id = useId();
  const ofKind = useMemo(() => typesOfKind(props.types ?? [], props.kind), [props.types, props.kind]);
  const results = useMemo(() => searchTypes(ofKind, query), [ofKind, query]);
  const label = THING_KIND_LABEL[props.kind];
  return (
    <FormSheet title="What is it?" subtitle={props.value === null ? `${label}: pick its type, or say how big it is` : whatWords(props.value)} onClose={props.onClose}>
      <div class="lre-cp-sheet" data-lre-type-sheet={props.kind}>
        <label class="lre-cp-search" for={id}>
          <Icon name="search" size={16} />
          <input id={id} class="lre-input" type="search" placeholder={`Search the catalogs' ${label.toLowerCase()}`} aria-label="Search the catalogs" value={query} onInput={(event) => setQuery(event.currentTarget.value)} />
        </label>
        <Button variant={other ? "primary" : "secondary"} icon="sliders" onClick={() => setOther(!other)}>
          Something else
        </Button>
        {other ? (
          <Section title="How big is it?" flush>
            <SizeChoices value={props.value !== null && "size" in props.value ? props.value.size : null} onPick={(size) => props.onPick({ size })} />
          </Section>
        ) : props.types === null ? (
          <Empty icon="hourglass">Reading the catalogs…</Empty>
        ) : query.trim() === "" ? (
          <p class="lre-cp-note">{ofKind.length === 0 ? `The catalogs have no ${label.toLowerCase()} types: use Something else.` : `Type what it is: ${ofKind.length === 1 ? "1 type" : `${ofKind.length} types`} of ${label.toLowerCase()}. A type gives its size and its details (weight, volume, the slot it is worn in); Something else gives a size in words.`}</p>
        ) : results.length === 0 ? (
          <Empty icon="search">No type matches “{query.trim()}”: try Something else.</Empty>
        ) : (
          <Section title={results.length === TYPE_LIMIT ? `${TYPE_LIMIT} types, keep typing to narrow` : results.length === 1 ? "1 type" : `${results.length} types`} flush>
            <List>
              {results.map((t) => (
                <ListRow key={`${t.table}:${t.id}`} title={t.name} subtitle={[t.category, sizeLabel(t.size)].filter((p) => p).join(" · ")} current={props.value !== null && "type" in props.value && props.value.type.id === t.id} onClick={() => props.onPick({ type: t })} />
              ))}
            </List>
          </Section>
        )}
      </div>
    </FormSheet>
  );
}
