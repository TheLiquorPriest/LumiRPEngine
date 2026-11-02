// Settings → Lore (DESIGN §4.2): which World Info books LumiRPEngine reads as lore, live (every book
// a chat reads, or only those the user ticks among them), and the lore index the agents route by:
// the tag pattern and LRE's own ids, what each line holds, whether every role's prompt carries the
// index and within how many tokens, the user's own index entry, and the entry Build → Lore built,
// which Stop lets go. Each control patches `loreBooks` or `loreIndex`; a field sent as null reads its
// default. The body has no hooks (`LoreSettingsBody`), so a test presses its controls; `LorePage`
// loads the books and the own entry's book for it. A book's folder can't be picked: Spindle doesn't
// give an extension a book's folder.

import { useEffect, useState } from "preact/hooks";
import type { JsonObject } from "../../shared/json";
import type { LoreBookEntryView, LoreBookView } from "../../shared/protocol";
import { LORE_INDEX_BOUNDS, LORE_INDEX_DEFAULTS, type LoreBooks, type LoreIndexSettings, isShortId, tagPatternOf } from "../../shared/settings";
import { useApp } from "../app";
import { Badge, Button, HostSelect, HostSwitch, NumberStepper, Section, Seg } from "../components";
import { bookLabels } from "../build/book-lore";
import { CheckField } from "../build/form-kit";
import { defaultButton } from "./agents";

type BooksMode = "auto" | "list";

/** The index settings Reset sends back to their defaults: every one but the built entry, which only Stop lets go. */
const RESET_FIELDS = ["tagPattern", "idPrefix", "idDigits", "holdsChars", "inPrompts", "promptTokens", "own"] as const satisfies readonly (keyof LoreIndexSettings)[];

/** The two index settings typed as text, which are sent once typed out (on blur or Enter) and only when they can be what they set. */
export type LoreTextField = "tagPattern" | "idPrefix";

const BOOKS_CHOICES: readonly { value: BooksMode; label: string }[] = [
  { value: "auto", label: "Every book a chat reads" },
  { value: "list", label: "Only the books I tick" },
];

/** The patch for some lore index settings; a field sent as null reads its default. */
export function loreIndexPatch(fields: JsonObject): JsonObject {
  return { loreIndex: fields };
}

/** Reset's patch: every index setting back to its default but the built entry (`RESET_FIELDS`). */
export function loreIndexResetPatch(): JsonObject {
  return loreIndexPatch(Object.fromEntries(RESET_FIELDS.map((key) => [key, null])));
}

/** What is wrong with a typed text field's value, or null when it can be saved. */
export function loreTextProblem(field: LoreTextField, value: string): string | null {
  if (field === "tagPattern") return value.trim() === "" ? "Write a pattern, or Reset for the default." : tagPatternOf(value) === null ? "That isn't a regular expression, so it isn't saved." : null;
  if (value.length > LORE_INDEX_BOUNDS.idPrefix) return `A prefix is at most ${LORE_INDEX_BOUNDS.idPrefix} characters.`;
  return isShortId(value) ? null : "A prefix is letters, digits, _, . and - only.";
}

/** The home row's line: which books, and what of the index is on. */
export function loreSummary(books: LoreBooks, index: LoreIndexSettings): string {
  const read = books === "auto" ? "Every book a chat reads" : `${books.length} ${books.length === 1 ? "book" : "books"} ticked`;
  const parts = [read, index.own ? "your own index entry" : index.inPrompts ? "index in every role's prompt" : null, index.built ? "an index entry kept in sync" : null];
  return parts.filter((p): p is string => p !== null).join(" · ");
}

export interface LoreSettingsProps {
  loreBooks: LoreBooks;
  loreIndex: LoreIndexSettings;
  /** The user's World Info books (the engine's own left out), once loaded. */
  books: readonly LoreBookView[] | null;
  /** The book the own-entry picker lists the entries of ("" for none), and its entries once loaded. */
  ownBook: string;
  ownEntries: readonly LoreBookEntryView[] | null;
  pickOwnBook(bookId: string): void;
  /** What is typed into a text field and not yet saved; null shows the saved value. */
  typed: Readonly<Record<LoreTextField, string | null>>;
  type(field: LoreTextField, value: string | null): void;
  patch(patch: JsonObject): void;
  busy: boolean;
}

