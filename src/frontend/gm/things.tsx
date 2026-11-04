// GM → Things (ITEMS-SPEC §10.2, §7.5, §6.2; mobile first, 390 px): the chat's things as they stand
// on its head, behind the gate with the rest of the truth, read through `lre.things` in GM scope.
// Here: where the player character is, what is in the room (furniture, built-in things and vehicles,
// what is in them nested), what lies there, and what the people there have, with why each has it.
// By place and By owner: Build's trees. Tidy up: the audit's findings, each with the one GM edit that
// fixes it or the fixes to choose from, Leave it (kept beside the chat; Show N left brings one back),
// Ask the Curator (the GM assistant), and how many a run shows; then Keep in the world, which copies
// what the chat made in play into its world's draft. A thing's page, from here or from World: where
// it is and why whoever has it has it, where it rests and Put it away, Move to…, Put in…, Hand to…,
// Kept at…, whose it is and who may use it, what it is and holds, its secrecy, its history in this
// chat and every field under Advanced; never a simulation level, a life or a tier. Each control is
// one GM edit with its own Undo, its notice saying what it did.

import { useEffect, useMemo, useState } from "preact/hooks";
import type { EntityId } from "../../shared/ids";
import type { EditOp, GmThingsRead, ResultBodies } from "../../shared/protocol";
import { TIDY_BOUNDS } from "../../shared/settings";
import type { GmEntity, GmView } from "../../shared/state-view";
import type { GmThingExtras, HistorySource, KeepResult, LoanChoice, MadeInPlay, RestView, TidyFinding, TidyFix, TidyKind, TidyRun } from "../../shared/thing-gm";
import type { HandoverBasis, ItemOp, Rest, Size, SizeClass, Spot } from "../../shared/things";
import { isSize, SIZE_LABELS, SIZES, THING_NAME_MAX } from "../../shared/things";
import type { PartyRef, ThingPage, ThingPicks, ThingRow, WhereChoice, WhereStep } from "../../shared/thing-view";
import { GRANT_WORDS, partyPossessive, presumedLine, SIZE_FROM_WORDS, SIZE_WORDS, sizeLabel, whoseWords } from "../../shared/thing-view";
import { listWords } from "../../shared/words";
import { useApp } from "../app";
import { AddPicker, CheckField, FormSheet, RefPicker, type RefOption } from "../build/form-kit";
import { HoldsSection, OwnerList, PlaceTree, SizeChoices, ThingChips, ThingRowView, TreeRows, whereWords } from "../build/things";
import { placeSections, type TreeNode } from "../build/things-model";
import { TextListEditor } from "../character/text-list";
import { Badge, Banner, Button, Disclosure, Empty, HostSelect, IdText, List, ListRow, NumberStepper, Section, Seg, useBusy } from "../components";
import { Icon } from "../icons";
import { PickBox } from "../multi-select";
import { gmThingsRequest } from "../requests";
import { cannotHold, pathText, stepWords } from "../things/where";
import { WhereSheet, type WhereExtra, type WherePick } from "../things/where-picker";
import type { BulkEditor, Editor } from "./editor";
import { FieldRow, Relations } from "./entity";
import { gmAt, gmOpen } from "./gate";
import { ActionRow, ActionRows, GmCard, GmPage, usePages } from "./ui";

type ThingsBody = ResultBodies["lre.things"];

/** No lint in GM mode: a chat's things carry no problems of the draft's. */
const NO_PROBLEMS: ReadonlyMap<string, "error" | "warning"> = new Map();

/**
 * Reads `lre.things` in GM scope for the chat, again whenever the GM view loads again (`gm`: a new
 * view after every turn, edit and Undo). Null while it loads; `failed` once it couldn't be read;
 * `set` takes an answer another request gave (Leave it, Keep in the world). A read of something
 * else shows nothing of the last one's.
 */
function useGmThings(chatId: string, read: GmThingsRead | null, gm: GmView): { body: ThingsBody | null; failed: boolean; set(body: ThingsBody): void } {
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
  }, [app, chatId, key, gm]);
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

/** Rows of things someone has, each with why they have it on its second line; what is in them under them once opened. */
function WhyRows(props: { nodes: readonly TreeNode[]; why: Readonly<Record<string, string>>; open: ReadonlySet<string>; onToggle(id: string): void; onOpen(id: EntityId): void }) {
  return (
    <>
      {props.nodes.map((node) => {
        if ("holder" in node) return <TreeRows key={node.holder.id} nodes={[node]} depth={0} open={props.open} problems={NO_PROBLEMS} onToggle={props.onToggle} onOpen={props.onOpen} />;
        const open = props.open.has(node.thing.id);
        return (
          <div key={node.thing.id} class="lre-thing-node">
            <ThingRowView row={node.thing} sub={props.why[node.thing.id]} expanded={open} onToggle={node.children.length > 0 ? () => props.onToggle(node.thing.id) : undefined} onOpen={props.onOpen} />
            {open ? <TreeRows nodes={node.children} depth={1} open={props.open} problems={NO_PROBLEMS} onToggle={props.onToggle} onOpen={props.onOpen} /> : null}
          </div>
        );
      })}
    </>
  );
}

