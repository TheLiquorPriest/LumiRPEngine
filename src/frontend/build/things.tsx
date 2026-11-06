// Build → Things (ITEMS-SPEC §10.1, mobile first): the world's things by place (a tree of places,
// what lies there and what holds what) and by owner (each owner's things on them, at home and
// elsewhere), with a search through the name resolver; Add a thing in four fields (its name, what it
// is: its kind, Item to Ammo or a Vehicle, then a type of that kind from the catalogs, a size in words
// or a vehicle's class; where it is, whose); a thing's page (where it is and is
// kept, whose, who may use it and why, what it is, what it holds, its secrecy and every field under
// Advanced, never a tier or a life); a person's things in the Character page's groups, each with
// Move, Give, Lend and Remove; and a place's furnishings and loose things. Everything is read from
// `lre.things` (the draft as a chat would start) and written as one draft patch per change.

import type { ComponentChildren } from "preact";
import { useEffect, useId, useMemo, useState } from "preact/hooks";
import type { EntityId, WorldId } from "../../shared/ids";
import type { JsonObject, JsonValue } from "../../shared/json";
import { hasOwn, isRecord } from "../../shared/json";
import type { JsonPatchOp, LintIssue, ResultBodies, ThingsRead } from "../../shared/protocol";
import type { GrantBasis, Size, SizeClass, Spot } from "../../shared/things";
import { isSize, SIZE_LABELS, SIZES, THING_NAME_MAX } from "../../shared/things";
import type { GrantView, OwnerGroup, PartyRef, PersonThings, ThingPage as ThingPageView, ThingPicks, ThingRow, ThingType, WhereChoice } from "../../shared/thing-view";
import { GRANT_WORDS, presumedLine, SIZE_FROM_WORDS, SIZE_WORDS, sizeLabel, whoseWords } from "../../shared/thing-view";
import { vehicleClassChoices, vehicleSpecsOf, worldHasAir, type VehicleClassChoice, type VehiclePick } from "../../shared/vehicles";
import { playedKinds, type WorldDoc } from "../../shared/world";
import { VehiclePicker } from "../../packs/vehicles/ui/picker";
import { useApp } from "../app";
import { TextListEditor } from "../character/text-list";
import { wordsOf } from "../character/places";
import { Badge, Banner, Button, Disclosure, Empty, HostSelect, IconButton, List, ListRow, PageHeader, SaveBar, Section, Seg, useBusy } from "../components";
import { Icon } from "../icons";
import { PickBox } from "../multi-select";
import type { EditorProps, Send } from "../registry";
import { thingsRequest } from "../requests";
import { useSelect } from "../store";
import { cannotHold, stepWords, whereLabel } from "../things/where";
import { WherePicker, WhereSheet, type WhereExtra, type WherePick } from "../things/where-picker";
import { KindChips, sizeOfWhat, suggestedName, THING_KINDS, TypeSheet, whatWords, type ThingKind, type WhatItIs } from "../things/what-it-is";
import { SpecsEditor } from "../things/specs";
import { entityFormSpecs, entityPatch } from "./character-model";
import { go, ItemHeader, OverflowMenu, type MenuItem } from "./chrome";
import { RevealItem } from "./contents";
import { CheckField, FormGroup, FormSheet, RefPicker, type RefOption } from "./form-kit";
import { useHeld } from "./held";
import { COLLECTION_SPECS } from "./schema";
import { lintAt, NumberInput, SchemaFields, TextInput, worldIdentifiers, type FormCtx } from "./schema-form";
import { draftSend } from "./draft";
import { draftEntity, giveOps, grantOps, lendOps, moveOps, newThing, ownerBuckets, ownerCounts, partyRoute, placeSections, removeOps, revokeOps, spotOfEntity, treeCount, withField, withKept, withOwner, withWhere, type PlaceSection, type TreeNode } from "./things-model";

type ThingsBody = ResultBodies["lre.things"];

/** Reads `lre.things` for the open draft again whenever the draft changes (`version`): null while it loads, `failed` when it couldn't be read. */
function useThings(worldId: WorldId, read: ThingsRead | null, version: number | undefined): { body: ThingsBody | null; failed: boolean } {
  const app = useApp();
  const [state, setState] = useState<{ body: ThingsBody | null; failed: boolean }>({ body: null, failed: false });
  const key = read ? JSON.stringify(read) : "";
  useEffect(() => {
    if (!read) return;
    let live = true;
    void app.request(thingsRequest(worldId, read)).then((body) => {
      if (live) setState({ body, failed: body === null });
    });
    return () => {
      live = false;
    };
  }, [app, worldId, key, version]);
  return state;
}

/** The draft's issues on each thing, by id: the worst one's severity, warnings and errors only. */
export function problemsById(lint: readonly LintIssue[]): ReadonlyMap<string, "error" | "warning"> {
  const out = new Map<string, "error" | "warning">();
  for (const issue of lint) {
    const [head, id] = issue.path.split(".");
    if (head !== "entities" || !id || issue.severity === "info") continue;
    if (out.get(id) !== "error") out.set(id, issue.severity);
  }
  return out;
}

// ---------------------------------------------------------------- rows and trees

/** A thing's chips and badges: its size (Built-in among them), whose it is, Worn, and Hidden until searched, Secret, a problem. */
export function ThingChips(props: { row: ThingRow; problem?: "error" | "warning"; whose?: boolean }) {
  const { row } = props;
  return (
    <span class="lre-thing-chips">
      <span class={`lre-thing-chip${row.size === "unknown" ? " muted" : ""}`} data-lre-size={row.size}>
        {sizeLabel(row.size)}
      </span>
      {props.whose !== false ? <span class="lre-thing-chip" data-lre-whose="">{whoseWords(row.whose)}</span> : null}
      {row.worn !== null ? <span class="lre-thing-chip">Worn</span> : null}
      {row.hidden ? <Badge tone="gm">Hidden until searched</Badge> : null}
      {row.secret ? <Badge tone="gm">Secret</Badge> : null}
      {props.problem ? (
        <Badge tone={props.problem === "error" ? "neg" : "warn"}>
          <Icon name="alert" size={12} />
          <span class="lre-sr">{props.problem === "error" ? "An error" : "A problem"}</span>
        </Badge>
      ) : null}
    </span>
  );
}

/**
 * One thing as a list row: its name (and how many things are in it), its chips on the line under
 * it, the whole row opening its page; `toggle` shows or hides what it holds; `menu` its actions.
 * `picked` set (a list's Select mode): the row shows its box, and its tap picks it (`onOpen`, which
 * the list makes its toggle) instead of opening it.
 */
