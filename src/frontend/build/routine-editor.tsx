// Build → Routines (DESIGN §8, §13): how people's days usually go, owner by owner, as world data
// (`world.routines`). The list groups the routines by whom they're for, most specific first, with
// the world's routine settings (Routines and the story) a tap away. A routine's page picks its owner
// by level (`owner-picker.tsx`): someone, a group (a family, a household), a kind, a selector, or
// everyone (the world's default); for anyone but everyone, "No routine" is a choice of its own. Its
// blocks list by time and open as sheets: what it reads as and what they do; its kind (fixed at a
// time; flexible within a window, or a few times a week; optional) with its time or window on the
// schedule's day bar; how long; how much it matters; its days; its place, by role or a chosen place;
// its company and whether it asks them along; and where it comes from: written here, a lore entry
// with its quote (its title opens it), or a sheet field. The basic needs (sleep and meals) are
// everyone's unless a block changes or turns one off. A routine only ever suggests: the story leads
// for anyone on screen. Problems opens a block's issue on its sheet (`BuildRoute.at`).
// `RoutineForm` is shared with the review of proposed routines, `RoutineBlockForm` with the GM view.
// Styles: styles/forms.ts and styles/visual-editors.ts.

import { useId, useMemo, useState } from "preact/hooks";
import type { JsonObject, JsonValue } from "../../shared/json";
import { hasOwn } from "../../shared/json";
import type { LintIssue } from "../../shared/protocol";
import type { RoutineBlock, RoutineBlockKind, RoutineDays, RoutineDef, RoutineEntry, RoutinePlace, RoutineSeason, RoutineSource, WorldRoutineSource } from "../../shared/routines";
import { AWARENESS_LABEL, BASIC_BLOCKS, INVITATIONS_LABEL, isOff, ROUTINE_BLOCK_KINDS, routineSettingsOf } from "../../shared/routines";
import type { ScheduleSlot, WorldDoc } from "../../shared/world";
import { useApp, useUi } from "../app";
import { Button, Disclosure, Empty, Field, HostSelect, IconButton, List, ListRow, NumberStepper, PageHeader, SaveBar, Section, Seg, useBusy, type SegOption } from "../components";
import { humanize } from "../format";
import { Icon } from "../icons";
import type { EditorProps } from "../registry";
import type { Req } from "../requests";
import { useSelect } from "../store";
import { COLLECTION_INFO, deleteItem, go, ItemHeader, NewItem, newItemName, PART_INFO } from "./chrome";
import { AddPicker, CheckField, Chip, FormGroup, FormSheet, Issues, ItemRow, RefPicker, type RefOption } from "./form-kit";
import { useHeld } from "./held";
import { ownerLevel, OwnerPicker, ownerWords, type OwnerLevel } from "./owner-picker";
import { DayBar, minutesOf, timeOf, wordsInUse } from "./schedule-form";
import { deriveId, newItem } from "./schema";
import { durationText, FieldInput, kindFields, LintBadge, lintAt, refOptions, TextInput } from "./schema-form";
import { SelectorEditor, selectorOf } from "./selector-editor";

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const SEASONS: readonly RoutineSeason[] = ["spring", "summer", "autumn", "winter"];
const NEEDS: Record<string, string> = { hunger: "Hunger", fatigue: "Rest", social: "Company", fun: "Fun" };
/** The activities every world knows, before its own. */
const ACTIVITIES = ["sleep", "breakfast", "lunch", "dinner", "work", "socialize", "leisure"];

/** A block's kind as the editor offers it, and what each means. */
const KIND_WORDS: Record<RoutineBlockKind, { label: string; help: string }> = {
  fixed: { label: "At a set time", help: "At the same time on each day it's on." },
  flexible: { label: "Within a window", help: "Somewhere in its window, wherever the day has room; or only a few times a week." },
  optional: { label: "Optional", help: "Only likely on a day it's on, and the first thing a busier day leaves out." },
};

/** How much a block matters when blocks compete for the same free time (1 to 5, 3 when absent). */
const MATTERS: readonly SegOption<number>[] = [
  { value: 1, label: "Least" },
  { value: 2, label: "Less" },
  { value: 3, label: "Usual" },
  { value: 4, label: "More" },
  { value: 5, label: "Most" },
];

/** How likely an optional block is on a day it's on (0.5 when absent). */
const CHANCES: readonly SegOption<number>[] = [
  { value: 0.25, label: "Rarely" },
  { value: 0.5, label: "Sometimes" },
  { value: 0.75, label: "Often" },
  { value: 0.9, label: "Usually" },
];

type PlaceRole = "home" | "work" | "here" | "with" | "place" | "nearest";
const PLACE_ROLE: Record<PlaceRole, string> = { home: "At home", work: "At work", here: "Wherever they are", with: "At the home of whoever they're with", place: "A chosen place", nearest: "The nearest place of a type" };

/** Whose routine, by level, in the order the list shows them: the most specific first, as the engine ranks them. */
const LEVELS: readonly OwnerLevel[] = ["entity", "group", "kind", "selector", "none"];
const LEVEL_TITLE: Record<OwnerLevel, string> = { entity: "Someone's own", group: "A group's", kind: "A kind's", selector: "By selector", none: "Everyone's" };

// ---------------------------------------------------------------- the routine as data

/** The draft write that saves a routine as its page holds it, under its id. */
export function routineWrite(worldId: string, id: string, routine: RoutineDef): Req<"lre.editor"> {
  // As JSON keeps it: a part the form cleared (an owner, a source) is gone, not undefined.
  return { type: "lre.editor", worldId, base: null, op: "put", collection: "routines", id, value: JSON.parse(JSON.stringify({ ...routine, id })) as JsonValue };
}

/** A new block: an hour, somewhere in the evening, at home. */
export function blankBlock(id: string, label: string): RoutineBlock {
  return { id, label, activity: "leisure", kind: "flexible", window: { from: "18:00", to: "21:00" }, minutes: 60 };
}

/**
 * The block as another kind, keeping what still fits: a fixed block starts where its window opened,
 * a window opens where the fixed block started (for an hour); times a week stay with flexible and
 * optional blocks, and a chance with optional ones.
 */
