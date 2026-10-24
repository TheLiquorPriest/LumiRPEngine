// Build → Character page (DESIGN §13 characters): a person edited as a character, not as one more
// entity of some kind. It reads the Character model (`lre.character`, build scope) for plain labels,
// place paths and bed choices, edits the draft's entity in place, and saves a draft patch of only what
// changed, so an edit made elsewhere to anything else stands. Places and beds are chosen with the
// shared pickers; every field the sections don't lay out is under All fields.

import { useEffect, useMemo, useState } from "preact/hooks";
import type { CharacterBed, CharacterDTO, CharacterField, CharacterResult, CharacterSection, PlaceRef, ThingRef } from "../../shared/character";
import type { JsonObject, JsonValue } from "../../shared/json";
import { isRecord } from "../../shared/json";
import type { WorldDoc } from "../../shared/world";
import { useApp } from "../app";
import { BedPicker, bedValue } from "../character/bed-picker";
import { PlacePicker } from "../character/place-picker";
import { TextListEditor } from "../character/text-list";
import { Badge, Banner, Button, Disclosure, IconButton, SaveBar, Section, useBusy } from "../components";
import { humanize } from "../format";
import type { EditorProps } from "../registry";
import { characterRequest } from "../requests";
import { useSelect } from "../store";
import { entityPatch, GROUP_LABEL, relationGroups, type RelationGroup } from "./character-model";
import { deleteItem, go, ItemHeader } from "./chrome";
import { authoredContents } from "../../shared/items-build";
import { CheckField, FormGroup, ItemRow, RefPicker, type RefOption } from "./form-kit";
import { useHeld } from "./held";
import { LorePinsSection } from "./lore-pins";
import { COLLECTION_SPECS } from "./schema";
import { DefInput, kindFields, lintAt, SchemaFields, worldIdentifiers, type FormCtx } from "./schema-form";
import { kindIs } from "./selector-editor";

/** The entity form's own keys each section lays out with the generic fields; All fields holds the rest. */
const WHO_KEYS: ReadonlySet<string> = new Set(["name", "kind", "tier", "class", "tags", "life", "lifeKnownBy"]);
const SECRET_KEYS: ReadonlySet<string> = new Set(["visibility", "knownBy", "cues"]);

const fieldsOf = (value: JsonObject): JsonObject => (isRecord(value.fields) ? value.fields : {});

/** Where they sleep as the draft has it now: at home with no bed, a place, or a thing. */
function bedOf(bed: JsonValue | undefined, places: ReadonlyMap<string, PlaceRef>, things: ReadonlyMap<string, ThingRef>): CharacterBed {
  if (typeof bed !== "string" || bed === "") return { kind: "home", place: null, item: null };
  const place = places.get(bed);
  if (place) return { kind: "place", place, item: null };
  return { kind: "item", place: null, item: things.get(bed) ?? null };
}

