// Build's forms over a draft that can change under them (DESIGN §23). A form follows the draft
// while it is untouched, and after Build's own writes; once edited, a reload (a change made in
// another window or by an outside agent) never resets it. When the draft's own value of what the
// form edits changes under the edits, Build's bar says so with Load theirs and Keep mine, and a
// save over that change asks first, so overwriting it is the user's choice.

import { useEffect, useState } from "preact/hooks";
import { PROTOCOL_VERSION } from "../../shared/protocol";
import type { ErrorMessage } from "../../shared/protocol";
import type { App } from "../app";
import { useApp } from "../app";
import { createStore, useSelect } from "../store";

/** A form holding edits over a change made elsewhere. */
export interface HeldForm {
  loadTheirs(): void;
  keepMine(): void;
}

/** The forms holding edits over a change made elsewhere (one, unless several editors are open). */
export const heldForms = createStore<readonly HeldForm[]>([]);

/** What a form's edits were made over. */
export interface HeldBase<T> {
  /** The item the form edits. */
  key: string;
  /** Changes when the draft's value of that item does. */
  watch: string;
  /** The JSON of the draft's value the form's edits were made over. */
  from: string;
  /** The draft's newer value, while the form keeps its edits over it. */
  theirs: { value: T; json: string } | null;
}

/** A form's next base, and the draft's value it loads, when it loads one. */
export interface HeldStep<T> {
  base: HeldBase<T>;
  load?: { value: T };
}

/** A form's base as it opens an item: its edits, none yet, are over the draft's value of it. */
export function heldStart<T>(key: string, watch: string, initial: T): HeldBase<T> {
  return { key, watch, from: JSON.stringify(initial), theirs: null };
}

/**
 * A form's step when the item it edits (`key`), or the draft's value of it (`watch`), may have
 * changed; null when neither did. Another item, Build's own write, an untouched form or one that
 * already matches follows the draft, as forms always did. Edits over a reload are kept, with the
 * draft's value as theirs, and stay made over what they were made over.
 */
export function holdOrFollow<T>(base: HeldBase<T>, now: { key: string; watch: string; value: T; initial: T; reloaded: boolean }): HeldStep<T> | null {
  if (now.key === base.key && now.watch === base.watch) return null;
  const mine = JSON.stringify(now.value);
  const next = JSON.stringify(now.initial);
  if (now.key !== base.key || !now.reloaded || mine === base.from || mine === next) {
    const followed: HeldBase<T> = { key: now.key, watch: now.watch, from: next, theirs: null };
    return mine === next ? { base: followed } : { base: followed, load: { value: now.initial } };
  }
  return { base: { ...base, watch: now.watch, theirs: { value: now.initial, json: next } } };
}

/** A held form's step on the user's choice: either way its edits are over theirs now, and Load theirs loads theirs. */
export function heldChoice<T>(base: HeldBase<T>, choice: "theirs" | "mine"): HeldStep<T> {
  if (!base.theirs) return { base };
  const settled: HeldBase<T> = { key: base.key, watch: base.watch, from: base.theirs.json, theirs: null };
  return choice === "theirs" ? { base: settled, load: { value: base.theirs.value } } : { base: settled };
}

/**
 * Keeps a form's `value` (with its setter) over `initial`, the draft's value of what it edits: `key`
 * names that item (another key is another item, which the form simply loads), and `watch` changes
 * when the draft's value does (its JSON by default). Every Build editor keeps its form with it, the
 * ones packs register included, so Build's bar and the save prompt cover them all.
 */
export function useHeld<T>(value: T, set: (next: T) => void, initial: T, key: string, watch: string = JSON.stringify(initial)): void {
  const reloaded = useSelect(useApp().drafts, (d) => d?.reloaded === true);
  const [base, setBase] = useState<HeldBase<T>>(() => heldStart(key, watch, initial));
  const apply = (step: HeldStep<T> | null): void => {
    if (!step) return;
    setBase(step.base);
    // A copy, so the form's edits never write into the draft's own value.
    if (step.load) set(structuredClone(step.load.value));
  };
  useEffect(() => apply(holdOrFollow(base, { key, watch, value, initial, reloaded })), [key, watch]);
  const theirs = base.theirs;
  useEffect(() => {
    if (!theirs) return undefined;
    // The base stays as it is while this form is registered: every step that changes it changes `theirs` too.
    const form: HeldForm = { loadTheirs: () => apply(heldChoice(base, "theirs")), keepMine: () => apply(heldChoice(base, "mine")) };
    heldForms.update((all) => [...all, form]);
    return () => heldForms.update((all) => all.filter((f) => f !== form));
  }, [theirs]);
}

/**
 * Whether a write may go: with no form holding edits over a change made elsewhere it may; with one,
 * the user is asked, and saving keeps theirs out (Keep mine). Declined, the write isn't sent.
 */
export async function confirmOverwrite(app: Pick<App, "host">): Promise<boolean> {
  const forms = heldForms.get();
  if (forms.length === 0) return true;
  if (!(await app.host.confirm("Save over the other change", "This item changed in another window, or an outside agent changed it, while you were editing it. Save yours over that change?", "warning", "Save mine"))) return false;
  for (const form of forms) form.keepMine();
  return true;
}

/** What a save the user declined answers, in place of the backend. */
export const NOT_SAVED: ErrorMessage = { lre: PROTOCOL_VERSION, type: "lre.error", reqId: null, code: "conflict", message: "Not saved: the change made elsewhere is kept." };

/** Build's bar notice while a form holds edits over a change made elsewhere. */
export function ChangedElsewhere() {
  const forms = useSelect(heldForms, (all) => all);
  if (forms.length === 0) return null;
  return (
    <div class="lre-banner warn" data-lre-changed-elsewhere>
      This item changed elsewhere while you were editing it.{" "}
      <button type="button" class="lre-btn small" onClick={() => forms.forEach((f) => f.loadTheirs())}>
        Load theirs
      </button>{" "}
      <button type="button" class="lre-btn small ghost" onClick={() => forms.forEach((f) => f.keepMine())}>
        Keep mine
      </button>
    </div>
  );
}