export function blockKindChange(block: RoutineBlock, kind: RoutineBlockKind): RoutineBlock {
  const { at, window, perWeek, chance, ...rest } = block;
  const from = window && TIME.test(window.from) ? window.from : at && TIME.test(at) ? at : "09:00";
  if (kind === "fixed") return { ...rest, kind, at: at && TIME.test(at) ? at : from };
  const next: RoutineBlock = { ...rest, kind, window: window ?? { from, to: timeOf(minutesOf(from) + 60) }, ...(perWeek !== undefined ? { perWeek } : {}) };
  return kind === "optional" && chance !== undefined ? { ...next, chance } : next;
}

/** The block's time as the day bar draws it: a fixed block from its start for its length; else its window, when it may start. */
export function blockSlot(block: RoutineBlock): ScheduleSlot {
  if (block.kind !== "fixed") return { start: block.window?.from ?? "", end: block.window?.to ?? "", value: block.label };
  const at = block.at ?? "";
  return { start: at, end: TIME.test(at) ? timeOf(minutesOf(at) + block.minutes) : "", value: block.label };
}

/** The block with its time as the day bar moved it: a fixed block's start and length, or the window. */
export function blockFromSlot(block: RoutineBlock, slot: ScheduleSlot): RoutineBlock {
  if (block.kind !== "fixed") return { ...block, window: { from: slot.start, to: slot.end } };
  const span = (minutesOf(slot.end) - minutesOf(slot.start) + 1440) % 1440;
  return { ...block, at: slot.start, minutes: span === 0 ? 1440 : span };
}

/** "No routine": the routine keeps no broader blocks and sets none, so whom it covers live by the story, their commitments and their basic needs. */
export function isNoRoutine(routine: Pick<RoutineDef, "inherit" | "blocks">): boolean {
  return routine.inherit === false && routine.blocks.length === 0;
}

/** The index of the block a lint path points at in the routine at `prefix`: `routines.r.blocks.2.window` → 2; null for the routine's own. */
export function blockAt(path: string | undefined, prefix: string): number | null {
  if (!path?.startsWith(`${prefix}.blocks.`)) return null;
  const n = path.slice(prefix.length + ".blocks.".length).split(".")[0] ?? "";
  return /^\d+$/.test(n) ? Number(n) : null;
}

/** A block's time in words: "05:30 for 9 h 30 min", "3 times a week, 2 h, starting 17:00–21:00". */
function timeWords(block: RoutineBlock): string {
  const length = durationText(block.minutes);
  if (block.kind === "fixed") return `${block.at ?? "no time"} for ${length}`;
  const often = block.perWeek !== undefined ? `${block.perWeek} time${block.perWeek === 1 ? "" : "s"} a week, ` : "";
  const chance = block.kind === "optional" ? `${(CHANCES.find((c) => c.value === (block.chance ?? 0.5))?.label ?? `${Math.round((block.chance ?? 0.5) * 100)}%`).toLowerCase()}, ` : "";
  return `${chance}${often}${length}, starting ${block.window ? `${block.window.from}–${block.window.to}` : "anywhen"}`;
}

/** Where a block happens, in words. */
function placeWords(doc: WorldDoc, place: RoutinePlace | undefined): string {
  if (place === undefined || place === "home") return "at home";
  if (place === "work") return "at work";
  if (place === "here") return "wherever they are";
  if (place === "with") return "at their company's home";
  if ("place" in place) return `at ${hasOwn(doc.places, place.place) ? doc.places[place.place]?.name || place.place : place.place}`;
  return `at the nearest ${humanize(place.nearest).toLowerCase()}`;
}

/** Where a block comes from, in words: "From lore: Rosie's Diner", "From Dev Patel's sheet: Job"; null when it's written here. */
function sourceWords(doc: WorldDoc, source: RoutineSource | undefined): string | null {
  if (!source || source.type === "authored") return null;
  if (source.type === "builtin") return "A basic need";
  if (source.type === "story") return "From the story";
  if (source.type === "gm") return "Set by the GM";
  if (source.type === "lore") return `From lore: ${hasOwn(doc.lore, source.entry) ? doc.lore[source.entry]?.title || source.entry : source.entry}`;
  const who = hasOwn(doc.entities, source.entity) ? doc.entities[source.entity]?.name || source.entity : source.entity;
  return `From ${who}'s sheet${source.field ? `: ${humanize(source.field)}` : ""}`;
}

/** Where a block starts on the clock, for the list's order: a fixed block's time, else its window's opening. */
function startOf(entry: RoutineEntry): number {
  if (isOff(entry)) return Infinity;
  const t = entry.kind === "fixed" ? entry.at : entry.window?.from;
  return t && TIME.test(t) ? minutesOf(t) : Infinity;
}

/** A routine's blocks in a few words for the list. */
function routineSummary(routine: RoutineDef): string {
  if (isNoRoutine(routine)) return "No routine";
  const on = routine.blocks.filter((b) => !isOff(b)).length;
  const off = routine.blocks.length - on;
  const parts = [`${on} block${on === 1 ? "" : "s"}`, off > 0 ? `${off} turned off` : "", routine.inherit === false ? "only its own" : ""];
  return parts.filter((p) => p !== "").join(", ");
}

/** A routine's name: its label, else whom it's for ("Mara Kim", "Every NPC"). */
function routineName(doc: WorldDoc, routine: Pick<RoutineDef, "label" | "owner">): string {
  return routine.label || ownerWords(doc, routine.owner, "Everyone");
}

/** A block's name, wherever it is defined: this routine, another, or the basic needs. */
function blockName(doc: WorldDoc, id: string): string {
  const basic = BASIC_BLOCKS.find((b) => b.id === id);
  if (basic) return basic.label;
  for (const r of Object.values(doc.routines ?? {})) for (const b of r.blocks) if (b.id === id && !isOff(b)) return b.label;
  return humanize(id);
}

// ---------------------------------------------------------------- one block's fields