export function CharacterPage(props: EditorProps) {
  const app = useApp();
  const draft = useSelect(app.drafts, (d) => d);
  const id = props.id ?? "";
  const stored = (props.world.entities as Record<string, unknown>)[id];
  const initial: JsonObject = isRecord(stored) ? (stored as JsonObject) : {};
  const [value, setValue] = useState<JsonObject>(initial);
  const [busy, run] = useBusy();
  useHeld(value, setValue, initial, `${props.world.id}/entities/${id}`, JSON.stringify(stored ?? null));
  // The model of the draft as stored: read again whenever the stored entity changes (a save, an edit elsewhere).
  const [model, setModel] = useState<CharacterResult | null>(null);
  const storedKey = JSON.stringify(stored ?? null);
  useEffect(() => {
    let live = true;
    void app.request(characterRequest(id, { worldId: props.world.id })).then((body) => {
      if (live && body) setModel(body);
    });
    return () => {
      live = false;
    };
  }, [app, id, props.world.id, storedKey]);
  const formDoc: WorldDoc = useMemo(() => ({ ...props.world, kinds: { ...draft?.packKinds, ...props.world.kinds }, relations: { ...draft?.packRelations, ...props.world.relations } }), [props.world, draft?.packKinds, draft?.packRelations]);
  const identifiers = useMemo(() => worldIdentifiers(props.world), [props.world]);
  const path = `entities.${id}`;
  const ctx: FormCtx = { doc: formDoc, lint: draft?.lint ?? [], path, identifiers, functions: draft?.functions ?? [], fieldEditors: app.catalog.fields };
  const changed = JSON.stringify(value) !== storedKey;
  const fields = fieldsOf(value);
  const setField = (field: string, next: JsonValue | undefined): void => {
    const out: JsonObject = { ...fields };
    if (next === undefined) delete out[field];
    else out[field] = next;
    setValue({ ...value, fields: out });
  };
  const save = () =>
    run(async () => {
      const ops = entityPatch(id, initial, value);
      if (ops.length > 0) await props.send({ type: "lre.editor", worldId: props.world.id, base: null, op: "patch", ops });
    });
  const character = model?.character ?? null;
  const name = typeof value.name === "string" && value.name !== "" ? value.name : id;
  return (
    <div class="lre-build-page lre-character-page" data-lre-editor="character">
      <ItemHeader
        title={name}
        id={id}
        subtitle={character ? `${character.kind.label} · ${character.tier.label}` : undefined}
        actions={character?.pov ? <Badge tone="accent">Player character</Badge> : undefined}
        onDelete={() => run(() => deleteItem(app, props.send, { worldId: props.world.id, collection: "entities", id, name }))}
        busy={busy}
      />
      {lintAt(draft?.lint ?? [], path)
        .filter((issue) => issue.path === path)
        .map((issue) => (
          <Banner key={issue.code} tone={issue.severity === "error" ? "neg" : issue.severity === "warning" ? "warn" : "info"}>
            {issue.message}
          </Banner>
        ))}
      <Section title="Who they are">
        <SchemaFields specs={COLLECTION_SPECS.entities.filter((s) => WHO_KEYS.has(s.key))} value={value} ctx={ctx} onChange={setValue} />
        <SectionFields section="identity" model={character} value={value} ctx={ctx} onField={setField} />
      </Section>
      {model ? <WhereTheyLive model={model} value={value} world={formDoc} onField={setField} onChange={setValue} /> : null}
      <TheirDay world={props.world} id={id} value={value} model={character} ctx={ctx} onChange={setValue} onField={setField} />
      <Section title="Work and money">
        <RefPicker label="Works for" value={typeof fields.employer === "string" ? fields.employer : ""} options={entitiesOfKind(formDoc, "business")} none="No employer" placeholder="Pick a business" onChange={(v) => setField("employer", v === "" ? undefined : v)} />
        <SectionFields section="work" model={character} value={value} ctx={ctx} onField={setField} skip={["employer"]} />
      </Section>
      <People world={formDoc} id={id} value={value} onChange={setValue} />
      <Section title="Stats">
        {(character?.sections.find((s) => s.id === "stats")?.fields.length ?? 0) === 0 ? <span class="lre-small lre-muted">Their kind has no sheet numbers or conditions.</span> : null}
        <SectionFields section="stats" model={character} value={value} ctx={ctx} onField={setField} />
      </Section>
      <ThingsTheyHave world={props.world} id={id} />
      <Section title="Secrets">
        <SchemaFields specs={COLLECTION_SPECS.entities.filter((s) => SECRET_KEYS.has(s.key))} value={value} ctx={ctx} onChange={setValue} />
      </Section>
      <LorePinsSection target="characters" id={id} />
      <Disclosure summary="All fields">
        <SchemaFields specs={COLLECTION_SPECS.entities} value={value} ctx={ctx} onChange={setValue} />
      </Disclosure>
      <SaveBar>
        <Button variant="primary" disabled={!changed} busy={busy} onClick={save}>
          Save to draft
        </Button>
        <Button variant="ghost" disabled={busy || !changed} onClick={() => setValue(initial)}>
          Revert
        </Button>
      </SaveBar>
    </div>
  );
}

/** A section's fields from the model, each with its kind field's own input under the model's plain label; a list of text is a list. */
function SectionFields(props: { section: CharacterSection["id"]; model: CharacterDTO | null; value: JsonObject; ctx: FormCtx; skip?: readonly string[]; onField(field: string, next: JsonValue | undefined): void }) {
  const kind = typeof props.value.kind === "string" ? props.value.kind : "";
  const defs = kindFields(props.ctx.doc, kind);
  const listed: CharacterField[] = props.model?.sections.find((s) => s.id === props.section)?.fields ?? [];
  const fields = fieldsOf(props.value);
  return (
    <>
      {listed
        .filter((f) => !(props.skip ?? []).includes(f.id))
        .map((f) => {
          const def = defs[f.id];
          if (!def) return null;
          const v = fields[f.id];
          if (def.type === "list" && (def.of === undefined || def.of === "text") && (v === undefined || (Array.isArray(v) && v.every((x) => typeof x === "string")))) {
            return <TextListEditor key={f.id} label={f.label} value={Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []} onChange={(next) => props.onField(f.id, next.length > 0 ? next : undefined)} />;
          }
          return <DefInput key={f.id} name={f.id} def={{ ...def, label: f.label, ...(f.help ? { hint: f.help } : {}) }} defs={defs} value={v} ctx={props.ctx} path={`${props.ctx.path}.fields.${f.id}`} onChange={(next) => props.onField(f.id, next)} />;
        })}
    </>
  );
}