/** The page's controls, without hooks: each one patches `loreBooks` or `loreIndex` through `patch`. */
export function LoreSettingsBody(props: LoreSettingsProps) {
  const { loreBooks, loreIndex: index, books, busy } = props;
  // Reset shows while any setting it covers differs from its default.
  const changed = RESET_FIELDS.some((key) => JSON.stringify(index[key]) !== JSON.stringify(LORE_INDEX_DEFAULTS[key]));
  const labels = bookLabels(books ?? []);
  const listed = loreBooks === "auto" ? null : loreBooks;
  const gone = listed?.filter((id) => !books?.some((b) => b.id === id)) ?? [];
  const setIndex = (fields: JsonObject) => props.patch(loreIndexPatch(fields));
  const tick = (id: string, on: boolean) => props.patch({ loreBooks: on ? [...(listed ?? []), id] : (listed ?? []).filter((b) => b !== id) });
  const text = (field: LoreTextField, label: string, help: string) => {
    const shown = props.typed[field] ?? index[field];
    const problem = props.typed[field] === null ? null : loreTextProblem(field, shown);
    return (
      <label class="lre-field" data-lre-lore-setting={field}>
        <span class="label">{label}</span>
        <input
          class="lre-input"
          aria-label={label}
          aria-invalid={problem !== null}
          value={shown}
          disabled={busy}
          onInput={(event) => props.type(field, event.currentTarget.value)}
          onChange={(event) => {
            const value = event.currentTarget.value;
            if (loreTextProblem(field, value) !== null) return;
            props.type(field, null);
            if (value !== index[field]) setIndex({ [field]: value });
          }}
        />
        {problem !== null ? <span class="lre-field-error" role="alert">{problem}</span> : null}
        <span class="lre-field-help">{help}</span>
      </label>
    );
  };
  const ownBookEntries = props.ownEntries ?? [];
  const ownTitle = index.own && index.own.bookId === props.ownBook ? (ownBookEntries.find((e) => e.id === index.own?.entryId)?.title ?? index.own.entryId) : (index.own?.entryId ?? null);
  return (
    <>
      <Section title="Books LumiRPEngine reads" flush>
        <div class="lre-set-rows">
          <div class="lre-set-ext" data-lre-lore-setting="books">
            <div class="lre-set-ext-head">
              <span class="lre-set-ext-title">World Info books</span>
              {loreBooks === "auto" ? null : defaultButton("Reset the books LumiRPEngine reads to its default, every book a chat reads", busy, () => props.patch({ loreBooks: null }))}
            </div>
            <div class="lre-field">
              <Seg<BooksMode> label="Which World Info books LumiRPEngine reads" value={listed ? "list" : "auto"} options={BOOKS_CHOICES} disabled={busy} onChange={(mode) => props.patch({ loreBooks: mode === "auto" ? null : (books ?? []).map((b) => b.id) })} />
              <span class="lre-field-help">
                {listed
                  ? "Only the ticked books are read, and each only where a chat reads it anyway: the world's Lore books (Build → Lore), the chat's own books and your global ones."
                  : "Every book a world chat reads: the world's Lore books (Build → Lore), the chat's own books and your global ones. LumiRPEngine reads each entry as it is now; nothing is copied."}
              </span>
            </div>
            {listed ? (
              <div class="lre-stack" data-lre-lore-books>
                {books === null ? <span class="lre-small lre-muted">Loading your books…</span> : null}
                {(books ?? []).map((b) => (
                  <CheckField key={b.id} label={labels[b.id] ?? b.name} checked={listed.includes(b.id)} disabled={busy} onChange={(on) => tick(b.id, on)} />
                ))}
                {gone.map((id) => (
                  <CheckField key={id} label={`${id} (no longer one of your books)`} checked disabled={busy} onChange={(on) => tick(id, on)} />
                ))}
              </div>
            ) : null}
            <span class="lre-small lre-muted">Default: every book a chat reads. World Info folders can't be picked: Lumiverse doesn't give extensions a book's folder.</span>
          </div>
        </div>
      </Section>
      <Section title="Lore index" flush>
        <div class="lre-set-rows">
          <p class="lre-set-timeout-lead">The agents find World Info entries by a short id in the lore index: one line per entry, its id, its title and what it holds. An id stays with its entry for good, even as other entries come and go.</p>
          {changed ? (
            <span>
              <Button size="sm" variant="ghost" icon="undo" label="Reset the lore index settings to their defaults" disabled={busy} onClick={() => props.patch(loreIndexResetPatch())}>
                Reset every index setting
              </Button>
            </span>
          ) : null}
          <div class="lre-set-ext" data-lre-lore-setting="ids">
            <div class="lre-set-ext-head">
              <span class="lre-set-ext-title">Short ids</span>
            </div>
            {text("tagPattern", "Tag pattern", `An entry with a keyword that matches this regular expression goes by that keyword, its tag. Default ${LORE_INDEX_DEFAULTS.tagPattern}.`)}
            {text("idPrefix", "Id prefix", `An entry without a tag gets an id of LumiRPEngine's own: this prefix, then its number. An entry keeps the id it has; new ones take a new prefix. Default ${LORE_INDEX_DEFAULTS.idPrefix}.`)}
            <NumberStepper label="Id digits" value={index.idDigits} min={LORE_INDEX_BOUNDS.idDigits[0]} max={LORE_INDEX_BOUNDS.idDigits[1]} integer disabled={busy} onChange={(idDigits) => setIndex({ idDigits })} />
            <span class="lre-small lre-muted">The number is padded to this many digits. Default {LORE_INDEX_DEFAULTS.idDigits}.</span>
          </div>
          <div class="lre-set-ext" data-lre-lore-setting="holds">
            <div class="lre-set-ext-head">
              <span class="lre-set-ext-title">What each line holds</span>
            </div>
            <NumberStepper label="Holds line (characters)" value={index.holdsChars} min={LORE_INDEX_BOUNDS.holdsChars[0]} max={LORE_INDEX_BOUNDS.holdsChars[1]} integer disabled={busy} onChange={(holdsChars) => setIndex({ holdsChars })} />
            <span class="lre-small lre-muted">The longest line of an entry's first words beside its title; 0 gives the title alone. Default {LORE_INDEX_DEFAULTS.holdsChars}.</span>
          </div>
          <div class="lre-set-ext" data-lre-lore-setting="prompts">
            <div class="lre-set-ext-head">
              <span class="lre-set-ext-title">In the roles' prompts</span>
            </div>
            <HostSwitch label="Every role's prompt carries the lore index" checked={index.inPrompts} disabled={busy} onChange={(inPrompts) => setIndex({ inPrompts })} />
            {index.inPrompts ? <NumberStepper label="Index tokens" value={index.promptTokens} min={LORE_INDEX_BOUNDS.promptTokens[0]} max={LORE_INDEX_BOUNDS.promptTokens[1]} integer disabled={busy} onChange={(promptTokens) => setIndex({ promptTokens })} /> : null}
            <span class="lre-small lre-muted">Off, an agent asks for the index with its lore_index tool. On, each role's prompt has it after its pinned files, cut to the tokens set here and saying how many entries it left out. Default off, {LORE_INDEX_DEFAULTS.promptTokens.toLocaleString("en-US")} tokens.</span>
          </div>
          <div class="lre-set-ext" data-lre-lore-setting="own">
            <div class="lre-set-ext-head">
              <span class="lre-set-ext-title">Your own index entry</span>
              {index.own ? (
                <Button size="sm" variant="ghost" icon="close" label="Clear your own index entry" disabled={busy} onClick={() => setIndex({ own: null })}>
                  Clear
                </Button>
              ) : null}
            </div>
            <span class="lre-set-timeout-text">An entry of yours that already indexes your lore. The agents get its text, as written, instead of the index LumiRPEngine makes; an id it names that is a tag reads its entry.</span>
            {index.own ? (
              <span class="lre-small" data-lre-lore-own>
                Now: {labels[index.own.bookId] ?? index.own.bookId} · {ownTitle}
              </span>
            ) : null}
            <HostSelect label="Book of your index entry" value={props.ownBook} placeholder="Pick a book" options={(books ?? []).map((b) => ({ value: b.id, label: labels[b.id] ?? b.name }))} disabled={busy} onChange={props.pickOwnBook} />
            {props.ownBook !== "" ? (
              <HostSelect
                label="Your index entry"
                value={index.own && index.own.bookId === props.ownBook ? index.own.entryId : ""}
                placeholder={props.ownEntries === null ? "Loading its entries…" : ownBookEntries.length === 0 ? "This book has no entries" : "Pick its entry"}
                options={ownBookEntries.map((e) => ({ value: e.id, label: e.title }))}
                disabled={busy}
                onChange={(entryId) => setIndex({ own: { bookId: props.ownBook, entryId } })}
              />
            ) : null}
            <span class="lre-small lre-muted">Default: none, the index LumiRPEngine makes.</span>
          </div>
          <div class="lre-set-ext" data-lre-lore-setting="built">
            <div class="lre-set-ext-head">
              <span class="lre-set-ext-title">Index entry kept in sync</span>
              {index.built ? <Badge tone="accent">On</Badge> : null}
            </div>
            {index.built ? (
              <>
                <span class="lre-small" data-lre-lore-built>
                  {labels[index.built.bookId] ?? index.built.bookId} · entry <code class="lre-form-lore-mono">{index.built.entryId}</code>, the index of world <code class="lre-form-lore-mono">{index.built.worldId}</code>'s books
                </span>
                <span class="lre-set-timeout-text">LumiRPEngine writes it again whenever the index changes. Stop leaves the entry in its book as it stands; delete it there once you no longer want it.</span>
                <span>
                  <Button size="sm" variant="secondary" icon="close" label="Stop keeping the index entry in sync" disabled={busy} onClick={() => setIndex({ built: null })}>
                    Stop
                  </Button>
                </span>
              </>
            ) : (
              <span class="lre-set-timeout-text">None. Build → Lore → Build an index entry writes one into a book you pick, and LumiRPEngine keeps it in sync until you stop it here.</span>
            )}
          </div>
        </div>
      </Section>
    </>
  );
}