/** Here's places: each headed by its path, then In the room, Lying here and On the people here, each person with Open (their sheet in World). */
export function HereView(props: { sections: readonly HereSection[]; why: Readonly<Record<string, string>>; open: ReadonlySet<string>; onToggle(id: string): void; onOpen(id: EntityId): void; onPerson(id: EntityId): void }) {
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
                  <TreeRows nodes={s.room} depth={0} open={props.open} problems={NO_PROBLEMS} onToggle={props.onToggle} onOpen={props.onOpen} />
                </div>
              </div>
            ) : null}
            {s.lying.length > 0 ? (
              <div class="lre-thing-bucket" data-lre-here-group="lying">
                <div class="lre-thing-bucket-head">Lying here</div>
                <div role="list">
                  <TreeRows nodes={s.lying} depth={0} open={props.open} problems={NO_PROBLEMS} onToggle={props.onToggle} onOpen={props.onOpen} />
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
                      <WhyRows nodes={p.children} why={props.why} open={props.open} onToggle={props.onToggle} onOpen={props.onOpen} />
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
  handover_owner: "An owner a handover changed",
  duplicate: "Maybe the same thing",
  size_unknown: "Size unknown",
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
function TidyPanel(props: { chatId: string; editor: Editor; names: ReadonlyMap<string, string>; onOpen(id: EntityId): void }) {
  const app = useApp();
  const { editor, chatId } = props;
  const tidy = useGmThings(chatId, { op: "tidy" }, editor.gm);
  const made = useGmThings(chatId, { op: "made" }, editor.gm);
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

// ---------------------------------------------------------------- the Things section

type ThingsView = "here" | "place" | "owner" | "tidy";

/** GM → Things: search, Here · By place · By owner · Tidy up, and a thing's page over the list. */
export function ThingsSection(props: { editor: BulkEditor; chatId: string }) {
  const app = useApp();
  const { editor, chatId } = props;
  const pages = usePages<{ thing: EntityId }>();
  // The list is read again with the GM view, so what an edit changed shows once it applied.
  const { body, failed } = useGmThings(chatId, { op: "list" }, editor.gm);
  const [view, setView] = useState<ThingsView>("here");
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<{ words: string; ids: EntityId[] } | null>(null);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [owners, setOwners] = useState<ReadonlySet<string> | null>(null);
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
  }, [words, chatId, editor.gm]);
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
  return (
    <div ref={pages.host.ref} class="lre-gm-pages" onKeyDown={pages.host.onKeyDown}>
      <div class="lre-stack lre-gm-list lre-gm-things" hidden={page !== null} data-lre-gm-things={view}>
        <label class="lre-gm-search">
          <Icon name="search" size={16} />
          <input class="lre-input" type="search" aria-label="Search things" placeholder="Search things: “Marcus's key”, “the fridge”" value={query} onInput={(event) => setQuery(event.currentTarget.value)} />
        </label>
        {words !== "" ? (
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
                  <ThingRowView key={row.id} row={row} sub={whereWords(row)} onOpen={openThing} />
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
                <HereView sections={hereAt} why={here.why} open={open} onToggle={(id) => setOpen(toggle(open, id))} onOpen={openThing} onPerson={openPerson} />
              )
            ) : view === "place" ? (
              <PlaceTree sections={sections} open={open} problems={NO_PROBLEMS} onToggle={(id) => setOpen(toggle(open, id))} onOpen={openThing} />
            ) : (
              <OwnerList groups={list.owners} rows={rows} open={ownersOpen} problems={NO_PROBLEMS} onToggle={(key) => setOwners(toggle(ownersOpen, key))} onOpen={openThing} onParty={(party) => openPerson(party.id)} />
            )}
          </>
        )}
      </div>
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
};

/** Who made each entry of a thing's history. */
const SOURCE_WORDS: Readonly<Record<HistorySource, string>> = { turn: "the turn", story: "the story", gm: "the GM", fix: "a ✎ fix", agent: "an agent" };

/** The sheets a thing's page opens. */
export type ThingSheet = "move" | "put" | "hand" | "kept" | "inside";

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
export function GmThingPage(props: { chatId: string; id: EntityId; editor: Editor; backLabel: string; onBack(): void; onOpen(id: EntityId): void }) {
  const { editor, id } = props;
  const entity = editor.gm.entities.find((e) => e.id === id);
  const gone = entity?.gone === true;
  const { body, failed } = useGmThings(props.chatId, gone ? null : { op: "thing", entity: id }, editor.gm);
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
        <GmThingBody page={page} gm={gm} pick={pick} entity={entity} editor={editor} onSheet={setSheet} onOpen={props.onOpen} />
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
    </GmPage>
  );
}