/** Home, Sleeps and Where the story starts them, each a place picked by its path; a vehicle they start inside. */
function WhereTheyLive(props: { model: CharacterResult; value: JsonObject; world: WorldDoc; onField(field: string, next: JsonValue | undefined): void; onChange(next: JsonObject): void }) {
  const { places, things } = props.model;
  const byId = useMemo(() => new Map(places.map((p) => [p.id, p])), [places]);
  const thingsById = useMemo(() => new Map(things.map((t) => [t.id, t])), [things]);
  const fields = fieldsOf(props.value);
  const home = typeof fields.home === "string" ? (byId.get(fields.home) ?? null) : null;
  const start = typeof fields.place === "string" ? (byId.get(fields.place) ?? null) : null;
  const bed = bedOf(fields.bed, byId, thingsById);
  // The picker reads where they live as edited, not as stored; its choices are the model's.
  const character: CharacterDTO = { ...props.model.character, home, bed };
  const relations = Array.isArray(props.value.relations) ? props.value.relations : [];
  const inside = relations.find((r): r is JsonObject => isRecord(r) && r.type === "in" && typeof r.to === "string");
  const setInside = (to: string): void => {
    const rest = relations.filter((r) => !(isRecord(r) && r.type === "in"));
    props.onChange({ ...props.value, relations: to === "" ? rest : [...rest, { type: "in", to }] });
  };
  return (
    <Section title="Where they live">
      <div class="lre-stack">
        <PlacePicker title="Their home" label="Home" places={places} value={home?.id ?? null} clearLabel="No home" onPick={(p) => props.onField("home", p?.id)} />
        <BedPicker character={character} places={places} things={things} onPick={(next) => props.onField("bed", bedValue(next) ?? undefined)} />
        <PlacePicker
          title="Where the story starts them"
          label="Where the story starts them"
          places={places}
          value={start?.id ?? null}
          suggestions={home ? [{ label: "Their home", place: home }] : []}
          onPick={(p) => props.onField("place", p?.id)}
        />
        <RefPicker label="Starts inside" value={typeof inside?.to === "string" ? inside.to : ""} options={entitiesOfKind(props.world, "vehicle")} none="Nothing (on foot)" placeholder="Pick a vehicle" onChange={setInside} />
      </div>
    </Section>
  );
}

/** Whether they live their own day, the routines and schedules that are theirs, and the day's fields. */
function TheirDay(props: { world: WorldDoc; id: string; value: JsonObject; model: CharacterDTO | null; ctx: FormCtx; onChange(next: JsonObject): void; onField(field: string, next: JsonValue | undefined): void }) {
  const app = useApp();
  const routines = Object.values(props.world.routines ?? {}).filter((r) => r.owner === props.id);
  const schedules = Object.values(props.world.schedules).filter((s) => s.owner === props.id);
  return (
    <Section title="Their day">
      <CheckField label="Lives their own day (agendas and plans)" checked={props.value.agent === true} onChange={(on) => props.onChange({ ...props.value, agent: on })} />
      <FormGroup title="Routine">
        {routines.length === 0 ? <span class="lre-small lre-muted">No routine of their own: they keep the basic needs, and any routine their group or kind has.</span> : null}
        {routines.map((r) => (
          <ItemRow key={r.id} title={r.label ?? humanize(r.id)} subtitle={`${r.blocks.length} ${r.blocks.length === 1 ? "block" : "blocks"}`} openLabel="Edit their routine" onOpen={() => go(app, { view: "item", worldId: props.world.id, collection: "routines", id: r.id })} />
        ))}
      </FormGroup>
      {schedules.length > 0 ? (
        <FormGroup title="Schedules">
          {schedules.map((s) => (
            <ItemRow key={s.id} title={humanize(s.id)} subtitle={`Sets ${humanize(s.target)}`} openLabel="Edit the schedule" onOpen={() => go(app, { view: "item", worldId: props.world.id, collection: "schedules", id: s.id })} />
          ))}
        </FormGroup>
      ) : null}
      <SectionFields section="day" model={props.model} value={props.value} ctx={props.ctx} onField={props.onField} />
    </Section>
  );
}

