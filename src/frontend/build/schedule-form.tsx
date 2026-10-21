// A schedule's form (DESIGN §13), shared by Build's schedule page (the calendar pack's editor), a
// proposal's review and the GM view's schedule change for one character: who a schedule applies to
// and what it sets, when it repeats, and its day as a 24-hour bar of slots. Tap a slot, on the bar
// or in the list, to edit it in a sheet; drag a handle on the bar (or step it with the arrow keys) to
// move where one slot hands over to the next. Slots are fixed values, weighted choices, or choices by
// what the field was just before, each value typed by what the schedule sets: a place by name, a
// field by its definition, words with the world's own as suggestions. The owner is picked by level
// (someone, a group, a kind, a selector): the most specific one wins a field (DESIGN §8).

import { useId, useMemo, useRef, useState } from "preact/hooks";
import type { JsonValue } from "../../shared/json";
import { hasOwn, isRecord } from "../../shared/json";
import type { LintIssue } from "../../shared/protocol";
import type { FieldDef, Recurrence, ScheduleDef, ScheduleSlot, WeightedValue, WorldDoc } from "../../shared/world";
import { Button, Disclosure, Field, IconButton, NumberStepper, Section, Seg } from "../components";
import { humanize } from "../format";
import type { Req } from "../requests";
import { CheckField, Chip, FormGroup, FormSheet, Issues, ItemRow, RefPicker, type RefOption } from "./form-kit";
import { OwnerPicker } from "./owner-picker";
import { ChoiceInput, kindFields, NumberInput, refOptions } from "./schema-form";
import { kindIs, selectorOf } from "./selector-editor";

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY = 1440;
/** Handles move in quarter hours. */
const STEP = 15;
export const EVERY: Record<Recurrence["every"], string> = { day: "Daily", week: "Weekly", month: "Monthly", year: "Yearly" };

