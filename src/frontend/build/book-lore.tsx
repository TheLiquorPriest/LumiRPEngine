// Build → Lore, World Info (DESIGN §4.2): the books the world reads lore from live, beside a chat's
// own books and the user's global ones, and LRE's say in a book's entries. The list of lore books is
// part of the world (each change goes to the draft at once; a chat uses it once committed and
// Upgraded). An entry's own fields (Known by, links, aliases) and its secret marks
// (`shared/secret-marks.ts`) are its book's: LRE writes them into the book only when the user presses
// for it here, and reads them from it every turn. A mark's names are picked by name and checked as
// every writer checks them (`secretMarkProblem`) before they are sent. An earlier build's secrecy
// fields are shown as they stand, never written: they move to marks with the rest of their book's
// secrecy on the secrecy page. Books can share a name (a character's card brings its own copy of each
// book it carries), so every book picker names them by `bookLabels`.

import { useEffect, useId, useMemo, useState } from "preact/hooks";
import { hasOwn, type JsonValue } from "../../shared/json";
import { LORE_AUDIENCE, loreBooksOf, loreIsSecret, OLD_SECRECY_FIELDS, PROSE_STEPS, type BookFieldsEdit, type BookLoreFields } from "../../shared/lore";
import type { LintIssue, LoreBookEntryView, LoreBookView, LoreMarkChange, LoreMarkView } from "../../shared/protocol";
import { markNameIssues, resolveMarkNames, secretMarkProblem } from "../../shared/secret-marks";
import { STEP_LABEL } from "../../shared/steps";
import type { StepPurpose, TrackDef, WorldDoc } from "../../shared/world";
import { useApp } from "../app";
import { Badge, Banner, Button, IconButton, List, ListRow, Row, Section, useBusy } from "../components";
import { ActionRow, ActionRows } from "../gm/ui";
import { useSelect } from "../store";
import { draftSend } from "./draft";
import { CheckField, FormGroup, Issues } from "./form-kit";
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
const LINKS_SPEC = loreSpec("links");
/** A mark's holders, picked as a world entry's holders are: the picker answers entity ids, which a mark reads as names. */
const KNOWN_TO_SPEC: FieldSpec = { kind: "refs", key: "knownTo", label: "Known to", collections: ["entities"] };
const KEPT_FROM_SPEC: FieldSpec = { kind: "refs", key: "keptFrom", label: "The people it is kept from", collections: ["entities"] };
const SECRET_LINE_SPEC: FieldSpec = { kind: "text", key: "text", label: "The secret line", multiline: true };

