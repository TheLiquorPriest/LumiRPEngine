// Build's forms over a draft others change too (DESIGN §23), stepped as `useHeld` steps them,
// without a DOM: what a form shows, and whether Build's bar holds it behind the notice, as the
// draft's value of what it edits changes. Every Build editor keeps its form this way: an object for
// the core forms and the packs' tracks, grids and schedules, the text itself for the map editor.

import { describe, expect, test } from "bun:test";
import type { HeldBase, HeldStep } from "../../src/frontend/build/held";
import { heldChoice, heldStart, holdOrFollow } from "../../src/frontend/build/held";

/**
 * A form on one item, stepped as `useHeld` steps it; `watchOf` is what its editor watches of the
 * draft's value. `type` is text typed into a field the form's value doesn't have yet (a number or
 * money field hands it on blur, once it parses), which counts as an edit as `typedFields` counts it.
 */
function form<T>(key: string, initial: T, watchOf: (initial: T) => string = (v) => JSON.stringify(v)) {
  let value = structuredClone(initial);
  let base: HeldBase<T> = heldStart(key, watchOf(initial), initial);
  let typing = false;
  const apply = (step: HeldStep<T> | null): void => {
    if (!step) return;
    base = step.base;
    if (step.load) value = structuredClone(step.load.value);
  };
  const changed = (next: T, reloaded: boolean, at: string): void => apply(holdOrFollow(base, { key: at, watch: watchOf(next), value, initial: next, reloaded, typing }));
  return {
    shown: (): { value: T; notice: boolean } => ({ value, notice: base.theirs !== null }),
    edit: (next: T): void => {
      value = next;
    },
    /** The first keystroke in a field, until it hands its text to the form (`edit`) or `handed` without a change. */
    type: (): void => {
      typing = true;
    },
    handed: (): void => {
      typing = false;
    },
    /** A change made elsewhere, as Build reloads it; `at` is the item the form is on then. */
    reload: (next: T, at: string = base.key): void => changed(next, true, at),
    /** Build's own write, whose answer replaces the draft. */
    written: (next: T): void => changed(next, false, base.key),
    choose: (choice: "theirs" | "mine"): void => apply(heldChoice(base, choice)),
  };
}

const track = (label: string, start = "Start") => ({ id: "t1", kind: "quest", label, start: "start", stages: { start: { label: start, next: [] as string[] } }, visibility: "public" });