/** Settings → Lore: the body, with the user's books and the own entry's book loaded for it. */
export function LorePage(props: { loreBooks: LoreBooks; loreIndex: LoreIndexSettings; patch(patch: JsonObject): void; busy: boolean }) {
  const app = useApp();
  const [books, setBooks] = useState<LoreBookView[] | null>(null);
  const [ownBook, setOwnBook] = useState(props.loreIndex.own?.bookId ?? "");
  const [ownEntries, setOwnEntries] = useState<LoreBookEntryView[] | null>(null);
  const [typed, setTyped] = useState<Record<LoreTextField, string | null>>({ tagPattern: null, idPrefix: null });
  useEffect(() => {
    void app.request({ type: "lre.lore", op: "books" }).then((body) => setBooks(body?.books ?? []));
  }, []);
  useEffect(() => {
    setOwnEntries(null);
    if (ownBook === "") return;
    let live = true;
    void app.request({ type: "lre.lore", op: "entries", bookId: ownBook }).then((body) => {
      if (live) setOwnEntries(body?.entries ?? []);
    });
    return () => {
      live = false;
    };
  }, [ownBook]);
  return (
    <div class="lre-stack" data-lre-settings-page="lore">
      <p class="lre-set-lead">LumiRPEngine reads your World Info as lore live, each entry as it is now: its helpers, minds and agents alike. These say which books it reads, and how the agents find an entry in them.</p>
      <LoreSettingsBody
        loreBooks={props.loreBooks}
        loreIndex={props.loreIndex}
        books={books}
        ownBook={ownBook}
        ownEntries={ownEntries}
        pickOwnBook={setOwnBook}
        typed={typed}
        type={(field, value) => setTyped((t) => ({ ...t, [field]: value }))}
        patch={props.patch}
        busy={props.busy}
      />
    </div>
  );
}
