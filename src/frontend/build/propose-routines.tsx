// Propose routines from lore (DESIGN §13, #48): the job's start form, whom to propose for, and its
// review. The review is Import from lore's: proposals ticked to apply, a count, Select all and None,
// and Apply in a sticky bar writing the ticked ones into the draft as `lre.editor put`. It groups
// them by the person or group they're for. Each shows the lore entry or sheet field it rests on with
// its quote, and every problem found checking it against the draft (a clash with their schedules or
// routine, a place or company it can't have, an item of its id already in the draft); only one with
// none starts ticked. Each opens in Build's own routine or schedule form to be edited before it's
// applied. A proposal that doesn't rest on a lore entry or a sheet field throughout is never offered.
// A review's ticks and edits are kept by job, so leaving the page and coming back loses nothing.

import { useMemo, useState } from "preact/hooks";
import { hasOwn, isRecord } from "../../shared/json";
import type { JsonValue } from "../../shared/json";
import type { JobProposal, RoutineJobInput } from "../../shared/protocol";
import { BLOCK_KIND_LABEL, isOff, routineShapeProblems, type RoutineDef, type RoutineEntry } from "../../shared/routines";
import type { ScheduleDef, WorldDoc } from "../../shared/world";
import type { App } from "../app";
import { useApp } from "../app";
import type { SegOption } from "../components";
import { Badge, Button, Empty, Field, IdText, JsonView, SaveBar, Section, Seg, useBusy } from "../components";
import { humanize } from "../format";
import { Icon } from "../icons";
import { createStore, useSelect } from "../store";
import { COLLECTION_INFO, itemLabel } from "./chrome";
import { draftSend } from "./draft";
import type { RefOption } from "./form-kit";
import { FormSheet } from "./form-kit";
import { proposalWrites, startTicked } from "./jobs";
import { ownerOptions } from "./owner-picker";
import { RoutineForm } from "./routine-editor";
import { EVERY, ScheduleForm, slotProblems, targetWords, valueWords } from "./schedule-form";
import { kindIs } from "./selector-editor";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function nameOf(doc: WorldDoc, id: string): string {
  return hasOwn(doc.entities, id) ? doc.entities[id]?.name || id : id;
}

// ---------------------------------------------------------------- whom to propose for

/** The people and groups the job may be asked for, by name: none secret, and never the player's character. */
export function proposeOwners(doc: WorldDoc): { people: RefOption[]; groups: RefOption[] } {
  const open = (id: string): boolean => id !== doc.pov && doc.entities[id]?.visibility !== "secret";
  return {
    people: ownerOptions(doc, "entity").filter((o) => open(o.value) && kindIs(doc, doc.entities[o.value]?.kind ?? "", "person")),
    groups: ownerOptions(doc, "group").filter((o) => open(o.value)),
  };
}

const WHO: readonly SegOption<"all" | "some">[] = [
  { value: "all", label: "Everyone" },
  { value: "some", label: "Choose" },
];