describe("a Build form over a draft others change", () => {
  test("an untouched form follows a change; an edited one keeps its edits behind the notice until the user picks", () => {
    const f = form("w/tracks/t1", track("Find the cat"));
    f.reload(track("Find the cat", "Begin"));
    expect(f.shown()).toEqual({ value: track("Find the cat", "Begin"), notice: false });
    f.edit(track("Find the black cat", "Begin"));
    f.reload(track("Find the cat", "Begin (agent)"));
    expect(f.shown()).toEqual({ value: track("Find the black cat", "Begin"), notice: true });
    // Another change while it is held: still held, and Load theirs brings the newest.
    f.reload(track("Find the cat", "Begin (agent, again)"));
    expect(f.shown()).toEqual({ value: track("Find the black cat", "Begin"), notice: true });
    f.choose("theirs");
    expect(f.shown()).toEqual({ value: track("Find the cat", "Begin (agent, again)"), notice: false });
  });

  test("text being typed is an edit from the first keystroke: a change elsewhere holds the form, so the field keeps what is typed until Load theirs", () => {
    // A field shows what is typed until the form's value of it changes, so the form's value staying is the typed text staying.
    const person = (name: string, mood = "calm", xp?: number) => ({ id: "rosie", kind: "person", name, fields: xp === undefined ? { mood } : { mood, xp } });
    const f = form("w/entities/rosie", person("Rosie Alvarez"));
    // A text field hands each keystroke to the form: an edit like any other.
    f.edit(person("Rosie Alvarez-R"));
    f.reload(person("Rosie Alvarez", "tense"));
    expect(f.shown()).toEqual({ value: person("Rosie Alvarez-R"), notice: true });
    f.choose("theirs");
    expect(f.shown()).toEqual({ value: person("Rosie Alvarez", "tense"), notice: false });
    // A number field keeps "12" to itself until blur; typed, it is an edit all the same.
    f.type();
    f.reload(person("Rosie Alvarez", "happy"));
    expect(f.shown()).toEqual({ value: person("Rosie Alvarez", "tense"), notice: true });
    // Another change while still typing: still held, the field's value still the one it was typed over.
    f.reload(person("Rosie A. (agent)", "calm"));
    expect(f.shown()).toEqual({ value: person("Rosie Alvarez", "tense"), notice: true });
    // Blurred, the field hands its number to the form, which keeps it behind the notice; Load theirs alone replaces it.
    f.edit(person("Rosie Alvarez", "tense", 12));
    f.handed();
    expect(f.shown()).toEqual({ value: person("Rosie Alvarez", "tense", 12), notice: true });
    f.choose("theirs");
    expect(f.shown()).toEqual({ value: person("Rosie A. (agent)", "calm"), notice: false });
    // Text typed, taken back and handed over without a change is no edit: the next change loads.
    f.type();
    f.handed();
    f.reload(person("Rosie A. (agent)", "happy"));
    expect(f.shown()).toEqual({ value: person("Rosie A. (agent)", "happy"), notice: false });
    // Build's own write and another item follow the draft even while a field is typed into.
    f.type();
    f.written(person("Rosie (saved)", "happy"));
    expect(f.shown()).toEqual({ value: person("Rosie (saved)", "happy"), notice: false });
    f.reload({ ...person("Hank"), id: "hank" }, "w/entities/hank");
    expect(f.shown()).toEqual({ value: { ...person("Hank"), id: "hank" }, notice: false });
  });

  test("keep mine keeps the edits over theirs: any later change holds them, unless it brings the same", () => {
    const f = form("w/tracks/t1", track("Find the cat"));
    f.edit(track("Mine"));
    f.reload(track("Find the cat", "Theirs"));
    f.choose("mine");
    expect(f.shown()).toEqual({ value: track("Mine"), notice: false });
    // Even the value the form began from is an edit now: it isn't theirs.
    f.edit(track("Find the cat"));
    f.reload(track("Find the cat", "Theirs again"));
    expect(f.shown()).toEqual({ value: track("Find the cat"), notice: true });
    f.choose("mine");
    f.edit(track("Mine"));
    f.reload(track("Mine"));
    expect(f.shown()).toEqual({ value: track("Mine"), notice: false });
  });

  test("a change to another item leaves the form alone; edits taken back, Build's own write and another item follow the draft", () => {
    const f = form("w/tracks/t1", track("Find the cat"));
    f.edit(track("Mine"));
    // The draft changed elsewhere, but not this track: its value, so the watch, is the same.
    f.reload(track("Find the cat"));
    expect(f.shown()).toEqual({ value: track("Mine"), notice: false });
    f.reload(track("Find the cat", "Theirs"));
    expect(f.shown().notice).toBe(true);
    // Taken back to what they were made over, the edits are gone: the next change loads.
    f.edit(track("Find the cat"));
    f.reload(track("Find the cat", "Theirs again"));
    expect(f.shown()).toEqual({ value: track("Find the cat", "Theirs again"), notice: false });
    // Build's own save answers with the draft as the backend keeps it, which the form takes.
    f.edit(track("Saved"));
    f.written({ ...track("Saved"), visibility: "secret" });
    expect(f.shown()).toEqual({ value: { ...track("Saved"), visibility: "secret" }, notice: false });
    // A new item, once saved, opens as itself (`new:t2` becomes `t2`), and loads whatever the form held.
    const g = form("w/tracks/new:t2", track("t2"));
    g.edit(track("Second"));
    g.reload(track("Second, as saved"), "w/tracks/t2");
    expect(g.shown()).toEqual({ value: track("Second, as saved"), notice: false });
  });

  test("the map editor's text holds the same way, watching the text itself", () => {
    const text = (name: string): string => JSON.stringify({ format: "lre-map-v1", id: "yard", name }, null, 2);
    const f = form("w/maps/yard", text("Yard"), (t) => t);
    f.reload(text("Yard (agent)"));
    expect(f.shown()).toEqual({ value: text("Yard (agent)"), notice: false });
    f.edit(text("My yard"));
    f.reload(text("Yard (agent, again)"));
    expect(f.shown()).toEqual({ value: text("My yard"), notice: true });
    f.choose("theirs");
    expect(f.shown()).toEqual({ value: text("Yard (agent, again)"), notice: false });
  });
});
