// Who may enter a place (ORG-SPEC §3.9): one place's entry as an organization's Property → Premises
// and GM → Places show it (who may enter, now, hours, keys and who carries them, and the latest
// entries without leave), and the form that changes it: who may enter, from the owner only to anyone
// or as the world has it, and, for the GM, its keys as text. What a change sends is the args of the
// orgs pack's `orgs.entry` (the GM's edit; a member's `org_entry` takes the same `entry`), with only
// what it changes.

import type { JsonObject } from "../shared/json";
import { AS_THE_WORLD, AUDIENCES, ENTRY_WORDS, NO_KEYS, ORGS_ENTRY, type Audience } from "../shared/org";
import type { EditOp } from "../shared/protocol";
import type { PremiseView } from "../shared/org-view";
import { Button, Field, Row } from "./components";

/** A change of a place's entry being made: who may enter (`default`: as the world has it), and its keys as text, between commas. */
export interface EntryDraft {
  place: string;
  entry: Audience | typeof AS_THE_WORLD;
  keys: string;
}

/** The form for a place as it stands: the entry play set on it (else as the world has it), and its keys. */
export function entryDraft(p: PremiseView): EntryDraft {
  return { place: p.id, entry: p.playEntry ?? AS_THE_WORLD, keys: p.keysSet.join(", ") };
}

/**
 * What a draft changes, as `orgs.entry`'s args: `place`, with `entry` and `keys` only when they
 * change (keys cleared: `none`; `default` typed puts the world's back); null when it changes nothing.
 */
export function entryArgs(p: PremiseView, draft: EntryDraft): JsonObject | null {
  const before = entryDraft(p);
  const keys = draft.keys
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k !== "");
  const args: JsonObject = { place: p.id };
  if (draft.entry !== before.entry) args.entry = draft.entry;
  if (keys.join(", ") !== before.keys) args.keys = keys.length === 0 ? NO_KEYS : keys.join(",");
  return Object.keys(args).length > 1 ? args : null;
}

/** The GM's change of a place's entry and keys: one `orgs.entry` effect, its History line on `org` when given (else on every organization holding the place); none when it changes nothing. */
export function entryOps(p: PremiseView, draft: EntryDraft, org?: string): EditOp[] {
  const args = entryArgs(p, draft);
  return args === null ? [] : [{ op: "effect", effect: ORGS_ENTRY, args: org === undefined ? args : { ...args, org } }];
}

/** Who carries a key, in words: the names the reader may see, and the rest counted. */
export function carrierWords(p: PremiseView): string | null {
  const names = p.carriers.map((c) => c.name);
  if (p.hiddenCarriers > 0) names.push(p.hiddenCarriers === 1 ? "someone else" : `${p.hiddenCarriers} others`);
  return names.length > 0 ? names.join(", ") : null;
}

/** One place's entry, read only: who may enter (and where that is set, when a place around it sets it), now, hours, keys, who carries one, and the latest entries without leave. */
export function PremiseRows(props: { place: PremiseView }) {
  const p = props.place;
  const carried = carrierWords(p);
  return (
    <div class="lre-stack" data-lre-premise-rows={p.id}>
      <Row k="Who may enter" v={p.words} sub={p.from !== null ? `As ${p.from} sets it` : undefined} />
      <Row k="Now" v={p.now} />
      {p.hours !== null ? <Row k="Hours" v={p.hours} /> : null}
      <Row k="Keys" v={p.keys.length > 0 ? p.keys.join(", ") : "None"} tone={p.keys.length > 0 ? undefined : "muted"} />
      {carried !== null ? <Row k="Carried by" v={carried} /> : null}
      {p.trespass.length > 0 ? (
        <div class="lre-stack" data-lre-premise-trespass={p.id}>
          <span class="lre-small lre-muted">Entered without leave</span>
          {p.trespass.map((t, i) => (
            <Row key={`${t.at}:${i}`} k={t.who} v={t.at} tone="warn" />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** The Change entry form: who may enter, and the keys when `keys` (the GM's); Save sends only once it changes something. */
export function EntryForm(props: { place: PremiseView; draft: EntryDraft; keys: boolean; busy: boolean; onDraft(draft: EntryDraft): void; onSave(): void; onCancel(): void }) {
  const { place, draft } = props;
  const changed = entryArgs(place, draft) !== null;
  return (
    <form
      class="lre-stack"
      data-lre-entry-form={place.id}
      onSubmit={(event) => {
        event.preventDefault();
        if (changed) props.onSave();
      }}
    >
      <Field label="Who may enter">
        <select class="lre-input" aria-label={`Who may enter ${place.name}`} value={draft.entry} disabled={props.busy} onChange={(event) => props.onDraft({ ...draft, entry: event.currentTarget.value as EntryDraft["entry"] })}>
          <option value={AS_THE_WORLD}>As the world has it</option>
          {AUDIENCES.map((a) => (
            <option key={a} value={a}>
              {ENTRY_WORDS[a]}
            </option>
          ))}
        </select>
      </Field>
      {props.keys ? (
        <Field label="Keys" help={`Item ids or item types, between commas; empty for no keys, ${AS_THE_WORLD} for the world's.`}>
          <input class="lre-input" type="text" aria-label={`Keys to ${place.name}`} value={draft.keys} disabled={props.busy} onInput={(event) => props.onDraft({ ...draft, keys: event.currentTarget.value })} />
        </Field>
      ) : null}
      {!changed ? <span class="lre-small lre-muted">It is so already.</span> : null}
      <Button type="submit" variant="primary" block disabled={props.busy || !changed}>
        Save
      </Button>
      <Button variant="ghost" block disabled={props.busy} onClick={props.onCancel}>
        Cancel
      </Button>
    </form>
  );
}