/** The job's start form: everyone the job may read, or the people and groups picked. */
export function RoutineJobStart(props: { busy: boolean; onStart(input: RoutineJobInput): void }) {
  const app = useApp();
  const draft = useSelect(app.drafts, (d) => d);
  // Owners as Build's forms read them: the packs' kinds merged in, the world's own winning.
  const doc = useMemo(() => (draft ? { ...draft.doc, kinds: { ...draft.packKinds, ...draft.doc.kinds } } : null), [draft]);
  const [who, setWho] = useState<"all" | "some">("all");
  const [picked, setPicked] = useState<string[]>([]);
  const [find, setFind] = useState("");
  const owners = useMemo(() => (doc ? proposeOwners(doc) : { people: [], groups: [] }), [doc]);
  const needle = find.trim().toLowerCase();
  const toggle = (id: string) => setPicked(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]);
  const picks = (title: string, options: readonly RefOption[]) => {
    const shown = options.filter((o) => needle === "" || o.label.toLowerCase().includes(needle) || picked.includes(o.value));
    return shown.length === 0 ? null : (
      <Field label={title}>
        <div class="lre-build-picks" role="group" aria-label={title}>
          {shown.map((o) => (
            <label key={o.value} class="lre-build-pick">
              <input type="checkbox" checked={picked.includes(o.value)} onChange={() => toggle(o.value)} />
              <span>
                {o.label}
                {o.sublabel ? <span class="lre-muted"> · {o.sublabel}</span> : null}
              </span>
            </label>
          ))}
        </div>
      </Field>
    );
  };
  return (
    <div class="lre-stack">
      <p class="lre-build-note">The AI reads the world's lore and each person's and group's sheet, and proposes their routines and schedules: shifts, opening hours, meals with the household, a weekly club night. Each rests on the lore entry or sheet field it quotes, and someone the lore gives no routine gets none. Nothing changes until you apply.</p>
      <Field label="Propose for">
        <Seg<"all" | "some"> label="Propose for" value={who} options={WHO} onChange={(next) => setWho(next)} />
      </Field>
      {who === "some" ? (
        owners.people.length + owners.groups.length === 0 ? (
          <Empty icon="users">No people or groups to propose for.</Empty>
        ) : (
          <>
            {owners.people.length + owners.groups.length > 12 ? <input class="lre-input" type="search" placeholder="Find by name" aria-label="Find by name" value={find} onInput={(event) => setFind(event.currentTarget.value)} /> : null}
            {picks("People", owners.people)}
            {picks("Groups", owners.groups)}
          </>
        )
      ) : null}
      <Button variant="primary" block disabled={props.busy || (who === "some" && picked.length === 0)} onClick={() => props.onStart(who === "all" ? {} : { owners: picked })}>
        {who === "all" ? "Propose for everyone" : picked.length === 0 ? "Pick whom to propose for" : picked.length === 1 ? "Propose for the one chosen" : `Propose for the ${picked.length} chosen`}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------- the review's reading of a proposal

/** Whether a source is one a proposal may rest on: a lore entry or a sheet field. */
function grounded(source: unknown): boolean {
  if (!isRecord(source)) return false;
  if (source.type === "lore") return typeof source.entry === "string" && source.entry !== "";
  return source.type === "sheet" && typeof source.entity === "string" && source.entity !== "" && typeof source.field === "string" && source.field !== "";
}

/**
 * Whether a proposal rests on lore or a sheet throughout: a routine whose every block does (its own
 * source, else the routine's), or a schedule whose every slot does (likewise), or that does itself
 * when it has none.
 */
export function citesSource(p: JobProposal): boolean {
  const value = p.value;
  if (!isRecord(value)) return false;
  if (p.collection === "routines") {
    const blocks = Array.isArray(value.blocks) ? value.blocks : [];
    return blocks.length > 0 && blocks.every((b) => isRecord(b) && grounded(b.source !== undefined ? b.source : value.source));
  }
  if (p.collection === "schedules") {
    const slots = Array.isArray(value.slots) ? value.slots : [];
    return slots.length > 0 ? slots.every((s) => isRecord(s) && grounded(s.source !== undefined ? s.source : value.source)) : grounded(value.source);
  }
  return false;
}

/** The proposals the review offers: routines and schedules resting on lore or a sheet throughout. */
export function offeredProposals(proposals: readonly JobProposal[]): JobProposal[] {
  return proposals.filter((p) => (p.collection === "routines" || p.collection === "schedules") && citesSource(p));
}

/** A source a proposal cites, as the review shows it. */
export interface CitedSource {
  /** Its key in `sourceNames`: a lore entry's id, or `<entity>.<field>` for a sheet's field. */
  key: string;
  type: "lore" | "sheet";
  name: string;
  quote?: string;
  /** A lore entry's id, to read it in place. */
  entry?: string;
}

/**
 * What a proposal cites: each source its value carries (the routine's and each block's, the
 * schedule's and each slot's), with its quote, named as the job named it, else by the draft; then any
 * other source the job says it read, by name.
 */
export function citedSources(p: JobProposal, doc: WorldDoc): CitedSource[] {
  const value = isRecord(p.value) ? p.value : {};
  const items = p.collection === "routines" ? value.blocks : value.slots;
  const raw = [value.source, ...(Array.isArray(items) ? items.map((item) => (isRecord(item) ? item.source : undefined)) : [])];
  const named = (key: string, fallback: string): string => (p.sourceNames && hasOwn(p.sourceNames, key) ? p.sourceNames[key] || fallback : fallback);
  const out: CitedSource[] = [];
  for (const s of raw) {
    if (!isRecord(s) || !grounded(s)) continue;
    const quote = typeof s.quote === "string" && s.quote.trim() !== "" ? s.quote.trim() : undefined;
    const cited: CitedSource =
      s.type === "lore"
        ? { key: String(s.entry), type: "lore", entry: String(s.entry), name: named(String(s.entry), hasOwn(doc.lore, String(s.entry)) ? doc.lore[String(s.entry)]?.title || String(s.entry) : String(s.entry)) }
        : { key: `${String(s.entity)}.${String(s.field)}`, type: "sheet", name: named(`${String(s.entity)}.${String(s.field)}`, `${nameOf(doc, String(s.entity))} · ${humanize(String(s.field))}`) };
    if (!out.some((c) => c.key === cited.key && c.quote === quote)) out.push(quote ? { ...cited, quote } : cited);
  }
  for (const [key, name] of Object.entries(p.sourceNames ?? {})) {
    if (out.some((c) => c.key === key)) continue;
    out.push(hasOwn(doc.lore, key) ? { key, type: "lore", entry: key, name } : { key, type: "sheet", name });
  }
  return out;
}

/** An item of the proposal's id the draft already holds, in words: applying the proposal would replace it. */
export function draftClash(p: JobProposal, doc: WorldDoc): string | null {
  const held = p.collection === "routines" ? (doc.routines ?? {}) : p.collection === "schedules" ? doc.schedules : {};
  return hasOwn(held, p.key) ? `It would replace the ${COLLECTION_INFO[p.collection].noun} “${itemLabel(p.collection, p.key, held[p.key])}” already in the draft` : null;
}

/** What the review finds wrong with a proposal: what the job's check found, and an item of its id already in the draft. */
export function reviewProblems(p: JobProposal, doc: WorldDoc): string[] {
  const clash = draftClash(p, doc);
  return [...(p.problems ?? []), ...(clash ? [clash] : [])];
}

/** The proposals the review starts ticked: those Import's review would tick, with no problem found against the draft. */
export function reviewTicked(proposals: readonly JobProposal[], doc: WorldDoc): Set<string> {
  const ticked = startTicked(proposals);
  return new Set(proposals.filter((p) => ticked.has(p.id) && reviewProblems(p, doc).length === 0).map((p) => p.id));
}

export interface OwnerGroup {
  /** The person or group, or "" for proposals for no one in particular. */
  owner: string;
  name: string;
  group: boolean;
  proposals: JobProposal[];
}

/** The review's proposals by the person or group they're for, in the order the job read them. */
export function reviewGroups(proposals: readonly JobProposal[], doc: WorldDoc): OwnerGroup[] {
  const groups = new Map<string, JobProposal[]>();
  for (const p of proposals) {
    const owner = p.owner ?? "";
    groups.set(owner, [...(groups.get(owner) ?? []), p]);
  }
  return [...groups].map(([owner, list]) => ({ owner, name: owner === "" ? "Others" : nameOf(doc, owner), group: owner !== "" && kindIs(doc, doc.entities[owner]?.kind ?? "", "group"), proposals: list }));
}

/** The proposals as the review will apply them: each edited one with its edited value. */
export function editedProposals(proposals: readonly JobProposal[], edits: Readonly<Record<string, JsonValue>>): JobProposal[] {
  return proposals.map((p) => (hasOwn(edits, p.id) ? { ...p, value: edits[p.id] ?? p.value } : p));
}

/** A routine as Build's form edits it, when the value reads as one. */
function asRoutine(value: JsonValue): RoutineDef | null {
  return routineShapeProblems(value).length === 0 ? (value as unknown as RoutineDef) : null;
}

/** A schedule as Build's form edits it, when the value reads as one. */
function asSchedule(value: JsonValue): ScheduleDef | null {
  return isRecord(value) && typeof value.id === "string" && typeof value.target === "string" && isRecord(value.recurrence) && typeof value.recurrence.every === "string" && Array.isArray(value.slots) && value.slots.every((s) => isRecord(s) && typeof s.start === "string" && typeof s.end === "string") ? (value as unknown as ScheduleDef) : null;
}

/** What is wrong with an edited value's shape, in the form's words. */
export function editProblems(p: JobProposal): string[] {
  if (p.collection === "routines") return routineShapeProblems(p.value);
  const schedule = asSchedule(p.value);
  return schedule ? slotProblems(schedule.slots) : ["it isn't a schedule"];
}

function lengthWords(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return [h > 0 ? `${h} h` : "", m > 0 ? `${m} min` : ""].filter((part) => part !== "").join(" ") || "no time";
}

/** A block in one line: "Fixed at 07:00 · 8 h · Mon, Tue · at Okafor's Garage · with Rosie". */
export function blockWords(doc: WorldDoc, entry: RoutineEntry): string {
  if (isOff(entry)) return `Turns ${humanize(entry.id).toLowerCase()} off`;
  const parts = [entry.kind === "fixed" ? `${BLOCK_KIND_LABEL.fixed} at ${entry.at ?? "?"}` : `${BLOCK_KIND_LABEL[entry.kind]}, ${entry.window?.from ?? "?"}–${entry.window?.to ?? "?"}`, lengthWords(entry.minutes)];
  if (entry.perWeek !== undefined) parts.push(`${entry.perWeek} time${entry.perWeek === 1 ? "" : "s"} a week`);
  if (entry.kind === "optional") parts.push(`${Math.round((entry.chance ?? 0.5) * 100)}% likely`);
  const weekdays = entry.days?.weekdays ?? [];
  if (weekdays.length > 0) parts.push(weekdays.map((d) => WEEKDAYS[d] ?? String(d)).join(", "));
  if (entry.days?.off === "only") parts.push("on days off");
  if (entry.days?.off === "never") parts.push("on working days");
  const place = entry.place;
  parts.push(place === undefined || place === "home" ? "at home" : place === "work" ? "at work" : place === "here" ? "wherever they are" : place === "with" ? "at their company's" : "place" in place ? `at ${hasOwn(doc.places, place.place) ? doc.places[place.place]?.name || place.place : place.place}` : `at the nearest ${humanize(place.nearest).toLowerCase()}`);
  const who = entry.company?.who;
  const company = [...(who?.ids ?? []), ...(who?.memberOf ?? [])].map((id) => nameOf(doc, id));
  if (company.length > 0) parts.push(`with ${company.join(", ")}${entry.company?.invite ? ", invited" : ""}`);
  return parts.join(" · ");
}

/** A schedule in one line: "Sets where they are · Weekly (Mon, Tue) · 09:00–17:00 Okafor's Garage". */
export function scheduleWords(doc: WorldDoc, s: ScheduleDef): string {
  const weekdays = s.recurrence.every === "week" ? (s.recurrence.weekdays ?? []) : [];
  const days = weekdays.length > 0 ? ` (${weekdays.map((d) => WEEKDAYS[d] ?? String(d)).join(", ")})` : "";
  const slots = s.slots.map((slot) => `${slot.start}–${slot.end} ${valueWords(doc, slot.value)}`).join(", ");
  return [`Sets ${targetWords(doc, s.owner, s.target)}`, `${EVERY[s.recurrence.every]}${days}`, slots].filter((part) => part !== "").join(" · ");
}

/** A proposal's value in a line or two. */
function valueSummary(p: JobProposal, doc: WorldDoc): string[] {
  if (p.collection === "routines") {
    const routine = asRoutine(p.value);
    return routine ? routine.blocks.map((b) => blockWords(doc, b)) : [];
  }
  const schedule = asSchedule(p.value);
  return schedule ? [scheduleWords(doc, schedule)] : [];
}

// ---------------------------------------------------------------- the review

interface ReviewState {
  accepted: readonly string[];
  /** Edited values, by proposal id. */
  edits: Readonly<Record<string, JsonValue>>;
  applied: boolean;
}

/** Each review's ticks and edits by job, for the session. */
const reviews = createStore<Record<string, ReviewState>>({});

/** A cited source: the entry or field by name (a lore entry reads in place), and its quote. */
function SourceLines(props: { sources: readonly CitedSource[]; doc: WorldDoc }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <>
      {props.sources.map((s) => {
        const id = `${s.key}\n${s.quote ?? ""}`;
        const entry = s.entry !== undefined && hasOwn(props.doc.lore, s.entry) ? props.doc.lore[s.entry] : undefined;
        return (
          <div key={id} class="lre-build-source" data-lre-proposal-source={s.key}>
            <span class="lre-build-proposal-line">
              <Icon name={s.type === "lore" ? "book" : "user"} size={16} />
              <span>
                {s.type === "lore" ? "From lore: " : "From a sheet: "}
                {entry ? (
                  <button type="button" class="lre-build-source-name" aria-expanded={open === id} onClick={() => setOpen(open === id ? null : id)}>
                    {s.name}
                  </button>
                ) : (
                  s.name
                )}
              </span>
            </span>
            {s.quote ? <q class="lre-build-quote">{s.quote}</q> : null}
            {open === id && entry ? <p class="lre-build-entry">{entry.content}</p> : null}
          </div>
        );
      })}
    </>
  );
}

