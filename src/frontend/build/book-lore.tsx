// Build → Lore, World Info (DESIGN §4.2): the books the world reads lore from live, beside a chat's
// own books and the user's global ones, and LRE's fields on a book's entries. A secret entry is stored
// switched off: the engine switches it on for a prompt, and its helpers read it, only once its gate
// holds; its audience names the helpers that may read it before then. The list of lore books is part
// of the world (each change goes to the draft at once; a chat uses it once committed and Upgraded);
// an entry's fields are its book's, written to it at once and read from it every turn. They are
// edited as a world entry's are: the gate in the formula editor, checked as it is typed (`lre.lore
// check`, what Save would refuse) with examples made of the world's names, and holders and links
// picked by name. Books can share a name (a character's card brings its own copy of each book it
// carries), so every book picker names them by `bookLabels`.

import { useEffect, useId, useMemo, useRef, useState } from "preact/hooks";
import { hasOwn, type JsonValue } from "../../shared/json";
import { LORE_AUDIENCE, loreBooksOf, loreIsSecret, PROSE_STEPS, type BookLoreFields } from "../../shared/lore";
import type { LintIssue, LoreBookEntryView, LoreBookView } from "../../shared/protocol";
import { STEP_LABEL } from "../../shared/steps";
import type { StepPurpose, TrackDef, WorldDoc } from "../../shared/world";
import { useApp } from "../app";
import { Badge, Banner, Button, IconButton, List, ListRow, Section, useBusy } from "../components";
import { ActionRow, ActionRows } from "../gm/ui";
import { useSelect } from "../store";
import { draftSend } from "./draft";
import { checkBalance } from "./expr-editor";
import { CheckField, Issues } from "./form-kit";
import { COLLECTION_SPECS, type FieldSpec } from "./schema";
import { FieldInput, lintAt, worldIdentifiers, type FormCtx } from "./schema-form";
import { kindIs, TagListInput } from "./selector-editor";