/** A problem the shared checks word as a clause, as a sentence under its field. */
function sentence(text: string): string {
  const said = `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
  return /[.!?]$/.test(said) ? said : `${said}.`;
}

/** The ids a by-name list picker answers, or none. */
function idsOf(value: JsonValue | undefined): string[] | undefined {
  const ids = Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  return ids.length > 0 ? ids : undefined;
}

/** A mark's names as Build edits them: whom it is known to, and whom it is kept from: everyone but those who know it, or the people picked. */
interface MarkNames {
  knownTo: string[];
  keptFrom: string[] | "everyone";
}

const NO_NAMES: MarkNames = { knownTo: [], keptFrom: "everyone" };

/**
 * A mark's names as the pickers hold them: each that names one of the world's people as its id, each
 * that names no one (or more than one) as written, so changing the names keeps it unless it is removed.
 */
function pickedNames(doc: WorldDoc, names: readonly string[]): string[] {
  const resolved = resolveMarkNames(doc, null, { knownTo: [...names], keptFrom: "everyone" });
  return [...resolved.knownTo, ...resolved.unresolved];
}

/** A mark's names in words: a person's name for one the world has, any other as written. */
function namesWords(doc: WorldDoc, names: readonly string[]): string {
  return listWords(pickedNames(doc, names).map((n) => (hasOwn(doc.entities, n) ? doc.entities[n]?.name || n : n)));
}

/** Whom a mark is known to and kept from, in words. */
function markWho(doc: WorldDoc, mark: Pick<LoreMarkView, "knownTo" | "keptFrom">): string {
  const known = mark.knownTo.length > 0 ? `Known to ${namesWords(doc, mark.knownTo)}` : null;
  const kept = mark.keptFrom === "everyone" ? [] : mark.keptFrom;
  const everyone = kept.length === 0;
  if (known === null) return everyone ? "Kept from everyone" : `Kept from ${namesWords(doc, kept)}`;
  return `${known}; ${everyone ? "kept from everyone else" : `kept from ${namesWords(doc, kept)}`}`;
}

/**
 * Text any mark may hold, to ask `secretMarkProblem` about names alone: Make secret marks the entry's
 * own text, which Build doesn't hold, so what its text can't be is the backend's to answer.
 */
const ANY_TEXT = "secret";

/** Why a mark can't be written with these names and this text, or null. */
function markProblem(names: MarkNames, text: string): string | null {
  if (names.keptFrom !== "everyone" && names.keptFrom.length === 0) return "pick whom it is kept from, or keep it from everyone but those who know it";
  return secretMarkProblem({ text, knownTo: names.knownTo, keptFrom: names.keptFrom });
}

/** A mark's names, picked: who knows it, and whom it is kept from. */
function MarkNamesFields(props: { names: MarkNames; ctx: FormCtx; problem: string | null; onChange(next: MarkNames): void }) {
  const keptId = useId();
  const { names, ctx } = props;
  const picked = names.keptFrom !== "everyone";
  const all = [...names.knownTo, ...(names.keptFrom === "everyone" ? [] : names.keptFrom)];
  return (
    <>
      <FieldInput spec={KNOWN_TO_SPEC} value={names.knownTo} ctx={ctx} path={ctx.path} parent={{}} onChange={(next) => props.onChange({ ...names, knownTo: idsOf(next) ?? [] })} />
      <div class="lre-field">
        <label class="label" for={keptId}>
          Kept from
        </label>
        <select id={keptId} class="lre-input" value={picked ? "picked" : "everyone"} onChange={(event) => props.onChange({ ...names, keptFrom: event.currentTarget.value === "picked" ? [] : "everyone" })}>
          <option value="everyone">Everyone but those who know it</option>
          <option value="picked">Only the people picked</option>
        </select>
      </div>
      {picked ? <FieldInput spec={KEPT_FROM_SPEC} value={names.keptFrom} ctx={ctx} path={ctx.path} parent={{}} onChange={(next) => props.onChange({ ...names, keptFrom: idsOf(next) ?? [] })} /> : null}
      {/* A name from the entry's text that names no one in the world is kept as written. */}
      {all.some((n) => !hasOwn(ctx.doc.entities, n)) ? <p class="lre-build-note">A name marked missing names no one in this world, or more than one person: the mark keeps it as written. Remove it, or leave it for someone the story adds.</p> : null}
      {props.problem !== null ? <Issues issues={[{ severity: "error", path: "mark", code: "mark", message: sentence(props.problem) }]} /> : null}
    </>
  );
}

/** One mark of an entry: its text and who knows it, with a warning for a name that names no one or more than one person, made public or given other names on the user's press. */
function MarkRow(props: { mark: LoreMarkView; index: number; ctx: FormCtx; busy: boolean; onMark(change: LoreMarkChange, done: () => void): void }) {
  const { mark, index, ctx } = props;
  const [names, setNames] = useState<MarkNames | null>(null);
  const problem = names ? markProblem(names, mark.text) : null;
  const issues = markNameIssues(ctx.doc, null, mark, `mark.${index}`);
  const open = (): void => setNames({ knownTo: pickedNames(ctx.doc, mark.knownTo), keptFrom: mark.keptFrom === "everyone" ? "everyone" : pickedNames(ctx.doc, mark.keptFrom) });
  return (
    <ActionRow
      title={mark.text}
      subtitle={markWho(ctx.doc, mark)}
      tone={issues.length > 0 ? "warn" : undefined}
      value={issues.length > 0 ? <Badge tone="warn">Check its names</Badge> : undefined}
      actions={
        <>
          <Button size="sm" variant="ghost" disabled={props.busy} onClick={() => (names ? setNames(null) : open())}>
            {names ? "Cancel" : "Change names"}
          </Button>
          <Button size="sm" disabled={props.busy} onClick={() => props.onMark({ kind: "public", mark: index }, () => setNames(null))}>
            Make public
          </Button>
        </>
      }
    >
      {issues.length > 0 ? <Issues issues={issues} /> : null}
      {names ? (
        <div class="lre-stack">
          <MarkNamesFields names={names} ctx={ctx} problem={problem} onChange={setNames} />
          <div class="lre-form-pins-actions">
            <Button variant="primary" disabled={props.busy || problem !== null} onClick={() => props.onMark({ kind: "names", mark: index, knownTo: names.knownTo, keptFrom: names.keptFrom }, () => setNames(null))}>
              Save the names
            </Button>
          </div>
        </div>
      ) : null}
    </ActionRow>
  );
}

/**
 * An earlier build's secrecy fields on an entry, as they stand: never written again, and counted only
 * while the entry's text holds no mark. They move to marks with the rest of the book's secrecy.
 */
function OldSecrecy(props: { lore: BookLoreFields; marked: boolean; doc: WorldDoc }) {
  const { lore, doc } = props;
  const secret = loreIsSecret(lore);
  const who = (ids: readonly string[]): string => listWords(ids.map((id) => (hasOwn(doc.entities, id) ? doc.entities[id]?.name || id : id)));
  const standing = props.marked
    ? "Its text holds secret marks, so these fields no longer count: its marks say who knows what."
    : secret
      ? "An earlier build keeps this entry secret by these fields, stored switched off: it reaches no prompt until its gate holds."
      : "These fields aren't set to secret, so they keep nothing back.";
  return (
    <FormGroup title="Secrecy from an earlier build">
      <p class="lre-build-note">{standing} They can't be changed here: the book's secrecy moves to secret marks on the secrecy page in Build → Lore.</p>
      <Row k="Secret" v={secret ? "Yes" : "No"} />
      {lore.gate !== undefined && lore.gate.trim() !== "" ? <Row k="Gate" v={<span class="lre-expr-token">{lore.gate}</span>} /> : null}
      {lore.holders && lore.holders.length > 0 ? <Row k="Whose own secret it is" v={who(lore.holders)} /> : null}
      {lore.audience && lore.audience.length > 0 ? <Row k="Helpers that may read it before the gate holds" v={listWords(lore.audience.map((p) => STEP_LABEL[p]))} /> : null}
    </FormGroup>
  );
}

/** An entry's own fields, the ones Build's Save writes. */
function ownFields(lore: BookLoreFields | undefined): BookFieldsEdit {
  return { ...(lore?.visibility ? { visibility: lore.visibility } : {}), ...(lore?.links ? { links: lore.links } : {}), ...(lore?.aliases ? { aliases: lore.aliases } : {}) };
}

/**
 * One World Info entry as LRE reads it, each change written to its book on the user's press: its own
 * fields, edited as a world entry's are until saved; its secret marks, each made public or given other
 * names; Make secret and Add a secret line. An entry an earlier build keeps secret by its fields, or
 * switched off as a copy of one, takes no mark until its book's secrecy moves to marks.
 */
function EntryFields(props: { entry: LoreBookEntryView; doc: WorldDoc; functions: readonly string[]; labels: Readonly<Record<string, string>>; busy: boolean; onSave(fields: BookFieldsEdit | null): void; onMark(change: LoreMarkChange, done: () => void): void }) {
  const { entry } = props;
  const [fields, setFields] = useState<BookFieldsEdit>(ownFields(entry.lore));
  const [adding, setAdding] = useState<"secret" | "add" | null>(null);
  const [line, setLine] = useState("");
  const [names, setNames] = useState<MarkNames>(NO_NAMES);
  const visibilityId = useId();
  useEffect(() => setFields(ownFields(entry.lore)), [entry.id, JSON.stringify(entry.lore ?? {})]);
  const identifiers = useMemo(() => worldIdentifiers(props.doc), [props.doc]);
  const ctx: FormCtx = { doc: props.doc, lint: [], path: "book", identifiers, functions: props.functions };
  const set = (patch: Partial<BookFieldsEdit>): void => setFields({ ...fields, ...patch });
  const marks = entry.marks ?? [];
  const old = entry.lore && OLD_SECRECY_FIELDS.some((key) => entry.lore?.[key] !== undefined) ? entry.lore : null;
  // As the backend refuses: an entry kept secret by an earlier build's fields, or as a copy, waits for its book's move.
  const held = marks.length === 0 && ((entry.lore !== undefined && loreIsSecret(entry.lore)) || entry.copyOf !== undefined);
  const problem = adding === null ? null : markProblem(names, adding === "secret" ? ANY_TEXT : line);
  // No error before a line is typed: the button waits for it.
  const shown = adding === "add" && line.trim() === "" ? null : problem;
  const start = (kind: "secret" | "add"): void => {
    setAdding(kind);
    setLine("");
    setNames(NO_NAMES);
  };
  const send = (): void => props.onMark(adding === "secret" ? { kind: "secret", knownTo: names.knownTo, keptFrom: names.keptFrom } : { kind: "add", text: line, knownTo: names.knownTo, keptFrom: names.keptFrom }, () => setAdding(null));
  return (
    <div class="lre-form-lore-fields" data-lre-book-entry={entry.id}>
      {entry.copyOf ? (
        <Banner tone="info">
          An earlier build switched this entry off as a copy of a secret entry in “{props.labels[entry.copyOf.bookId] ?? "another book"}”. It stays as it is until its book's secrecy moves to secret marks on the secrecy page in Build → Lore, which puts it back as it stood.
        </Banner>
      ) : null}
      {entry.unreadable && entry.unreadable.length > 0 ? (
        <Banner tone="warn" title="A secret mark that can't be read">
          <p>This text starts like a secret mark but can't be read as one, so it is left out of every prompt and helper. Fix it in the entry's text in World Info:</p>
          <ul>
            {entry.unreadable.map((u, i) => (
              <li key={i}>
                <span class="lre-expr-token">{u.raw}</span>: {sentence(u.problem)}
              </li>
            ))}
          </ul>
        </Banner>
      ) : null}
      {marks.length > 0 ? (
        <FormGroup title="Secret marks" aside={entry.whole ? <Badge tone="gm">Whole entry</Badge> : undefined}>
          {entry.whole ? <p class="lre-build-note">Its whole text is one secret, so the whole entry is: the narrator is told it marked as a secret, or not at all, as the chat's narrator view says, and of the characters only those who know it have it in mind.</p> : null}
          <ActionRows label="Secret marks">
            {marks.map((mark, i) => (
              <MarkRow key={`${i}:${mark.text}`} mark={mark} index={i} ctx={ctx} busy={props.busy} onMark={props.onMark} />
            ))}
          </ActionRows>
        </FormGroup>
      ) : null}
      {old ? <OldSecrecy lore={old} marked={marks.length > 0} doc={props.doc} /> : null}
      {held ? null : adding === null ? (
        <div class="lre-form-pins-actions">
          {marks.length === 0 && (entry.unreadable ?? []).length === 0 && entry.chars > 0 ? (
            <Button disabled={props.busy} onClick={() => start("secret")}>
              Make this entry secret
            </Button>
          ) : null}
          <Button disabled={props.busy} onClick={() => start("add")}>
            Add a secret line
          </Button>
        </div>
      ) : (
        <FormGroup title={adding === "secret" ? "Make this entry secret" : "Add a secret line"}>
          <p class="lre-build-note">{adding === "secret" ? "Its whole text becomes one secret mark, written into the entry in its book." : "The line goes at the end of the entry's text as a secret mark, written into its book."} The narrator is told a secret marked as one, or not at all, as the chat's narrator view says; of the characters, only those who know it have it in mind.</p>
          {adding === "add" ? <FieldInput spec={SECRET_LINE_SPEC} value={line} ctx={ctx} path={ctx.path} parent={{}} onChange={(next) => setLine(typeof next === "string" ? next : "")} /> : null}
          <MarkNamesFields names={names} ctx={ctx} problem={shown} onChange={setNames} />
          <div class="lre-form-pins-actions">
            <Button variant="primary" disabled={props.busy || problem !== null} onClick={send}>
              {adding === "secret" ? "Make it secret" : "Add the line"}
            </Button>
            <Button variant="ghost" disabled={props.busy} onClick={() => setAdding(null)}>
              Cancel
            </Button>
          </div>
        </FormGroup>
      )}
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
        <Button variant="primary" disabled={props.busy} onClick={() => props.onSave(fields)}>
          Save to the book
        </Button>
        {Object.keys(ownFields(entry.lore)).length > 0 ? (
          <Button variant="ghost" disabled={props.busy} onClick={() => props.onSave(null)}>
            Take the fields off
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** LRE's say in one book's entries: their own fields and their secret marks, each written to the book on the user's press. */
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
  const save = (entryId: string, fields: BookFieldsEdit | null) =>
    run(async () => {
      const body = await app.request({ type: "lre.lore", op: "fields", bookId: book, entryId, fields });
      if (body?.entries) setEntries(body.entries);
    });
  const mark = (entryId: string, change: LoreMarkChange, done: () => void) =>
    run(async () => {
      const body = await app.request({ type: "lre.lore", op: "mark", bookId: book, entryId, change });
      if (!body?.entries) return;
      setEntries(body.entries);
      done();
    });
  const badge = (e: LoreBookEntryView) => {
    if (e.whole) return <Badge tone="gm">Whole entry secret</Badge>;
    if (e.marks) return <Badge tone="gm">{e.marks.length === 1 ? "1 secret line" : `${e.marks.length} secret lines`}</Badge>;
    if (e.lore && loreIsSecret(e.lore)) return <Badge tone="gm">Secret, earlier build</Badge>;
    if (e.lore) return <Badge>Lore fields</Badge>;
    return e.disabled ? <Badge>Off in its book</Badge> : undefined;
  };
  return (
    <div data-lre-book-entries>
      <Section title="World Info entries">
        <div class="lre-stack">
          <p class="lre-build-note">An entry of a book the chat reads is lore as it is. Give it the fields a world entry has, or keep some or all of it secret: a secret mark in its text says who knows it. LRE writes into a book only when you press for it here.</p>
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
                  subtitle={e.unreadable ? "Holds a secret mark that can't be read" : e.copyOf ? `Switched off by an earlier build as a copy of a secret in “${labels[e.copyOf.bookId] ?? "another book"}”` : undefined}
                  value={badge(e)}
                  actions={<IconButton icon={open === e.id ? "close" : "edit"} label={open === e.id ? `Close ${e.title}` : `Edit ${e.title}'s lore and secrets`} onClick={() => setOpen(open === e.id ? null : e.id)} />}
                >
                  {/* Open under its own row, so a long book's entry is edited where it was tapped. */}
                  {open === e.id ? <EntryFields entry={e} doc={draft.doc} functions={draft.functions} labels={labels} busy={busy} onSave={(fields) => save(e.id, fields)} onMark={(change, done) => mark(e.id, change, done)} /> : null}
                </ActionRow>
              ))}
            </ActionRows>
          ) : null}
        </div>
      </Section>
    </div>
  );
}