/** A proposal in Build's own form, on its own page: Done keeps the edit and ticks it, Back leaves it as it was. */
function ProposalEditor(props: { p: JobProposal; doc: WorldDoc; owner: string; onDone(value: JsonValue): void; onClose(): void }) {
  const [routine, setRoutine] = useState(() => (props.p.collection === "routines" ? asRoutine(props.p.value) : null));
  const [schedule, setSchedule] = useState(() => (props.p.collection === "schedules" ? asSchedule(props.p.value) : null));
  const edited = routine ?? schedule;
  const noun = COLLECTION_INFO[props.p.collection].noun;
  return (
    <FormSheet
      title={`Edit the ${noun}`}
      subtitle={`${itemLabel(props.p.collection, props.p.key, props.p.value)} · ${props.owner}`}
      backLabel="Proposals"
      onClose={props.onClose}
      actions={
        <Button size="sm" variant="primary" icon="check" disabled={!edited} onClick={() => edited && props.onDone(edited as unknown as JsonValue)}>
          Done
        </Button>
      }
    >
      {routine ? <RoutineForm value={routine} doc={props.doc} path={`routines.${props.p.key}`} onChange={setRoutine} /> : null}
      {schedule ? <ScheduleForm value={schedule} doc={props.doc} path={`schedules.${props.p.key}`} onChange={setSchedule} /> : null}
      {!edited ? <Empty icon="alert">This proposal doesn't read as a {noun}, so it can't be edited here.</Empty> : null}
    </FormSheet>
  );
}