/** A moment the host recorded, in the user's own date (and time) format. */
function addedWords(seconds: number, time: boolean): string {
  const at = new Date(seconds * 1000);
  return time ? at.toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : at.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/**
 * Each book's name as a picker shows it, by id. Two books can share a name: a character's card
 * brings its own copy of each book it carries, beside the one imported on its own. A shared name
 * gets just what tells its books apart: whether a character brought it, then the day it was made,
 * then the time too, then its id. A book the chat has says so.
 */
export function bookLabels(books: readonly LoreBookView[]): Record<string, string> {
  const brought = (b: LoreBookView): string[] => (b.character ? ["came with a character"] : []);
  const added = (b: LoreBookView, time: boolean): string[] => (b.added === null ? [] : [`added ${addedWords(b.added, time)}`]);
  // From saying nothing to saying the id, which always tells books apart.
  const tellers: readonly ((b: LoreBookView) => string[])[] = [() => [], brought, (b) => [...brought(b), ...added(b, false)], (b) => [...brought(b), ...added(b, true)], (b) => [...brought(b), `id ${b.id}`]];
  const label = (b: LoreBookView, said: readonly string[]): string => `${said.length > 0 ? `${b.name} · ${said.join(", ")}` : b.name}${b.attached ? " (in this chat)" : ""}`;
  const groups = new Map<string, LoreBookView[]>();
  for (const b of books) {
    const key = b.name.trim().toLowerCase();
    groups.set(key, [...(groups.get(key) ?? []), b]);
  }
  const out: Record<string, string> = {};
  for (const group of groups.values()) {
    const tell = tellers.find((t) => new Set(group.map((b) => label(b, t(b)))).size === group.length);
    for (const b of group) out[b.id] = label(b, tell ? tell(b) : [`id ${b.id}`]);
  }
  return out;
}

/** The user's World Info books, the engine's own left out, those attached to the open chat marked, once loaded. */
function useBooks(): LoreBookView[] | null {
  const app = useApp();
  const [books, setBooks] = useState<LoreBookView[] | null>(null);
  useEffect(() => {
    const chatId = app.client.getState().chatId;
    void app.request({ type: "lre.lore", op: "books", ...(chatId ? { chatId } : {}) }).then((body) => setBooks(body?.books ?? []));
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
  const labels = useMemo(() => bookLabels(books ?? []), [books]);
  const [choice, setChoice] = useState("");
  const pickId = useId();
  if (!draft) return null;
  const listed = loreBooksOf(draft.doc);
  const save = (next: string[]) =>
    run(async () => {
      // Back to "Choose a book" before the added book leaves the choices: a select whose value is no longer one of them shows blank.
      setChoice("");
      await send({ type: "lre.editor", worldId: draft.worldId, base: draft.base, op: "set", part: "meta", value: { loreBooks: next } });
    });
  return (
    <div data-lre-lore-books>
      <Section title="Lore books" aside={listed.length > 0 ? <Badge>{listed.length}</Badge> : undefined}>
        <div class="lre-stack">
          <p class="lre-build-note">The helpers and minds read these World Info books as lore, live, beside the books attached to a chat and your global books. A character's or persona's book is read only when it is listed here. Commit, then Upgrade a chat, to use a change in it.</p>
          {listed.length > 0 ? (
            <ActionRows label="Lore books">
              {listed.map((id) => {
                const title = labels[id] ?? id;
                const missing = books !== null && !books.some((b) => b.id === id);
                return (
                  <ActionRow
                    key={id}
                    title={title}
                    subtitle={missing ? "This book no longer exists, so nothing reads it: remove it." : undefined}
                    value={missing ? <Badge tone="neg">Missing</Badge> : undefined}
                    actions={<IconButton icon="close" label={`Remove ${title}`} disabled={busy} onClick={() => save(listed.filter((b) => b !== id))} />}
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
                    {labels[b.id] ?? b.name}
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

/** "a", "a and b", "a, b and c". */
function listWords(words: readonly string[]): string {
  return words.length <= 1 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} and ${words.at(-1) ?? ""}`;
}

/**
 * The helpers a secret entry may let read it before its gate holds: every one but the steps that
 * write what the narrator or the player sees (`PROSE_STEPS`), which never read a secret whatever it
 * says. One an entry names from before is still offered, so it can be unticked.
 */
export function audienceChoices(audience: readonly StepPurpose[]): StepPurpose[] {
  return LORE_AUDIENCE.filter((p) => !PROSE_STEPS.includes(p) || audience.includes(p));
}

/** A secret entry's audience, a world entry's or a book entry's, with why some helpers aren't offered. */
export function SecretAudience(props: { audience: readonly StepPurpose[]; issues?: readonly LintIssue[]; onChange(next: StepPurpose[]): void }) {
  const labelId = useId();
  const named = props.audience.filter((p) => PROSE_STEPS.includes(p));
  const toggle = (purpose: StepPurpose): void => props.onChange(props.audience.includes(purpose) ? props.audience.filter((p) => p !== purpose) : LORE_AUDIENCE.filter((p) => p === purpose || props.audience.includes(p)));
  return (
    <div class="lre-field" role="group" aria-labelledby={labelId}>
      <span class="label" id={labelId}>
        Helpers that may read it before the gate holds
      </span>
      {audienceChoices(props.audience).map((purpose) => (
        <CheckField key={purpose} label={STEP_LABEL[purpose]} help={PROSE_STEPS.includes(purpose) ? "Writes for the player, so it never reads a secret: untick it" : undefined} checked={props.audience.includes(purpose)} onChange={() => toggle(purpose)} />
      ))}
      <span class="lre-field-help">{listWords(PROSE_STEPS.map((p) => STEP_LABEL[p]))} aren't offered: they write what the narrator or the player sees, so they never read a secret before its gate holds.</span>
      {named.length > 0 ? (
        <Banner tone="warn">
          {listWords(named.map((p) => STEP_LABEL[p]))} write{named.length === 1 ? "s" : ""} what the narrator or the player sees, so {named.length === 1 ? "it never reads" : "they never read"} this secret before its gate holds.
        </Banner>
      ) : null}
      {props.issues ? <Issues issues={props.issues} /> : null}
    </div>
  );
}

/** A gate to start from: its formula, and when it holds in words. */
export interface GateExample {
  formula: string;
  words: string;
}

/** An id a formula can quote as it is. */
const QUOTABLE = /^[^'"\\]+$/;

/**
 * Gates to start from, made of the world's own names: a quest at the stage it moves on to from its
 * start, the player's character knowing someone, and the player's character at the place the story
 * starts.
 */
export function gateExamples(doc: WorldDoc): GateExample[] {
  const out: GateExample[] = [];
  // The first stage a quest moves on to, else any but its start.
  const nextOf = (t: TrackDef): string | undefined => {
    const later = (sid: string): boolean => sid !== t.start && QUOTABLE.test(sid) && hasOwn(t.stages, sid);
    return (hasOwn(t.stages, t.start) ? t.stages[t.start]?.next.map((n) => n.to).find(later) : undefined) ?? Object.keys(t.stages).find(later);
  };
  const track = Object.values(doc.tracks)
    .filter((t) => QUOTABLE.test(t.id) && nextOf(t) !== undefined)
    .sort((a, b) => (a.label || a.id).localeCompare(b.label || b.id))[0];
  const stage = track ? nextOf(track) : undefined;
  if (track && stage !== undefined) {
    // The name form reads in the formula's readout as the track's stage; an id that isn't a name is quoted.
    const read = /^[A-Za-z_]\w*$/.test(track.id) ? `stage.${track.id}` : `stage('${track.id}')`;
    out.push({ formula: `${read} == '${stage}'`, words: `while “${track.label || track.id}” is at “${track.stages[stage]?.label || stage}”` });
  }
  const someone = Object.values(doc.entities)
    .filter((e) => e.id !== doc.pov && QUOTABLE.test(e.id) && kindIs(doc, e.kind, "person"))
    .sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id))[0];
  if (someone) out.push({ formula: `knows(pov, '${someone.id}')`, words: `once your character knows ${someone.name || someone.id}` });
  const start = doc.places[doc.start.place];
  if (start && QUOTABLE.test(start.id)) out.push({ formula: `at(pov, '${start.id}')`, words: `while your character is at ${start.name || start.id}` });
  return out;
}

/** The world's example gates as rows, each its formula over its words: tapping one puts it in the gate. */
export function GateExamples(props: { doc: WorldDoc; onPick(formula: string): void }) {
  const examples = useMemo(() => gateExamples(props.doc), [props.doc]);
  if (examples.length === 0) return null;
  return (
    <div class="lre-field">
      <span class="lre-field-help">For example, tap one to use it:</span>
      <List>
        {examples.map((x) => (
          <ListRow key={x.formula} icon="function" title={<span class="lre-expr-token">{x.formula}</span>} subtitle={x.words} onClick={() => props.onPick(x.formula)} />
        ))}
      </List>
    </div>
  );
}

/** One of world lore's own fields, so a book entry's are edited as a world entry's are. */
function loreSpec(key: string): FieldSpec {
  const spec = COLLECTION_SPECS.lore.find((s) => s.key === key);
  if (!spec) throw new Error(`world lore has no ${key} field`);
  return spec;
}
/** A secret's gate: shown only for a secret, which needs one, so not marked optional as the stored field is. */
export const SECRET_GATE_SPEC: FieldSpec = { kind: "expr", key: "gate", label: loreSpec("gate").label };
const HOLDERS_SPEC = loreSpec("holders");
const LINKS_SPEC = loreSpec("links");

/** A problem the backend words as a clause, as a sentence under its field. */
function sentence(text: string): string {
  const said = `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
  return /[.!?]$/.test(said) ? said : `${said}.`;
}

/**
 * What Save would refuse a secret entry's gate for (`lre.lore check`), asked a moment after each change
 * to it: null while it is fine, or while the entry isn't secret. An answer to an older gate is dropped.
 */
function useGateProblem(secret: boolean, gate: string): string | null {
  const app = useApp();
  const [problem, setProblem] = useState<string | null>(null);
  const asked = useRef(0);
  useEffect(() => {
    const ask = ++asked.current;
    if (!secret) {
      setProblem(null);
      return;
    }
    const timer = setTimeout(() => {
      void app.request({ type: "lre.lore", op: "check", fields: { secret: true, gate } }).then((body) => {
        if (ask === asked.current) setProblem(body?.problem ?? null);
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [secret, gate]);
  return problem;
}

/** The ids a by-name list picker answers, or none. */
function idsOf(value: JsonValue | undefined): string[] | undefined {
  const ids = Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  return ids.length > 0 ? ids : undefined;
}

/**
 * One entry's LRE fields, edited as a world entry's are until saved to its book. Its twins, entries of
 * the same text anywhere in the user's books, go with its secrecy, and the form names them by their
 * books' `labels`; a twin kept secret as a copy is changed through the secret it follows, and says so.
 */
function EntryFields(props: { entry: LoreBookEntryView; doc: WorldDoc; functions: readonly string[]; labels: Readonly<Record<string, string>>; busy: boolean; onSave(fields: BookLoreFields | null): void }) {
  const [fields, setFields] = useState<BookLoreFields>(props.entry.lore ?? {});
  const visibilityId = useId();
  useEffect(() => setFields(props.entry.lore ?? {}), [props.entry.id, JSON.stringify(props.entry.lore ?? {})]);
  const secret = loreIsSecret(fields);
  const gate = fields.gate ?? "";
  const problem = useGateProblem(secret, gate);
  // The formula editor says itself when a bracket or a quote is left open; the check would say it again.
  const balanced = checkBalance(gate).ok;
  const refused = secret && (!balanced || problem !== null);
  const identifiers = useMemo(() => worldIdentifiers(props.doc), [props.doc]);
  const issues: LintIssue[] = secret && balanced && problem !== null ? [{ severity: "error", path: "book.gate", code: "gate", message: sentence(problem) }] : [];
  const ctx: FormCtx = { doc: props.doc, lint: issues, path: "book", identifiers, functions: props.functions };
  const set = (patch: Partial<BookLoreFields>): void => setFields({ ...fields, ...patch });
  const bookOf = (bookId: string): string => `“${props.labels[bookId] ?? "another book"}”`;
  const copy = props.entry.copyOf;
  if (copy?.kept) {
    return (
      <div class="lre-form-lore-fields" data-lre-book-entry={props.entry.id}>
        <Banner tone="info">The same text is secret in {bookOf(copy.bookId)}, so this entry is kept off with it: it comes on for a prompt once that one's gate holds, and back on for good when that one is made public. Change its secrecy there.</Banner>
      </div>
    );
  }
  const twins = [...new Set((props.entry.twins ?? []).map((t) => bookOf(t.bookId)))];
  return (
    <div class="lre-form-lore-fields" data-lre-book-entry={props.entry.id}>
      {copy ? <Banner tone="info">It was kept secret with the same text in {bookOf(copy.bookId)}, which is no longer secret there: make it public here to switch it back on.</Banner> : null}
      <CheckField label="Make this entry secret" help="It is stored switched off: it reaches no prompt and no helper until its gate holds." checked={secret} onChange={(on) => set({ secret: on })} />
      {/* Its twins go with it, whichever book a chat scans: say which before and after. */}
      {twins.length > 0 ? <p class="lre-build-note" data-lre-book-twins>{props.entry.lore && loreIsSecret(props.entry.lore) ? `The same text in ${listWords(twins)} is kept off with it, and comes back on with it.` : `The same text is in ${listWords(twins)}: making this entry secret keeps ${twins.length === 1 ? "that one" : "those"} off too, and making it public again switches them back on.`}</p> : null}
      {secret ? (
        <>
          <FieldInput spec={SECRET_GATE_SPEC} value={fields.gate} ctx={ctx} path={ctx.path} parent={{}} onChange={(next) => set({ gate: typeof next === "string" && next !== "" ? next : undefined })} />
          {/* Examples while there is no gate, or one that doesn't read: the shape to follow. */}
          {gate.trim() === "" || refused ? <GateExamples doc={props.doc} onPick={(formula) => set({ gate: formula })} /> : null}
          <FieldInput spec={HOLDERS_SPEC} value={fields.holders} ctx={ctx} path={ctx.path} parent={{}} onChange={(next) => set({ holders: idsOf(next) })} />
          <SecretAudience audience={fields.audience ?? []} onChange={(next) => set({ audience: next.length > 0 ? next : undefined })} />
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
      <FieldInput spec={LINKS_SPEC} value={fields.links} ctx={ctx} path={ctx.path} parent={{}} onChange={(next) => set({ links: idsOf(next) })} />
      <TagListInput label="Aliases" noun="alias" value={fields.aliases ?? []} suggestions={[]} onChange={(next) => set({ aliases: next })}>
        <span class="lre-field-help">Other names it goes by</span>
      </TagListInput>
      <div class="lre-form-pins-actions">
        <Button variant="primary" disabled={props.busy || refused} onClick={() => props.onSave(fields)}>
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
  const draft = useSelect(app.drafts, (d) => d);
  const books = useBooks();
  const labels = useMemo(() => bookLabels(books ?? []), [books]);
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
  if (!draft) return null;
  const save = (entryId: string, fields: BookLoreFields | null) =>
    run(async () => {
      const body = await app.request({ type: "lre.lore", op: "fields", bookId: book, entryId, fields });
      if (body?.entries) setEntries(body.entries);
    });
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
                {labels[b.id] ?? b.name}
              </option>
            ))}
          </select>
          {entries && entries.length > 0 ? (
            <ActionRows label="Entries">
              {entries.map((e) => (
                <ActionRow
                  key={e.id}
                  title={e.title}
                  subtitle={e.copyOf?.kept ? `Kept off with the same text in “${labels[e.copyOf.bookId] ?? "another book"}”` : undefined}
                  value={e.lore && loreIsSecret(e.lore) ? <Badge tone="gm">Secret</Badge> : e.lore ? <Badge>Lore fields</Badge> : e.disabled ? <Badge>Off in its book</Badge> : undefined}
                  actions={<IconButton icon={open === e.id ? "close" : "edit"} label={open === e.id ? `Close ${e.title}` : `Edit ${e.title}'s lore fields`} onClick={() => setOpen(open === e.id ? null : e.id)} />}
                >
                  {/* Open under its own row, so a long book's entry is edited where it was tapped. */}
                  {open === e.id ? <EntryFields entry={e} doc={draft.doc} functions={draft.functions} labels={labels} busy={busy} onSave={(fields) => save(e.id, fields)} /> : null}
                </ActionRow>
              ))}
            </ActionRows>
          ) : null}
        </div>
      </Section>
    </div>
  );
}