/** The days a block is on: weekdays, days off, holidays, birthdays, seasons and weather; none picked, every day. */
function DaysFields(props: { value: RoutineDays | undefined; doc: WorldDoc; issues: readonly LintIssue[]; onChange(next: RoutineDays | undefined): void }) {
  const days = props.value ?? {};
  const set = (patch: Partial<RoutineDays>) => {
    const next: RoutineDays = { ...days, ...patch };
    // A constraint emptied is no constraint: an empty list would rule every day out.
    for (const key of Object.keys(next) as (keyof RoutineDays)[]) {
      const v = next[key];
      if (v === undefined || (Array.isArray(v) && v.length === 0)) delete next[key];
    }
    props.onChange(Object.keys(next).length > 0 ? next : undefined);
  };
  const toggle = <T,>(list: readonly T[] | undefined, item: T): T[] => ((list ?? []).includes(item) ? (list ?? []).filter((x) => x !== item) : [...(list ?? []), item]);
  const holidays = props.doc.calendar.holidays;
  return (
    <div class="lre-stack" data-lre-block-days>
      <Field label="On these weekdays" help="None picked: every day.">
        <div class="lre-ve-days" role="group" aria-label="Weekdays">
          {WEEKDAYS.map((day, i) => (
            <button key={day} type="button" aria-pressed={days.weekdays?.includes(i) ?? false} onClick={() => set({ weekdays: toggle(days.weekdays, i).sort() })}>
              {day}
            </button>
          ))}
        </div>
      </Field>
      <Field label="Days off">
        <Seg<"any" | "only" | "never">
          label="Days off"
          value={days.off ?? "any"}
          options={[
            { value: "any", label: "Either way" },
            { value: "only", label: "Only days off" },
            { value: "never", label: "Never on days off" },
          ]}
          onChange={(off) => set({ off: off === "any" ? undefined : off })}
        />
      </Field>
      {holidays.length > 0 ? (
        <>
          <Field label="Only on these holidays">
            <div class="lre-form-chips" role="group" aria-label="Only on these holidays">
              {holidays.map((h) => (
                <Chip key={h.id} pressed={days.holidays?.includes(h.id) ?? false} onToggle={() => set({ holidays: toggle(days.holidays, h.id) })}>
                  {h.label}
                </Chip>
              ))}
            </div>
          </Field>
          <Field label="Never on these">
            <div class="lre-form-chips" role="group" aria-label="Never on these holidays">
              {holidays.map((h) => (
                <Chip key={h.id} pressed={days.except?.includes(h.id) ?? false} onToggle={() => set({ except: toggle(days.except, h.id) })}>
                  {h.label}
                </Chip>
              ))}
            </div>
          </Field>
        </>
      ) : null}
      <Field label="Birthdays">
        <Seg<"any" | "own" | "friend">
          label="Birthdays"
          value={days.birthday ?? "any"}
          options={[
            { value: "any", label: "Any day" },
            { value: "own", label: "Their birthday" },
            { value: "friend", label: "A friend's birthday" },
          ]}
          onChange={(birthday) => set({ birthday: birthday === "any" ? undefined : birthday })}
        />
      </Field>
      <Field label="Seasons" help="None picked: all year. Needs the weather's seasons.">
        <div class="lre-form-chips" role="group" aria-label="Seasons">
          {SEASONS.map((s) => (
            <Chip key={s} pressed={days.seasons?.includes(s) ?? false} onToggle={() => set({ seasons: toggle(days.seasons, s) })}>
              {humanize(s)}
            </Chip>
          ))}
        </div>
      </Field>
      <Field label="Weather">
        <Seg<"any" | "fair" | "foul">
          label="Weather"
          value={days.weather ?? "any"}
          options={[
            { value: "any", label: "Any weather" },
            { value: "fair", label: "Fair" },
            { value: "foul", label: "Foul" },
          ]}
          onChange={(weather) => set({ weather: weather === "any" ? undefined : weather })}
        />
      </Field>
      <Issues issues={props.issues} />
    </div>
  );
}

/** Where a block happens: by role (home, work, wherever they are, their company's home), a chosen place, or the nearest place of a scene type. */
function PlaceFields(props: { value: RoutinePlace | undefined; doc: WorldDoc; issues: readonly LintIssue[]; onChange(next: RoutinePlace | undefined): void }) {
  const { doc } = props;
  const stored: PlaceRole = props.value === undefined ? "home" : typeof props.value === "string" ? props.value : "place" in props.value ? "place" : "nearest";
  // A chosen place or scene type is kept back until one is picked; till then the block stays where it was.
  const [pending, setPending] = useState<"place" | "nearest" | null>(null);
  const role = stored === "place" || stored === "nearest" ? stored : (pending ?? stored);
  const scenes = [...new Set(Object.values(doc.places).flatMap((p) => (p.sceneType ? [p.sceneType] : [])))].sort().map((s) => ({ value: s, label: humanize(s) }));
  const roles = (Object.keys(PLACE_ROLE) as PlaceRole[]).filter((r) => r !== "nearest" || scenes.length > 0 || stored === "nearest");
  return (
    <div class="lre-stack" data-lre-block-place={role}>
      <HostSelect
        label="Where"
        value={role}
        options={roles.map((r) => ({ value: r, label: PLACE_ROLE[r] }))}
        onChange={(next) => {
          const r = roles.find((x) => x === next);
          if (!r) return;
          if (r === "place" || r === "nearest") {
            setPending(r);
            return;
          }
          setPending(null);
          props.onChange(r === "home" ? undefined : r);
        }}
      />
      {role === "place" ? (
        <RefPicker label="Which place" value={typeof props.value === "object" && "place" in props.value ? props.value.place : ""} options={refOptions(doc, "places")} onChange={(place) => props.onChange(place ? { place } : undefined)} />
      ) : role === "nearest" ? (
        <RefPicker label="The nearest place of type" value={typeof props.value === "object" && "nearest" in props.value ? props.value.nearest : ""} options={scenes} onChange={(nearest) => props.onChange(nearest ? { nearest } : undefined)} />
      ) : role === "with" ? (
        <span class="lre-small lre-muted">The home of the first person it's with, as Who with picks them.</span>
      ) : null}
      <Issues issues={props.issues} />
    </div>
  );
}

/** What a block's activity may be: the world's own activities first (an enum field's values, or the words in use), then the ones every world knows. */
function activityOptions(doc: WorldDoc): string[] {
  const inRoutines = Object.values(doc.routines ?? {}).flatMap((r) => r.blocks.flatMap((b) => (isOff(b) ? [] : [b.activity])));
  return [...new Set([...ACTIVITIES, ...wordsInUse(doc, "activity"), ...inRoutines].filter((a) => a.trim() !== ""))];
}