/** Entities of a kind (or one extending it), by name, for a picker. */
function entitiesOfKind(doc: WorldDoc, kind: string): RefOption[] {
  return Object.values(doc.entities)
    .filter((e) => kindIs(doc, e.kind, kind))
    .map((e) => ({ value: e.id, label: e.name }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Their relations by group, each with remove, and a new one to someone picked by name. */
function People(props: { world: WorldDoc; id: string; value: JsonObject; onChange(next: JsonObject): void }) {
  const relations = Array.isArray(props.value.relations) ? props.value.relations : [];
  const groups = relationGroups(relations);
  const [type, setType] = useState("");
  const [to, setTo] = useState("");
  const nameOf = (id: string): string => props.world.entities[id]?.name ?? humanize(id);
  const labelOf = (t: string): string => props.world.relations[t]?.label ?? humanize(t);
  // Relations a person can hold toward people or groups: never what the space and gear packs write.
  const types: RefOption[] = Object.values(props.world.relations)
    .filter((r) => r.id !== "in" && r.id !== "travels_with" && r.id !== "worn_by" && r.id !== "equipped" && r.id !== "uses")
    .map((r) => ({ value: r.id, label: r.label ?? humanize(r.id) }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const people: RefOption[] = Object.values(props.world.entities)
    .filter((e) => e.id !== props.id && (kindIs(props.world, e.kind, "person") || kindIs(props.world, e.kind, "group")))
    .map((e) => ({ value: e.id, label: e.name, ...(kindIs(props.world, e.kind, "group") ? { sublabel: "a group" } : {}) }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const remove = (index: number): void => props.onChange({ ...props.value, relations: relations.filter((_, i) => i !== index) });
  const add = (): void => {
    props.onChange({ ...props.value, relations: [...relations, { type, to }] });
    setTo("");
  };
  return (
    <Section title="People">
      {(Object.keys(groups) as RelationGroup[]).map((g) =>
        groups[g].length === 0 ? null : (
          <FormGroup key={g} title={GROUP_LABEL[g]}>
            {groups[g].map((r) => (
              <ItemRow key={r.index} title={nameOf(r.to)} subtitle={labelOf(r.type)} actions={<IconButton icon="trash" label={`Remove ${labelOf(r.type)} ${nameOf(r.to)}`} onClick={() => remove(r.index)} />} />
            ))}
          </FormGroup>
        ),
      )}
      {relations.length === 0 ? <span class="lre-small lre-muted">No one yet.</span> : null}
      <FormGroup title="Add someone">
        <RefPicker label="How they're tied" value={type} options={types} placeholder="Pick a relation" onChange={setType} />
        <RefPicker label="To" value={to} options={people} placeholder="Search people and groups by name" onChange={setTo} />
        <Button size="sm" icon="plus" disabled={type === "" || to === ""} onClick={add}>
          Add
        </Button>
        <span class="lre-small lre-muted">A relation's own details (how warm, since when) are under All fields → Relations.</span>
      </FormGroup>
    </Section>
  );
}

/** What the world puts on them, and the vehicles and property they own, each opening its page. */
function ThingsTheyHave(props: { world: WorldDoc; id: string }) {
  const app = useApp();
  const owns = (e: WorldDoc["entities"][string]): boolean => e.fields.owner === props.id || (Array.isArray(e.fields.owners) && e.fields.owners.includes(props.id));
  const owned = Object.values(props.world.entities).filter((e) => (kindIs(props.world, e.kind, "vehicle") || kindIs(props.world, e.kind, "property")) && owns(e));
  const carried = authoredContents(props.world, props.id, "entities");
  const open = (id: string): void => go(app, { view: "item", worldId: props.world.id, collection: "entities", id });
  return (
    <div data-lre-contents={props.id}>
      <Section title="Things they have">
        {carried.length === 0 && owned.length === 0 ? <span class="lre-small lre-muted">Nothing the world puts on them, and no vehicle or property of theirs.</span> : null}
        {carried.map((row) => (
          <ItemRow key={row.id} title={row.name} subtitle="On them" badge={row.hidden ? <Badge tone="gm">Hidden until searched</Badge> : undefined} openLabel={`Open ${row.name}`} onOpen={() => open(row.id)} />
        ))}
        {owned.map((e) => (
          <ItemRow key={e.id} title={e.name} subtitle={`Theirs · ${humanize(e.kind)}`} openLabel={`Open ${e.name}`} onOpen={() => open(e.id)} />
        ))}
      </Section>
    </div>
  );
}
