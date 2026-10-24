// Build → Lore, World Info (DESIGN §4.2): the books the world reads lore from live, beside a chat's
// own books and the user's global ones, and LRE's fields on a book's entries. A secret entry is stored
// switched off: the engine switches it on for a prompt, and its helpers read it, only once its gate
// holds; its audience names the helpers that may read it before then. The list of lore books is part
// of the world (each change goes to the draft at once; a chat uses it once committed and Upgraded);
// an entry's fields are its book's, written to it at once and read from it every turn.

import { useEffect, useId, useMemo, useState } from "preact/hooks";
import { LORE_AUDIENCE, loreBooksOf, loreIsSecret, PROSE_STEPS, type BookLoreFields } from "../../shared/lore";
import type { LoreBookEntryView, LoreBookView } from "../../shared/protocol";
import type { StepPurpose } from "../../shared/world";
import { useApp } from "../app";
import { Badge, Banner, Button, IconButton, Section, useBusy } from "../components";
import { ActionRow, ActionRows } from "../gm/ui";
import { STEP_LABEL } from "../settings/steps";
import { useSelect } from "../store";
import { draftSend } from "./draft";
import { CheckField, Issues } from "./form-kit";
import { lintAt } from "./schema-form";
import { TagListInput } from "./selector-editor";

/** The user's World Info books, the engine's own left out, once loaded. */
function useBooks(): LoreBookView[] | null {
  const app = useApp();
  const [books, setBooks] = useState<LoreBookView[] | null>(null);
  useEffect(() => {
    void app.request({ type: "lre.lore", op: "books" }).then((body) => setBooks(body?.books ?? []));
  }, []);
  return books;
}