/**
 * One block's fields, as world data and a chat's change both hold them: what it reads as and what
 * they do; its kind, with its time or window on the day bar, its length, how often and how likely;
 * how much it matters; its days, its place and its company (asked along or not); the needs it meets;
 * and whether the player reads it as Busy. No id and no source: the page around it keeps those.
 * `doc` is the world with the packs' kinds merged in; `path` is where its lint is.
 */
export function RoutineBlockForm(props: { value: RoutineBlock; doc: WorldDoc; path: string; lint?: readonly LintIssue[]; onChange(next: RoutineBlock): void }) {
  const { doc } = props;
  const block = props.value;
  const set = props.onChange;
  const lint = props.lint ?? [];
  const at = (key: string) => lintAt(lint, `${props.path}.${key}`);
  const ctx = { doc, lint, path: props.path, identifiers: [], functions: [] };
  const activityId = useId();
  const activityList = useId();
  const activities = useMemo(() => activityOptions(doc), [doc]);
  const slot = blockSlot(block);
  const time = (label: string, value: string | undefined, onChange: (next: string) => void) => (
    <Field label={label}>
      <input class="lre-input" type="time" step={900} value={value ?? ""} onChange={(event) => (TIME.test(event.currentTarget.value) ? onChange(event.currentTarget.value) : undefined)} />
    </Field>
  );
  return (
    <div class="lre-stack" data-lre-block-form={block.kind}>
      <TextInput label="What it reads as" hint="As their day shows it: “Opens the shop”, “Dinner with the family”." value={block.label} issues={at("label")} onChange={(label) => set({ ...block, label: typeof label === "string" ? label : "" })} />
      <Field label="What they're doing" help="An activity the world knows: sleep, a meal, work, socialize, leisure, or the world's own." for={activityId}>
        <input id={activityId} class="lre-input" list={activityList} autoComplete="off" value={block.activity} onInput={(event) => set({ ...block, activity: event.currentTarget.value })} />
        <datalist id={activityList}>
          {activities.map((a) => (
            <option key={a} value={a} />
          ))}
        </datalist>
      </Field>
      <Issues issues={at("activity")} />
      <Field label="When it happens" help={KIND_WORDS[block.kind].help}>
        <Seg<RoutineBlockKind> label="When it happens" value={block.kind} options={ROUTINE_BLOCK_KINDS.map((k) => ({ value: k, label: KIND_WORDS[k].label }))} onChange={(kind) => set(blockKindChange(block, kind))} />
      </Field>
      <DayBar
        slots={[slot]}
        current={0}
        label={() => block.label || "This block"}
        colour={() => "var(--lre-series-1)"}
        onOpen={() => undefined}
        onMove={(slots) => {
          const moved = slots[0];
          if (moved) set(blockFromSlot(block, moved));
        }}
      />
      <span class="lre-small lre-muted">{block.kind === "fixed" ? "The bar is when it runs. Drag either end to move when it starts or ends." : "The bar is when it may start. Drag either end to widen or narrow it."}</span>
      <div class="lre-ve-times">
        {block.kind === "fixed" ? time("Starts at", block.at, (at) => set({ ...block, at })) : null}
        {block.kind !== "fixed" ? time("May start from", block.window?.from, (from) => set({ ...block, window: { from, to: block.window?.to ?? from } })) : null}
        {block.kind !== "fixed" ? time("Until", block.window?.to, (to) => set({ ...block, window: { from: block.window?.from ?? to, to } })) : null}
        <FieldInput
          spec={{ kind: "duration", key: "minutes", label: "How long" }}
          value={block.minutes}
          ctx={ctx}
          path={props.path}
          parent={block as unknown as JsonObject}
          onChange={(minutes) => (typeof minutes === "number" ? set({ ...block, minutes: Math.min(1440, Math.max(1, Math.round(minutes))) }) : undefined)}
        />
      </div>
      <Issues issues={[...at("at"), ...at("window")]} />
      {block.kind !== "fixed" ? (
        <>
          <Field label="How often" help={block.perWeek !== undefined ? "On that many of the days it's on, each week; the planner picks which." : "On every day it's on."}>
            <Seg<"each" | "some">
              label="How often"
              value={block.perWeek !== undefined ? "some" : "each"}
              options={[
                { value: "each", label: "Every day it's on" },
                { value: "some", label: "A few times a week" },
              ]}
              onChange={(often) => {
                const { perWeek, ...rest } = block;
                set(often === "some" ? { ...rest, perWeek: perWeek ?? 3 } : rest);
              }}
            />
          </Field>
          {block.perWeek !== undefined ? <NumberStepper label="Times a week" value={block.perWeek} min={1} max={7} integer onChange={(perWeek) => set({ ...block, perWeek })} /> : null}
          <Issues issues={at("perWeek")} />
        </>
      ) : null}
      {block.kind === "optional" ? (
        <Field label="How likely" help="On a day it's on.">
          <Seg<number> label="How likely" value={CHANCES.some((c) => c.value === (block.chance ?? 0.5)) ? (block.chance ?? 0.5) : null} options={CHANCES} onChange={(chance) => set({ ...block, chance })} />
        </Field>
      ) : null}
      <Field label="How much it matters" help="When blocks want the same free time, the one that matters more goes first.">
        <Seg<number> label="How much it matters" value={block.priority ?? 3} options={MATTERS} onChange={(priority) => set({ ...block, priority })} />
      </Field>
      <Issues issues={at("priority")} />
      <PlaceFields value={block.place} doc={doc} issues={at("place")} onChange={(place) => {
        const { place: _, ...rest } = block;
        set(place === undefined ? rest : { ...rest, place });
      }} />
      <SelectorEditor
        label="Who with"
        value={block.company ? (selectorOf(block.company.who) ?? {}) : undefined}
        doc={doc}
        optional
        onChange={(who) => {
          const { company, ...rest } = block;
          set(who === undefined ? rest : { ...rest, company: { who, ...(company?.invite ? { invite: true } : {}) } });
        }}
      />
      {block.company ? (
        <CheckField
          label="Asks them along"
          help="An invitation, made as their day is planned, and only as Routines and the story allows it."
          checked={block.company.invite === true}
          onChange={(invite) => set({ ...block, company: { who: block.company?.who ?? {}, ...(invite ? { invite: true } : {}) } })}
        />
      ) : null}
      <Issues issues={at("company")} />
      <Disclosure summary="Which days" defaultOpen={block.days !== undefined}>
        <DaysFields value={block.days} doc={doc} issues={at("days")} onChange={(days) => {
          const { days: _, ...rest } = block;
          set(days === undefined ? rest : { ...rest, days });
        }} />
      </Disclosure>
      <Disclosure summary="Needs and privacy" defaultOpen={block.needs !== undefined || block.private === true}>
        <div class="lre-stack">
          <Field label="The needs it meets" help="None picked: the ones its activity meets.">
            <div class="lre-form-chips" role="group" aria-label="The needs it meets">
              {Object.entries(NEEDS).map(([need, label]) => {
                const on = block.needs?.includes(need) ?? false;
                return (
                  <Chip key={need} pressed={on} onToggle={() => {
                    const next = on ? (block.needs ?? []).filter((n) => n !== need) : [...(block.needs ?? []), need];
                    const { needs: _, ...rest } = block;
                    set(next.length === 0 ? rest : { ...rest, needs: next });
                  }}>
                    {label}
                  </Chip>
                );
              })}
            </div>
          </Field>
          <Issues issues={at("needs")} />
          <CheckField label="Private" help="The player reads it as Busy, never what it is." checked={block.private === true} onChange={(on) => {
            const { private: _, ...rest } = block;
            set(on ? { ...rest, private: true } : rest);
          }} />
        </div>
      </Disclosure>
    </div>
  );
}

