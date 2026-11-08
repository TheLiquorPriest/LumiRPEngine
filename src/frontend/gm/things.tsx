// GM → Things (ITEMS-SPEC §10.2, §7.5, §6.2; mobile first, 390 px): the chat's things as they stand
// on its head, behind the gate with the rest of the truth, read through `lre.things` in GM scope.
// Here: where the player character is, what is in the room (furniture, built-in things and vehicles,
// what is in them nested), what lies there, and what the people there have, with why each has it.
// By place and By owner: Build's trees. Select makes those lists choose: the bulk bar under them
// moves, puts in, puts away (each to where it rests), puts on or takes off, hands over, makes
// theirs, lets someone use, renames (one), sizes or removes every thing picked as one GM edit with
// one Undo. + Add a thing makes one anywhere, as one GM edit. Tidy up: the audit's findings, each
// with the one GM edit that fixes it or the fixes to choose from, Leave it (kept beside the chat;
// Show N left brings one back), Ask the Curator (the GM assistant), and how many a run shows; then
// Keep in the world, which copies what the chat made in play into its world's draft. A thing's page,
// from here or from World: where it is and why whoever has it has it, where it rests and Put it
// away, Move to…, Put in…, Hand to…, Kept at…, Wear and Take off, whose it is and who may use it,
// what it is and holds, its secrecy, its history in this chat and every field under Advanced; never
// a simulation level, a life or a tier. A person's things on their GM page: Outfit, Carried and
// Wardrobe first, then (Gear 3) their saved outfits and loadouts. Each control is one GM edit with
// its own Undo, its notice saying what it did.

import type { ComponentChildren } from "preact";
import { useEffect, useId, useMemo, useState } from "preact/hooks";
import type { EntityId } from "../../shared/ids";
import type { EditOp, GmThingsRead, ResultBodies } from "../../shared/protocol";
import { EDIT_OPS_MAX } from "../../shared/protocol";
import { TIDY_BOUNDS } from "../../shared/settings";
import type { GmEntity, GmView } from "../../shared/state-view";
import type { GmThingExtras, HistorySource, KeepResult, LoanChoice, MadeInPlay, RestView, TidyFinding, TidyFix, TidyKind, TidyRun } from "../../shared/thing-gm";
import type { HandoverBasis, ItemOp, Rest, SetKind, Size, SizeClass, Spot } from "../../shared/things";
import { isSize, makeFieldsOf, SET_KIND_LABEL, SET_KINDS, SET_NAME_MAX, setsOf, SIZE_LABELS, SIZES, THING_NAME_MAX } from "../../shared/things";
import type { PartyRef, ThingPage, ThingPicks, ThingRow, ThingType, WhereChoice, WhereStep } from "../../shared/thing-view";
import { GRANT_WORDS, partyPossessive, presumedLine, SIZE_FROM_WORDS, SIZE_WORDS, sizeLabel, whoseWords } from "../../shared/thing-view";
import { vehicleSpecsOf, type VehicleClassChoice, type VehicleSpec } from "../../shared/vehicles";
import { listWords } from "../../shared/words";
import { SetRows } from "../../packs/gear/ui/sets-sheet";
import { useApp, useChatWorld } from "../app";
import { AddPicker, CheckField, FormSheet, RefPicker, type RefOption } from "../build/form-kit";
import type { MenuItem } from "../build/chrome";
import { buildClasses, HoldsSection, OwnerList, PersonGroups, PlaceTree, ThingChips, ThingRowView, TreeRows, whereWords, type PersonBucket } from "../build/things";
import { placeSections, type TreeNode } from "../build/things-model";
import { TextListEditor } from "../character/text-list";
import { wordsOf } from "../character/places";
import { Badge, Banner, Button, Disclosure, Empty, HostSelect, IdText, List, ListRow, NumberStepper, Section, Seg, useBusy } from "../components";
import { Icon } from "../icons";
import { PickBox, SelectBar, useSelection, type Selection } from "../multi-select";
import { gmThingsRequest } from "../requests";
import { useSelect } from "../store";
import { AddThingSheet, type AddDraft } from "../things/add-thing";
import { cannotHold, pathText, stepWords } from "../things/where";
import { WhereSheet, type WhereExtra, type WherePick } from "../things/where-picker";
import { SizeChoices, THING_KINDS } from "../things/what-it-is";
import { SpecsEditor } from "../things/specs";
import type { BulkEditor, Editor } from "./editor";
import { FieldRow, Relations } from "./entity";
import { thinEntity } from "./parts";
import { gmAt, gmOpen } from "./nav";
import { ActionRow, ActionRows, GmCard, GmPage, usePages } from "./ui";

type ThingsBody = ResultBodies["lre.things"];

/** No lint in GM mode: a chat's things carry no problems of the draft's. */
const NO_PROBLEMS: ReadonlyMap<string, "error" | "warning"> = new Map();

/**
 * Reads `lre.things` in GM scope for the chat, again when the chat moves on (`BulkEditor.reloadKey`:
 * a turn, an edit, an Undo), not when a part of the GM view lands. Null while it loads; `failed` once
 * it couldn't be read; `set` takes an answer another request gave (Leave it, Keep in the world). A
 * read of something else shows nothing of the last one's.
 */
function useGmThings(chatId: string, read: GmThingsRead | null, reloadKey: string): { body: ThingsBody | null; failed: boolean; set(body: ThingsBody): void } {
  const app = useApp();
  const key = read ? JSON.stringify(read) : "";
  const [state, setState] = useState<{ key: string; body: ThingsBody | null; failed: boolean }>({ key: "", body: null, failed: false });
  useEffect(() => {
    if (!read) return;
    let live = true;
    void app.request(gmThingsRequest(chatId, read)).then((body) => {
      if (live) setState({ key, body, failed: body === null });
    });
    return () => {
      live = false;
    };
  }, [app, chatId, key, reloadKey]);
  const mine = state.key === key;
  return { body: mine ? state.body : null, failed: mine && state.failed, set: (body) => setState({ key, body, failed: false }) };
}

/** Whether a kind is a thing's (an item, or a kind that extends one: containers, kits, vehicles), by the kinds the GM view lists, as the engine's `isThing` reads it. */
export function isThingKind(kinds: GmView["kinds"], kind: string): boolean {
  let at: string | null = kind;
  for (let guard = 0; at !== null && guard < 32; guard++) {
    if (at === "item") return true;
    const id: string = at;
    at = kinds.find((k) => k.id === id)?.extends ?? null;
  }
  return false;
}

// ---------------------------------------------------------------- Here

/** The sizes that stand in a room rather than lie about in it: furniture, what is built in, vehicles. */
const IN_THE_ROOM: Readonly<Partial<Record<SizeClass, true>>> = { furniture: true, builtin: true, vehicle: true };

/** One place in Here: its path from where the player character is, what stands in the room, what lies there, and the people there with what they have. */
export interface HereSection {
  path: WhereStep[];
  room: TreeNode[];
  lying: TreeNode[];
  people: Extract<TreeNode, { holder: WhereStep }>[];
}

/**
 * Here (ITEMS-SPEC §10.2): what is where the player character is and in the places inside it (its
 * rooms), each place on its own, as By place builds it (`placeSections`), headed from there inward:
 * in the room, the furniture, built-in things and vehicles lying there, what is in them under them;
 * lying here, everything else lying there; on the people here, each person there with what they
 * have.
 */
export function hereSections(rows: readonly ThingRow[], here: string): HereSection[] {
  return placeSections(rows, { within: here }).map((s) => {
    const out: HereSection = { path: s.path.slice(Math.max(0, s.path.findIndex((step) => step.id === here))), room: [], lying: [], people: [] };
    for (const node of s.nodes) {
      if ("holder" in node) {
        if (node.holder.is === "person") out.people.push(node);
        else out.lying.push(node);
      } else (IN_THE_ROOM[node.thing.size] ? out.room : out.lying).push(node);
    }
    return out;
  });
}

/** Rows of things someone has, each with why they have it on its second line; what is in them under them once opened; `picked` while choosing. */
function WhyRows(props: { nodes: readonly TreeNode[]; why: Readonly<Record<string, string>>; open: ReadonlySet<string>; picked?: ReadonlySet<string>; onToggle(id: string): void; onOpen(id: EntityId): void }) {
  return (
    <>
      {props.nodes.map((node) => {
        if ("holder" in node) return <TreeRows key={node.holder.id} nodes={[node]} depth={0} open={props.open} problems={NO_PROBLEMS} picked={props.picked} onToggle={props.onToggle} onOpen={props.onOpen} />;
        const open = props.open.has(node.thing.id);
        return (
          <div key={node.thing.id} class="lre-thing-node">
            <ThingRowView row={node.thing} sub={props.why[node.thing.id]} expanded={open} picked={props.picked?.has(node.thing.id)} onToggle={node.children.length > 0 ? () => props.onToggle(node.thing.id) : undefined} onOpen={props.onOpen} />
            {open ? <TreeRows nodes={node.children} depth={1} open={props.open} problems={NO_PROBLEMS} picked={props.picked} onToggle={props.onToggle} onOpen={props.onOpen} /> : null}
          </div>
        );
      })}
    </>
  );
}