/** The world's lore books: each read live as lore by the helpers and minds, a gone one marked. */
export function LoreBooksSection() {
  const app = useApp();
  const draft = useSelect(app.drafts, (d) => d);
  const send = useMemo(() => draftSend(app), [app]);
  const [busy, run] = useBusy();
  const books = useBooks();
  const [choice, setChoice] = useState("");
  const pickId = useId();
  if (!draft) return null;
  const listed = loreBooksOf(draft.doc);
  const save = (next: string[]) =>
    run(async () => {
      await send({ type: "lre.editor", worldId: draft.worldId, base: draft.base, op: "set", part: "meta", value: { loreBooks: next } });
      setChoice("");
    });
  return (
    <div data-lre-lore-books>
      <Section title="Lore books" aside={listed.length > 0 ? <Badge>{listed.length}</Badge> : undefined}>
        <div class="lre-stack">
          <p class="lre-build-note">The helpers and minds read these World Info books as lore, live, beside the books attached to a chat and your global books. A character's or persona's book is read only when it is listed here. Commit, then Upgrade a chat, to use a change in it.</p>
          {listed.length > 0 ? (
            <ActionRows label="Lore books">
              {listed.map((id) => {
                const name = books?.find((b) => b.id === id)?.name;
                const missing = books !== null && name === undefined;
                return (
                  <ActionRow
                    key={id}
                    title={name ?? id}
                    subtitle={missing ? "This book no longer exists, so nothing reads it: remove it." : undefined}
                    value={missing ? <Badge tone="neg">Missing</Badge> : undefined}
                    actions={<IconButton icon="close" label={`Remove ${name ?? id}`} disabled={busy} onClick={() => save(listed.filter((b) => b !== id))} />}
                  />
                );
              })}
            </ActionRows>
          ) : null}
          <Issues issues={lintAt(draft.lint, "loreBooks")} />
          <div class="lre-form-pins-add">
            <label for={pickId}>Add a book</label>
            <select id={pickId} class="lre-input" value={choice} onChange={(event) => setChoice(event.currentTarget.value)}>
              <option value="">{books === null ? "Loading books…" : "Choose a book"}</option>
              {(books ?? [])
                .filter((b) => !listed.includes(b.id))
                .map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
            </select>
            <div class="lre-form-pins-actions">
              <Button variant="primary" icon="plus" disabled={choice === "" || busy} onClick={() => save([...listed, choice])}>
                Add
              </Button>
            </div>
          </div>
        </div>
      </Section>
    </div>
  );
}

/** One entry's LRE fields, edited until saved to its book. */
function EntryFields(props: { entry: LoreBookEntryView; busy: boolean; onSave(fields: BookLoreFields | null): void }) {
  const [fields, setFields] = useState<BookLoreFields>(props.entry.lore ?? {});
  const gateId = useId();
  const visibilityId = useId();
  const audienceLabel = useId();
  useEffect(() => setFields(props.entry.lore ?? {}), [props.entry.id, JSON.stringify(props.entry.lore ?? {})]);
  const secret = loreIsSecret(fields);
  const audience = fields.audience ?? [];
  const prose = audience.filter((p) => PROSE_STEPS.includes(p));
  const set = (patch: Partial<BookLoreFields>): void => setFields({ ...fields, ...patch });
  const toggle = (purpose: StepPurpose): void => set({ audience: audience.includes(purpose) ? audience.filter((p) => p !== purpose) : LORE_AUDIENCE.filter((p) => p === purpose || audience.includes(p)) });
  return (
    <div class="lre-form-lore-fields" data-lre-book-entry={props.entry.id}>
      <CheckField label="Make this entry secret" help="It is stored switched off: it reaches no prompt and no helper until its gate holds." checked={secret} onChange={(on) => set({ secret: on })} />
      {secret ? (
        <>
          <div class="lre-field">
            <label class="label" for={gateId}>
              Gate
            </label>
            <input id={gateId} class="lre-input" value={fields.gate ?? ""} placeholder="stage.keeper == 'revealed'" onInput={(event) => set({ gate: event.currentTarget.value })} />
            <span class="lre-field-help">When it may be read: a formula on the world's state</span>
          </div>
          <div class="lre-field" role="group" aria-labelledby={audienceLabel}>
            <span class="label" id={audienceLabel}>
              Helpers that may read it before the gate holds
            </span>
            {LORE_AUDIENCE.map((purpose) => (
              <CheckField key={purpose} label={STEP_LABEL[purpose]} help={PROSE_STEPS.includes(purpose) ? "Writes for the player: never reads a secret" : undefined} checked={audience.includes(purpose)} onChange={() => toggle(purpose)} />
            ))}
          </div>
          {prose.length > 0 ? <Banner tone="warn">{prose.map((p) => STEP_LABEL[p]).join(", ")} write what the narrator or the player sees, so they never read this secret before its gate holds.</Banner> : null}
          <TagListInput label="Holders" noun="character id" value={fields.holders ?? []} suggestions={[]} onChange={(next) => set({ holders: next })}>
            <span class="lre-field-help">Characters whose own secret it is: their minds read it</span>
          </TagListInput>
        </>
      ) : null}
      <div class="lre-field">
        <label class="label" for={visibilityId}>
          Who may read it
        </label>
        <select id={visibilityId} class="lre-input" value={fields.visibility ?? "public"} onChange={(event) => set({ visibility: event.currentTarget.value === "known_by" ? "known_by" : "public" })}>
          <option value="public">Anyone</option>
          <option value="known_by">Known by: once your character knows everyone and everywhere it links</option>
        </select>
      </div>
      <TagListInput label="Links" noun="id" value={fields.links ?? []} suggestions={[]} onChange={(next) => set({ links: next })}>
        <span class="lre-field-help">The people and places it is about</span>
      </TagListInput>
      <TagListInput label="Aliases" noun="alias" value={fields.aliases ?? []} suggestions={[]} onChange={(next) => set({ aliases: next })}>
        <span class="lre-field-help">Other names it goes by</span>
      </TagListInput>
      <div class="lre-form-pins-actions">
        <Button variant="primary" disabled={props.busy} onClick={() => props.onSave(fields)}>
          Save to the book
        </Button>
        {props.entry.lore ? (
          <Button variant="ghost" disabled={props.busy} onClick={() => props.onSave(null)}>
            Take the fields off
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** LRE's fields on one book's entries, written to the book at once. */
export function BookEntriesSection() {
  const app = useApp();
  const books = useBooks();
  const [busy, run] = useBusy();
  const [book, setBook] = useState("");
  const [entries, setEntries] = useState<LoreBookEntryView[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const bookId = useId();
  useEffect(() => {
    setEntries(null);
    setOpen(null);
    if (book === "") return;
    void app.request({ type: "lre.lore", op: "entries", bookId: book }).then((body) => setEntries(body?.entries ?? []));
  }, [book]);
  const save = (entryId: string, fields: BookLoreFields | null) =>
    run(async () => {
      const body = await app.request({ type: "lre.lore", op: "fields", bookId: book, entryId, fields });
      if (body?.entries) setEntries(body.entries);
    });
  const shown = entries?.find((e) => e.id === open) ?? null;
  return (
    <div data-lre-book-entries>
      <Section title="World Info entries">
        <div class="lre-stack">
          <p class="lre-build-note">An entry of a book the chat reads is lore as it is. Give it the fields a world entry has, or make it secret: it stays switched off, out of every prompt and helper, until its gate holds.</p>
          <label for={bookId}>Book</label>
          <select id={bookId} class="lre-input" value={book} onChange={(event) => setBook(event.currentTarget.value)}>
            <option value="">{books === null ? "Loading books…" : books.length === 0 ? "No World Info books" : "Choose a book"}</option>
            {(books ?? []).map((b) => (
              <option key={b.id} value={b.id}>
                {b.attached ? `${b.name} (in this chat)` : b.name}
              </option>
            ))}
          </select>
          {entries && entries.length > 0 ? (
            <ActionRows label="Entries">
              {entries.map((e) => (
                <ActionRow
                  key={e.id}
                  title={e.title}
                  value={e.lore && loreIsSecret(e.lore) ? <Badge tone="gm">Secret</Badge> : e.lore ? <Badge>Lore fields</Badge> : e.disabled ? <Badge>Off in its book</Badge> : undefined}
                  actions={<IconButton icon={open === e.id ? "close" : "edit"} label={open === e.id ? `Close ${e.title}` : `Edit ${e.title}'s lore fields`} onClick={() => setOpen(open === e.id ? null : e.id)} />}
                />
              ))}
            </ActionRows>
          ) : null}
          {shown ? <EntryFields entry={shown} busy={busy} onSave={(fields) => save(shown.id, fields)} /> : null}
        </div>
      </Section>
    </div>
  );
}