/** The review of a Propose routines pass: by person and group, ticked when nothing was found against it, each editable, applied into the draft. */
export function RoutineProposalReview(props: { app: App; worldId: string; jobId: string; proposals: readonly JobProposal[] }) {
  const draft = useSelect(props.app.drafts, (d) => (d?.worldId === props.worldId ? d : null));
  // The draft as Build's forms read it: the packs' kinds merged in, the world's own winning.
  const doc = useMemo(() => (draft ? { ...draft.doc, kinds: { ...draft.packKinds, ...draft.doc.kinds } } : null), [draft]);
  const offered = useMemo(() => offeredProposals(props.proposals), [props.proposals]);
  // Untouched, a review ticks what nothing was found against, as the draft stands; its first change keeps it.
  const kept = useSelect(reviews, (all) => all[props.jobId]);
  const state: ReviewState = kept ?? { accepted: doc ? [...reviewTicked(offered, doc)] : [], edits: {}, applied: false };
  const save = (next: ReviewState) => reviews.update((all) => ({ ...all, [props.jobId]: next }));
  const [editing, setEditing] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, run] = useBusy();
  const send = useMemo(() => draftSend(props.app), [props.app]);
  if (!doc) return <Empty icon="hourglass">Loading the draft…</Empty>;
  const accepted = new Set(state.accepted);
  const chosen = editedProposals(offered, state.edits);
  const withheld = props.proposals.length - offered.length;
  const toggle = (id: string) => save({ ...state, accepted: accepted.has(id) ? state.accepted.filter((x) => x !== id) : [...state.accepted, id] });
  const groups = reviewGroups(chosen, doc);
  const edit = editing !== null ? chosen.find((p) => p.id === editing) : undefined;
  return (
    <>
      <Section
        title="Proposals"
        aside={
          <span class="lre-build-count">
            {accepted.size} of {offered.length} ticked
          </span>
        }
      >
        <div class="lre-stack">
          <p class="lre-build-note">Each rests on the lore entry or sheet field it quotes. Only one with nothing found against it starts ticked; edit any before you apply it.</p>
          {withheld > 0 ? (
            <p class="lre-build-note" data-lre-proposals-withheld={withheld}>
              {withheld} proposal{withheld === 1 ? "" : "s"} cited no lore entry or sheet field, so {withheld === 1 ? "it isn't" : "they aren't"} offered.
            </p>
          ) : null}
          <div class="lre-build-actions">
            <Button size="sm" icon="check" disabled={state.applied} onClick={() => save({ ...state, accepted: offered.map((p) => p.id) })}>
              Select all
            </Button>
            <Button size="sm" variant="ghost" disabled={state.applied} onClick={() => save({ ...state, accepted: [] })}>
              None
            </Button>
          </div>
        </div>
        {groups.map((group) => (
          <div key={group.owner} class="lre-build-group" data-lre-proposal-owner={group.owner}>
            <div class="lre-build-group-head">
              <span>
                {group.name}
                {group.group ? " · group" : ""}
              </span>
              <span class="lre-build-count">
                {group.proposals.filter((p) => accepted.has(p.id)).length} of {group.proposals.length}
              </span>
            </div>
            <div role="list">
              {group.proposals.map((p) => {
                const noun = COLLECTION_INFO[p.collection].noun;
                const title = itemLabel(p.collection, p.key, p.value);
                const sure = Math.round(p.confidence * 100);
                const edited = hasOwn(state.edits, p.id);
                // Once applied, the draft holds them: "already in the draft" would only be about themselves.
                const clash = state.applied ? null : draftClash(p, doc);
                const shape = edited ? editProblems(p) : [];
                return (
                  <div key={p.id} class="lre-build-proposal" role="listitem" data-lre-proposal={p.id}>
                    <label class="lre-check">
                      <input type="checkbox" aria-label={`Accept ${noun} “${title}”`} checked={accepted.has(p.id)} disabled={state.applied} onChange={() => toggle(p.id)} />
                    </label>
                    <div class="lre-build-proposal-body">
                      <div class="lre-build-proposal-head">
                        <span class="lre-build-proposal-title">{title}</span>
                        <span class="lre-build-badges">
                          {edited ? <Badge tone="accent">Edited</Badge> : null}
                          <Badge tone={p.confidence >= 0.8 ? "pos" : p.confidence >= 0.5 ? "warn" : "neg"}>
                            {sure}%<span class="lre-sr"> sure</span>
                          </Badge>
                        </span>
                      </div>
                      <span class="lre-build-proposal-line lre-muted">{humanize(noun)}</span>
                      {valueSummary(p, doc).map((line, i) => (
                        <span key={i} class="lre-build-proposal-line">
                          {line}
                        </span>
                      ))}
                      <IdText id={`${p.collection}.${p.key}`} />
                      <SourceLines sources={citedSources(p, doc)} doc={doc} />
                      {/* What was found against the proposal as the job made it: once edited, it may no longer hold. */}
                      {(p.problems ?? []).map((problem, i) => (
                        <span key={i} class={edited ? "lre-build-proposal-line lre-muted" : "lre-build-proposal-line lre-warn"} data-lre-proposal-problem>
                          <Icon name="alert" size={16} />
                          {edited ? `Before your edit: ${problem}` : problem}
                        </span>
                      ))}
                      {clash ? (
                        <span class="lre-build-proposal-line lre-warn" data-lre-proposal-problem>
                          <Icon name="alert" size={16} />
                          {clash}
                        </span>
                      ) : null}
                      {shape.map((problem, i) => (
                        <span key={i} class="lre-build-proposal-line lre-neg" data-lre-proposal-edit-problem>
                          <Icon name="alert" size={16} />
                          After your edit: {problem}
                        </span>
                      ))}
                      {p.note ? <span class="lre-build-proposal-line lre-muted">{p.note}</span> : null}
                      <div class="lre-build-actions">
                        <Button size="sm" variant="ghost" icon="edit" disabled={state.applied} onClick={() => setEditing(p.id)}>
                          Edit
                        </Button>
                        {edited && !state.applied ? (
                          <Button size="sm" variant="ghost" icon="undo" onClick={() => save({ ...state, edits: Object.fromEntries(Object.entries(state.edits).filter(([id]) => id !== p.id)) })}>
                            As proposed
                          </Button>
                        ) : null}
                        <button type="button" class="lre-btn small ghost" aria-expanded={open === p.id} onClick={() => setOpen(open === p.id ? null : p.id)}>
                          <Icon name={open === p.id ? "chevron-up" : "chevron-down"} size={16} />
                          {open === p.id ? "Hide value" : "Show value"}
                        </button>
                      </div>
                      {open === p.id ? (
                        <div class="lre-build-json">
                          <JsonView value={p.value} />
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </Section>
      <SaveBar>
        <Button
          variant="primary"
          block
          icon={state.applied ? "check" : undefined}
          disabled={accepted.size === 0 || state.applied}
          busy={busy}
          onClick={() =>
            run(async () => {
              let ok = 0;
              for (const write of proposalWrites(props.worldId, chosen, accepted)) {
                const message = await send(write);
                if (message.type === "lre.result") ok += 1;
              }
              props.app.toast(`Applied ${ok} of ${accepted.size} to the draft. Commit when ready.`, ok === accepted.size ? "info" : "error");
              save({ ...state, applied: true });
            })
          }
        >
          {state.applied ? "Applied to the draft" : `Apply ${accepted.size} to the draft`}
        </Button>
      </SaveBar>
      {/* The form opens as its own page over the review, which keeps its place underneath. */}
      {edit ? (
        <ProposalEditor
          key={edit.id}
          p={edit}
          doc={doc}
          owner={edit.owner ? nameOf(doc, edit.owner) : "Others"}
          onClose={() => setEditing(null)}
          onDone={(value) => {
            save({ ...state, edits: { ...state.edits, [edit.id]: value }, accepted: accepted.has(edit.id) ? state.accepted : [...state.accepted, edit.id] });
            setEditing(null);
          }}
        />
      ) : null}
    </>
  );
}