/** Here's places: each headed by its path, then In the room, Lying here and On the people here, each person with Open (their sheet in World); `picked` while choosing. */
export function HereView(props: { sections: readonly HereSection[]; why: Readonly<Record<string, string>>; open: ReadonlySet<string>; picked?: ReadonlySet<string>; onToggle(id: string): void; onOpen(id: EntityId): void; onPerson(id: EntityId): void }) {
  return (
    <div class="lre-thing-tree" data-lre-by="here">
      {props.sections.map((s) => {
        const key = s.path.at(-1)?.id ?? "";
        return (
          <section key={key} class="lre-thing-place lre-gm-here" data-lre-here={key}>
            <h3 class="lre-thing-place-head">
              <span class="lre-cp-path">{pathText(s.path)}</span>
            </h3>
            {s.room.length > 0 ? (
              <div class="lre-thing-bucket" data-lre-here-group="room">
                <div class="lre-thing-bucket-head">In the room</div>
                <div role="list">
                  <TreeRows nodes={s.room} depth={0} open={props.open} problems={NO_PROBLEMS} picked={props.picked} onToggle={props.onToggle} onOpen={props.onOpen} />
                </div>
              </div>
            ) : null}
            {s.lying.length > 0 ? (
              <div class="lre-thing-bucket" data-lre-here-group="lying">
                <div class="lre-thing-bucket-head">Lying here</div>
                <div role="list">
                  <TreeRows nodes={s.lying} depth={0} open={props.open} problems={NO_PROBLEMS} picked={props.picked} onToggle={props.onToggle} onOpen={props.onOpen} />
                </div>
              </div>
            ) : null}
            {s.people.length > 0 ? (
              <div class="lre-thing-bucket" data-lre-here-group="people">
                <div class="lre-thing-bucket-head">On the people here</div>
                {s.people.map((p) => (
                  <div key={p.holder.id} class="lre-thing-holder" data-lre-holder={p.holder.id}>
                    <div class="lre-thing-owner-head">
                      <span class="lre-thing-holder-name">
                        <Icon name="user" size={14} />
                        On {p.holder.name}
                      </span>
                      <Button size="sm" variant="ghost" label={`Open ${p.holder.name}'s sheet`} onClick={() => props.onPerson(p.holder.id)}>
                        Open
                      </Button>
                    </div>
                    <div role="list">
                      <WhyRows nodes={p.children} why={props.why} open={props.open} picked={props.picked} onToggle={props.onToggle} onOpen={props.onOpen} />
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- Tidy up

/** Each kind of finding's card title. */
const TIDY_TITLES: Readonly<Record<TidyKind, string>> = {
  too_big: "Too big to carry",
  two_places: "In two places at once",
  worn_elsewhere: "Worn but lying elsewhere",
  handover_owner: "An owner a handover changed",
  duplicate: "Maybe the same thing",
  size_unknown: "Size unknown",
  final_dropped: "Dropped by the final review",
};

/**
 * One finding as a card: its sentence, Fix (the one edit), the other fixes to choose from, Open for
 * each thing it is about, Leave it (or, left, Bring it back) and Ask the Curator.
 */
export function TidyCard(props: { finding: TidyFinding; names?: ReadonlyMap<string, string>; busy: boolean; left?: boolean; onFix(fix: TidyFix): void; onLeave?(left: boolean): void; onAsk?(): void; onOpen?(id: EntityId): void }) {
  const f = props.finding;
  const onLeave = props.onLeave;
  const onAsk = props.onAsk;
  const onOpen = props.onOpen;
  return (
    <GmCard name={`tidy:${f.key}`} title={TIDY_TITLES[f.kind]} badges={f.secret ? <Badge tone="gm">Secret</Badge> : undefined}>
      <p class="lre-gm-tidy-text" data-lre-tidy={f.kind}>
        {f.text}
      </p>
      <div class="lre-gm-tidy-actions">
        {f.fix ? (
          <Button size="sm" variant="primary" icon="check" disabled={props.busy || props.left} onClick={() => f.fix && props.onFix(f.fix)}>
            {f.fix.label}
          </Button>
        ) : null}
        {f.choices.map((c) => (
          <Button key={c.label} size="sm" disabled={props.busy || props.left} onClick={() => props.onFix(c)}>
            {c.label}
          </Button>
        ))}
      </div>
      <div class="lre-gm-tidy-actions">
        {onOpen
          ? f.things.map((id) => (
              <Button key={id} size="sm" variant="ghost" icon="box" label={`Open ${props.names?.get(id) ?? id}`} onClick={() => onOpen(id)}>
                {props.names?.get(id) ?? id}
              </Button>
            ))
          : null}
        {onLeave ? (
          <Button size="sm" variant="ghost" icon={props.left ? "undo" : "eye-off"} disabled={props.busy} onClick={() => onLeave(!props.left)}>
            {props.left ? "Bring it back" : "Leave it"}
          </Button>
        ) : null}
        {onAsk ? (
          <Button size="sm" variant="ghost" icon="message" disabled={props.busy} onClick={onAsk}>
            Ask the Curator
          </Button>
        ) : null}
      </div>
    </GmCard>
  );
}

/** Tidy up's run: how many it found, its cards, Show N left (each left one with Bring it back), and how many findings a run shows. */
export function TidyList(props: { run: TidyRun; names: ReadonlyMap<string, string>; busy: boolean; showLeft: boolean; onFix(fix: TidyFix): void; onLeave(finding: TidyFinding, left: boolean): void; onAsk(finding: TidyFinding): void; onShowLeft(show: boolean): void; onLimit(limit: number): void; onOpen(id: EntityId): void }) {
  const { run } = props;
  const [min, max] = TIDY_BOUNDS.findings;
  const title = run.total === 0 ? "Nothing to tidy" : run.findings.length < run.total ? `${run.findings.length} of ${run.total} findings` : run.total === 1 ? "1 finding" : `${run.total} findings`;
  return (
    <div class="lre-stack" data-lre-tidy-run="">
      <Section title={title}>
        <span class="lre-small lre-muted">Things a turn left wrong, each with the one edit that sets it right. Each fix is a GM edit with its own Undo.</span>
        <NumberStepper label="Findings per run" value={run.limit} min={min} max={max} integer disabled={props.busy} onChange={props.onLimit} />
      </Section>
      {run.findings.length === 0 ? (
        <Empty icon="check" title={run.left > 0 ? "Nothing else to tidy" : "Nothing to tidy"}>
          {run.left > 0 ? "Only the findings you left are standing." : "Every thing is where it can be, its owner and size make sense, and nothing looks made twice."}
        </Empty>
      ) : (
        run.findings.map((f) => <TidyCard key={f.key} finding={f} names={props.names} busy={props.busy} onFix={props.onFix} onLeave={(left) => props.onLeave(f, left)} onAsk={() => props.onAsk(f)} onOpen={props.onOpen} />)
      )}
      {run.left > 0 ? (
        <Button variant="ghost" icon={props.showLeft ? "chevron-up" : "chevron-down"} onClick={() => props.onShowLeft(!props.showLeft)}>
          {props.showLeft ? "Hide those left" : `Show ${run.left} left`}
        </Button>
      ) : null}
      {props.showLeft ? run.leftOut.map((f) => <TidyCard key={f.key} finding={f} names={props.names} busy={props.busy} left onFix={props.onFix} onLeave={(left) => props.onLeave(f, left)} onOpen={props.onOpen} />) : null}
    </div>
  );
}

/** A place made in play as Keep in the world names what it is. */
const PLACE_AS: Readonly<Record<MadeInPlay["places"][number]["as"], string>> = { room: "A room", spot: "A spot", venue: "A venue" };

/** The pick key of a thing or place in Keep in the world's list. */
export const keepKey = (kind: "thing" | "place", id: string): string => `${kind}:${id}`;

/**
 * Keep in the world (ITEMS-SPEC §6.2): what the chat made in play that its world doesn't have, its
 * places and things, each to pick (one the world's draft has already says so, and can't be picked);
 * Keep copies the picked ones into the draft, then what was kept, skipped and lost on the way shows.
 */
export function KeepList(props: { made: MadeInPlay; picked: ReadonlySet<string>; kept: KeepResult | null; names: ReadonlyMap<string, string>; busy: boolean; onPick(key: string, on: boolean): void; onKeep(): void }) {
  const { made, kept } = props;
  const row = (key: string, title: string, subtitle: string, inDraft: boolean) => {
    const on = props.picked.has(key);
    return (
      <ListRow key={key} title={title} subtitle={inDraft ? `${subtitle} · in the world's draft already` : subtitle} leading={<PickBox label={`Keep ${title}`} checked={on} />} disabled={inDraft || props.busy} onClick={() => props.onPick(key, !on)} />
    );
  };
  const count = props.picked.size;
  return (
    <Section title="Keep in the world" flush>
      <div class="lre-stack lre-gm-keep" data-lre-keep="">
        <span class="lre-small lre-muted">Copies what this chat made in play into the world's draft under the same ids; once the draft is committed, a chat upgraded to it keeps them as the world's.</span>
        {made.places.length === 0 && made.things.length === 0 ? <Empty icon="globe">This chat made no place or thing the world lacks.</Empty> : null}
        {made.places.length > 0 ? (
          <div data-lre-keep-group="places">
            <div class="lre-thing-bucket-head">Places</div>
            <List>{made.places.map((p) => row(keepKey("place", p.id), p.name, `${PLACE_AS[p.as]} in ${pathText(p.path) || "nowhere"}`, p.inDraft))}</List>
          </div>
        ) : null}
        {made.things.length > 0 ? (
          <div data-lre-keep-group="things">
            <div class="lre-thing-bucket-head">Things</div>
            <List>
              {made.things.map((t) => {
                const at = t.where.at(-1);
                const words = at ? stepWords(at) : "nowhere";
                return row(keepKey("thing", t.id), t.name, `${words.charAt(0).toUpperCase()}${words.slice(1)}`, t.inDraft);
              })}
            </List>
          </div>
        ) : null}
        {made.places.length + made.things.length > 0 ? (
          <Button variant="primary" icon="globe" disabled={count === 0 || props.busy} onClick={props.onKeep}>
            {count === 0 ? "Keep in the world" : count === 1 ? "Keep 1 in the world" : `Keep ${count} in the world`}
          </Button>
        ) : null}
        {kept ? (
          <div class="lre-stack" data-lre-kept="">
            {kept.places.length + kept.things.length > 0 ? <Banner tone="info" title="In the world's draft now">{[...kept.places, ...kept.things].map((id) => props.names.get(id) ?? id).join(", ")}</Banner> : null}
            {kept.skipped.length > 0 ? (
              <Banner tone="warn" title="Not kept">
                {kept.skipped.map((s) => (
                  <span key={s.id} class="lre-gm-keep-line">
                    {s.reason}
                  </span>
                ))}
              </Banner>
            ) : null}
            {kept.notes.map((n) => (
              <span key={n} class="lre-small lre-gm-keep-line">
                {n}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </Section>
  );
}

/**
 * Tidy up's read and its requests: the run (again after each edit), Leave it and Bring it back,
 * how many a run shows (the user's setting), Ask the Curator (the finding's sentence sent to the GM
 * assistant, which then opens), and Keep in the world's list and its Keep.
 */
function TidyPanel(props: { chatId: string; editor: BulkEditor; names: ReadonlyMap<string, string>; onOpen(id: EntityId): void }) {
  const app = useApp();
  const { editor, chatId } = props;
  const tidy = useGmThings(chatId, { op: "tidy" }, editor.reloadKey);
  const made = useGmThings(chatId, { op: "made" }, editor.reloadKey);
  const [showLeft, setShowLeft] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [kept, setKept] = useState<KeepResult | null>(null);
  const [busy, act] = useBusy();
  const shown = tidy.body?.tidy ?? null;
  const leave = (f: TidyFinding, left: boolean) =>
    act(async () => {
      const body = await app.request(gmThingsRequest(chatId, { op: "leave", key: f.key, left }));
      if (body) tidy.set(body);
    });
  const limit = (findings: number) =>
    act(async () => {
      if (!(await app.request({ type: "lre.settings.set", patch: { tidy: { findings } } }))) return;
      const body = await app.request(gmThingsRequest(chatId, { op: "tidy" }));
      if (body) tidy.set(body);
    });
  const ask = (f: TidyFinding) =>
    act(async () => {
      if (await app.request({ type: "lre.assistant", chatId, op: "send", text: `Tidy up found this: ${f.text}` })) app.ui.update((ui) => gmAt(ui, "core.assistant"));
    });
  const keep = () =>
    act(async () => {
      const things = [...picked].flatMap((k) => (k.startsWith("thing:") ? [k.slice(6)] : []));
      const places = [...picked].flatMap((k) => (k.startsWith("place:") ? [k.slice(6)] : []));
      const body = await app.request(gmThingsRequest(chatId, { op: "keep", things, places }));
      if (!body) return;
      made.set(body);
      setKept(body.kept ?? null);
      setPicked(new Set());
    });
  const madeNames = useMemo(() => {
    const m = made.body?.made;
    const out = new Map(props.names);
    for (const p of m?.places ?? []) out.set(p.id, p.name);
    for (const t of m?.things ?? []) out.set(t.id, t.name);
    return out;
  }, [made.body, props.names]);
  return (
    <div class="lre-stack lre-gm-tidy" data-lre-gm-tidy="">
      {tidy.failed ? (
        <Empty icon="alert">Tidy up couldn't read this chat's things.</Empty>
      ) : !shown ? (
        <Empty icon="hourglass">Looking through the things…</Empty>
      ) : (
        <TidyList run={shown} names={props.names} busy={busy || editor.busy} showLeft={showLeft} onFix={(fix) => void editor.edit(fix.ops, fix.done)} onLeave={leave} onAsk={ask} onShowLeft={setShowLeft} onLimit={limit} onOpen={props.onOpen} />
      )}
      {made.body?.made ? (
        <KeepList
          made={made.body.made}
          picked={picked}
          kept={kept}
          names={madeNames}
          busy={busy || editor.busy}
          onPick={(key, on) => {
            const next = new Set(picked);
            if (on) next.add(key);
            else next.delete(key);
            setPicked(next);
          }}
          onKeep={keep}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- Select: the bulk bar

/** The sheets the bulk bar opens. */
export type BulkSheet = "move" | "put" | "hand" | "own" | "use" | "rename" | "size" | "remove";

/**
 * One change the bulk bar makes to every thing picked: `words` says where a move takes them ("at the
 * Garage", "in the Wardrobe"); `whom` names whom a hand-over or a grant is to, and `until` when a
 * loan or a grant ends.
 */
export type BulkChange =
  | { do: "move"; to: Spot; words: string }
  | { do: "away" }
  | { do: "wear" }
  | { do: "hand"; to: EntityId; whom: string; basis: Extract<HandoverBasis, "hold" | "gift" | "loan">; until?: LoanChoice }
  | { do: "own"; owner: PartyRef | null }
  | { do: "grant"; who: EntityId; whom: string; until?: LoanChoice }
  | { do: "rename"; name: string }
  | { do: "size"; size: Size }
  | { do: "remove" };

/** "1 thing", "3 things". */
const counted = (n: number): string => (n === 1 ? "1 thing" : `${n} things`);

/** The things a notice names: up to three by name, more by how many. */
function namesOf(rows: readonly ThingRow[]): string {
  return rows.length <= 3 ? listWords(rows.map((r) => r.name)) : counted(rows.length);
}

/** The things a notice names, with the verb that agrees. */
function named(rows: readonly ThingRow[], verb: { one: string; many: string }): string {
  return `${namesOf(rows)} ${rows.length === 1 ? verb.one : verb.many}`;
}

const IS = { one: "is", many: "are" } as const;

/** Whether a thing is where a spot says already: lying at the place, or directly in the holder. */
function isAt(row: ThingRow, spot: Spot): boolean {
  const at = row.where.at(-1);
  return "place" in spot ? at?.is === "place" && at.id === spot.place : at?.id === spot.in;
}

/** Whether every thing picked is worn: the bar's Wear is Take off then. */
export function allWorn(rows: readonly ThingRow[]): boolean {
  return rows.length > 0 && rows.every((r) => r.worn !== null && r.with !== null);
}

/** The ends the bulk bar's loans and grants offer from the HUD's clock (`now`, its minutes): a day, three days or a week from now; none without a clock. */
export function bulkLoans(now: number | null): LoanChoice[] {
  if (now === null) return [];
  return ([[1, "For a day"], [3, "For three days"], [7, "For a week"]] as const).map(([days, label]) => ({ label, until: now + days * 1440 }));
}

/**
 * The one GM edit a bulk change makes to the things picked (ITEMS-SPEC §10.2), with its notice: Move
 * to a place, Put in a holder, Put away (each to where it rests, `ThingRow.rest`), Wear or Take off
 * (on whoever has it: Take off once every one is worn, else Wear what takes a slot and isn't worn
 * yet), Hand to someone (to hold, a gift or a loan), Make it theirs, Let someone use it (until an
 * end, a loan; else assigned), Rename (one thing), a size, or Remove; each thing one op, as its own
 * page's control sends it. A thing already so is left out (and a Put away says how many stay); null
 * when that leaves nothing to change.
 */
export function bulkEdit(change: BulkChange, rows: readonly ThingRow[]): { ops: EditOp[]; done: string } | null {
  switch (change.do) {
    case "move": {
      const moving = rows.filter((r) => !isAt(r, change.to));
      const why = "place" in change.to ? "The GM moved it" : "The GM put it there";
      return moving.length === 0 ? null : { ops: moving.map((r) => item({ do: "move", item: r.id, to: change.to, why })), done: `${named(moving, IS)} ${change.words} now.` };
    }
    case "away": {
      const going = rows.flatMap((r) => (r.rest !== null && !isAt(r, r.rest) ? [{ row: r, rest: r.rest }] : []));
      if (going.length === 0) return null;
      const stay = rows.length - going.length;
      const staying = stay === 0 ? "" : ` ${counted(stay)} ${stay === 1 ? "stays" : "stay"}: already where it is kept, or kept nowhere.`;
      return { ops: going.map((g) => item({ do: "move", item: g.row.id, to: g.rest, why: "Put away" })), done: `${named(going.map((g) => g.row), IS)} put away, each where it is kept.${staying}` };
    }
    case "wear": {
      if (allWorn(rows)) return { ops: rows.flatMap((r) => (r.with !== null ? [item({ do: "wear", item: r.id, who: r.with, off: true })] : [])), done: `${named(rows, IS)} taken off; ${rows.length === 1 ? "it stays" : "each stays"} with whoever wore it.` };
      const wearing = rows.flatMap((r) => (r.slot !== null && r.with !== null && r.worn === null ? [{ row: r, who: r.with }] : []));
      if (wearing.length === 0) return null;
      return { ops: wearing.map((w) => item({ do: "wear", item: w.row.id, who: w.who })), done: `${named(wearing.map((w) => w.row), IS)} worn now, ${wearing.length === 1 ? "by" : "each by"} whoever has it.` };
    }
    case "hand": {
      // What they hold already is no hand-over.
      const handing = rows.filter((r) => !isAt(r, { in: change.to }));
      if (handing.length === 0) return null;
      const until = change.until;
      const done = change.basis === "gift" ? `${named(handing, IS)} ${partyPossessive({ name: change.whom, is: "person" })} now, a gift.` : change.basis === "loan" ? `${change.whom} has ${namesOf(handing)} on loan${until ? `, ${until.label.charAt(0).toLowerCase()}${until.label.slice(1)}` : ""}.` : `${change.whom} is holding ${namesOf(handing)} now.`;
      return { ops: handing.map((r) => item({ do: "hand", item: r.id, to: change.to, basis: change.basis, ...(until ? { until: until.until } : {}), why: "The GM handed it over" })), done };
    }
    case "own": {
      const owner = change.owner;
      // A stated owner already theirs (or, for nobody, none stated) is no change.
      const changing = rows.filter((r) => (owner === null ? r.whose.presumed === null : !(r.whose.presumed === null && r.whose.owners.length === 1 && r.whose.owners[0]?.id === owner.id)));
      if (changing.length === 0) return null;
      return { ops: changing.map((r) => item({ do: "own", item: r.id, owner: owner?.id ?? null, why: "The GM made it so" })), done: `${named(changing, IS)} ${owner ? partyPossessive(owner) : "nobody's"} now.` };
    }
    case "grant": {
      // Its stated owner needs no leave to use it.
      const granting = rows.filter((r) => !(r.whose.presumed === null && r.whose.owners.some((o) => o.id === change.who)));
      if (granting.length === 0) return null;
      const until = change.until;
      return { ops: granting.map((r) => item({ do: "grant", item: r.id, who: change.who, basis: until ? "loan" : "assign", ...(until ? { until: until.until } : {}) })), done: `${change.whom} may use ${namesOf(granting)} ${until ? `${until.label.charAt(0).toLowerCase()}${until.label.slice(1)}` : "now"}.` };
    }
    case "rename": {
      const row = rows.length === 1 ? rows[0] : undefined;
      const name = change.name.trim();
      return !row || name === "" || name === row.name ? null : { ops: [item({ do: "label", item: row.id, name })], done: `${row.name} is called ${name} now.` };
    }
    case "size": {
      const changing = rows.filter((r) => r.size !== change.size);
      return changing.length === 0 ? null : { ops: changing.map((r) => item({ do: "label", item: r.id, size: change.size })), done: `${named(changing, IS)} ${SIZE_LABELS[change.size]} now.` };
    }
    case "remove":
      return rows.length === 0 ? null : { ops: rows.map((r) => item({ do: "remove", item: r.id, why: "The GM removed it" })), done: `${named(rows, IS)} out of the world.` };
  }
}

/** The biggest of the things picked, for what can't hold them: a vehicle over every size, the size ladder's largest otherwise. */
function biggest(rows: readonly ThingRow[]): SizeClass | null {
  if (rows.some((r) => r.size === "vehicle")) return "vehicle";
  const rank = (size: SizeClass): number => SIZES.findIndex((s) => s === size);
  return rows.reduce<SizeClass | null>((top, r) => (top === null || rank(r.size) > rank(top) ? r.size : top), null);
}

/**
 * The bar under GM → Things while it chooses: how many are picked, Select all and Clear, and what to
 * do to every thing picked: Move to…, Put in…, Put away (each to where it rests), Wear or Take off
 * (on whoever has it), Hand to…, Make it theirs…, Let use…, Rename… (one thing), Size… and
 * Remove…, each one GM edit of one op a thing with one Undo, so at most `EDIT_OPS_MAX` at a time.
 * Put away and Wear send at once; the rest open their sheets.
 */
export function ThingsBulkBar(props: { selection: Selection; all: readonly string[]; shown: readonly string[]; rows: readonly ThingRow[]; editor: Editor; onSheet(sheet: BulkSheet): void }) {
  const { rows, editor } = props;
  const over = rows.length > EDIT_OPS_MAX;
  const off = editor.busy || rows.length === 0 || over;
  const away = bulkEdit({ do: "away" }, rows);
  const wear = bulkEdit({ do: "wear" }, rows);
  const takeOff = allWorn(rows);
  return (
    <SelectBar label="Things picked" selection={props.selection} all={props.all} shown={props.shown}>
      {over ? <span class="lre-small lre-muted" data-lre-bulk-over="">{`One edit holds at most ${EDIT_OPS_MAX} changes: pick fewer.`}</span> : null}
      <Button size="sm" icon="pin" disabled={off} onClick={() => props.onSheet("move")}>
        Move to…
      </Button>
      <Button size="sm" icon="box" disabled={off} onClick={() => props.onSheet("put")}>
        Put in…
      </Button>
      <Button size="sm" icon="home" disabled={off || away === null} title={away === null && rows.length > 0 ? "Each is where it is kept already, or kept nowhere" : undefined} onClick={() => away && void editor.edit(away.ops, away.done)}>
        Put away
      </Button>
      <Button size="sm" icon={takeOff ? "close" : "shield"} disabled={off || wear === null} title={wear === null && rows.length > 0 ? "None of them takes a slot and is with someone to wear it" : undefined} onClick={() => wear && void editor.edit(wear.ops, wear.done)}>
        {takeOff ? "Take off" : "Wear"}
      </Button>
      <Button size="sm" icon="user-plus" disabled={off} onClick={() => props.onSheet("hand")}>
        Hand to…
      </Button>
      <Button size="sm" icon="user" disabled={off} onClick={() => props.onSheet("own")}>
        Make it theirs…
      </Button>
      <Button size="sm" icon="key" disabled={off} onClick={() => props.onSheet("use")}>
        Let use…
      </Button>
      <Button size="sm" icon="edit" disabled={off || rows.length !== 1} title={rows.length > 1 ? "Rename one thing at a time" : undefined} onClick={() => props.onSheet("rename")}>
        Rename…
      </Button>
      <Button size="sm" icon="layers" disabled={off} onClick={() => props.onSheet("size")}>
        Size…
      </Button>
      <Button size="sm" variant="danger" icon="trash" disabled={off} onClick={() => props.onSheet("remove")}>
        Remove…
      </Button>
    </SelectBar>
  );
}

/** A person or an organization for the things picked, searched by name: Make it theirs… (or Nobody), or Let use… (people only, `children` above them saying until when). */
function PartySheet(props: { kind: "own" | "use"; subtitle: string; parties: readonly PartyRef[]; children?: ComponentChildren; onPick(party: PartyRef | null): void; onClose(): void }) {
  const [query, setQuery] = useState("");
  const want = wordsOf(query);
  const shown = props.parties.filter((p) => want.every((q) => wordsOf(p.name).some((w) => w.startsWith(q))));
  const search = props.kind === "own" ? "Search people and organizations" : "Search people";
  return (
    <FormSheet title={props.kind === "own" ? "Make it theirs" : "Let someone use them"} subtitle={props.subtitle} onClose={props.onClose}>
      <div class="lre-cp-sheet" data-lre-bulk-party={props.kind}>
        {props.children}
        <label class="lre-cp-search">
          <Icon name="search" size={16} />
          <input class="lre-input" type="search" placeholder={search} aria-label={search} value={query} onInput={(event) => setQuery(event.currentTarget.value)} />
        </label>
        <List>
          {props.kind === "own" && want.length === 0 ? <ListRow icon="minus" title="Nobody" subtitle="Nobody's: anyone's to use" onClick={() => props.onPick(null)} /> : null}
          {shown.map((p) => (
            <ListRow key={p.id} icon={p.is === "person" ? "user" : "users"} title={p.name} subtitle={p.is === "person" ? undefined : p.is === "company" ? "A business" : `A ${p.is}`} onClick={() => props.onPick(p)} />
          ))}
        </List>
        {shown.length === 0 ? <Empty icon="search">No one is called that.</Empty> : null}
      </div>
    </FormSheet>
  );
}

/** Let use… for the things picked: until a day, three days or a week from now, or with no end (assigned to them), then whom. */
function UseSheet(props: { subtitle: string; people: readonly PartyRef[]; loans: readonly LoanChoice[]; onPick(who: PartyRef, until: LoanChoice | null): void; onClose(): void }) {
  const [loan, setLoan] = useState(-1);
  const until = props.loans[loan] ?? null;
  return (
    <PartySheet kind="use" subtitle={props.subtitle} parties={props.people} onClose={props.onClose} onPick={(who) => who && props.onPick(who, until)}>
      {props.loans.length > 0 ? <HostSelect label="Until" value={String(loan)} options={[{ value: "-1", label: "No end: until someone stops it" }, ...props.loans.map((l, i) => ({ value: String(i), label: l.label }))]} onChange={(next) => setLoan(Number(next))} /> : null}
    </PartySheet>
  );
}

/** Rename… for the one thing picked: what it is called from now on. */
function RenameSheet(props: { row: ThingRow; busy: boolean; onRename(name: string): void; onClose(): void }) {
  const [name, setName] = useState(props.row.name);
  const trimmed = name.trim();
  return (
    <FormSheet
      title="Rename"
      subtitle={props.row.name}
      onClose={props.onClose}
      actions={
        <Button size="sm" variant="primary" disabled={props.busy || trimmed === "" || trimmed === props.row.name} onClick={() => props.onRename(trimmed)}>
          Rename
        </Button>
      }
    >
      <label class="lre-field" data-lre-bulk-rename="">
        <span class="label">Name</span>
        <input class="lre-input" value={name} maxLength={THING_NAME_MAX} onInput={(event) => setName(event.currentTarget.value)} />
      </label>
    </FormSheet>
  );
}

/** Remove… for the things picked: what it does, and the one button that does it. */
function RemoveSheet(props: { rows: readonly ThingRow[]; busy: boolean; onRemove(): void; onClose(): void }) {
  return (
    <FormSheet title="Remove from the world" subtitle={counted(props.rows.length)} onClose={props.onClose}>
      <div class="lre-stack" data-lre-bulk-remove="">
        <span class="lre-field-help">{`Takes ${props.rows.length <= 3 ? listWords(props.rows.map((r) => r.name)) : counted(props.rows.length)} out of the world; what is in them stays where it is. The edit's Undo brings them back.`}</span>
        <Button variant="danger" icon="trash" disabled={props.busy} onClick={props.onRemove}>
          {props.rows.length === 1 ? "Remove it from the world" : `Remove ${props.rows.length} from the world`}
        </Button>
      </div>
    </FormSheet>
  );
}

/** The things a tree shows, its holders' contents included, in order. */
function treeIds(nodes: readonly TreeNode[]): string[] {
  return nodes.flatMap((n) => [...("thing" in n ? [n.thing.id] : []), ...treeIds(n.children)]);
}

// ---------------------------------------------------------------- + Add a thing

/**
 * The one GM edit + Add a thing makes of a draft (ITEMS-SPEC §10.2), with its notice: one make of its
 * type, of a vehicle's class with its make, model and year, or else of what it is said to be (its
 * category, or that it holds things) and how big; how many; where (at a place, on a person, in a
 * holder).
 */
export function addEdit(draft: AddDraft): { ops: EditOp[]; done: string } {
  const what = draft.what;
  const at: Spot = draft.at.is === "place" ? { place: draft.at.id } : { in: draft.at.id };
  const said = what !== null && "vehicle" in what ? { class: what.vehicle.id, details: { make: what.vehicle.make, model: what.vehicle.model, year: what.vehicle.year } } : what !== null && "type" in what ? { type: what.type.id } : { ...(draft.kind !== "vehicle" ? makeFieldsOf(draft.kind) : {}), ...(what !== null && "size" in what ? { size: what.size } : {}) };
  const op = item({ do: "make", name: draft.name, at, ...said, ...(draft.qty !== 1 ? { qty: draft.qty } : {}), why: "The GM put it there" });
  return { ops: [op], done: `${draft.name}${draft.qty !== 1 ? ` ×${draft.qty}` : ""} is ${stepWords({ id: draft.at.id, name: draft.at.name, is: draft.at.is })} now.` };
}

/**
 * + Add a thing in GM → Things (ITEMS-SPEC §10.2): Add's one sheet (its name, its kind and what it
 * is, how many, where: any place, person or holder, starting where the player character is), made
 * at once as one GM edit with its Undo (`addEdit`); Vehicle once the world's classes are read and it
 * has some. Hook-free: `GmAddThing` reads the types and the classes.
 */
export function GmAddSheet(props: { pick: ThingPicks; here: string | null; types: readonly ThingType[] | null; classes: readonly VehicleClassChoice[] | null; editor: Editor; onClose(): void }) {
  const { editor } = props;
  return (
    <AddThingSheet
      title="Add a thing"
      subtitle="Made in this chat: what it's called, what it is, how many, where"
      types={props.types}
      classes={props.classes}
      choices={props.pick.where}
      start={{ at: props.pick.where.find((c) => c.is === "place" && c.id === props.here) ?? null }}
      kinds={props.classes !== null && props.classes.length > 0 ? THING_KINDS : THING_KINDS.filter((k) => k !== "vehicle")}
      busy={editor.busy}
      action="Add"
      help="Made at once, as one GM edit with its Undo."
      onClose={props.onClose}
      onSubmit={(draft) => {
        const edit = addEdit(draft);
        void editor.edit(edit.ops, edit.done).then((ok) => ok && props.onClose());
      }}
    />
  );
}

/** + Add a thing while it is open: the catalogs' types (`lre.things` types in GM scope), and the chat's world for its vehicle classes, of the year its clock is in. */
function GmAddThing(props: { chatId: string; pick: ThingPicks; here: string | null; editor: Editor; onClose(): void }) {
  const app = useApp();
  const [types, setTypes] = useState<ThingType[] | null>(null);
  const world = useChatWorld(app.send);
  // The HUD's date, `YYYY-MM-DD HH:MM`; without one, the year the world starts.
  const now = useSelect(app.sync, (s) => s.view?.hud?.fixes.time?.value ?? null);
  useEffect(() => {
    let live = true;
    void app.request(gmThingsRequest(props.chatId, { op: "types" })).then((answer) => {
      if (live) setTypes(answer?.types ?? []);
    });
    return () => {
      live = false;
    };
  }, [props.chatId]);
  const classes = useMemo(() => (world ? buildClasses(world, Number(now?.slice(0, 4)) || undefined) : null), [world, now]);
  return <GmAddSheet pick={props.pick} here={props.here} types={types} classes={classes} editor={props.editor} onClose={props.onClose} />;
}

// ---------------------------------------------------------------- the Things section

type ThingsView = "here" | "place" | "owner" | "tidy";

/**
 * GM → Things: search, Select, + Add a thing, Here · By place · By owner · Tidy up, and a thing's
 * page over the list. Select turns the lists to choosing: a row's tap picks it, and the bulk bar
 * under them changes every thing picked in one GM edit.
 */
export function ThingsSection(props: { editor: BulkEditor; chatId: string }) {
  const app = useApp();
  const { editor, chatId } = props;
  const pages = usePages<{ thing: EntityId }>();
  // The list is read again when the chat moves on, so what an edit changed shows once it applied.
  const { body, failed } = useGmThings(chatId, { op: "list" }, editor.reloadKey);
  const [view, setView] = useState<ThingsView>("here");
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<{ words: string; ids: EntityId[] } | null>(null);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [owners, setOwners] = useState<ReadonlySet<string> | null>(null);
  const selection = useSelection();
  const [bulk, setBulk] = useState<BulkSheet | null>(null);
  const [adding, setAdding] = useState(false);
  // The world's clock as the HUD reads it: how long the bulk bar's loans and grants run.
  const clock = useSelect(app.sync, (s) => s.view?.hud?.clock.minutes ?? null);
  const words = query.trim();
  useEffect(() => {
    if (words === "") return;
    let live = true;
    // A short wait, so a word typed is one search, not one per keystroke.
    const timer = setTimeout(() => {
      void app.request(gmThingsRequest(chatId, { op: "find", words })).then((answer) => {
        if (live && answer?.found) setFound({ words, ids: answer.found });
      });
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [words, chatId, editor.reloadKey]);
  const list = body?.list ?? null;
  const here = body?.here ?? null;
  const rows = useMemo(() => new Map((list?.rows ?? []).map((r) => [r.id, r])), [list]);
  const names = useMemo(() => new Map((list?.rows ?? []).map((r) => [r.id, r.name])), [list]);
  const sections = useMemo(() => (list ? placeSections(list.rows) : []), [list]);
  const hereAt = useMemo(() => (list && here?.here ? hereSections(list.rows, here.here) : []), [list, here]);
  const page = pages.page;
  const toggle = (set: ReadonlySet<string>, id: string): ReadonlySet<string> => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  };
  const openThing = (id: EntityId): void => pages.open({ thing: id });
  const openPerson = (id: EntityId): void => app.ui.update((ui) => gmOpen(ui, "world", id));
  const ownersOpen = owners ?? new Set([editor.gm.entities.find((e) => e.pov)?.id ?? ""]);
  const results = found && found.words === words ? found.ids.flatMap((id) => rows.get(id) ?? []) : null;
  const pov = editor.gm.entities.find((e) => e.pov);
  // While choosing, a row's tap picks it; the bar's Select all takes what the list shows now. Tidy up's cards are no list to choose from.
  const listing = words !== "" || view !== "tidy";
  const choosing = selection.on && listing;
  const picked = choosing ? new Set(selection.ids) : undefined;
  const tap = (id: EntityId): void => (choosing ? selection.toggle(id) : openThing(id));
  const shown = words !== "" ? (results ?? []).map((r) => r.id) : view === "here" ? hereAt.flatMap((s) => [...treeIds(s.room), ...treeIds(s.lying), ...treeIds(s.people)]) : view === "place" ? sections.flatMap((s) => treeIds(s.nodes)) : (list?.owners ?? []).filter((g) => ownersOpen.has(g.owner?.id ?? "")).flatMap((g) => [...g.on, ...g.home, ...g.away]);
  const chosen = selection.ids.flatMap((id) => rows.get(id) ?? []);
  const one = chosen.length === 1 ? chosen[0] : undefined;
  const pick = list?.pick ?? null;
  const chosenIds = new Set(chosen.map((r) => r.id));
  const loans = bulkLoans(clock);
  const closeBulk = () => setBulk(null);
  /** One bulk change as one GM edit; its sheet closes once it applied. */
  const change = (next: BulkChange): void => {
    const edit = bulkEdit(next, chosen);
    if (!edit) {
      app.toast("Nothing to change: each one is so already.", "info");
      return closeBulk();
    }
    void editor.edit(edit.ops, edit.done).then((ok) => {
      if (!ok) return;
      closeBulk();
      if (next.do === "remove") selection.set([]);
    });
  };
  return (
    <div ref={pages.host.ref} class="lre-gm-pages" onKeyDown={pages.host.onKeyDown}>
      <div class="lre-stack lre-gm-list lre-gm-things" hidden={page !== null} data-lre-gm-things={view} data-lre-choosing={choosing ? "" : undefined}>
        <div class="lre-gm-things-top">
          <label class="lre-gm-search">
            <Icon name="search" size={16} />
            <input class="lre-input" type="search" aria-label="Search things" placeholder="Search things: “Marcus's key”, “the fridge”" value={query} onInput={(event) => setQuery(event.currentTarget.value)} />
          </label>
          {listing ? (
            <Button size="sm" variant={choosing ? "primary" : "secondary"} icon={choosing ? "check" : "checklist"} title={choosing ? undefined : "Choose things to change together"} onClick={() => (choosing ? selection.stop() : selection.start())}>
              {choosing ? "Done" : "Select"}
            </Button>
          ) : null}
          <Button size="sm" icon="plus" label="Add a thing" title="Add a thing to this chat" disabled={!pick} onClick={() => setAdding(true)}>
            Add
          </Button>
        </div>
        {words !== "" ? (
          results === null ? (
            <Empty icon="hourglass">Searching…</Empty>
          ) : results.length === 0 ? (
            <Empty icon="search" title="No matches">
              No thing is called “{words}”, or has a name starting with it.
            </Empty>
          ) : (
            <Section title={counted(results.length)} flush>
              <div class="lre-thing-tree" role="list" data-lre-found="">
                {results.map((row) => (
                  <ThingRowView key={row.id} row={row} sub={whereWords(row)} picked={picked?.has(row.id)} onOpen={tap} />
                ))}
              </div>
            </Section>
          )
        ) : (
          <>
            <Seg<ThingsView>
              label="Show things"
              value={view}
              options={[
                { value: "here", label: "Here" },
                { value: "place", label: "By place" },
                { value: "owner", label: "By owner" },
                { value: "tidy", label: "Tidy up" },
              ]}
              onChange={setView}
            />
            {view === "tidy" ? (
              <TidyPanel chatId={chatId} editor={editor} names={names} onOpen={openThing} />
            ) : failed ? (
              <Empty icon="alert">This chat's things couldn't be read.</Empty>
            ) : !list || !here ? (
              <Empty icon="hourglass">Reading this chat's things…</Empty>
            ) : view === "here" ? (
              here.here === null ? (
                <Empty icon="pin">{pov ? `${pov.name} is nowhere` : "The player character is nowhere"}, so nothing is here.</Empty>
              ) : hereAt.length === 0 ? (
                <Empty icon="box">Nothing lies here, and nobody here has anything.</Empty>
              ) : (
                <HereView sections={hereAt} why={here.why} open={open} picked={picked} onToggle={(id) => setOpen(toggle(open, id))} onOpen={tap} onPerson={openPerson} />
              )
            ) : view === "place" ? (
              <PlaceTree sections={sections} open={open} problems={NO_PROBLEMS} picked={picked} onToggle={(id) => setOpen(toggle(open, id))} onOpen={tap} />
            ) : (
              <OwnerList groups={list.owners} rows={rows} open={ownersOpen} problems={NO_PROBLEMS} picked={picked} onToggle={(key) => setOwners(toggle(ownersOpen, key))} onOpen={tap} onParty={(party) => openPerson(party.id)} />
            )}
          </>
        )}
        {choosing ? <ThingsBulkBar selection={selection} all={[...rows.keys()]} shown={shown} rows={chosen} editor={editor} onSheet={setBulk} /> : null}
      </div>
      {bulk === "move" && pick ? <WhereSheet title="Move to" choices={pick.where.filter((c) => c.is === "place")} value={null} size={biggest(chosen)} onClose={closeBulk} onPick={(next) => next && "choice" in next && change({ do: "move", to: { place: next.choice.id }, words: `at ${next.choice.name}` })} /> : null}
      {bulk === "put" && pick ? <WhereSheet title="Put in" choices={pick.where.filter((c) => c.is === "thing" && !chosenIds.has(c.id) && !c.path.some((s) => chosenIds.has(s.id)))} value={null} size={biggest(chosen)} empty="Nothing picked" onClose={closeBulk} onPick={(next) => next && "choice" in next && change({ do: "move", to: { in: next.choice.id }, words: `in ${next.choice.name}` })} /> : null}
      {bulk === "hand" && pick ? (
        <HandSheet
          name={namesOf(chosen)}
          size={biggest(chosen) ?? "unknown"}
          people={pick.where.filter((c) => c.is === "person" && !chosen.every((r) => isAt(r, { in: c.id })))}
          owner={null}
          loans={loans}
          onClose={closeBulk}
          onHand={(to, basis, until) => {
            if (basis !== "hold" && basis !== "gift" && basis !== "loan") return;
            const ends = loans.find((l) => l.until === until);
            change({ do: "hand", to, whom: pick.where.find((c) => c.id === to)?.name ?? to, basis, ...(ends ? { until: ends } : {}) });
          }}
        />
      ) : null}
      {bulk === "own" && pick ? <PartySheet kind="own" subtitle={counted(chosen.length)} parties={pick.parties} onClose={closeBulk} onPick={(owner) => change({ do: "own", owner })} /> : null}
      {bulk === "use" && pick ? <UseSheet subtitle={namesOf(chosen)} people={pick.parties.filter((p) => p.is === "person")} loans={loans} onClose={closeBulk} onPick={(who, until) => change({ do: "grant", who: who.id, whom: who.name, ...(until ? { until } : {}) })} /> : null}
      {bulk === "rename" && one ? <RenameSheet row={one} busy={editor.busy} onClose={closeBulk} onRename={(name) => change({ do: "rename", name })} /> : null}
      {bulk === "size" ? (
        <FormSheet title="Size" subtitle={counted(chosen.length)} onClose={closeBulk}>
          <SizeChoices value={null} onPick={(size) => change({ do: "size", size })} />
        </FormSheet>
      ) : null}
      {bulk === "remove" ? <RemoveSheet rows={chosen} busy={editor.busy} onClose={closeBulk} onRemove={() => change({ do: "remove" })} /> : null}
      {adding && pick ? <GmAddThing chatId={chatId} pick={pick} here={here?.here ?? null} editor={editor} onClose={() => setAdding(false)} /> : null}
      {page ? <GmThingPage key={page.thing} chatId={chatId} id={page.thing} editor={editor} backLabel="Things" onBack={pages.back} onOpen={(id) => (isThingKind(editor.gm.kinds, editor.gm.entities.find((e) => e.id === id)?.kind ?? "") ? openThing(id) : openPerson(id))} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------- a thing's page

/** What says where a thing rests (`RestView.from`), as its page words it. */
const REST_FROM: Readonly<Record<RestView["from"], string>> = {
  home: "Set on it",
  authored: "Where the world starts it",
  carry: "Everyday carry: its owner keeps it on them",
  fixture: "A fixture: it stays where it stands",
  bought: "Bought: it goes to the buyer's",
  made: "Where it was made",
  stored: "Kept with their things at home: what keeps its kind there (a wardrobe for clothing)",
};

/** Who made each entry of a thing's history. */
const SOURCE_WORDS: Readonly<Record<HistorySource, string>> = { turn: "the turn", story: "the story", gm: "the GM", fix: "a ✎ fix", agent: "an agent" };

/** The sheets a thing's page opens. */
export type ThingSheet = "move" | "put" | "hand" | "kept" | "inside" | "wear";

/** Where a thing rests, in words: on its owner, a place or what holds it, or where it is. */
function restWords(rest: RestView | null): string {
  if (rest === null) return "Where it is";
  if (rest.owner) return "On its owner";
  return pathText(rest.where) || "Nowhere";
}

/** A spot in words: "at 114 Harbor Street", "in the Toolbox", "on Jordan Ellis". */
function spotWords(pick: ThingPicks, spot: Spot): string {
  const id = "place" in spot ? spot.place : spot.in;
  const choice = pick.where.find((c) => c.id === id);
  return choice ? stepWords({ id, name: choice.name, is: choice.is }) : id;
}

/** A field of the GM view's entity, as it is stored (null when it isn't). */
function fieldOf(entity: GmEntity | undefined, id: string): unknown {
  return entity?.fields.find((f) => f.id === id)?.value ?? null;
}

const item = (change: Extract<EditOp, { op: "item" }>["change"]): EditOp => ({ op: "item", change });

export interface GmThingBodyProps {
  page: ThingPage;
  gm: GmThingExtras;
  pick: ThingPicks;
  /** The thing as the GM view has it: its fields and relations under Advanced. */
  entity: GmEntity | undefined;
  editor: Editor;
  onSheet(sheet: ThingSheet): void;
  /** Opens a thing or a person it names. */
  onOpen(id: EntityId): void;
}

/**
 * A thing's page in GM → Things (ITEMS-SPEC §10.2), every section of it: Tidy up's findings on it;
 * where it is, why whoever has it has it, where it rests and Put it away, Move to…, Put in…, Hand
 * to… and Kept at…; whose it is and Make it theirs…; who may use it, each grant with × and Let
 * someone use it…; what it is; what it holds and + Add inside; its secrecy and Reveal; its history
 * in this chat; every field and relation under Advanced; Remove from the world. Each control one GM
 * edit, its notice the sentence saying what it did.
 */
export function GmThingBody(props: GmThingBodyProps) {
  const { page, gm, pick, editor, entity } = props;
  const row = page.row;
  const id = row.id;
  const name = row.name;
  const busy = editor.busy;
  const pov = editor.gm.entities.find((e) => e.id === gm.pov);
  const owner = row.whose.presumed === null && row.whose.owners.length === 1 ? (row.whose.owners[0] ?? null) : null;
  const granted = new Set(page.grants.map((g) => g.who.id));
  const people: RefOption[] = pick.parties.filter((p) => p.is === "person" && !granted.has(p.id)).map((p) => ({ value: p.id, label: p.name }));
  const parties: RefOption[] = pick.parties.map((p) => ({ value: p.id, label: p.name, ...(p.is !== "person" ? { sublabel: p.is === "company" ? "a business" : `a ${p.is}` } : {}) }));
  const partyName = (who: string): string => pick.parties.find((p) => p.id === who)?.name ?? who;
  const presumes = presumedLine(row.whose);
  const hiddenWords = row.hidden ? (gm.found ? "Hidden until searched; the player character has found it" : "Hidden until searched") : row.secret ? (gm.found ? "Secret; the player character knows of it" : "Secret") : "Public: anyone may know of it";
  const putAway = gm.putAway;
  // Who has it, by name: whom Wear puts it on and Take off takes it from.
  const holder = row.with;
  const holderName = holder !== null ? (pick.where.find((c) => c.id === holder)?.name ?? partyName(holder)) : null;
  return (
    <div class="lre-gm-entity lre-gm-thing" data-lre-gm-thing={id}>
      {gm.findings.map((f) => (
        <TidyCard key={f.key} finding={f} busy={busy} onFix={(fix) => void editor.edit(fix.ops, fix.done)} />
      ))}
      <Section title="Where it is">
        <ActionRows label="Where it is">
          <ActionRow title="Is" value={whereWords(row)} subtitle={gm.why ?? undefined} />
          <ActionRow
            title="Kept at"
            value={restWords(gm.rest)}
            subtitle={gm.rest ? REST_FROM[gm.rest.from] : "Nothing says where it goes back to"}
            actions={
              putAway ? (
                <Button size="sm" icon="home" disabled={busy} onClick={() => void editor.edit([item({ do: "move", item: id, to: putAway, why: "Put away" })], `${name} is put away, ${spotWords(pick, putAway)}.`)}>
                  Put it away
                </Button>
              ) : undefined
            }
          />
        </ActionRows>
        <div class="lre-gm-thing-actions">
          <Button size="sm" icon="pin" disabled={busy} onClick={() => props.onSheet("move")}>
            Move to…
          </Button>
          <Button size="sm" icon="box" disabled={busy} onClick={() => props.onSheet("put")}>
            Put in…
          </Button>
          <Button size="sm" icon="user" disabled={busy} onClick={() => props.onSheet("hand")}>
            Hand to…
          </Button>
          <Button size="sm" icon="home" disabled={busy} onClick={() => props.onSheet("kept")}>
            Kept at…
          </Button>
          {row.worn !== null && holder !== null ? (
            <Button size="sm" icon="close" disabled={busy} onClick={() => void editor.edit([item({ do: "wear", item: id, who: holder, off: true })], `${holderName ?? holder} takes off ${name}; it stays with them.`)}>
              Take off
            </Button>
          ) : row.slot !== null && holder !== null ? (
            <Button size="sm" icon="shield" disabled={busy} title={`Put it on ${holderName ?? holder}`} onClick={() => void editor.edit([item({ do: "wear", item: id, who: holder })], `${holderName ?? holder} wears ${name} now.`)}>
              Wear
            </Button>
          ) : row.slot !== null ? (
            <Button size="sm" icon="shield" disabled={busy} onClick={() => props.onSheet("wear")}>
              Wear…
            </Button>
          ) : null}
        </div>
      </Section>
      <Section title="Whose">
        <ActionRows label="Whose">
          <ActionRow title="Owner" value={whoseWords(row.whose)} subtitle={presumes ?? undefined} />
        </ActionRows>
        <RefPicker
          label="Make it theirs…"
          value={owner?.id ?? ""}
          options={parties}
          none="Nobody"
          disabled={busy}
          onChange={(next) => {
            const party = pick.parties.find((p) => p.id === next);
            void editor.edit([item({ do: "own", item: id, owner: next === "" ? null : next, why: "The GM made it so" })], next === "" ? `${name} is nobody's now.` : `${name} is ${party ? partyPossessive(party) : next} now.`);
          }}
        />
      </Section>
      <Section title="Who may use it">
        <div class="lre-thing-chips wrap" data-lre-use="">
          {page.use.length === 0 ? <span class="lre-small lre-muted">Nobody, but by a grant.</span> : null}
          {page.use.map((c) => (
            <span key={c.label} class="lre-thing-chip" title={c.who.join(", ")} data-lre-basis={c.basis}>
              {c.label}
            </span>
          ))}
        </div>
        <ActionRows label="Grants">
          {page.grants.map((g) => (
            <ActionRow
              key={g.who.id}
              title={g.who.name}
              subtitle={[GRANT_WORDS[g.basis], g.until !== null ? `until ${g.until}` : null].filter((p) => p !== null).join(" · ")}
              actions={
                <Button size="sm" variant="ghost" icon="close" label={`Stop ${g.who.name} using it`} disabled={busy} onClick={() => void editor.edit([item({ do: "revoke", item: id, who: g.who.id })], `${g.who.name} may no longer use ${name}.`)}>
                  Stop
                </Button>
              }
            />
          ))}
        </ActionRows>
        <AddPicker label="Let someone use it…" options={people} placeholder="Let someone use it…" disabled={busy} onAdd={(who) => void editor.edit([item({ do: "grant", item: id, who, basis: "assign" })], `${partyName(who)} may use ${name} now.`)} />
      </Section>
      <Section title="What it is">
        <span class="lre-small" data-lre-what="">
          {[row.type, page.kindLabel, `${sizeLabel(row.size)}, ${SIZE_FROM_WORDS[page.sizeFrom]}`].filter((p) => p !== null && p !== "").join(" · ")}
          {gm.made ? " · made in play" : ""}
        </span>
        <LabelForm key={JSON.stringify([name, fieldOf(entity, "aliases"), fieldOf(entity, "description"), fieldOf(entity, "size"), fieldOf(entity, "consumable"), fieldOf(entity, "sleep"), fieldOf(entity, "qty"), fieldOf(entity, "condition")])} id={id} name={name} entity={entity} size={row.size} editor={editor} />
      </Section>
      {row.kind === "vehicle" ? (
        <Section title="Specs">
          <GmSpecs key={JSON.stringify(fieldOf(entity, "specs"))} id={id} name={name} stored={vehicleSpecsOf(fieldOf(entity, "specs")) ?? []} editor={editor} />
        </Section>
      ) : null}
      {row.holds !== null ? <HoldsSection holds={row.holds} contents={page.contents} problems={NO_PROBLEMS} onOpen={props.onOpen} onAdd={() => props.onSheet("inside")} /> : null}
      <Section title="Secrecy">
        <ActionRows label="Secrecy">
          <ActionRow
            title="Who may know of it"
            value={hiddenWords}
            actions={
              (row.hidden || row.secret) && !gm.found ? (
                <Button size="sm" icon="eye" disabled={busy} onClick={() => void editor.edit([{ op: "link", rel: "knows", from: gm.pov, to: id }], `${pov?.name ?? "The player character"} knows of ${name} now.`)}>
                  Reveal to {pov?.name ?? "the player character"}
                </Button>
              ) : undefined
            }
          />
        </ActionRows>
      </Section>
      <Section title="History">
        {gm.history.length === 0 ? (
          <span class="lre-small lre-muted">Nothing in this chat has changed it.</span>
        ) : (
          <ActionRows label="History">
            {gm.history.map((h, i) => (
              <ActionRow key={`${h.turn}:${i}`} title={h.lines.join(" · ")} subtitle={`${h.turn === 0 ? "Before the first turn" : `Turn ${h.turn}`} · ${SOURCE_WORDS[h.source]}`} />
            ))}
          </ActionRows>
        )}
      </Section>
      {entity ? (
        <Disclosure summary="Advanced: every field, its relations and its id">
          <span class="lre-small">
            Id: <code>{id}</code>
          </span>
          <ActionRows label="Fields">
            {entity.fields.map((f) => (
              <FieldRow key={f.id} entity={entity} field={f} editor={editor} />
            ))}
          </ActionRows>
          <Relations entity={entity} editor={editor} />
        </Disclosure>
      ) : null}
      <Section title="Remove">
        <span class="lre-field-help">Takes {name} out of the world; what is in it stays where it is. The edit's Undo brings it back.</span>
        <Button variant="danger" icon="trash" disabled={busy} onClick={() => void editor.edit([item({ do: "remove", item: id, why: "The GM removed it" })], `${name} is out of the world.`)}>
          Remove from the world
        </Button>
      </Section>
    </div>
  );
}

/** A vehicle's specs, changed here and saved as one label edit. */
function GmSpecs(props: { id: EntityId; name: string; stored: VehicleSpec[]; editor: Editor }) {
  const [specs, setSpecs] = useState<VehicleSpec[]>(props.stored);
  const busy = props.editor.busy;
  return (
    <>
      <SpecsEditor value={specs} disabled={busy} onChange={setSpecs} />
      <Button size="sm" variant="primary" disabled={busy || JSON.stringify(specs) === JSON.stringify(props.stored)} onClick={() => void props.editor.edit([item({ do: "label", item: props.id, specs })], specs.length > 0 ? `${props.name}'s specs are saved.` : `${props.name} has no specs now.`)}>
        Save specs
      </Button>
    </>
  );
}

/** A label op's parts as What it is's notice names them. */
const LABEL_WORDS = { name: "name", aliases: "other names", description: "description", size: "size" } as const;

/**
 * What it is: its name, what else it is called, its description and size, consumable and sleep in
 * or on, and (at its Gear level) how many and its condition; Save sends what changed as one edit.
 */
function LabelForm(props: { id: EntityId; name: string; entity: GmEntity | undefined; size: SizeClass; editor: Editor }) {
  const { entity, editor } = props;
  const aliases = fieldOf(entity, "aliases");
  const description = fieldOf(entity, "description");
  const size = fieldOf(entity, "size");
  const qty = fieldOf(entity, "qty");
  const condition = fieldOf(entity, "condition");
  const stored = {
    name: props.name,
    aliases: Array.isArray(aliases) ? aliases.filter((a): a is string => typeof a === "string") : [],
    description: typeof description === "string" ? description : "",
    size: isSize(size) ? size : null,
    consumable: fieldOf(entity, "consumable") === true,
    sleep: fieldOf(entity, "sleep") === true,
    qty: typeof qty === "number" ? qty : null,
    condition: typeof condition === "number" ? condition : null,
  };
  const [v, setV] = useState(stored);
  const gear = entity?.levels.find((l) => l.domain === "gear")?.level ?? 0;
  const trimmed = v.name.trim();
  // What changed, as one label op and a set for each flag and number, and in words for the notice.
  const ops: EditOp[] = [];
  const parts: string[] = [];
  const label: Extract<ItemOp, { do: "label" }> = {
    do: "label",
    item: props.id,
    ...(trimmed !== stored.name ? { name: trimmed } : {}),
    ...(JSON.stringify(v.aliases) !== JSON.stringify(stored.aliases) ? { aliases: v.aliases } : {}),
    ...(v.description.trim() !== stored.description ? { description: v.description.trim() } : {}),
    ...(v.size !== null && v.size !== stored.size ? { size: v.size } : {}),
  };
  for (const key of ["name", "aliases", "description", "size"] as const) if (label[key] !== undefined) parts.push(LABEL_WORDS[key]);
  if (parts.length > 0) ops.push(item(label));
  for (const [key, words] of [["consumable", "consumable"], ["sleep", "sleep in or on"]] as const) {
    if (v[key] === stored[key]) continue;
    ops.push({ op: "set", entity: props.id, field: key, value: v[key] });
    parts.push(words);
  }
  for (const [key, words] of [["qty", "how many"], ["condition", "condition"]] as const) {
    const next = v[key];
    if (next === stored[key] || next === null) continue;
    ops.push({ op: "set", entity: props.id, field: key, value: next });
    parts.push(words);
  }
  const ready = ops.length > 0 && trimmed !== "" && trimmed.length <= THING_NAME_MAX && !editor.busy;
  const sizes = [...(stored.size === null ? [{ value: "", label: props.size === "unknown" ? "Not set (nothing gives one)" : `As inferred: ${sizeLabel(props.size)}` }] : []), ...SIZES.map((s) => ({ value: s, label: SIZE_LABELS[s], sublabel: SIZE_WORDS[s].means }))];
  return (
    <div class="lre-stack" data-lre-label-form="">
      <label class="lre-field">
        <span class="label">Name</span>
        <input class="lre-input" value={v.name} maxLength={THING_NAME_MAX} onInput={(event) => setV({ ...v, name: event.currentTarget.value })} />
      </label>
      <TextListEditor label="Also called" value={v.aliases} placeholder="Another name, as the story may say it" onChange={(aliases) => setV({ ...v, aliases })} />
      <label class="lre-field">
        <span class="label">Description</span>
        <textarea class="lre-input" rows={3} value={v.description} onInput={(event) => setV({ ...v, description: event.currentTarget.value })} />
      </label>
      <HostSelect label="Size" value={v.size ?? ""} options={sizes} onChange={(next) => setV({ ...v, size: isSize(next) ? next : null })} />
      {gear >= 2 ? <NumberStepper label="How many" value={v.qty} min={1} integer onChange={(qty) => setV({ ...v, qty })} /> : null}
      {gear >= 3 ? <NumberStepper label="Condition (0 broken, 100 like new)" value={v.condition} min={0} max={100} integer onChange={(condition) => setV({ ...v, condition })} /> : null}
      <CheckField label="Sleep in or on" help="A bed, a sofa, a sleeping bag, a van." checked={v.sleep} onChange={(sleep) => setV({ ...v, sleep })} />
      <CheckField label="Consumable" help="Used up as it is used: food, fuel, ammunition." checked={v.consumable} onChange={(consumable) => setV({ ...v, consumable })} />
      <div class="lre-inline">
        <Button variant="primary" disabled={!ready} onClick={() => void editor.edit(ops, `${trimmed}: ${listWords(parts)} saved.`)}>
          Save
        </Button>
        <Button variant="ghost" disabled={ops.length === 0} onClick={() => setV(stored)}>
          Revert
        </Button>
      </div>
    </div>
  );
}

/**
 * Hand to… (ITEMS-SPEC §4.6): someone to hand it to, as Holding it for its owner, a Gift (theirs
 * now) or a Loan (theirs to use until a day, three days or a week from now); or Return it to its
 * owner. Who can't carry it is said so: the thing stays where it is, theirs to have.
 */
function HandSheet(props: { name: string; size: SizeClass; people: readonly WhereChoice[]; owner: PartyRef | null; loans: readonly LoanChoice[]; onHand(to: EntityId, basis: HandoverBasis, until?: number): void; onClose(): void }) {
  const [basis, setBasis] = useState<"hold" | "gift" | "loan">("hold");
  const [loan, setLoan] = useState(0);
  const until = props.loans[loan]?.until;
  const owner = props.owner;
  return (
    <FormSheet title="Hand to…" subtitle={props.name} onClose={props.onClose}>
      <div class="lre-stack" data-lre-hand="">
        {owner ? (
          <Button icon="undo" onClick={() => props.onHand(owner.id, "return")}>
            Return it to {owner.name}
          </Button>
        ) : null}
        <Seg<"hold" | "gift" | "loan">
          label="As"
          value={basis}
          options={[
            { value: "hold", label: "Holding", title: "Holding it for its owner" },
            { value: "gift", label: "Gift", title: "Theirs now" },
            { value: "loan", label: "Loan", title: "Theirs to use for a while" },
          ]}
          onChange={setBasis}
        />
        {basis === "loan" && props.loans.length > 0 ? <HostSelect label="Until" value={String(loan)} options={props.loans.map((l, i) => ({ value: String(i), label: l.label }))} onChange={(next) => setLoan(Number(next))} /> : null}
        <List>
          {props.people.map((p) => {
            const at = p.path.at(-1);
            return <ListRow key={p.id} icon="user" title={p.name} subtitle={cannotHold(p, props.size) ?? (at ? stepWords(at) : undefined)} chevron onClick={() => props.onHand(p.id, basis, basis === "loan" ? until : undefined)} />;
          })}
        </List>
      </div>
    </FormSheet>
  );
}

/** + Add inside: a new thing made inside this one, by its name and (if the GM says) its size, its owner's. */
function AddInsideSheet(props: { holder: string; owner: EntityId | null; busy: boolean; onMake(op: EditOp, done: string): void; onClose(): void }) {
  const [name, setName] = useState("");
  const [size, setSize] = useState<Size | null>(null);
  const trimmed = name.trim();
  const ready = trimmed !== "" && trimmed.length <= THING_NAME_MAX && !props.busy;
  return (
    <FormSheet
      title="Add inside"
      subtitle={props.holder}
      onClose={props.onClose}
      actions={
        <Button size="sm" variant="primary" disabled={!ready} onClick={() => props.onMake(item({ do: "make", name: trimmed, at: { in: props.holder }, ...(size ? { size } : {}), ...(props.owner ? { owner: props.owner } : {}), why: "The GM put it there" }), `${trimmed} is in it now.`)}>
          Add
        </Button>
      }
    >
      <div class="lre-stack" data-lre-add-inside="">
        <label class="lre-field">
          <span class="label">Name</span>
          <input class="lre-input" value={name} maxLength={THING_NAME_MAX} placeholder="Spare fuse" onInput={(event) => setName(event.currentTarget.value)} />
        </label>
        <span class="lre-small lre-muted">How big is it? Leave it, and its name may say.</span>
        <SizeChoices value={size} onPick={setSize} />
      </div>
    </FormSheet>
  );
}

/** Kept at…'s choices beyond places and holders: where it is, or on its owner. */
const KEPT_EXTRAS: readonly WhereExtra[] = [
  { value: "here", label: "Where it is", help: "It is kept where it is; moved, it is kept there" },
  { value: "owner", label: "On its owner", help: "Its owner carries it: wallet, keys, phone" },
];

/**
 * A thing's page in GM (from Things or World): its read (`lre.things` thing in GM scope), the page,
 * and the sheets its controls open. A removed thing says so, with Restore.
 */
export function GmThingPage(props: { chatId: string; id: EntityId; editor: BulkEditor; backLabel: string; onBack(): void; onOpen(id: EntityId): void }) {
  const { editor, id } = props;
  const entity = editor.gm.entities.find((e) => e.id === id);
  const gone = entity?.gone === true;
  const { body, failed } = useGmThings(props.chatId, gone ? null : { op: "thing", entity: id }, editor.reloadKey);
  // Its full entry (fields, relations, the label form's values): Things lists it slim.
  useEffect(() => editor.need({ entities: [id] }), [id]);
  const [sheet, setSheet] = useState<ThingSheet | null>(null);
  const page = body?.thing ?? null;
  const gm = body?.gm ?? null;
  const pick = body?.pick ?? null;
  const row = page?.row ?? null;
  const name = row?.name ?? entity?.name ?? id;
  const close = () => setSheet(null);
  /** One edit from a sheet: the sheet closes once it applied. */
  const send = (ops: EditOp[], done: string) => void editor.edit(ops, done).then((ok) => ok && close());
  // Move to…'s value: the place it lies at; Kept at…'s: on its owner, the place or holder its own `home` names, else where it is.
  const lyingAt = page ? pick?.where.find((c) => c.is === "place" && c.id === page.row.where.at(-1)?.id) : undefined;
  const keptAt = page?.kept.set ? pick?.where.find((w) => w.id === page.kept.where.at(-1)?.id) : undefined;
  const kept: WherePick = page?.kept.set && page.kept.owner ? { extra: "owner" } : keptAt ? { choice: keptAt } : { extra: "here" };
  // Its one stated owner: what + Add inside makes is theirs, and Return it to… hands it back to them when they are a person who doesn't have it.
  const sole = page && page.row.whose.presumed === null && page.row.whose.owners.length === 1 ? page.row.whose.owners[0] : undefined;
  const ownerRef = sole && sole.is === "person" && page?.row.with !== sole.id ? sole : null;
  return (
    <GmPage
      name="thing"
      title={name}
      subtitle={
        <>
          {row ? <ThingChips row={row} whose={false} /> : null}
          {gm?.made ? <Badge tone="gm">Made in play</Badge> : null}
          <IdText id={id} />
        </>
      }
      backLabel={props.backLabel}
      onBack={props.onBack}
    >
      {gone ? (
        <Banner
          tone="neg"
          title="Removed from the world"
          actions={
            <Button variant="primary" icon="undo" disabled={editor.busy} onClick={() => void editor.edit([{ op: "restore", entity: id }], `${name} is back in the world.`)}>
              Restore
            </Button>
          }
        >
          Out of the world until restored.
        </Banner>
      ) : failed ? (
        <Empty icon="alert">This thing couldn't be read.</Empty>
      ) : !page || !gm || !pick ? (
        <Empty icon="hourglass">Reading the thing…</Empty>
      ) : (
        <GmThingBody page={page} gm={gm} pick={pick} entity={entity && !thinEntity(entity) ? entity : undefined} editor={editor} onSheet={setSheet} onOpen={props.onOpen} />
      )}
      {sheet === "move" && page && pick ? (
        <WhereSheet title="Move to" choices={pick.where.filter((c) => c.is === "place")} value={lyingAt ? { choice: lyingAt } : null} size={page.row.size} onClose={close} onPick={(next) => next && "choice" in next && send([item({ do: "move", item: id, to: { place: next.choice.id }, why: "The GM moved it" })], `${name} is at ${next.choice.name} now.`)} />
      ) : null}
      {sheet === "put" && page && pick ? (
        <WhereSheet title="Put in" choices={pick.where.filter((c) => c.is === "thing" && c.id !== id && !c.path.some((s) => s.id === id))} value={null} size={page.row.size} empty="Nothing picked" onClose={close} onPick={(next) => next && "choice" in next && send([item({ do: "move", item: id, to: { in: next.choice.id }, why: "The GM put it there" })], `${name} is in ${next.choice.name} now.`)} />
      ) : null}
      {sheet === "hand" && page && gm && pick ? (
        <HandSheet
          name={name}
          size={page.row.size}
          people={pick.where.filter((c) => c.is === "person" && c.id !== page.row.with)}
          owner={ownerRef}
          loans={gm.loans}
          onClose={close}
          onHand={(to, basis, until) => {
            const whom = pick.parties.find((p) => p.id === to)?.name ?? pick.where.find((c) => c.id === to)?.name ?? to;
            const done = basis === "return" ? `${name} is back with ${whom}.` : basis === "gift" ? `${name} is ${partyPossessive({ name: whom, is: "person" })} now, a gift.` : basis === "loan" ? `${whom} has ${name} on loan.` : `${whom} is holding ${name} now.`;
            send([item({ do: "hand", item: id, to, basis, ...(until !== undefined ? { until } : {}), why: basis === "return" ? "Given back" : "The GM handed it over" })], done);
          }}
        />
      ) : null}
      {sheet === "kept" && page && pick ? (
        <WhereSheet
          title="Kept at"
          choices={pick.where.filter((c) => c.id !== id && !c.path.some((s) => s.id === id))}
          value={kept}
          size={page.row.size}
          extras={KEPT_EXTRAS}
          onClose={close}
          onPick={(next) => {
            const home: Rest | null = next === null || ("extra" in next && next.extra === "here") ? null : "extra" in next ? "owner" : next.choice.is === "place" ? { place: next.choice.id } : { in: next.choice.id };
            send([item({ do: "home", item: id, home })], home === null ? `${name} is kept where it is.` : home === "owner" ? `${name} is kept on its owner.` : `${name} is kept ${spotWords(pick, home)} now.`);
          }}
        />
      ) : null}
      {sheet === "inside" && page ? <AddInsideSheet holder={id} owner={sole?.id ?? null} busy={editor.busy} onClose={close} onMake={(op, done) => send([op], done)} /> : null}
      {sheet === "wear" && page && pick ? (
        <FormSheet title="Wear" subtitle={name} onClose={close}>
          <List>
            {pick.where
              .filter((c) => c.is === "person")
              .map((p) => {
                const at = p.path.at(-1);
                return <ListRow key={p.id} icon="user" title={p.name} subtitle={cannotHold(p, page.row.size) ?? (at ? stepWords(at) : undefined)} chevron onClick={() => send([item({ do: "wear", item: id, who: p.id })], `${p.name} wears ${name} now.`)} />;
              })}
          </List>
        </FormSheet>
      ) : null}
    </GmPage>
  );
}

// ---------------------------------------------------------------- a person's things

/**
 * A row's GM controls on a person's page: Take off what they wear; Wear what has a slot and is with
 * them, held for someone or kept in their wardrobe; Put it away for what isn't where it rests; each
 * one GM edit with its Undo.
 */
export function personThingMenu(row: ThingRow, bucket: PersonBucket["key"], person: { id: EntityId; name: string }, editor: Editor): MenuItem[] {
  const out: MenuItem[] = [];
  if (bucket === "outfit") out.push({ label: "Take off", icon: "close", disabled: editor.busy, onSelect: () => void editor.edit([item({ do: "wear", item: row.id, who: person.id, off: true })], `${person.name} takes off ${row.name}; it stays with them.`) });
  else if (row.slot !== null && (bucket === "carried" || bucket === "wardrobe" || bucket === "holding")) out.push({ label: "Wear", icon: "shield", disabled: editor.busy, onSelect: () => void editor.edit([item({ do: "wear", item: row.id, who: person.id })], `${person.name} wears ${row.name} now.`) });
  const away = bulkEdit({ do: "away" }, [row]);
  if (away) out.push({ label: "Put it away", icon: "home", disabled: editor.busy, onSelect: () => void editor.edit(away.ops, away.done) });
  return out;
}

/** A saved set as `SetRows` lists it: the gear pack's `GearSet`, which the frontend reads through the pack's UI, never its core. */
type SetRow = Parameters<typeof SetRows>[0]["sets"][number];

/**
 * A person's saved outfits and loadouts as their GM page lists them (`fields.sets`, DESIGN §28.16), by
 * kind and name: each piece by name and the slot it goes in (one gone from the world, missing), and
 * On now when every piece still in the world is worn in its slot (`outfit`: what they wear, as their
 * things read).
 */
export function gmSets(person: Pick<GmEntity, "fields">, outfit: readonly ThingRow[], entities: readonly GmEntity[]): SetRow[] {
  const byId = new Map(entities.map((e) => [e.id, e]));
  const worn = new Map(outfit.map((r) => [r.id, r]));
  return Object.entries(setsOf({ sets: person.fields.find((f) => f.id === "sets")?.value }))
    .map(([id, set]): SetRow => {
      const reached = set.pieces.filter((p) => byId.get(p.item)?.gone === false);
      const on =
        reached.length > 0 &&
        reached.every((p) => {
          const row = worn.get(p.item);
          return row !== undefined && row.worn !== null && row.worn === (p.slot ?? row.slot);
        });
      const pieces = set.pieces.map((p) => ({ item: p.item, name: byId.get(p.item)?.name ?? p.item, ...(p.slot !== undefined ? { slot: p.slot.replace(/_/g, " ") } : {}), ...(reached.includes(p) ? {} : { missing: true as const }) }));
      return { id, name: set.name, kind: set.kind, pieces, ...(on ? { on: true as const } : {}) };
    })
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/**
 * A person's outfits and loadouts on their GM page (DESIGN §28.16; from Gear 3): each saved set with
 * its pieces and On now, Change into (the gear pack's `set_apply`: each piece put on in its slot,
 * what else of its kind they wear taken off and, at home, put back where it is kept) and Forget, then
 * Save what they wear as…; each one GM edit with its Undo. Hook-free but for the save form.
 */
export function GmSets(props: { person: GmEntity; outfit: readonly ThingRow[]; editor: Editor }) {
  const { person, editor } = props;
  const sets = gmSets(person, props.outfit, editor.gm.entities);
  return (
    <Section title="Outfits & loadouts">
      <div class="lre-stack" data-lre-gm-sets={person.id}>
        {SET_KINDS.map((kind) => (
          <div key={kind} class="lre-bel-group">
            <div class="lre-bel-group-head">{kind === "outfit" ? "Outfits" : "Loadouts"}</div>
            <SetRows
              sets={sets}
              kind={kind}
              busy={editor.busy}
              onApply={(set) => void editor.edit([item({ do: "set_apply", who: person.id, set: set.id })], `${person.name} changed into ${set.name}.`)}
              onDrop={(set) => void editor.edit([item({ do: "set_drop", who: person.id, set: set.id })], `${person.name} no longer keeps ${set.name}.`)}
            />
          </div>
        ))}
        <SaveSetForm person={person} editor={editor} />
      </div>
    </Section>
  );
}

/** Save what they wear as…: what the person wears now kept as an outfit, or what they have ready as a loadout, under a name (one of that name replaced); one GM edit. */
function SaveSetForm(props: { person: GmEntity; editor: Editor }) {
  const { person, editor } = props;
  const [name, setName] = useState("");
  const [kind, setKind] = useState<SetKind>("outfit");
  const nameId = useId();
  const trimmed = name.trim();
  const done = kind === "outfit" ? `${trimmed}: what ${person.name} wears now, saved as an outfit.` : `${trimmed}: what ${person.name} has ready now, saved as a loadout.`;
  return (
    <div class="lre-bel-group" data-lre-gm-set-save="">
      <div class="lre-bel-group-head">Save what they wear as…</div>
      <Seg<SetKind> label="Save as" value={kind} options={SET_KINDS.map((k) => ({ value: k, label: SET_KIND_LABEL[k] }))} onChange={setKind} />
      <div class="lre-field">
        <label class="label" for={nameId}>
          Name
        </label>
        <input id={nameId} class="lre-input" value={name} maxLength={SET_NAME_MAX} placeholder={kind === "outfit" ? "Work clothes" : "Range day"} onInput={(event) => setName(event.currentTarget.value)} />
        <span class="lre-field-help">{kind === "outfit" ? `Keeps what ${person.name} wears now.` : `Keeps what ${person.name} has ready: in hand, holstered, sheathed, and their armor.`}</span>
      </div>
      <Button variant="primary" icon="check" disabled={editor.busy || trimmed === ""} onClick={() => void editor.edit([item({ do: "set_save", who: person.id, name: trimmed, kind })], done).then((ok) => ok && setName(""))}>
        Save
      </Button>
    </div>
  );
}

/**
 * A person's things on their GM page (ITEMS-SPEC §10.2): Outfit, Carried and Wardrobe, then the rest
 * of theirs and what they hold for others, as Build's Character page groups them, read from the
 * chat's head and again after every edit; a row opens its thing page, and its menu is
 * `personThingMenu`'s. From Gear 3, their outfits and loadouts (`GmSets`).
 */
export function GmPersonThings(props: { chatId: string; person: GmEntity; editor: BulkEditor; onOpen(id: EntityId): void }) {
  const { body, failed } = useGmThings(props.chatId, { op: "person", entity: props.person.id }, props.editor.reloadKey);
  const groups = body?.person ?? null;
  const gear = props.person.levels.find((l) => l.domain === "gear")?.level ?? 0;
  return (
    <>
      <Section title="Things">
        {failed ? (
          <Empty icon="alert">Their things couldn't be read.</Empty>
        ) : groups ? (
          <PersonGroups person={props.person.id} groups={groups} problems={NO_PROBLEMS} menu={(row, bucket) => personThingMenu(row, bucket, props.person, props.editor)} onOpen={props.onOpen} />
        ) : (
          <span class="lre-small lre-muted">Reading their things…</span>
        )}
      </Section>
      {gear >= 3 ? <GmSets person={props.person} outfit={groups?.outfit ?? []} editor={props.editor} /> : null}
    </>
  );
}
