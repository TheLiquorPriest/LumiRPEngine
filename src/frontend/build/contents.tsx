// Build's item helpers (DESIGN §13): an entity's or a place's Contents (what the world puts in it or
// leaves lying there, each opening its own page), "Reveal this item" (hidden until searched for,
// §7), and an objective picker for a quest's item checks (`carries`, `has_item`, `at`).

import { useMemo, useState } from "preact/hooks";
import type { JsonObject } from "../../shared/json";
import { authoredContents, isItemKind, itemObjective, revealScaffold, type ItemCheck } from "../../shared/items-build";
import type { KindDef, WorldDoc } from "../../shared/world";
import { useApp } from "../app";
import { useSelect } from "../store";
import { Badge, Banner, Button, Section, Seg } from "../components";
import { go } from "./chrome";
import { FormGroup, ItemRow, RefPicker, type RefOption } from "./form-kit";

/** What the world puts in this container or on this person, or leaves lying at this place. */
export function ContentsSection(props: { world: WorldDoc; collection: "entities" | "places"; id: string }) {
  const app = useApp();
  const rows = authoredContents(props.world, props.id, props.collection);
  return (
    <div data-lre-contents={props.id}>
      <Section title={props.collection === "places" ? "Things here" : "Contents"}>
        {rows.length === 0 ? <span class="lre-small lre-muted">{props.collection === "places" ? "Nothing lies here loose." : "Nothing is in it."}</span> : null}
        {rows.map((row) => (
          <ItemRow key={row.id} title={row.name} badge={row.hidden ? <Badge tone="gm">Hidden until searched</Badge> : undefined} openLabel={`Open ${row.name}`} onOpen={() => go(app, { view: "item", worldId: props.world.id, collection: "entities", id: row.id })} />
        ))}
      </Section>
    </div>
  );
}

/** "Reveal this item": makes the thing being edited hidden until it is searched for; the page's Save keeps it. */
export function RevealItem(props: { kinds: Readonly<Record<string, KindDef>>; value: JsonObject; onChange(next: JsonObject): void }) {
  if (typeof props.value.kind !== "string" || !isItemKind(props.kinds, props.value.kind)) return null;
  if (props.value.visibility === "discoverable") {
    return (
      <Banner tone="info" icon="search">
        Hidden until the player character searches where it lies, or opens what holds it.
      </Banner>
    );
  }
  const made = revealScaffold(props.value);
  return (
    <div data-lre-reveal="">
      <FormGroup title="Reveal this item">
        <span class="lre-small lre-muted">Keeps it hidden until the player character searches where it lies, or opens what holds it, with Search.</span>
        {"problem" in made ? <span class="lre-small">{made.problem}</span> : null}
        <Button size="sm" icon="search" disabled={"problem" in made} onClick={() => ("entity" in made ? props.onChange(made.entity) : undefined)}>
          Hide until searched
        </Button>
      </FormGroup>
    </div>
  );
}

const CHECKS: { value: ItemCheck; label: string }[] = [
  { value: "carries", label: "Has it with them" },
  { value: "has_item", label: "Has one like it" },
  { value: "at", label: "It lies at" },
];

/** Adds an objective testing a thing: the player character carries it or one like it, or it lies at a place. */
export function ItemObjectivePicker(props: { world: WorldDoc; onAdd(objective: string): void }) {
  const app = useApp();
  const packKinds = useSelect(app.drafts, (d) => d?.packKinds);
  // The packs' kinds count too (a gear item, container or kit), the world's own winning.
  const kinds = useMemo(() => ({ ...packKinds, ...props.world.kinds }), [packKinds, props.world.kinds]);
  const [check, setCheck] = useState<ItemCheck>("carries");
  const [item, setItem] = useState("");
  const [place, setPlace] = useState("");
  const items: RefOption[] = useMemo(
    () =>
      Object.values(props.world.entities)
        .filter((e) => isItemKind(kinds, e.kind))
        .map((e) => ({ value: e.id, label: e.name, ...(e.visibility === "discoverable" ? { sublabel: "hidden until searched" } : {}) }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [props.world.entities, kinds],
  );
  const places: RefOption[] = useMemo(() => Object.values(props.world.places).map((p) => ({ value: p.id, label: p.name })).sort((a, b) => a.label.localeCompare(b.label)), [props.world.places]);
  const ready = item !== "" && (check !== "at" || place !== "");
  return (
    <div data-lre-item-objective="">
      <FormGroup title="Add an item check">
        <Seg<ItemCheck> label="Check" value={check} options={CHECKS} onChange={setCheck} />
        <RefPicker label="Item" value={item} options={items} placeholder="Pick a thing" onChange={setItem} />
        {check === "at" ? <RefPicker label="Place" value={place} options={places} placeholder="Pick a place" onChange={setPlace} /> : null}
        <Button size="sm" icon="plus" disabled={!ready} onClick={() => props.onAdd(itemObjective(check, item, place))}>
          Add objective
        </Button>
      </FormGroup>
    </div>
  );
}
