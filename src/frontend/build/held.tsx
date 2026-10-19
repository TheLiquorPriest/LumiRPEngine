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

interface Base<T> {
  key: string;
  watch: string;
  /** The JSON of the draft's value the form's edits were made over. */
  from: string;
  /** The draft's newer value, while the form keeps its edits over it. */
  theirs: { value: T; json: string } | null;
}

/**
 * Keeps a form's `value` (with its setter) over `initial`, the draft's value of what it edits: `key`
 * names that item (another key is another item, which the form simply loads), and `watch` changes
 * when the draft's value does (its JSON by default).
 */
export function useHeld<T>(value: T, set: (next: T) => void, initial: T, key: string, watch: string = JSON.stringify(initial)): void {
  const reloaded = useSelect(useApp().drafts, (d) => d?.reloaded === true);
  const [base, setBase] = useState<Base<T>>(() => ({ key, watch, from: JSON.stringify(initial), theirs: null }));
  useEffect(() => {
    if (key === base.key && watch === base.watch) return;
    const mine = JSON.stringify(value);
    const next = JSON.stringify(initial);
    // Another item, Build's own write, an untouched form, or one that already matches: the form follows the draft, as it always did.
    if (key !== base.key || !reloaded || mine === base.from || mine === next) {
      setBase({ key, watch, from: next, theirs: null });
      if (mine !== next) set(structuredClone(initial));
      return;
    }
    setBase({ ...base, watch, theirs: { value: initial, json: next } });
  }, [key, watch]);
  const theirs = base.theirs;
  useEffect(() => {
    if (!theirs) return undefined;
    const form: HeldForm = {
      loadTheirs: () => {
        setBase({ key, watch: base.watch, from: theirs.json, theirs: null });
        set(structuredClone(theirs.value));
      },
      keepMine: () => setBase({ key, watch: base.watch, from: theirs.json, theirs: null }),
    };
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