export function ThingRowView(props: { row: ThingRow; depth?: number; sub?: ComponentChildren; problem?: "error" | "warning"; whose?: boolean; expanded?: boolean; picked?: boolean; onToggle?(): void; onOpen(id: EntityId): void; menu?: readonly MenuItem[] }) {
  const { row } = props;
  const onToggle = props.onToggle;
  const picking = props.picked !== undefined;
  const text = (
    <>
      <span class="lre-thing-name">
        {row.name}
        {row.inside > 0 ? <span class="lre-thing-count"> ({row.inside})</span> : null}
      </span>
      {props.sub !== undefined ? <span class="lre-thing-sub">{props.sub}</span> : null}
      <ThingChips row={row} problem={props.problem} whose={props.whose} />
    </>
  );
  return (
    <div class={`lre-thing-row${props.picked ? " picked" : ""}`} role="listitem" data-lre-thing={row.id} style={{ "--lre-depth": String(Math.min(props.depth ?? 0, 4)) }}>
      {onToggle ? <IconButton icon={props.expanded ? "chevron-down" : "chevron-right"} label={`${props.expanded ? "Hide" : "Show"} what is in ${row.name}`} pressed={props.expanded} onClick={onToggle} /> : <span class="lre-thing-gap" aria-hidden="true" />}
      <button type="button" class={picking ? "lre-thing-open picking" : "lre-thing-open"} aria-label={picking ? `Pick ${row.name}` : `Open ${row.name}`} aria-pressed={picking ? props.picked : undefined} onClick={() => props.onOpen(row.id)}>
        {picking ? (
          <>
            <PickBox label={`Pick ${row.name}`} checked={props.picked === true} />
            <span class="lre-thing-text">{text}</span>
          </>
        ) : (
          text
        )}
      </button>
      {!picking && props.menu && props.menu.length > 0 ? <OverflowMenu label={`${row.name}: actions`} items={props.menu} /> : null}
    </div>
  );
}

/** A tree's nodes as rows, nested: a holder's contents under it while it is open; someone holding things heads what they hold. `picked`: the list is choosing. */
export function TreeRows(props: { nodes: readonly TreeNode[]; depth: number; open: ReadonlySet<string>; problems: ReadonlyMap<string, "error" | "warning">; picked?: ReadonlySet<string>; onToggle(id: string): void; onOpen(id: EntityId): void }) {
  return (
    <>
      {props.nodes.map((node) => {
        if ("holder" in node) {
          return (
            <div key={node.holder.id} class="lre-thing-holder" data-lre-holder={node.holder.id}>
              <div class="lre-thing-holder-name" style={{ "--lre-depth": String(Math.min(props.depth, 4)) }}>
                <Icon name={node.holder.is === "person" ? "user" : "box"} size={14} />
                {node.holder.is === "person" ? `On ${node.holder.name}` : `In ${node.holder.name}`}
              </div>
              <TreeRows nodes={node.children} depth={props.depth + 1} open={props.open} problems={props.problems} picked={props.picked} onToggle={props.onToggle} onOpen={props.onOpen} />
            </div>
          );
        }
        const open = props.open.has(node.thing.id);
        return (
          <div key={node.thing.id} class="lre-thing-node">
            <ThingRowView row={node.thing} depth={props.depth} problem={props.problems.get(node.thing.id)} expanded={open} picked={props.picked?.has(node.thing.id)} onToggle={node.children.length > 0 ? () => props.onToggle(node.thing.id) : undefined} onOpen={props.onOpen} />
            {open ? <TreeRows nodes={node.children} depth={props.depth + 1} open={props.open} problems={props.problems} picked={props.picked} onToggle={props.onToggle} onOpen={props.onOpen} /> : null}
          </div>
        );
      })}
    </>
  );
}