export function minutesOf(time: string): number {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

/** Minutes past midnight as HH:MM; the day's end (1440) is midnight, 00:00. */
export function timeOf(minutes: number): string {
  const m = ((minutes % DAY) + DAY) % DAY;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** A problem with a slot table, and the slots it's about (by index). */
export interface SlotIssue {
  slots: number[];
  message: string;
}

/** Plain-language problems with a slot table: bad times, overlaps (an end at or before the start runs past midnight), missing values and weights. */
export function slotIssues(slots: readonly ScheduleSlot[]): SlotIssue[] {
  const out: SlotIssue[] = [];
  const spans: { start: number; end: number; index: number }[] = [];
  slots.forEach((slot, index) => {
    if (!TIME.test(slot.start) || !TIME.test(slot.end)) {
      out.push({ slots: [index], message: `Slot ${index + 1}: times must be HH:MM` });
      return;
    }
    const start = minutesOf(slot.start);
    const end = minutesOf(slot.end);
    if (end > start) spans.push({ start, end, index });
    else {
      spans.push({ start, end: DAY, index });
      if (end > 0) spans.push({ start: 0, end, index });
    }
    if (slot.value === undefined && !slot.weighted && !slot.given) out.push({ slots: [index], message: `Slot ${index + 1}: no value` });
    if (slot.weighted && slot.weighted.reduce((sum, w) => sum + w.weight, 0) <= 0) out.push({ slots: [index], message: `Slot ${index + 1}: weights must add up to more than 0` });
  });
  spans.sort((a, b) => a.start - b.start);
  for (let i = 1; i < spans.length; i += 1) {
    const prev = spans[i - 1];
    const cur = spans[i];
    if (prev && cur && cur.start < prev.end && prev.index !== cur.index) out.push({ slots: [prev.index, cur.index], message: `Slots ${prev.index + 1} and ${cur.index + 1} overlap` });
  }
  return out;
}

export function slotProblems(slots: readonly ScheduleSlot[]): string[] {
  return [...new Set(slotIssues(slots).map((issue) => issue.message))];
}

/** Where a slot shows on the day bar, in minutes: one span, or two for a slot that runs past midnight. Bad times show nothing. */
export function slotSpans(slots: readonly ScheduleSlot[]): { index: number; start: number; end: number }[] {
  return slots.flatMap((slot, index) => {
    if (!TIME.test(slot.start) || !TIME.test(slot.end)) return [];
    const start = minutesOf(slot.start);
    const end = minutesOf(slot.end);
    if (end > start) return [{ index, start, end }];
    return end > 0 ? [{ index, start, end: DAY }, { index, start: 0, end }] : [{ index, start, end: DAY }];
  });
}

/** One end of a slot. */
export interface SlotEdge {
  index: number;
  side: "start" | "end";
}

/** A handle on the day bar: a time (0–1440; an end at midnight sits at 1440) and the slot ends that meet there, which move together. */
export interface DayHandle {
  at: number;
  edges: SlotEdge[];
}

export function dayHandles(slots: readonly ScheduleSlot[]): DayHandle[] {
  const byAt = new Map<number, SlotEdge[]>();
  slots.forEach((slot, index) => {
    if (!TIME.test(slot.start) || !TIME.test(slot.end)) return;
    const start = minutesOf(slot.start);
    const end = minutesOf(slot.end);
    byAt.set(start, [...(byAt.get(start) ?? []), { index, side: "start" }]);
    // A slot ending at midnight ends at the bar's right edge, not its left.
    const endAt = end === 0 ? DAY : end;
    byAt.set(endAt, [...(byAt.get(endAt) ?? []), { index, side: "end" }]);
  });
  return [...byAt].map(([at, edges]) => ({ at, edges })).sort((a, b) => a.at - b.at);
}

/** How far a handle may move: up to a step short of its neighbours, within the day; one at either end of the day stays there. */
export function handleRange(handles: readonly DayHandle[], i: number): [number, number] {
  const h = handles[i];
  if (!h || h.at === 0 || h.at === DAY) return [h?.at ?? 0, h?.at ?? 0];
  return [(handles[i - 1]?.at ?? 0) + STEP, (handles[i + 1]?.at ?? DAY) - STEP];
}

/** The slots with every end at a handle moved to `to` minutes. */
export function moveHandle(slots: readonly ScheduleSlot[], edges: readonly SlotEdge[], to: number): ScheduleSlot[] {
  const time = timeOf(to);
  return slots.map((slot, index) => {
    const mine = edges.filter((e) => e.index === index);
    if (mine.length === 0) return slot;
    return { ...slot, ...(mine.some((e) => e.side === "start") ? { start: time } : {}), ...(mine.some((e) => e.side === "end") ? { end: time } : {}) };
  });
}

/** How a schedule's values are typed, from what it sets: a place by name; a field by its definition, the owner's kind's first; else words. */
export type SlotValueType = { kind: "place" } | { kind: "field"; def: FieldDef } | { kind: "words" };

/** The kinds whose fields a schedule's target may name, the owner's own first: an entity's kind, a kind, a selector's kinds. */
function ownerKinds(doc: WorldDoc, owner: unknown): string[] {
  if (isRecord(owner)) return selectorOf(owner)?.kind ?? [];
  if (typeof owner !== "string" || owner === "") return [];
  const entity = hasOwn(doc.entities, owner) ? doc.entities[owner] : undefined;
  return entity ? [entity.kind] : [owner];
}

export function slotValueType(doc: WorldDoc, owner: unknown, target: string): SlotValueType {
  if (target === "place") return { kind: "place" };
  for (const kind of [...ownerKinds(doc, owner), ...Object.keys(doc.kinds)]) {
    const fields = kindFields(doc, kind);
    const def = hasOwn(fields, target) ? fields[target] : undefined;
    // A worked-out field is never stored, so a schedule can't set it.
    if (def && !def.derived) return { kind: "field", def };
  }
  return { kind: "words" };
}

/** What the fields a schedule may set are called, the owner's kinds' first: place and activity lead, then each other field once. */
export function targetOptions(doc: WorldDoc, owner: unknown): RefOption[] {
  const out: RefOption[] = [];
  const seen = new Set(["place", "activity"]);
  for (const kind of [...ownerKinds(doc, owner), ...Object.keys(doc.kinds)]) {
    for (const [field, def] of Object.entries(kindFields(doc, kind))) {
      if (seen.has(field) || def.derived || def.locked) continue;
      seen.add(field);
      out.push({ value: field, label: def.label ?? humanize(field), sublabel: hasOwn(doc.kinds, kind) ? (doc.kinds[kind]?.label ?? kind) : kind });
    }
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * The key a value of the slot before has in `given` (as the engine reads it, `sampleSlot`): text as
 * it is, anything else as JSON, nothing as `null`.
 */
export function givenKey(value: JsonValue | undefined): string {
  return value === undefined || value === null ? "null" : typeof value === "string" ? value : JSON.stringify(value);
}

/** A `given` key as the value it stands for, typed as the schedule's values are; `null` is nothing. */
export function givenValue(type: SlotValueType, key: string): JsonValue | undefined {
  if (key === "null") return undefined;
  if (type.kind === "field" && (type.def.type === "number" || type.def.type === "bool")) {
    try {
      return JSON.parse(key) as JsonValue;
    } catch {
      return key;
    }
  }
  return key;
}

/** A value in words: a place or entity by its name, a word with its underscores spaced, anything else as JSON. */
export function valueWords(doc: WorldDoc, value: JsonValue | undefined): string {
  if (value === undefined || value === null) return "nothing";
  if (typeof value === "string") {
    if (hasOwn(doc.places, value)) return doc.places[value]?.name ?? value;
    if (hasOwn(doc.entities, value)) return doc.entities[value]?.name ?? value;
    return value === "" ? "(empty)" : value.replace(/_/g, " ");
  }
  return JSON.stringify(value);
}

function slotLabel(doc: WorldDoc, slot: ScheduleSlot): string {
  if (slot.value !== undefined) return valueWords(doc, slot.value);
  if (slot.weighted) return slot.weighted.map((w) => valueWords(doc, w.value)).join(" / ");
  return "by what it was before";
}

/** The words a schedule setting `target` uses elsewhere in the world, for suggestions: every fixed and weighted value that is text. */
export function wordsInUse(doc: WorldDoc, target: string): string[] {
  const out = new Set<string>();
  const add = (v: JsonValue | undefined) => {
    if (typeof v === "string" && v !== "") out.add(v);
  };
  for (const s of Object.values(doc.schedules)) {
    if (s.target !== target) continue;
    for (const slot of s.slots) {
      add(slot.value);
      for (const w of slot.weighted ?? []) add(w.value);
      for (const row of Object.values(slot.given ?? {})) for (const w of row) add(w.value);
    }
  }
  return [...out].sort((a, b) => a.localeCompare(b));
}

/** Words, with the ones the world already uses for this field offered as the phone's suggestions; empty is no value. */
function WordsInput(props: { label: string; help?: string; value: JsonValue | undefined; suggestions: readonly string[]; onChange(value: JsonValue | undefined): void }) {
  const id = useId();
  const list = useId();
  const shown = typeof props.value === "string" ? props.value : props.value === undefined ? "" : JSON.stringify(props.value);
  return (
    <Field label={props.label} help={props.help} for={id}>
      <input id={id} class="lre-input" list={props.suggestions.length > 0 ? list : undefined} value={shown} onChange={(event) => props.onChange(event.currentTarget.value.trim() === "" ? undefined : event.currentTarget.value.trim())} />
      {props.suggestions.length > 0 ? (
        <datalist id={list}>
          {props.suggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      ) : null}
    </Field>
  );
}

/** One value of the schedule, typed by what it sets (`slotValueType`). */
export function SlotValueInput(props: { label: string; type: SlotValueType; value: JsonValue | undefined; doc: WorldDoc; suggestions: readonly string[]; onChange(value: JsonValue | undefined): void }) {
  const { type, doc } = props;
  if (type.kind === "place") return <RefPicker label={props.label} value={typeof props.value === "string" ? props.value : ""} options={refOptions(doc, "places")} onChange={(next) => props.onChange(next === "" ? undefined : next)} />;
  if (type.kind === "field") {
    const def = type.def;
    switch (def.type) {
      case "number":
        return <NumberInput label={props.label} value={props.value} min={def.min} max={def.max} issues={[]} onChange={props.onChange} />;
      case "bool":
        return <CheckField label={props.label} checked={props.value === true} onChange={(checked) => props.onChange(checked)} />;
      case "enum":
        return <ChoiceInput label={props.label} value={props.value} options={(def.values ?? []).map((v) => ({ value: v, label: humanize(v) }))} issues={[]} onChange={props.onChange} />;
      case "ref": {
        // A kinded ref names an entity of that kind; an unkinded one a place or an entity, places first.
        const options = def.ref ? refOptions(doc, "entities").filter((o) => kindIs(doc, doc.entities[o.value]?.kind ?? "", def.ref ?? "")) : [...refOptions(doc, "places").map((o) => ({ ...o, sublabel: "Place" })), ...refOptions(doc, "entities")];
        return <RefPicker label={props.label} value={typeof props.value === "string" ? props.value : ""} options={options} onChange={(next) => props.onChange(next === "" ? undefined : next)} />;
      }
    }
  }
  return <WordsInput label={props.label} help={type.kind === "words" ? "A word, as the field takes it" : undefined} value={props.value} suggestions={props.suggestions} onChange={props.onChange} />;
}

/** Weighted choices: each a value and its weight, with its share of the whole. */
function Choices(props: { title: string; items: readonly WeightedValue[]; type: SlotValueType; doc: WorldDoc; suggestions: readonly string[]; onChange(next: WeightedValue[]): void }) {
  const total = props.items.reduce((sum, w) => sum + Math.max(0, w.weight), 0);
  return (
    <FormGroup title={props.title} aside={<Button size="sm" icon="plus" onClick={() => props.onChange([...props.items, { value: "", weight: 1 }])}>Choice</Button>}>
      {props.items.length === 0 ? <span class="lre-small lre-muted">No choices yet.</span> : null}
      {props.items.map((w, i) => (
        <div key={i} class="lre-ve-weight">
          <SlotValueInput label={`Choice ${i + 1}`} type={props.type} value={w.value} doc={props.doc} suggestions={props.suggestions} onChange={(value) => props.onChange(props.items.map((x, j) => (j === i ? { ...x, value: value ?? "" } : x)))} />
          <IconButton icon="trash" label={`Remove choice ${i + 1}`} onClick={() => props.onChange(props.items.filter((_, j) => j !== i))} />
          <NumberStepper label={`Weight${total > 0 ? ` (${Math.round((Math.max(0, w.weight) / total) * 100)}%)` : ""}`} value={w.weight} min={0} onChange={(weight) => props.onChange(props.items.map((x, j) => (j === i ? { ...x, weight } : x)))} />
        </div>
      ))}
    </FormGroup>
  );
}

/**
 * Choices by what the field was just before the slot starts (`given`, the engine's Markov row): one
 * case per value it was, each with its weighted choices; a case for a value it never was is never used.
 */
function GivenCases(props: { given: Record<string, WeightedValue[]> | undefined; type: SlotValueType; doc: WorldDoc; suggestions: readonly string[]; onChange(next: Record<string, WeightedValue[]> | undefined): void }) {
  const cases = Object.entries(props.given ?? {});
  const write = (next: [string, WeightedValue[]][]) => props.onChange(next.length === 0 ? undefined : Object.fromEntries(next));
  // A new case takes the first value not yet listed: nothing, then the world's words.
  const fresh = ["null", ...props.suggestions].find((key) => !cases.some(([k]) => k === key)) ?? "";
  return (
    <div class="lre-stack" data-lre-given>
      <span class="lre-small lre-muted">Choices that depend on what this was just before the slot starts. When a case matches, its choices stand in for the value above.</span>
      {cases.map(([key, items], i) => (
        <FormGroup key={i} title={`If it was ${key === "null" ? "nothing" : valueWords(props.doc, givenValue(props.type, key))} before`} aside={<IconButton icon="trash" label={`Remove case ${i + 1}`} onClick={() => write(cases.filter((_, j) => j !== i))} />}>
          <CheckField label="It was nothing before" checked={key === "null"} onChange={(none) => write(cases.map((c, j) => (j === i ? [none ? "null" : "", c[1]] : c)))} />
          {key === "null" ? null : <SlotValueInput label="What it was" type={props.type} value={givenValue(props.type, key)} doc={props.doc} suggestions={props.suggestions} onChange={(value) => write(cases.map((c, j) => (j === i ? [givenKey(value), c[1]] : c)))} />}
          <Choices title="Then choose" items={items} type={props.type} doc={props.doc} suggestions={props.suggestions} onChange={(next) => write(cases.map((c, j) => (j === i ? [c[0], next] : c)))} />
        </FormGroup>
      ))}
      <div>
        <Button size="sm" icon="plus" onClick={() => write([...cases, [fresh, [{ value: "", weight: 1 }]]])}>
          Case
        </Button>
      </div>
    </div>
  );
}

/** The day as a bar: slots by value colour, each opening its sheet; handles where a slot starts or ends. */
export function DayBar(props: { slots: readonly ScheduleSlot[]; current: number | null; label(slot: ScheduleSlot): string; colour(slot: ScheduleSlot): string; onOpen(index: number): void; onMove(slots: ScheduleSlot[]): void }) {
  const bar = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const handles = dayHandles(props.slots);
  const minuteAt = (clientX: number) => {
    const rect = bar.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return null;
    return Math.round((((clientX - rect.left) / rect.width) * DAY) / STEP) * STEP;
  };
  const moveTo = (i: number, to: number) => {
    const h = handles[i];
    if (!h) return;
    const [min, max] = handleRange(handles, i);
    const at = Math.min(max, Math.max(min, to));
    if (at !== h.at) props.onMove(moveHandle(props.slots, h.edges, at));
  };
  const name = (h: DayHandle) => {
    const ends = h.edges.filter((e) => e.side === "end").map((e) => e.index + 1);
    const starts = h.edges.filter((e) => e.side === "start").map((e) => e.index + 1);
    return ends.length > 0 && starts.length > 0 ? `Slot ${ends.join(", ")} ends and slot ${starts.join(", ")} starts` : ends.length > 0 ? `End of slot ${ends.join(", ")}` : `Start of slot ${starts.join(", ")}`;
  };
  return (
    <>
      <div ref={bar} class="lre-ve-day" data-lre-day-bar>
        <div class="lre-ve-day-track">
          {slotSpans(props.slots).map((span, i) => {
            const slot = props.slots[span.index];
            if (!slot) return null;
            return (
              // The list below is the slots' accessible target; the bar is the picture and the drag surface.
              <button
                key={`${span.index}:${i}`}
                type="button"
                tabIndex={-1}
                aria-hidden="true"
                class="lre-ve-day-slot"
                aria-current={span.index === props.current}
                style={{ left: `${(span.start / DAY) * 100}%`, width: `${((span.end - span.start) / DAY) * 100}%`, "--slot": props.colour(slot) }}
                title={`${slot.start}–${slot.end} ${props.label(slot)}`}
                onClick={() => props.onOpen(span.index)}
              >
                {props.label(slot)}
              </button>
            );
          })}
        </div>
        {handles.map((h, i) => {
          const [min, max] = handleRange(handles, i);
          if (min === max) return null;
          return (
            // Keyed by its slot edges, not its time: a drag moves the time, and a new element would drop the pointer capture.
            <div
              key={h.edges.map((e) => `${e.index}${e.side}`).join()}
              class="lre-ve-handle"
              role="slider"
              tabIndex={0}
              aria-label={name(h)}
              aria-valuemin={min}
              aria-valuemax={max}
              aria-valuenow={h.at}
              aria-valuetext={timeOf(h.at)}
              data-dragging={dragging === i ? "" : undefined}
              style={{ left: `${(h.at / DAY) * 100}%` }}
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                event.preventDefault();
                setDragging(i);
              }}
              onPointerMove={(event) => {
                if (dragging !== i) return;
                const to = minuteAt(event.clientX);
                if (to !== null) moveTo(i, to);
              }}
              onPointerUp={() => setDragging(null)}
              onPointerCancel={() => setDragging(null)}
              onKeyDown={(event) => {
                const delta = event.key === "ArrowLeft" || event.key === "ArrowDown" ? -STEP : event.key === "ArrowRight" || event.key === "ArrowUp" ? STEP : event.key === "PageDown" ? -60 : event.key === "PageUp" ? 60 : 0;
                const to = event.key === "Home" ? min : event.key === "End" ? max : delta !== 0 ? h.at + delta : null;
                if (to === null) return;
                event.preventDefault();
                moveTo(i, to);
              }}
            >
              <span />
            </div>
          );
        })}
      </div>
      <div class="lre-ve-day-axis" aria-hidden="true">
        <span>00</span>
        <span>06</span>
        <span>12</span>
        <span>18</span>
        <span>24</span>
      </div>
    </>
  );
}

/** One slot as a sheet: its times, its value (fixed or weighted), the choices by what it was before, and Remove. */
function SlotSheet(props: { slot: ScheduleSlot; index: number; issues: readonly string[]; type: SlotValueType; doc: WorldDoc; suggestions: readonly string[]; onChange(slot: ScheduleSlot): void; onRemove(): void; onClose(): void }) {
  const { slot } = props;
  const weighted = slot.weighted !== undefined;
  const lint: LintIssue[] = props.issues.map((message) => ({ severity: "error", path: `slots.${props.index}`, code: "slot", message }));
  const typed = { type: props.type, doc: props.doc, suggestions: props.suggestions };
  return (
    <FormSheet title={`Slot ${props.index + 1}`} subtitle={`${slot.start}–${slot.end} · ${slotLabel(props.doc, slot)}`} backLabel="Schedule" onClose={props.onClose}>
      <Issues issues={lint} />
      <div class="lre-ve-times">
        <Field label="Starts">
          <input class="lre-input" type="time" step={900} value={slot.start} onChange={(event) => props.onChange({ ...slot, start: event.currentTarget.value })} />
        </Field>
        <Field label="Ends" help="At or before the start: it runs past midnight.">
          <input class="lre-input" type="time" step={900} value={slot.end} onChange={(event) => props.onChange({ ...slot, end: event.currentTarget.value })} />
        </Field>
      </div>
      <Field label="Its value">
        <Seg<"value" | "weighted">
          label="Its value"
          value={weighted ? "weighted" : "value"}
          options={[
            { value: "value", label: "Fixed" },
            { value: "weighted", label: "Weighted choice" },
          ]}
          onChange={(mode) => props.onChange(mode === "value" ? { start: slot.start, end: slot.end, value: slot.weighted?.[0]?.value ?? "", ...(slot.given ? { given: slot.given } : {}) } : { start: slot.start, end: slot.end, weighted: [{ value: slot.value ?? "", weight: 1 }], ...(slot.given ? { given: slot.given } : {}) })}
        />
      </Field>
      {weighted ? <Choices title="Choices" items={slot.weighted ?? []} {...typed} onChange={(next) => props.onChange({ ...slot, weighted: next })} /> : <SlotValueInput label="Value" value={slot.value} {...typed} onChange={(value) => props.onChange({ ...slot, value })} />}
      <Disclosure summary="By what it was before" defaultOpen={slot.given !== undefined}>
        <GivenCases given={slot.given} {...typed} onChange={(given) => props.onChange({ ...slot, given })} />
      </Disclosure>
      <div class="lre-inline">
        <Button variant="danger" icon="trash" onClick={props.onRemove}>
          Remove slot
        </Button>
      </div>
    </FormSheet>
  );
}

/** The two fields most schedules set, as the editor names them. */
const TARGET_WORDS: Record<"place" | "activity", string> = { place: "Where they are", activity: "What they're doing" };

/** What a schedule sets, in words for its header: one of the two, else the field's label. */
export function targetWords(doc: WorldDoc, owner: unknown, target: string): string {
  if (target === "place" || target === "activity") return TARGET_WORDS[target].toLowerCase();
  if (target === "") return "nothing yet";
  return targetOptions(doc, owner).find((o) => o.value === target)?.label ?? humanize(target);
}

/** What the schedule sets: where they are, what they're doing, or another field by name (any field or relation id under it). */
function TargetPicker(props: { doc: WorldDoc; owner: unknown; value: string; onChange(target: string): void }) {
  const id = useId();
  const mode = props.value === "place" || props.value === "activity" ? props.value : "other";
  return (
    <div class="lre-stack" data-lre-target={mode}>
      <Field label="It sets">
        <Seg<"place" | "activity" | "other">
          label="It sets"
          value={mode}
          options={[
            { value: "place", label: TARGET_WORDS.place },
            { value: "activity", label: TARGET_WORDS.activity },
            { value: "other", label: "Another field" },
          ]}
          onChange={(next) => props.onChange(next === "other" ? "" : next)}
        />
      </Field>
      {mode === "other" ? (
        <>
          <RefPicker label="Which field" value={props.value} options={targetOptions(props.doc, props.owner)} onChange={props.onChange} />
          <Field label="Or its id" help="A field or relation no kind declares, as the world's rules name it." for={id}>
            <input id={id} class="lre-input" value={props.value} onChange={(event) => props.onChange(event.currentTarget.value.trim())} />
          </Field>
        </>
      ) : null}
    </div>
  );
}

/** When a schedule repeats: every day, chosen weekdays, chosen days of the month or once a year; never on chosen holidays; between two dates. */
export function RecurrenceFields(props: { value: Recurrence; holidays: readonly { id: string; label: string }[]; onChange(next: Recurrence): void }) {
  const rec = props.value;
  const setRec = props.onChange;
  return (
    <div class="lre-stack" data-lre-recurrence={rec.every}>
      <Seg<Recurrence["every"]> label="Repeats" value={rec.every} options={(Object.keys(EVERY) as Recurrence["every"][]).map((every) => ({ value: every, label: EVERY[every] }))} onChange={(every) => setRec({ ...rec, every })} />
      {rec.every === "week" ? (
        <Field label="On">
          <div class="lre-ve-days" role="group" aria-label="Weekdays">
            {WEEKDAYS.map((day, i) => {
              const on = rec.weekdays?.includes(i) ?? false;
              return (
                <button key={day} type="button" aria-pressed={on} onClick={() => setRec({ ...rec, weekdays: on ? (rec.weekdays ?? []).filter((d) => d !== i) : [...(rec.weekdays ?? []), i].sort() })}>
                  {day}
                </button>
              );
            })}
          </div>
        </Field>
      ) : null}
      {rec.every === "month" ? (
        <Field label="On these days of the month">
          <div class="lre-ve-days" role="group" aria-label="Days of the month">
            {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => {
              const on = rec.days?.includes(day) ?? false;
              return (
                <button key={day} type="button" aria-pressed={on} onClick={() => setRec({ ...rec, days: on ? (rec.days ?? []).filter((d) => d !== day) : [...(rec.days ?? []), day].sort((a, b) => a - b) })}>
                  {day}
                </button>
              );
            })}
          </div>
        </Field>
      ) : null}
      {props.holidays.length > 0 ? (
        <Field label="Not on">
          <div class="lre-form-chips" role="group" aria-label="Not on these holidays">
            {props.holidays.map((h) => {
              const on = rec.except?.includes(h.id) ?? false;
              return (
                <Chip key={h.id} pressed={on} onToggle={() => setRec({ ...rec, except: on ? (rec.except ?? []).filter((e) => e !== h.id) : [...(rec.except ?? []), h.id] })}>
                  {h.label}
                </Chip>
              );
            })}
          </div>
        </Field>
      ) : null}
      <div class="lre-ve-times">
        <Field label="From">
          <input class="lre-input" type="date" value={rec.from ?? ""} onChange={(event) => setRec({ ...rec, from: event.currentTarget.value || undefined })} />
        </Field>
        <Field label="Until">
          <input class="lre-input" type="date" value={rec.until ?? ""} onChange={(event) => setRec({ ...rec, until: event.currentTarget.value || undefined })} />
        </Field>
      </div>
    </div>
  );
}

/**
 * A schedule's fields as one form: who and what, when it repeats, and its day with each slot's
 * sheet. The schedule's page and a proposal's review both edit through it. `doc` is the draft with
 * the packs' kinds merged in, so owners and fields of pack kinds are offered.
 */
export function ScheduleForm(props: { value: ScheduleDef; doc: WorldDoc; path: string; onChange(next: ScheduleDef): void }) {
  const { doc } = props;
  const schedule = props.value;
  const setSchedule = props.onChange;
  const [open, setOpen] = useState<number | null>(null);
  const issues = useMemo(() => slotIssues(schedule.slots), [schedule.slots]);
  const type = slotValueType(doc, schedule.owner, schedule.target);
  const suggestions = wordsInUse(doc, schedule.target);
  const label = (slot: ScheduleSlot) => slotLabel(doc, slot);
  const values = [...new Set(schedule.slots.map(label))];
  const colour = (slot: ScheduleSlot) => `var(--lre-series-${(values.indexOf(label(slot)) % 5) + 1})`;
  const slot = open !== null ? schedule.slots[open] : undefined;
  const addSlot = () => {
    const last = schedule.slots.at(-1);
    const start = last && TIME.test(last.end) ? last.end : "00:00";
    const end = timeOf(Math.min(DAY - 1, minutesOf(start) + 60));
    setSchedule({ ...schedule, slots: [...schedule.slots, { start, end, value: "" }] });
    setOpen(schedule.slots.length);
  };
  return (
    <>
      <Section title="Who and what">
        <div class="lre-stack">
          <OwnerPicker label="It applies to" value={schedule.owner} doc={doc} noneLabel="No one" noneHelp="A world process (the weather, prices): it sets no one's field." onChange={(owner) => setSchedule({ ...schedule, owner })} />
          <span class="lre-small lre-muted">When schedules set the same field of the same person, the most specific owner wins: their own, then a group's, then their kind's, then a selector's.</span>
          <TargetPicker doc={doc} owner={schedule.owner} value={schedule.target} onChange={(target) => setSchedule({ ...schedule, target })} />
        </div>
      </Section>
      <Section title="Repeats">
        <RecurrenceFields value={schedule.recurrence} holidays={doc.calendar.holidays} onChange={(recurrence) => setSchedule({ ...schedule, recurrence })} />
      </Section>
      <Section title="The day" aside={<Button size="sm" icon="plus" onClick={addSlot}>Slot</Button>}>
        <div class="lre-stack">
          <DayBar slots={schedule.slots} current={open} label={label} colour={colour} onOpen={setOpen} onMove={(slots) => setSchedule({ ...schedule, slots })} />
          <span class="lre-small lre-muted">Tap a slot to edit it. Drag a handle to move where one slot ends or the next starts.</span>
          <Issues issues={[...new Set(issues.map((issue) => issue.message))].map((message) => ({ severity: "error", path: `${props.path}.slots`, code: "slot", message }))} />
          {schedule.slots.length === 0 ? (
            <span class="lre-small lre-muted">No slots: the schedule sets nothing.</span>
          ) : (
            <div class="lre-form-items" data-lre-slots>
              {schedule.slots.map((s, i) => {
                const flagged = issues.some((issue) => issue.slots.includes(i));
                return (
                  <ItemRow
                    key={i}
                    title={
                      <span class="lre-ve-brush">
                        <span class="lre-ve-dot" style={{ "--slot": colour(s) }} aria-hidden="true" />
                        {s.start}–{s.end}
                      </span>
                    }
                    subtitle={label(s)}
                    badge={flagged ? <span class="lre-badge neg">Fix</span> : undefined}
                    openLabel={`Edit slot ${i + 1}, ${s.start} to ${s.end}`}
                    onOpen={() => setOpen(i)}
                  />
                );
              })}
            </div>
          )}
        </div>
      </Section>
      {slot && open !== null ? (
        <SlotSheet
          slot={slot}
          index={open}
          issues={issues.filter((issue) => issue.slots.includes(open)).map((issue) => issue.message)}
          type={type}
          doc={doc}
          suggestions={suggestions}
          onChange={(next) => setSchedule({ ...schedule, slots: schedule.slots.map((s, i) => (i === open ? next : s)) })}
          onRemove={() => {
            setSchedule({ ...schedule, slots: schedule.slots.filter((_, i) => i !== open) });
            setOpen(null);
          }}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </>
  );
}

/** The draft write that saves a schedule as its page holds it, under its id. */
export function scheduleWrite(worldId: string, id: string, schedule: ScheduleDef): Req<"lre.editor"> {
  return { type: "lre.editor", worldId, base: null, op: "put", collection: "schedules", id, value: { ...schedule, id } as unknown as JsonValue };
}