// ---------------------------------------------------------------- where it comes from

/**
 * Where a block, or a whole routine, comes from: written here (no source), a lore entry with the
 * words it rests on (its title opens the entry), or a field of someone's sheet. `inherited` names the
 * routine's own source, which a block without one rests on.
 */
function SourceFields(props: { value: WorldRoutineSource | undefined; doc: WorldDoc; issues: readonly LintIssue[]; inherited?: string | null; onChange(next: WorldRoutineSource | undefined): void }) {
  const app = useApp();
  const { doc } = props;
  const value = props.value;
  // Lore waits for its entry before it's a source; written here until then.
  const [pending, setPending] = useState(false);
  const type = value?.type ?? (pending ? "lore" : "authored");
  const quote = value && value.type !== "authored" ? (value.quote ?? "") : "";
  const withQuote = (text: JsonValue | undefined) => (typeof text === "string" && text.trim() !== "" ? { quote: text } : {});
  const lore = Object.values(doc.lore)
    .map((l) => ({ value: l.id, label: l.title || l.id }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const entity = value?.type === "sheet" ? value.entity : "";
  const kind = hasOwn(doc.entities, entity) ? (doc.entities[entity]?.kind ?? "") : "";
  const fields = Object.entries(kind ? kindFields(doc, kind) : {}).map(([id, f]) => ({ value: id, label: f.label || humanize(id) }));
  return (
    <div class="lre-stack" data-lre-source={type}>
      <Seg<"authored" | "lore" | "sheet">
        label="Where it comes from"
        value={type}
        options={[
          { value: "authored", label: "Written here" },
          { value: "lore", label: "From lore" },
          { value: "sheet", label: "From a sheet" },
        ]}
        onChange={(next) => {
          setPending(next === "lore");
          if (next === "authored") props.onChange(undefined);
          else if (next === "sheet" && value?.type !== "sheet") props.onChange({ type: "sheet", entity: "", field: "" });
          else if (next === "lore" && value?.type !== "lore") props.onChange(undefined);
        }}
      />
      {type === "authored" ? <span class="lre-small lre-muted">{props.inherited ? `It rests on the routine's source: ${props.inherited}.` : "Written by the world's author."}</span> : null}
      {type === "lore" ? (
        <>
          <RefPicker label="Lore entry" value={value?.type === "lore" ? value.entry : ""} options={lore} onChange={(entry) => props.onChange(entry ? { type: "lore", entry, ...withQuote(quote) } : undefined)} />
          {value?.type === "lore" && hasOwn(doc.lore, value.entry) ? (
            <div data-lre-open-lore={value.entry}>
              <List>
                <ListRow icon="book" title={doc.lore[value.entry]?.title || value.entry} subtitle={value.quote ? `“${value.quote}”` : "No words quoted yet"} chevron onClick={() => go(app, { view: "item", worldId: doc.id, collection: "lore", id: value.entry })} />
              </List>
            </div>
          ) : null}
        </>
      ) : null}
      {type === "sheet" ? (
        <>
          <RefPicker label="Whose sheet" value={entity} options={refOptions(doc, "entities")} onChange={(next) => props.onChange({ type: "sheet", entity: next, field: "", ...withQuote(quote) })} />
          {entity !== "" ? <RefPicker label="Which field" value={value?.type === "sheet" ? value.field : ""} options={fields} onChange={(field) => props.onChange({ type: "sheet", entity, field, ...withQuote(quote) })} /> : null}
        </>
      ) : null}
      {value && value.type !== "authored" ? (
        <TextInput label="The words it rests on" optional multiline hint="A short quote, so anyone reading the block sees why." value={quote} issues={[]} onChange={(text) => props.onChange({ ...value, quote: undefined, ...withQuote(text) })} />
      ) : null}
      <Issues issues={props.issues} />
    </div>
  );
}

// ---------------------------------------------------------------- a block's sheet

/** A block of the routine as a sheet: its fields, its id under Advanced, where it comes from, and Remove. */
function BlockSheet(props: { block: RoutineBlock; index: number; routine: RoutineDef; doc: WorldDoc; path: string; lint: readonly LintIssue[]; fresh: boolean; onChange(next: RoutineBlock): void; onRemove(): void; onClose(): void }) {
  const { block, doc } = props;
  const path = `${props.path}.blocks.${props.index}`;
  const idField = useId();
  const idList = useId();
  const taken = props.routine.blocks.filter((_, i) => i !== props.index).map((b) => b.id);
  const known = [...new Set([...BASIC_BLOCKS.map((b) => b.id), ...Object.values(doc.routines ?? {}).flatMap((r) => r.blocks.map((b) => b.id))])].filter((id) => !taken.includes(id));
  const clash = taken.includes(block.id);
  // A block added here takes its id from its label, as + New's id follows a name; a saved or copied block keeps its id, which chats and other routines know it by.
  const change = (next: RoutineBlock) => props.onChange(props.fresh && next.label !== block.label ? { ...next, id: deriveId(next.label.trim() || "Block", new Set(taken)) } : next);
  return (
    <FormSheet title={block.label || "New block"} subtitle={`${KIND_WORDS[block.kind].label} · ${timeWords(block)}`} backLabel="Routine" onClose={props.onClose}>
      <Issues issues={props.lint.filter((issue) => issue.path === path || issue.path === `${path}.id`)} />
      <RoutineBlockForm value={block} doc={doc} path={path} lint={props.lint} onChange={change} />
      <FormGroup title="Where it comes from">
        <SourceFields value={block.source?.type === "lore" || block.source?.type === "sheet" || block.source?.type === "authored" ? block.source : undefined} doc={doc} issues={lintAt(props.lint, `${path}.source`)} inherited={sourceWords(doc, props.routine.source)} onChange={(source) => {
          const { source: _, ...rest } = block;
          props.onChange(source === undefined ? rest : { ...rest, source });
        }} />
      </FormGroup>
      <Disclosure summary="Its id (Advanced)" defaultOpen={clash}>
        <Field label="Id" for={idField} help="A block replaces a broader routine's block, or a basic need (sleep, breakfast, lunch, dinner), with the same id." error={clash ? "Another block of this routine has this id." : null}>
          <input id={idField} class="lre-input lre-build-mono" list={idList} autoComplete="off" spellcheck={false} value={block.id} onChange={(event) => props.onChange({ ...block, id: event.currentTarget.value.trim().replace(/[^\w.-]/g, "_") })} />
          <datalist id={idList}>
            {known.map((id) => (
              <option key={id} value={id}>
                {blockName(doc, id)}
              </option>
            ))}
          </datalist>
        </Field>
      </Disclosure>
      <div class="lre-inline">
        <Button variant="danger" icon="trash" onClick={props.onRemove}>
          Remove block
        </Button>
      </div>
    </FormSheet>
  );
}

// ---------------------------------------------------------------- a routine

/**
 * A routine's fields as one form: whom it's for and its name, "No routine" or its blocks (each
 * opening its sheet), the blocks it turns off, and where it comes from. The routine's page and a
 * proposal's review both edit through it. `doc` is the draft with the packs' kinds merged in; `path`
 * is where its lint is (`routines.<id>`), and `at` a lint path whose block opens first.
 */
export function RoutineForm(props: { value: RoutineDef; doc: WorldDoc; path: string; lint?: readonly LintIssue[]; at?: string; onChange(next: RoutineDef): void }) {
  const { doc } = props;
  const routine = props.value;
  const set = props.onChange;
  const lint = props.lint ?? [];
  const [open, setOpen] = useState<number | null>(() => {
    const n = blockAt(props.at, props.path);
    return n !== null && n < routine.blocks.length && !isOff(routine.blocks[n] as RoutineEntry) ? n : null;
  });
  // The blocks "No routine" put away, back if the routine is chosen again before the page is left.
  const [stash, setStash] = useState<RoutineEntry[]>([]);
  // The ids of the blocks added on this page, whose ids still follow their labels.
  const [fresh, setFresh] = useState<readonly string[]>([]);
  const level = ownerLevel(doc, routine.owner);
  const none = level !== "none" && isNoRoutine(routine);
  const whom = ownerWords(doc, routine.owner, "everyone");
  const covered = level === "kind" || level === "selector" ? `${whom.charAt(0).toLowerCase()}${whom.slice(1)}` : whom;
  const indexed = routine.blocks.map((entry, index) => ({ entry, index }));
  const blocks = indexed.filter((b) => !isOff(b.entry)).sort((a, b) => startOf(a.entry) - startOf(b.entry));
  const offs = indexed.filter((b) => isOff(b.entry));
  const ids = new Set(routine.blocks.map((b) => b.id));
  const basics: RefOption[] = BASIC_BLOCKS.filter((b) => !ids.has(b.id)).map((b) => ({ value: b.id, label: b.label, sublabel: `Everyone's · ${timeWords(b)}` }));
  // Other routines' blocks this one could change or turn off, each id once, named by the routine it's from; a basic need's id offers the basic need.
  const broader: RefOption[] = [];
  for (const r of Object.values(doc.routines ?? {})) {
    if (r.id === routine.id) continue;
    for (const b of r.blocks) if (!isOff(b) && !ids.has(b.id) && !BASIC_BLOCKS.some((x) => x.id === b.id) && !broader.some((o) => o.value === b.id)) broader.push({ value: b.id, label: b.label, sublabel: routineName(doc, r) });
  }
  const add = (block: RoutineBlock) => {
    set({ ...routine, blocks: [...routine.blocks, block] });
    setOpen(routine.blocks.length);
  };
  // A copy of a basic need or a broader block, under its id, to change for whom this routine covers; a basic need's copy is written here.
  const copy = (id: string) => {
    const basic = BASIC_BLOCKS.find((b) => b.id === id);
    const from = basic ?? Object.values(doc.routines ?? {}).flatMap((r) => (r.id === routine.id ? [] : r.blocks)).find((b): b is RoutineBlock => !isOff(b) && b.id === id);
    if (!from) return;
    const block = structuredClone(from);
    if (basic) delete block.source;
    add(block);
  };
  const remove = (index: number) => {
    set({ ...routine, blocks: routine.blocks.filter((_, i) => i !== index) });
    setOpen(null);
  };
  const current = open !== null ? routine.blocks[open] : undefined;
  return (
    <>
      <Section title="Whose routine">
        <div class="lre-stack">
          <OwnerPicker
            label="It's for"
            value={routine.owner}
            doc={doc}
            noneLabel="Everyone"
            noneHelp="The world's default: everyone whose day is planned, wherever a more specific routine doesn't set the same block."
            onChange={(owner) => {
              const { owner: _, ...rest } = routine;
              set(owner === undefined ? rest : { ...rest, owner });
            }}
          />
          <span class="lre-small lre-muted">Where routines set the same block for someone, the most specific wins: their own, then a group's, a kind's, a selector's, then everyone's.</span>
          <TextInput label="Name" optional value={routine.label} issues={lintAt(lint, `${props.path}.label`)} onChange={(label) => {
            const { label: _, ...rest } = routine;
            set(typeof label === "string" && label !== "" ? { ...rest, label } : rest);
          }} />
          <Issues issues={lint.filter((issue) => issue.path === props.path || issue.path === `${props.path}.owner` || issue.path === `${props.path}.id`)} />
        </div>
      </Section>
      {level !== "none" ? (
        <Section title="Their days">
          <div class="lre-stack">
            <Seg<"routine" | "none">
              label="Their days"
              value={none ? "none" : "routine"}
              options={[
                { value: "routine", label: "Have a routine" },
                { value: "none", label: "No routine" },
              ]}
              onChange={(next) => {
                if (next === "none") {
                  setStash(routine.blocks);
                  setOpen(null);
                  set({ ...routine, inherit: false, blocks: [] });
                } else {
                  const { inherit: _, ...rest } = routine;
                  set({ ...rest, blocks: stash });
                }
              }}
            />
            {none ? (
              <span class="lre-small lre-muted" data-lre-no-routine>
                No routine: their days come from the story, the GM, their commitments (shifts, appointments, trips) and their basic needs (sleep and meals), and no broader routine applies to them.
              </span>
            ) : (
              <CheckField
                label="Keeps the blocks of broader routines"
                help="A group's, a kind's and everyone's, wherever this routine doesn't set the same block."
                checked={routine.inherit !== false}
                onChange={(keep) => {
                  const { inherit: _, ...rest } = routine;
                  set(keep ? rest : { ...rest, inherit: false });
                }}
              />
            )}
          </div>
        </Section>
      ) : null}
      {none ? null : (
        <>
          <Section
            title="Blocks"
            aside={
              <Button
                size="sm"
                icon="plus"
                onClick={() => {
                  const block = blankBlock(deriveId("Block", ids), "");
                  setFresh([...fresh, block.id]);
                  add(block);
                }}
              >
                Block
              </Button>
            }
          >
            <div class="lre-stack">
              {blocks.length === 0 ? (
                <span class="lre-small lre-muted">No blocks yet. Add one, or change a basic need or a broader routine's block below.</span>
              ) : (
                <div class="lre-form-items" data-lre-blocks>
                  {blocks.map(({ entry, index }) => {
                    if (isOff(entry)) return null;
                    const source = sourceWords(doc, entry.source ?? routine.source);
                    const issues = lintAt(lint, `${props.path}.blocks.${index}`);
                    return (
                      <div key={index} data-lre-block={entry.id}>
                        <ItemRow
                          title={entry.label || humanize(entry.id)}
                          subtitle={[`${KIND_WORDS[entry.kind].label} · ${timeWords(entry)} · ${placeWords(doc, entry.place)}`, source].filter((s) => s !== null).join(" · ")}
                          badge={<LintBadge issues={issues} />}
                          openLabel={`Edit ${entry.label || entry.id}`}
                          onOpen={() => setOpen(index)}
                        />
                      </div>
                    );
                  })}
                </div>
              )}
              {basics.length + broader.length > 0 ? <AddPicker label="Change a basic need or a broader block" placeholder="Change a basic need or a broader block…" options={[...basics, ...broader]} onAdd={copy} /> : null}
              <span class="lre-small lre-muted">Everyone sleeps and eats ({BASIC_BLOCKS.map((b) => b.label).join(", ")}) unless a block with the same id changes it or turns it off; a block here changes a broader routine's block with the same id the same way.</span>
            </div>
          </Section>
          <Section title="Turned off here">
            <div class="lre-stack">
              {offs.length === 0 ? (
                <span class="lre-small lre-muted">Nothing: the basic needs and broader routines' blocks apply as they are.</span>
              ) : (
                <div class="lre-form-items" data-lre-offs>
                  {offs.map(({ entry, index }) => (
                    <ItemRow key={index} title={blockName(doc, entry.id)} subtitle={`Off for ${covered}`} badge={<LintBadge issues={lintAt(lint, `${props.path}.blocks.${index}`)} />} actions={<IconButton icon="undo" label={`Turn ${blockName(doc, entry.id)} back on`} onClick={() => remove(index)} />} />
                  ))}
                </div>
              )}
              {basics.length + broader.length > 0 ? <AddPicker label="Turn off a block" placeholder="Turn off a block…" options={[...basics, ...broader]} onAdd={(id) => set({ ...routine, blocks: [...routine.blocks, { id, off: true }] })} /> : null}
            </div>
          </Section>
        </>
      )}
      <Disclosure summary="Where this routine comes from" defaultOpen={routine.source !== undefined}>
        <SourceFields value={routine.source} doc={doc} issues={lintAt(lint, `${props.path}.source`)} onChange={(source) => {
          const { source: _, ...rest } = routine;
          set(source === undefined ? rest : { ...rest, source });
        }} />
        <span class="lre-small lre-muted">Its blocks rest on this unless a block names its own.</span>
      </Disclosure>
      {current && open !== null && !isOff(current) ? (
        <BlockSheet
          block={current}
          index={open}
          routine={routine}
          doc={doc}
          path={props.path}
          lint={lint}
          fresh={fresh.includes(current.id)}
          onChange={(next) => {
            // An id the label moved stays fresh under its new name; one typed by hand stops following.
            if (next.id !== current.id && fresh.includes(current.id)) setFresh(next.label !== current.label ? fresh.map((f) => (f === current.id ? next.id : f)) : fresh.filter((f) => f !== current.id));
            set({ ...routine, blocks: routine.blocks.map((b, i) => (i === open ? next : b)) });
          }}
          onRemove={() => remove(open)}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </>
  );
}

/** Build → Routines → a routine: its form over the draft, Save to draft and Revert, Delete in the overflow. */
export function RoutineEditor(props: EditorProps) {
  const app = useApp();
  const draft = useSelect(app.drafts, (d) => d);
  const at = useUi((ui) => (ui.build.view === "item" ? ui.build.at : undefined));
  const isNew = props.id?.startsWith("new:") ?? false;
  const id = isNew ? (props.id ?? "").slice(4) : (props.id ?? "");
  const routines = props.world.routines ?? {};
  const stored = hasOwn(routines, id) ? routines[id] : undefined;
  const blank = newItem("routines", id, props.world, newItemName(props.world.id, "routines", id)) as unknown as RoutineDef;
  const [routine, setRoutine] = useState<RoutineDef>(stored ? structuredClone(stored) : blank);
  const [busy, run] = useBusy();
  // Revert starts the form over too, so an owner level chosen but never filled, or an open sheet, goes with the rest.
  const [reverts, setReverts] = useState(0);
  useHeld(routine, setRoutine, stored ?? blank, `${props.world.id}/routines/${props.id ?? ""}`, JSON.stringify(stored ?? null));
  // Owners, company and sheet fields see the packs' kinds too (groups among them); the world's own win.
  const doc = useMemo(() => ({ ...props.world, kinds: { ...draft?.packKinds, ...props.world.kinds } }), [props.world, draft?.packKinds]);
  if (!id) return <span class="lre-muted">Choose a routine.</span>;
  const changed = JSON.stringify(routine) !== JSON.stringify(stored ?? null);
  const path = `routines.${id}`;
  const name = routineName(doc, routine);
  const save = () =>
    run(async () => {
      const message = await props.send(routineWrite(props.world.id, id, routine));
      if (message.type === "lre.result" && isNew) go(app, { view: "item", worldId: props.world.id, collection: "routines", id });
    });
  return (
    <div class="lre-build-page" data-lre-editor="routines">
      <ItemHeader
        title={name}
        id={id}
        subtitle={isNew ? "New routine, not in the draft until you create it" : `${ownerWords(doc, routine.owner, "Everyone")} · ${routineSummary(routine)}`}
        onDelete={isNew ? undefined : () => run(() => deleteItem(app, props.send, { worldId: props.world.id, collection: "routines", id, name }))}
        busy={busy}
      />
      <RoutineForm key={reverts} value={routine} doc={doc} path={path} lint={lintAt(draft?.lint ?? [], path)} at={at} onChange={setRoutine} />
      <SaveBar>
        <Button variant="primary" disabled={(!changed && !isNew) || busy} busy={busy} onClick={save}>
          {isNew ? "Create routine" : "Save to draft"}
        </Button>
        <Button
          variant="ghost"
          disabled={!changed || busy}
          onClick={() => {
            setRoutine(stored ? structuredClone(stored) : blank);
            setReverts(reverts + 1);
          }}
        >
          Revert
        </Button>
      </SaveBar>
    </div>
  );
}

// ---------------------------------------------------------------- the list

/**
 * Build → Routines: Routines and the story a tap away, then the routines by whom they're for, the
 * most specific first, each with its owner and its blocks in a few words; + New names a new one.
 */
export function RoutineList(props: { worldId: string }) {
  const app = useApp();
  const draft = useSelect(app.drafts, (d) => d);
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  if (!draft) return null;
  const doc: WorldDoc = { ...draft.doc, kinds: { ...draft.packKinds, ...draft.doc.kinds } };
  const info = COLLECTION_INFO.routines;
  const all = Object.values(draft.doc.routines ?? {});
  const q = query.trim().toLowerCase();
  const shown = all.filter((r) => q === "" || [r.id, r.label ?? "", ownerWords(doc, r.owner, "Everyone")].join("\n").toLowerCase().includes(q));
  const settings = routineSettingsOf(draft.doc);
  const add = (
    <Button size="sm" variant="primary" icon="plus" label="New routine" onClick={() => setAdding(true)}>
      New
    </Button>
  );
  return (
    <div class="lre-build-page" data-lre-collection="routines">
      <PageHeader title={info.label} subtitle={info.hint} actions={adding ? undefined : add} />
      {adding ? <NewItem worldId={draft.worldId} collection="routines" taken={new Set(Object.keys(draft.doc.routines ?? {}))} onDone={() => setAdding(false)} /> : null}
      <p class="lre-build-note">A routine is what someone usually does, never what they must. For anyone in a scene with you the story leads: a routine never moves them out of it or contradicts what's been told.</p>
      <Section title="Settings" flush>
        <List>
          <ListRow
            icon={PART_INFO.routineSettings.icon}
            title={PART_INFO.routineSettings.label}
            subtitle={`${AWARENESS_LABEL[settings.awareness]} · Invitations: ${INVITATIONS_LABEL[settings.invitations].toLowerCase()}`}
            badge={<LintBadge issues={lintAt(draft.lint, "routineSettings")} />}
            chevron
            onClick={() => go(app, { view: "part", worldId: draft.worldId, part: "routineSettings" })}
          />
        </List>
      </Section>
      {all.length > 8 ? (
        <div class="lre-build-search">
          <Icon name="search" size={16} />
          <input class="lre-input" type="search" placeholder="Search routines" aria-label="Search routines" value={query} onInput={(event) => setQuery(event.currentTarget.value)} />
        </div>
      ) : null}
      {all.length === 0 ? (
        <Empty icon={info.icon} title="No routines yet">
          Without one, a person's day is their schedules, their commitments, the plans the story gives them, and sleep and meals.
        </Empty>
      ) : shown.length === 0 ? (
        <Empty icon="search" title="No matches">
          Nothing here matches “{query.trim()}”.
        </Empty>
      ) : (
        LEVELS.map((level) => {
          const here = shown.filter((r) => ownerLevel(doc, r.owner) === level).sort((a, b) => routineName(doc, a).localeCompare(routineName(doc, b)));
          if (here.length === 0) return null;
          return (
            <Section key={level} title={LEVEL_TITLE[level]} flush>
              <List>
                {here.map((r) => (
                  <ListRow
                    key={r.id}
                    title={routineName(doc, r)}
                    subtitle={r.label ? `${ownerWords(doc, r.owner, "Everyone")} · ${routineSummary(r)}` : routineSummary(r)}
                    id={r.id}
                    badge={<LintBadge issues={lintAt(draft.lint, `routines.${r.id}`)} />}
                    chevron
                    onClick={() => go(app, { view: "item", worldId: draft.worldId, collection: "routines", id: r.id })}
                  />
                ))}
              </List>
            </Section>
          );
        })
      )}
    </div>
  );
}