/** By place: each place that has things, headed by its path, its tree under it. */
export function PlaceTree(props: { sections: readonly PlaceSection[]; open: ReadonlySet<string>; problems: ReadonlyMap<string, "error" | "warning">; from?: number; picked?: ReadonlySet<string>; onToggle(id: string): void; onOpen(id: EntityId): void }) {
  return (
    <div class="lre-thing-tree" data-lre-by="place">
      {props.sections.map((s) => {
        const key = s.path.at(-1)?.id ?? "";
        const shown = s.path.slice(props.from ?? 0);
        return (
          <section key={key} class="lre-thing-place" data-lre-place-section={key}>
            <h3 class="lre-thing-place-head">
              {shown.length === 0 ? (
                <span class="lre-cp-path lre-muted">{s.path.length === 0 ? "Nowhere: lost, or never put anywhere" : "Here"}</span>
              ) : (
                <span class="lre-cp-path">
                  {shown.slice(0, -1).map((step) => (
                    <span key={step.id} class="lre-cp-path-up">
                      {step.name}
                      <span class="lre-cp-sep" aria-hidden="true">
                        ›
                      </span>
                    </span>
                  ))}
                  <span class="lre-cp-path-name">{shown.at(-1)?.name}</span>
                </span>
              )}
              <span class="lre-thing-place-count">{treeCount(s.nodes)}</span>
            </h3>
            <div role="list">
              <TreeRows nodes={s.nodes} depth={0} open={props.open} problems={props.problems} picked={props.picked} onToggle={props.onToggle} onOpen={props.onOpen} />
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** By owner: each owner with their counts and a link to their page, opened to their things on them, at home and elsewhere. */
export function OwnerList(props: { groups: readonly OwnerGroup[]; rows: ReadonlyMap<string, ThingRow>; open: ReadonlySet<string>; problems: ReadonlyMap<string, "error" | "warning">; picked?: ReadonlySet<string>; onToggle(key: string): void; onOpen(id: EntityId): void; onParty(party: PartyRef): void }) {
  return (
    <div class="lre-thing-tree" data-lre-by="owner">
      {props.groups.map((g) => {
        const key = g.owner?.id ?? "";
        const open = props.open.has(key);
        const name = g.owner?.name ?? "Nobody's";
        const page = g.owner ? partyRoute(g.owner) : null;
        const owner = g.owner;
        return (
          <section key={key} class="lre-thing-owner" data-lre-owner={key}>
            <div class="lre-thing-owner-head">
              <IconButton icon={open ? "chevron-down" : "chevron-right"} label={`${open ? "Hide" : "Show"} ${name}: things`} pressed={open} onClick={() => props.onToggle(key)} />
              <span class="lre-thing-owner-text">
                <span class="lre-thing-owner-name">
                  {name}
                  {owner?.is && owner.is !== "person" && owner.is !== "other" ? <span class="lre-thing-owner-is"> · {owner.is === "company" ? "business" : owner.is}</span> : null}
                </span>
                <span class="lre-thing-sub">{ownerCounts(g) || "Nothing"}</span>
              </span>
              {owner && page ? (
                <Button size="sm" variant="ghost" label={`Open ${owner.name}'s page`} onClick={() => props.onParty(owner)}>
                  Open
                </Button>
              ) : null}
            </div>
            {open
              ? ownerBuckets(g).map((b) =>
                  b.ids.length === 0 ? null : (
                    <div key={b.key} class="lre-thing-bucket" data-lre-bucket={b.key}>
                      <div class="lre-thing-bucket-head">{b.label}</div>
                      <div role="list">
                        {b.ids.map((id) => {
                          const row = props.rows.get(id);
                          return row ? <ThingRowView key={id} row={row} sub={whereWords(row)} whose={false} problem={props.problems.get(id)} picked={props.picked?.has(id)} onOpen={props.onOpen} /> : null;
                        })}
                      </div>
                    </div>
                  ),
                )
              : null}
          </section>
        );
      })}
    </div>
  );
}

/** Where a thing is, as a row's second line: "On Jordan Ellis, in Wallet", "At Alder Automotive", "Nowhere". */
export function whereWords(row: ThingRow): string {
  const at = row.where.at(-1);
  if (!at) return "Nowhere";
  const place = row.where.findLast((s) => s.is === "place");
  const held = row.where.slice(row.where.findLastIndex((s) => s.is === "place") + 1);
  const text = held.length > 0 ? held.map(stepWords).join(", ") : place ? stepWords(place) : stepWords(at);
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}${held.length > 0 && place ? ` (${stepWords(place)})` : ""}`;
}

// ---------------------------------------------------------------- the Things page

/** Build → Things: search, By place / By owner, + Add a thing, and the way to the things settings (the gear pack's). */
export function ThingsPage() {
  const app = useApp();
  const draft = useSelect(app.drafts, (d) => d);
  const worldId = draft?.worldId ?? "";
  const { body, failed } = useThings(worldId, draft ? { op: "list" } : null, draft?.version);
  const [by, setBy] = useState<"place" | "owner">("place");
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<{ words: string; ids: EntityId[] } | null>(null);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [owners, setOwners] = useState<ReadonlySet<string> | null>(null);
  const [adding, setAdding] = useState(false);
  const words = query.trim();
  useEffect(() => {
    if (words === "" || !draft) return;
    let live = true;
    // A short wait, so a word typed is one search, not one per keystroke.
    const timer = setTimeout(() => {
      void app.request(thingsRequest(worldId, { op: "find", words })).then((answer) => {
        if (live && answer?.found) setFound({ words, ids: answer.found });
      });
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [words, worldId, draft?.version]);
  const list = body?.list ?? null;
  const rows = useMemo(() => new Map((list?.rows ?? []).map((r) => [r.id, r])), [list]);
  const sections = useMemo(() => (list ? placeSections(list.rows) : []), [list]);
  const problems = useMemo(() => problemsById(draft?.lint ?? []), [draft?.lint]);
  if (!draft) return null;
  const toggle = (set: ReadonlySet<string>, id: string): ReadonlySet<string> => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  };
  // By owner opens on the player character's things.
  const ownersOpen = owners ?? new Set([draft.doc.pov]);
  const openThing = (id: EntityId): void => go(app, { view: "item", worldId, collection: "entities", id });
  const results = found && found.words === words ? found.ids.flatMap((id) => rows.get(id) ?? []) : null;
  return (
    <div class="lre-build-page lre-things-page" data-lre-things="">
      <PageHeader
        title="Things"
        subtitle="What people have and places hold"
        actions={
          <Button size="sm" variant="primary" icon="plus" label="Add a thing" disabled={!list} onClick={() => setAdding(true)}>
            Add
          </Button>
        }
      />
      <label class="lre-build-search">
        <Icon name="search" size={16} />
        <input class="lre-input" type="search" placeholder="Search things: “Marcus's key”, “the wrench on the bench”" aria-label="Search things" value={query} onInput={(event) => setQuery(event.currentTarget.value)} />
      </label>
      {failed ? (
        <Empty icon="alert" title="Things couldn't be read.">
          The draft can't start a chat as it stands; Problems says why.
        </Empty>
      ) : !list ? (
        <Empty icon="hourglass">Reading the world's things…</Empty>
      ) : words !== "" ? (
        results === null ? (
          <Empty icon="hourglass">Searching…</Empty>
        ) : results.length === 0 ? (
          <Empty icon="search" title="No matches">
            No thing is called “{words}”, or has a name starting with it.
          </Empty>
        ) : (
          <Section title={results.length === 1 ? "1 thing" : `${results.length} things`} flush>
            <div class="lre-thing-tree" role="list" data-lre-found="">
              {results.map((row) => (
                <ThingRowView key={row.id} row={row} sub={whereWords(row)} problem={problems.get(row.id)} onOpen={openThing} />
              ))}
            </div>
          </Section>
        )
      ) : list.rows.length === 0 ? (
        <Empty icon="box" title="No things yet" action={<Button variant="primary" icon="plus" onClick={() => setAdding(true)}>Add a thing</Button>}>
          A thing is anything someone has or a place holds: keys, a toolbox, a fridge, a truck.
        </Empty>
      ) : (
        <>
          <Seg<"place" | "owner">
            label="Show things"
            value={by}
            options={[
              { value: "place", label: "By place" },
              { value: "owner", label: "By owner" },
            ]}
            onChange={setBy}
          />
          {by === "place" ? (
            <PlaceTree sections={sections} open={open} problems={problems} onToggle={(id) => setOpen(toggle(open, id))} onOpen={openThing} />
          ) : (
            <OwnerList
              groups={list.owners}
              rows={rows}
              open={ownersOpen}
              problems={problems}
              onToggle={(key) => setOwners(toggle(ownersOpen, key))}
              onOpen={openThing}
              onParty={(party) => {
                const page = partyRoute(party);
                if (page) go(app, { view: "item", worldId, collection: page.collection, id: page.id });
              }}
            />
          )}
        </>
      )}
      <Section flush>
        <List>
          <ListRow icon="sliders" title="Things settings" subtitle="Sizes, who may use what, everyday carry and putting away: the Gear pack's settings" chevron onClick={() => go(app, { view: "item", worldId, collection: "packs", id: "gear" })} />
        </List>
      </Section>
      {adding && list ? <AddThing doc={draft.doc} pick={list.pick} onClose={() => setAdding(false)} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------- Add a thing

/** The where picker's value for a spot, from its choices. */
function pickOf(pick: ThingPicks, spot: Spot | null): WherePick | null {
  if (spot === null) return null;
  const id = "place" in spot ? spot.place : spot.in;
  const choice = pick.where.find((c) => c.id === id);
  return choice ? { choice } : null;
}

/** A choice as the spot it puts a thing at. */
function spotOfChoice(choice: WhereChoice): Spot {
  return choice.is === "place" ? { place: choice.id } : { in: choice.id };
}

/** Where a thing is kept, as the Kept at picker offers it: where it is, or on its owner. */
const KEPT_EXTRAS: readonly WhereExtra[] = [
  { value: "here", label: "Where it is", help: "It is kept where it is; moved, it is kept there" },
  { value: "owner", label: "On its owner", help: "Its owner carries it: wallet, keys, phone" },
];

/** The Kept at picker's value for a stored `home`: on its owner, a place or a holder, or where it is. */
function keptPick(pick: ThingPicks, home: JsonValue | undefined): WherePick {
  if (home === "owner") return { extra: "owner" };
  const choice = typeof home === "string" ? pick.where.find((c) => c.id === home) : undefined;
  return choice ? { choice } : { extra: "here" };
}

/** A Kept at pick as the `home` it stores; null: where it is. */
function keptValue(next: WherePick | null): string | null {
  if (next === null || ("extra" in next && next.extra === "here")) return null;
  return "extra" in next ? next.extra : next.choice.id;
}

/** People and organizations as the whose picker offers them, each with what it is. */
function partyOptions(parties: readonly PartyRef[]): RefOption[] {
  return parties.map((p) => ({ value: p.id, label: p.name, ...(p.is !== "person" ? { sublabel: p.is === "company" ? "a business" : `a ${p.is}` } : {}) }));
}

/** The vehicle classes Add a thing offers in a world: its own table's, for a year (the one it starts in, unless said), aircraft only where it has air routes. */
export function buildClasses(doc: WorldDoc, year: number = Number(doc.start.at.slice(0, 4))): VehicleClassChoice[] {
  return vehicleClassChoices(doc.tables["vehicles.classes"], { year, air: worldHasAir(doc) });
}

/**
 * Add a thing (ITEMS-SPEC §10.1): one sheet of four fields: its name; what it is (its kind, a chip
 * each, then a type from the catalogs of that kind, which gives its size and details, or something
 * else, a size in words; a vehicle's class from the vehicle picker); where it is; whose (or
 * nobody's, with what that means where it is). Kept at follows Where unless changed. Create puts it
 * in the draft and opens its page; `preset` starts Where and Whose ("Give them a thing").
 */
export function AddThing(props: { doc: WorldDoc; pick: ThingPicks; preset?: { where?: Spot; owner?: string | null }; onClose(): void; onCreated?(id: EntityId): void }) {
  const app = useApp();
  const send = useMemo(() => draftSend(app), [app]);
  const [busy, run] = useBusy();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ThingKind>("item");
  const [what, setWhat] = useState<WhatItIs>(null);
  const [choosing, setChoosing] = useState(false);
  const [types, setTypes] = useState<ThingType[] | null>(null);
  const [where, setWhere] = useState<WherePick | null>(() => pickOf(props.pick, props.preset?.where ?? null));
  const [owner, setOwner] = useState<string>(props.preset?.owner ?? "");
  const [kept, setKept] = useState<WherePick>({ extra: "here" });
  const nameId = useId();
  const classes = useMemo(() => buildClasses(props.doc), [props.doc]);
  useEffect(() => {
    let live = true;
    void app.request(thingsRequest(props.doc.id, { op: "types" })).then((answer) => {
      if (live) setTypes(answer?.types ?? []);
    });
    return () => {
      live = false;
    };
  }, [props.doc.id]);
  const vehicle = kind === "vehicle";
  const size = sizeOfWhat(what);
  const choice = where && "choice" in where ? where.choice : null;
  const tooBig = choice ? cannotHold(choice, size) : null;
  const trimmed = name.trim();
  const ready = trimmed !== "" && trimmed.length <= THING_NAME_MAX && what !== null && choice !== null && tooBig === null && (!vehicle || choice.is === "place");
  const presumes = owner === "" && choice ? presumedLine(choice.presumes) : null;
  const pickKind = (next: ThingKind): void => {
    if (next === kind) return;
    setKind(next);
    setWhat(null);
  };
  const pickWhat = (next: WhatItIs): void => {
    setWhat(next);
    setChoosing(false);
    const named = suggestedName(next);
    if (named !== null && trimmed === "") setName(named.slice(0, THING_NAME_MAX));
  };
  const create = () =>
    run(async () => {
      if (!ready || !choice) return;
      const typed = what !== null && "type" in what ? what.type : null;
      const row = typed ? props.doc.tables[typed.table]?.rows[typed.id] : undefined;
      const made = newThing(props.doc, {
        name: trimmed,
        type: typed && row ? { type: typed, row } : null,
        size: what !== null && "size" in what ? what.size : null,
        is: vehicle ? null : kind,
        vehicle: what !== null && "vehicle" in what ? what.vehicle : null,
        where: spotOfChoice(choice),
        owner: owner === "" ? null : owner,
        kept: keptValue(kept),
      });
      const sent = await send({ type: "lre.editor", worldId: props.doc.id, base: null, op: "put", collection: "entities", id: made.id, value: made.value });
      if (sent.type !== "lre.result") return;
      props.onClose();
      if (props.onCreated) props.onCreated(made.id);
      else go(app, { view: "item", worldId: props.doc.id, collection: "entities", id: made.id });
    });
  return (
    <FormSheet
      title="Add a thing"
      subtitle="Four fields: what it's called, what it is, where it is, whose"
      onClose={props.onClose}
      actions={
        <Button size="sm" variant="primary" disabled={!ready} busy={busy} onClick={create}>
          Create
        </Button>
      }
    >
      <div class="lre-stack" data-lre-add-thing={kind}>
        <div class="lre-field">
          <label class="label" for={nameId}>
            1. Name
          </label>
          <input id={nameId} class="lre-input" value={name} maxLength={THING_NAME_MAX} placeholder={vehicle ? "Delivery van" : "Torque wrench"} onInput={(event) => setName(event.currentTarget.value)} />
        </div>
        <div class="lre-field" data-lre-what="">
          <span class="label">2. What is it?</span>
          <KindChips value={kind} kinds={classes.length > 0 ? THING_KINDS : THING_KINDS.filter((k) => k !== "vehicle")} onPick={pickKind} />
          <div class="lre-cp-value">
            <span class="lre-cp-path">{what === null ? <span class="lre-muted">Not picked yet</span> : whatWords(what)}</span>
            <Button size="sm" icon={vehicle ? "car" : "search"} onClick={() => setChoosing(true)}>
              {what === null ? "Pick…" : "Change…"}
            </Button>
          </div>
          <span class="lre-field-help">{vehicle ? "Its class gives its fuel, range and price; its make, model and year are yours to set." : "A type from the catalogs gives its size and details; Something else asks how big it is."}</span>
        </div>
        <WherePicker title="3. Where is it?" choices={vehicle ? props.pick.where.filter((c) => c.is === "place") : props.pick.where} value={where} size={size} onPick={setWhere} action={where ? "Change…" : "Pick…"} empty="Not picked yet" help={tooBig ?? (vehicle ? "A place it stands at." : "A place, someone who has it, or what holds it.")} />
        {tooBig ? <Banner tone="warn">{tooBig}: pick a place, or something that takes it.</Banner> : null}
        <div class="lre-field" data-lre-whose="">
          <RefPicker label="4. Whose?" value={owner} options={partyOptions(props.pick.parties)} none="Nobody" onChange={setOwner} />
          <span class="lre-field-help">{owner === "" ? (presumes ?? "Pick where it is to see what nobody's means there.") : "A person, a household, a business or a group."}</span>
        </div>
        <WherePicker title="Kept at" choices={props.pick.where} value={kept} size={size} extras={KEPT_EXTRAS} onPick={(next) => setKept(next ?? { extra: "here" })} help="Where it goes back to when nobody is using it." />
      </div>
      {choosing && vehicle ? <VehiclePicker classes={classes} value={what !== null && "vehicle" in what ? what.vehicle.id : null} title="What vehicle?" onClose={() => setChoosing(false)} onPick={(pick: VehiclePick) => pickWhat({ vehicle: pick })} /> : null}
      {choosing && !vehicle ? <TypeSheet types={types} kind={kind} value={what} onClose={() => setChoosing(false)} onPick={pickWhat} /> : null}
    </FormSheet>
  );
}

// ---------------------------------------------------------------- a thing's page

/** Who may use it (ITEMS-SPEC §3.4): each ground as a chip, then each grant as a row with ×, then Let someone use it. */
export function UseSection(props: { chips: ThingPageView["use"]; grants: readonly GrantView[]; added: readonly { who: PartyRef; basis: GrantBasis }[]; dropped: ReadonlySet<string>; people: readonly RefOption[]; adding: string; disabled?: boolean; onAdding(who: string): void; onAdd(): void; onDrop(who: string): void }) {
  const grants = props.grants.filter((g) => !props.dropped.has(g.who.id));
  return (
    <Section title="Who may use it">
      <div class="lre-thing-chips wrap" data-lre-use="">
        {props.chips.length === 0 ? <span class="lre-small lre-muted">Nobody, but by a grant.</span> : null}
        {props.chips.map((c) => (
          <span key={c.label} class="lre-thing-chip" title={c.who.join(", ")} data-lre-basis={c.basis}>
            {c.label}
          </span>
        ))}
      </div>
      <div class="lre-form-items" data-lre-grants="">
        {grants.map((g) => (
          <div key={g.who.id} class="lre-form-item">
            <span class="lre-form-item-open">
              <span class="lre-form-item-text">
                <span class="lre-form-item-title">{g.who.name}</span>
                <span class="lre-form-item-sub">{[GRANT_WORDS[g.basis], g.until !== null ? `until ${g.until}` : null].filter((p) => p !== null).join(" · ")}</span>
              </span>
            </span>
            <span class="lre-form-item-actions">
              <IconButton icon="close" label={`Stop ${g.who.name} using it`} disabled={props.disabled} onClick={() => props.onDrop(g.who.id)} />
            </span>
          </div>
        ))}
        {props.added.map((g) => (
          <div key={`new:${g.who.id}`} class="lre-form-item">
            <span class="lre-form-item-open">
              <span class="lre-form-item-text">
                <span class="lre-form-item-title">{g.who.name}</span>
                <span class="lre-form-item-sub">{GRANT_WORDS[g.basis]} · not saved yet</span>
              </span>
            </span>
          </div>
        ))}
      </div>
      <FormGroup title="Let someone use it">
        <RefPicker label="Who" value={props.adding} options={props.people} placeholder="Pick a person" disabled={props.disabled} onChange={props.onAdding} />
        <Button size="sm" icon="plus" disabled={props.disabled || props.adding === ""} onClick={props.onAdd}>
          Let them use it
        </Button>
      </FormGroup>
    </Section>
  );
}

/** What it holds (ITEMS-SPEC §10.1): the size it takes, its contents with whose each is, and + Add inside. */
export function HoldsSection(props: { holds: Size; contents: readonly ThingRow[]; problems: ReadonlyMap<string, "error" | "warning">; onOpen(id: EntityId): void; onAdd(): void; children?: ComponentChildren }) {
  return (
    <Section
      title="Holds"
      aside={
        <Button size="sm" icon="plus" onClick={props.onAdd}>
          Add inside
        </Button>
      }
    >
      <span class="lre-small" data-lre-takes={props.holds}>
        Takes things up to {SIZE_LABELS[props.holds]}.
      </span>
      {props.children}
      <div class="lre-thing-tree" role="list">
        {props.contents.length === 0 ? <span class="lre-small lre-muted">Nothing is in it.</span> : null}
        {props.contents.map((row) => (
          <ThingRowView key={row.id} row={row} problem={props.problems.get(row.id)} onOpen={props.onOpen} />
        ))}
      </div>
    </Section>
  );
}

/** Its kind's fields that lay out elsewhere on the page, which Advanced leaves to them: every field still shows there. */
const PAGE_KEYS: ReadonlySet<string> = new Set(["tier", "agent", "life", "lifeKnownBy", "characterId", "cues", "levels"]);

/** A size field's choices: what its type says (or that nothing does), then the ladder. */
function sizeOptions(inferred: SizeClass, from: string): { value: string; label: string; sublabel?: string }[] {
  return [{ value: "", label: inferred === "unknown" ? "Not set (nothing gives one)" : `As inferred: ${sizeLabel(inferred)}`, sublabel: from }, ...SIZES.map((s) => ({ value: s, label: SIZE_LABELS[s], sublabel: SIZE_WORDS[s].means }))];
}

/**
 * A thing's page in Build (ITEMS-SPEC §10.1): its name with its type and size; where it is and
 * where it is kept, each with Change…; whose, with Change…; who may use it; what it is; what it
 * holds; Hidden until searched and Visibility; and every field, its relations and its id under
 * Advanced. No tier, Life or own day. Its changes, and the grants it makes or ends, save together.
 */
export function ThingPage(props: EditorProps) {
  const app = useApp();
  const draft = useSelect(app.drafts, (d) => d);
  const id = props.id ?? "";
  const stored = hasOwn(props.world.entities, id) ? props.world.entities[id] : undefined;
  const initial: JsonObject = stored ? (stored as unknown as JsonObject) : {};
  const storedKey = JSON.stringify(stored ?? null);
  const [value, setValue] = useState<JsonObject>(initial);
  const [added, setAdded] = useState<{ who: PartyRef; basis: GrantBasis }[]>([]);
  const [dropped, setDropped] = useState<ReadonlySet<string>>(new Set());
  const [adding, setAdding] = useState("");
  const [inside, setInside] = useState(false);
  const [choosingType, setChoosingType] = useState(false);
  const [types, setTypes] = useState<ThingType[] | null>(null);
  const [busy, run] = useBusy();
  useHeld(value, setValue, initial, `${props.world.id}/entities/${id}`, storedKey);
  const { body, failed } = useThings(props.world.id, { op: "thing", entity: id }, draft?.version);
  const formDoc: WorldDoc = useMemo(() => ({ ...props.world, kinds: playedKinds(draft?.packKinds, props.world.kinds), relations: { ...draft?.packRelations, ...props.world.relations } }), [props.world, draft?.packKinds, draft?.packRelations]);
  const identifiers = useMemo(() => worldIdentifiers(props.world), [props.world]);
  useEffect(() => {
    if (!choosingType || types !== null) return;
    void app.request(thingsRequest(props.world.id, { op: "types" })).then((answer) => setTypes(answer?.types ?? []));
  }, [choosingType]);
  const page = body?.thing ?? null;
  const pick = body?.pick ?? null;
  const path = `entities.${id}`;
  const lint = draft?.lint ?? [];
  const ctx: FormCtx = { doc: formDoc, lint, path, identifiers, functions: draft?.functions ?? [], fieldEditors: app.catalog.fields };
  const fields = isRecord(value.fields) ? value.fields : {};
  const changed = JSON.stringify(value) !== storedKey || added.length > 0 || dropped.size > 0;
  const name = typeof value.name === "string" && value.name !== "" ? value.name : id;
  const gear = props.world.realism.levels.gear ?? 0;
  const problems = useMemo(() => problemsById(lint), [lint]);
  const save = () =>
    run(async () => {
      const ops: JsonPatchOp[] = [...entityPatch(id, initial, value), ...[...dropped].flatMap((who) => revokeOps(props.world, who, id)), ...added.flatMap((g) => grantOps(g.who.id, id, g.basis))];
      if (ops.length === 0) return;
      const sent = await props.send({ type: "lre.editor", worldId: props.world.id, base: null, op: "patch", ops });
      if (sent.type === "lre.result") {
        setAdded([]);
        setDropped(new Set());
      }
    });
  const revert = (): void => {
    setValue(initial);
    setAdded([]);
    setDropped(new Set());
  };
  const remove = () =>
    run(async () => {
      if (!(await app.host.confirm("Remove the thing", `Remove “${name}” from the world? What is in it stays where it was.`, "danger", "Remove"))) return;
      const sent = await props.send({ type: "lre.editor", worldId: props.world.id, base: null, op: "patch", ops: removeOps(props.world, id) });
      if (sent.type === "lre.result") go(app, { view: "entities", worldId: props.world.id, group: "things" });
    });
  if (!stored) return <Empty icon="alert">This thing isn't in the draft.</Empty>;
  const row = page?.row ?? null;
  const spot = spotOfEntity(value);
  const where = pick ? pickOf(pick, spot) : null;
  const owners = Array.isArray(fields.owners);
  const owner = typeof fields.owner === "string" ? fields.owner : "";
  const presumes = !owners && owner === "" && where && "choice" in where ? presumedLine(where.choice.presumes) : null;
  const typeId = typeof fields.catalog === "string" ? fields.catalog : "";
  const people = pick ? partyOptions(pick.parties.filter((p) => p.is === "person" && !added.some((g) => g.who.id === p.id))) : [];
  return (
    <div class="lre-build-page lre-thing-page" data-lre-editor="thing">
      <ItemHeader
        title={name}
        id={id}
        subtitle={row ? <ThingChips row={row} whose={false} problem={problems.get(id)} /> : undefined}
        menu={[{ label: "Remove from the world", icon: "trash", danger: true, disabled: busy, onSelect: remove }]}
        busy={busy}
      />
      {lintAt(lint, path).map((issue, i) => (
        <Banner key={`${issue.code}:${i}`} tone={issue.severity === "error" ? "neg" : issue.severity === "warning" ? "warn" : "info"}>
          {issue.message}
        </Banner>
      ))}
      {failed ? <Banner tone="warn">The draft can't start a chat as it stands, so where this thing is and who may use it can't be read; Problems says why.</Banner> : null}
      {pick ? (
        <Section title="Where it is">
          <div class="lre-stack">
            <WherePicker title="Where it is" choices={pick.where.filter((c) => c.id !== id)} value={where} size={row?.size ?? null} empty="Nowhere" onPick={(next) => next && "choice" in next && setValue(withWhere(value, spotOfChoice(next.choice)))} />
            <WherePicker title="Kept at" choices={pick.where.filter((c) => c.id !== id)} value={keptPick(pick, fields.home)} size={row?.size ?? null} extras={KEPT_EXTRAS} onPick={(next) => setValue(withKept(value, keptValue(next)))} help="Where it goes back to when nobody is using it." />
          </div>
        </Section>
      ) : null}
      <Section title="Whose">
        {owners ? (
          <span class="lre-small">It has owners with shares: change them under Advanced.</span>
        ) : (
          <div class="lre-field">
            <RefPicker label="Owner" value={owner} options={pick ? partyOptions(pick.parties) : []} none="Nobody" onChange={(next) => setValue(withOwner(value, next === "" ? null : next))} />
            <span class="lre-field-help">{owner === "" ? (presumes ?? "Nobody's.") : "A person, a household, a business or a group."}</span>
          </div>
        )}
      </Section>
      {page ? <UseSection chips={page.use} grants={page.grants} added={added} dropped={dropped} people={people} adding={adding} disabled={busy} onAdding={setAdding} onAdd={() => {
        const who = pick?.parties.find((p) => p.id === adding);
        if (who) setAdded([...added, { who, basis: "assign" }]);
        setAdding("");
      }} onDrop={(who) => setDropped(new Set([...dropped, who]))} /> : null}
      <Section title="What it is">
        <TextInput label="Name" value={value.name} issues={lintAt(lint, `${path}.name`)} onChange={(next) => setValue({ ...value, name: typeof next === "string" ? next : "" })} />
        <div class="lre-field" data-lre-type="">
          <span class="label">Type</span>
          <div class="lre-cp-value">
            <span class="lre-cp-path">{row?.type ?? (typeId !== "" ? typeId : <span class="lre-muted">No type</span>)}</span>
            <Button size="sm" icon="search" onClick={() => setChoosingType(true)}>
              Change…
            </Button>
          </div>
          <span class="lre-field-help">{page ? `${page.kindLabel}; ${sizeLabel(row?.size ?? "unknown")}, ${SIZE_FROM_WORDS[page.sizeFrom]}.` : null}</span>
        </div>
        <HostSelect label="Size" value={isSize(fields.size) ? fields.size : ""} options={sizeOptions(isSize(fields.size) ? "unknown" : (row?.size ?? "unknown"), page && !isSize(fields.size) ? SIZE_FROM_WORDS[page.sizeFrom] : "")} onChange={(next) => setValue(withField(value, "size", next === "" ? undefined : next))} />
        <TextListEditor label="Also called" value={Array.isArray(fields.aliases) ? fields.aliases.filter((a): a is string => typeof a === "string") : []} placeholder="Another name, as the story may say it" onChange={(next) => setValue(withField(value, "aliases", next.length > 0 ? next : undefined))} />
        <TextInput label="Description" value={fields.description} multiline optional issues={lintAt(lint, `${path}.fields.description`)} onChange={(next) => setValue(withField(value, "description", typeof next === "string" && next !== "" ? next : undefined))} />
        {gear >= 2 ? <NumberInput label="Quantity" value={fields.qty} min={1} optional hint="How many: a stack of the same thing." issues={lintAt(lint, `${path}.fields.qty`)} onChange={(next) => setValue(withField(value, "qty", next))} /> : null}
        {gear >= 3 ? <NumberInput label="Condition" value={fields.condition} min={0} max={100} optional hint="0 is broken, 100 like new." issues={lintAt(lint, `${path}.fields.condition`)} onChange={(next) => setValue(withField(value, "condition", next))} /> : null}
        {gear >= 3 ? <TextInput label="Worn in (slot)" value={fields.slot} optional hint="Where it is worn: pocket, wrist, back…" issues={lintAt(lint, `${path}.fields.slot`)} onChange={(next) => setValue(withField(value, "slot", typeof next === "string" && next !== "" ? next : undefined))} /> : null}
        <CheckField label="Sleep in or on" help="A bed, a sofa, a sleeping bag, a van." checked={fields.sleep === true} onChange={(on) => setValue(withField(value, "sleep", on ? true : undefined))} />
        <CheckField label="Consumable" help="Used up as it is used: food, fuel, ammunition." checked={fields.consumable === true} onChange={(on) => setValue(withField(value, "consumable", on ? true : undefined))} />
      </Section>
      {value.kind === "vehicle" ? (
        <Section title="Specs">
          <SpecsEditor value={vehicleSpecsOf(fields.specs) ?? []} onChange={(next) => setValue(withField(value, "specs", next.length > 0 ? next.map((s) => ({ label: s.label, value: s.value })) : undefined))} />
        </Section>
      ) : null}
      {row && row.holds !== null && page ? (
        <HoldsSection holds={row.holds} contents={page.contents} problems={problems} onOpen={(c) => go(app, { view: "item", worldId: props.world.id, collection: "entities", id: c })} onAdd={() => setInside(true)}>
          <HostSelect label="Takes things up to" value={isSize(fields.holds) ? fields.holds : ""} options={sizeOptions(isSize(fields.holds) ? "unknown" : row.holds, "")} onChange={(next) => setValue(withField(value, "holds", next === "" ? undefined : next))} />
        </HoldsSection>
      ) : null}
      <Section title="Secrecy">
        <RevealItem kinds={formDoc.kinds} value={value} onChange={setValue} />
        <SchemaFields specs={COLLECTION_SPECS.entities.filter((s) => s.key === "visibility" || s.key === "knownBy")} value={value} ctx={ctx} onChange={setValue} />
      </Section>
      <Disclosure summary="Advanced: every field, its relations and its id">
        <span class="lre-small">
          Id: <code>{id}</code>
        </span>
        <SchemaFields specs={entityFormSpecs(formDoc, value).filter((s) => !PAGE_KEYS.has(s.key))} value={value} ctx={ctx} onChange={setValue} />
      </Disclosure>
      <SaveBar>
        <Button variant="primary" disabled={!changed} busy={busy} onClick={save}>
          Save to draft
        </Button>
        <Button variant="ghost" disabled={busy || !changed} onClick={revert}>
          Revert
        </Button>
      </SaveBar>
      {inside && pick ? <AddThing doc={props.world} pick={pick} preset={{ where: { in: id }, owner: owner === "" ? null : owner }} onClose={() => setInside(false)} onCreated={() => undefined} /> : null}
      {choosingType ? (
        <TypeSheet
          types={types}
          kind="item"
          value={null}
          onClose={() => setChoosingType(false)}
          onPick={(next) => {
            setChoosingType(false);
            if (next === null || "vehicle" in next) return;
            setValue("type" in next ? withField(value, "catalog", next.type.id) : withField(withField(value, "catalog", undefined), "size", next.size));
          }}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- a person's things, a place's

/** How a thing is carried on someone, as a Carried row says it: in a pocket, in a bag, or carried. */
function carriedWords(row: ThingRow, person: EntityId): string {
  if (row.worn === "pocket") return "In a pocket";
  const at = row.where.at(-1);
  return at && at.id !== person ? `In ${at.name}` : "Carried";
}

/** One group of a person's things as their page lists it: its key and title (a Wardrobe group's names its holder), its rows with each one's second line, and whether a row says whose it is. */
export interface PersonBucket {
  key: "outfit" | "carried" | "wardrobe" | "home" | "away" | "lent" | "holding";
  title: string;
  rows: { row: ThingRow; sub: string | undefined }[];
  /** Whose a row is shows in this group (someone else's things they hold, what they carry). */
  whose: boolean;
}

/**
 * A person's things as their page groups them (ITEMS-SPEC §10.1, §10.3): Outfit (what they wear, by
 * slot), Carried (on them, not worn), Wardrobe (their clothing at home, a group per holder), At home
 * (the rest of theirs there), Elsewhere, Lent out and Holding for others; each row once, the empty
 * groups left out. Below Gear 3 nothing is worn and everything on them is Carried.
 */
export function personBuckets(groups: PersonThings, person: EntityId): PersonBucket[] {
  const holding = new Set(groups.holding.map((r) => r.id));
  const kept = new Set(groups.wardrobe.flatMap((w) => w.rows.map((r) => r.id)));
  const out: PersonBucket[] = [
    { key: "outfit", title: "Outfit", whose: false, rows: groups.outfit.map((row) => ({ row, sub: row.worn !== null && row.worn !== "worn" ? `Worn · ${row.worn.replace(/_/g, " ")}` : "Worn" })) },
    { key: "carried", title: "Carried", whose: true, rows: groups.carried.filter((r) => !holding.has(r.id)).map((row) => ({ row, sub: carriedWords(row, person) })) },
    ...groups.wardrobe.map((w): PersonBucket => ({ key: "wardrobe", title: `Wardrobe · ${w.holder ? w.holder.name : "loose at home"}`, whose: false, rows: w.rows.map((row) => ({ row, sub: row.slot !== null ? `Worn · ${row.slot.replace(/_/g, " ")}` : undefined })) })),
    { key: "home", title: "At home", whose: false, rows: groups.home.filter((r) => !kept.has(r.id)).map((row) => ({ row, sub: whereWords(row) })) },
    { key: "away", title: "Elsewhere", whose: false, rows: groups.away.map((row) => ({ row, sub: whereWords(row) })) },
    { key: "lent", title: "Lent out", whose: false, rows: groups.lent.map((row) => ({ row, sub: row.with !== null ? `With ${row.where.find((s) => s.id === row.with)?.name ?? "someone"}` : whereWords(row) })) },
    { key: "holding", title: "Holding for others", whose: true, rows: groups.holding.map((row) => ({ row, sub: whereWords(row) })) },
  ];
  return out.filter((b) => b.rows.length > 0);
}

/** A person's things in groups, each row with its actions (`menu`, by the row and the group it is in). */
export function PersonGroups(props: { person: EntityId; groups: PersonThings; problems: ReadonlyMap<string, "error" | "warning">; menu(row: ThingRow, bucket: PersonBucket["key"]): readonly MenuItem[]; onOpen(id: EntityId): void }) {
  const buckets = personBuckets(props.groups, props.person);
  return (
    <div class="lre-thing-tree" data-lre-person-things={props.person}>
      {buckets.length === 0 ? <span class="lre-small lre-muted">Nothing yet: they have nothing, and nothing anywhere is theirs.</span> : null}
      {buckets.map((b, i) => (
        <div key={`${b.key}:${i}`} class="lre-thing-bucket" data-lre-bucket={b.key}>
          <div class="lre-thing-bucket-head">{b.title}</div>
          <div role="list">
            {b.rows.map(({ row, sub }) => (
              <ThingRowView key={row.id} row={row} whose={b.whose} sub={sub} problem={props.problems.get(row.id)} menu={props.menu(row, b.key)} onOpen={props.onOpen} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** A sheet listing people to pick one: Give and Lend. */
function PersonSheet(props: { title: string; people: readonly WhereChoice[]; size: SizeClass; onPick(person: WhereChoice): void; onClose(): void }) {
  const [query, setQuery] = useState("");
  const id = useId();
  const want = wordsOf(query);
  const shown = props.people.filter((p) => want.every((q) => wordsOf(p.name).some((w) => w.startsWith(q))));
  return (
    <FormSheet title={props.title} onClose={props.onClose}>
      <div class="lre-cp-sheet">
        <label class="lre-cp-search" for={id}>
          <Icon name="search" size={16} />
          <input id={id} class="lre-input" type="search" placeholder="Search people" aria-label="Search people" value={query} onInput={(event) => setQuery(event.currentTarget.value)} />
        </label>
        {shown.length === 0 ? (
          <Empty icon="search">No one is called that.</Empty>
        ) : (
          <List>
            {shown.map((p) => (
              <ListRow key={p.id} icon="user" title={p.name} subtitle={cannotHold(p, props.size) ? "Too big for them to carry: it stays where it is" : whereLabel(p)} onClick={() => props.onPick(p)} />
            ))}
          </List>
        )}
      </div>
    </FormSheet>
  );
}

/**
 * The Character page's Things they have (ITEMS-SPEC §10.1): Outfit, Carried, Wardrobe (their
 * clothing at home, by holder), At home, Elsewhere, Lent out and Holding for others; each row's
 * Move…, Give…, Lend… and Remove; + Give them a thing opens Add a thing, on them and theirs.
 */
export function PersonThingsSection(props: { world: WorldDoc; id: EntityId; send: Send }) {
  const app = useApp();
  const draft = useSelect(app.drafts, (d) => d);
  const { body } = useThings(props.world.id, { op: "person", entity: props.id }, draft?.version);
  const [busy, run] = useBusy();
  const [sheet, setSheet] = useState<{ kind: "move" | "give" | "lend"; row: ThingRow } | null>(null);
  const [adding, setAdding] = useState(false);
  const problems = useMemo(() => problemsById(draft?.lint ?? []), [draft?.lint]);
  const patch = (ops: JsonPatchOp[]) =>
    run(async () => {
      if (ops.length > 0) await props.send({ type: "lre.editor", worldId: props.world.id, base: null, op: "patch", ops });
    });
  const groups = body?.person ?? null;
  const pick = body?.pick ?? null;
  const people = pick ? pick.where.filter((c) => c.is === "person" && c.id !== props.id) : [];
  const menu = (row: ThingRow): MenuItem[] => [
    { label: "Move…", icon: "pin", disabled: busy, onSelect: () => setSheet({ kind: "move", row }) },
    { label: "Give…", icon: "user", disabled: busy, onSelect: () => setSheet({ kind: "give", row }) },
    { label: "Lend…", icon: "users", disabled: busy, onSelect: () => setSheet({ kind: "lend", row }) },
    {
      label: "Remove",
      icon: "trash",
      danger: true,
      disabled: busy,
      onSelect: () =>
        run(async () => {
          if (!(await app.host.confirm("Remove the thing", `Remove “${row.name}” from the world? What is in it stays where it was.`, "danger", "Remove"))) return;
          await props.send({ type: "lre.editor", worldId: props.world.id, base: null, op: "patch", ops: removeOps(props.world, row.id) });
        }),
    },
  ];
  const carries = (row: ThingRow, to: WhereChoice): boolean => row.with === props.id && cannotHold(to, row.size) === null;
  return (
    <div data-lre-contents={props.id}>
      <Section
        title="Things they have"
        aside={
          <Button size="sm" icon="plus" disabled={!pick} onClick={() => setAdding(true)}>
            Give them a thing
          </Button>
        }
      >
        {groups ? <PersonGroups person={props.id} groups={groups} problems={problems} menu={menu} onOpen={(id) => go(app, { view: "item", worldId: props.world.id, collection: "entities", id })} /> : <span class="lre-small lre-muted">Reading their things…</span>}
      </Section>
      {sheet?.kind === "move" && pick ? (
        <WhereSheet
          title={`Move ${sheet.row.name}`}
          choices={pick.where.filter((c) => c.id !== sheet.row.id)}
          value={pickOf(pick, spotOfEntity(draftEntity(props.world, sheet.row.id) ?? {}))}
          size={sheet.row.size}
          onClose={() => setSheet(null)}
          onPick={(next) => {
            const row = sheet.row;
            setSheet(null);
            if (next && "choice" in next) patch(moveOps(props.world, row.id, spotOfChoice(next.choice)));
          }}
        />
      ) : null}
      {(sheet?.kind === "give" || sheet?.kind === "lend") && pick ? (
        <PersonSheet
          title={`${sheet.kind === "give" ? "Give" : "Lend"} ${sheet.row.name} to`}
          people={people}
          size={sheet.row.size}
          onClose={() => setSheet(null)}
          onPick={(to) => {
            const { kind, row } = sheet;
            setSheet(null);
            patch(kind === "give" ? giveOps(props.world, row.id, to.id, carries(row, to)) : lendOps(props.world, row.id, to.id, carries(row, to)));
          }}
        />
      ) : null}
      {adding && pick ? <AddThing doc={props.world} pick={pick} preset={{ where: { in: props.id }, owner: props.id }} onClose={() => setAdding(false)} onCreated={() => undefined} /> : null}
    </div>
  );
}

/** A place's page's Things here (ITEMS-SPEC §10.1): its furnishings and loose things as a tree, its rooms' under it, with + Add a thing here. */
export function PlaceThingsSection(props: { world: WorldDoc; id: string }) {
  const app = useApp();
  const draft = useSelect(app.drafts, (d) => d);
  const { body } = useThings(props.world.id, { op: "list" }, draft?.version);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const list = body?.list ?? null;
  const sections = useMemo(() => (list ? placeSections(list.rows, { within: props.id, people: false }) : []), [list, props.id]);
  const problems = useMemo(() => problemsById(draft?.lint ?? []), [draft?.lint]);
  const depth = list?.pick.where.find((c) => c.id === props.id)?.path.length ?? 0;
  return (
    <div data-lre-contents={props.id}>
      <Section
        title="Things here"
        aside={
          <Button size="sm" icon="plus" disabled={!list} onClick={() => setAdding(true)}>
            Add a thing here
          </Button>
        }
      >
        {!list ? (
          <span class="lre-small lre-muted">Reading what is here…</span>
        ) : sections.length === 0 ? (
          <span class="lre-small lre-muted">Nothing lies here, and nothing stands here.</span>
        ) : (
          <PlaceTree
            sections={sections}
            open={open}
            problems={problems}
            from={depth + 1}
            onToggle={(id) => {
              const next = new Set(open);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              setOpen(next);
            }}
            onOpen={(id) => go(app, { view: "item", worldId: props.world.id, collection: "entities", id })}
          />
        )}
      </Section>
      {adding && list ? <AddThing doc={props.world} pick={list.pick} preset={{ where: { place: props.id } }} onClose={() => setAdding(false)} onCreated={() => undefined} /> : null}
    </div>
  );
}

