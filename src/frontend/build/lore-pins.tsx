// Build → an entity's or a place's page, and the Pinned lore page's steps, Pinned lore (DESIGN
// §24.5): the lore pinned to a character (their mind's calls always read it first), to a place (every
// helper and mind call there, or in a place inside it, reads it first) or to a step (every call of it
// reads it first, whatever its lore setting; the mind step's, every mind), within each call's lore
// tokens. A pin names one of the world's lore entries, an entry of one of the user's World Info books
// or a whole book, the books attached to the open chat listed first. Pins are the world's `lorePins`
// part: each change goes to the draft at once, and a chat uses it once committed and the chat
// Upgraded; a book's text is read from the book whenever a call reads it. A map-drawn place is pinned
// here too.

import { useEffect, useId, useMemo, useState } from "preact/hooks";
import { lorePinKey, lorePinsJson, lorePinsOf } from "../../shared/lore";
import { isMindPurpose, type MindPurpose } from "../../shared/minds";
import type { LoreBookEntryView, LoreBookView, LorePinView } from "../../shared/protocol";
import type { LorePin, LorePins, StepPurpose } from "../../shared/world";
import { useApp } from "../app";
import { Badge, Button, Section, useBusy } from "../components";
import { ActionRow, ActionRows } from "../gm/ui";
import { IconButton } from "../components";
import { STEP_LABEL } from "../settings/steps";
import { useSelect } from "../store";
import { draftSend } from "./draft";
import { Issues } from "./form-kit";
import { lintAt } from "./schema-form";

const HINT = {
  characters: "Their mind reads these first, every time they think, within the pinned lore a mind reads (Settings → Minds → What a mind reads).",
  places: "Every helper and mind call here, or in a place inside it, reads these first, within its lore tokens.",
  steps: "Every call of this step reads these first, whatever its lore setting, within its lore tokens (Settings → Steps).",
} as const;

/** The minds steps have no lore setting: their pins read within the pinned lore a mind reads. */
const MIND_STEP_HINT: Record<MindPurpose, string> = {
  mind: "Every character's mind reads these, after what is pinned to them, within the pinned lore a mind reads (Settings → Minds → What a mind reads).",
  memory: "Each character's memory after the reply reads these, and no other lore, within the pinned lore a mind reads (Settings → Minds → What a mind reads).",
  skip: "The call that looks for a time skip's beats reads these, and so does every mind at a beat, after what is pinned to them and to every mind; within the pinned lore a mind reads (Settings → Minds → What a mind reads).",
  consolidate: "Each memory consolidation reads these, and no other lore, within the pinned lore a mind reads (Settings → Minds → What a mind reads).",
};

/** The picker's choice of a whole book rather than one of its entries; no host entry id looks like it. */
const WHOLE_BOOK = "lre:whole-book";

/** What the pins are pinned to: a character or a place by id, or a step. */
type PinTarget = { target: "characters" | "places"; id: string } | { target: "steps"; id: StepPurpose };

export function LorePinsSection(props: PinTarget) {
  const app = useApp();
  const draft = useSelect(app.drafts, (d) => d);
  const send = useMemo(() => draftSend(app), [app]);
  const [busy, run] = useBusy();
  const [views, setViews] = useState<Record<string, LorePinView>>({});
  const [adding, setAdding] = useState<"lore" | "book" | null>(null);
  const [books, setBooks] = useState<LoreBookView[] | null>(null);
  const [book, setBook] = useState("");
  const [entries, setEntries] = useState<LoreBookEntryView[] | null>(null);
  const [choice, setChoice] = useState("");
  const loreId = useId();
  const bookId = useId();
  const entryId = useId();
  const pins: LorePins = draft ? lorePinsOf(draft.doc) : { characters: {}, places: {}, steps: {} };
  const list: LorePin[] = (props.target === "steps" ? pins.steps[props.id] : pins[props.target][props.id]) ?? [];
  const keys = list.map(lorePinKey).join("\n");
  // A book's or book entry's title is read from the book; a world entry's comes with the draft.
  useEffect(() => {
    if (!draft || !list.some((p) => !("lore" in p))) return;
    void app.request({ type: "lre.lore", op: "pins", worldId: draft.worldId }).then((body) => {
      const part = (props.target === "steps" ? body?.pins?.steps[props.id] : body?.pins?.[props.target][props.id]) ?? [];
      setViews(Object.fromEntries(part.map((v) => [v.key, v])));
    });
  }, [draft?.worldId, keys]);
  useEffect(() => {
    if (adding !== "book" || books !== null) return;
    void app.request({ type: "lre.lore", op: "books", ...(app.client.getState().chatId ? { chatId: app.client.getState().chatId ?? "" } : {}) }).then((body) => setBooks(body?.books ?? []));
  }, [adding]);
  useEffect(() => {
    setEntries(null);
    setChoice("");
    if (book === "") return;
    void app.request({ type: "lre.lore", op: "entries", bookId: book }).then((body) => setEntries(body?.entries ?? []));
  }, [book]);
  if (!draft) return null;
  const save = (next: LorePin[]) =>
    run(async () => {
      const all: LorePins = props.target === "steps" ? { ...pins, steps: { ...pins.steps, [props.id]: next } } : { ...pins, [props.target]: { ...pins[props.target], [props.id]: next } };
      await send({ type: "lre.editor", worldId: draft.worldId, base: draft.base, op: "set", part: "lorePins", value: lorePinsJson(all) });
      setAdding(null);
      setChoice("");
    });
  const titleOf = (pin: LorePin): { title: string; source: string; badge: string | null } => {
    if ("lore" in pin) {
      const entry = draft.doc.lore[pin.lore];
      return entry ? { title: entry.title || pin.lore, source: "World lore", badge: entry.secret === true ? "Secret" : null } : { title: pin.lore, source: "World lore", badge: "Missing" };
    }
    const v = views[lorePinKey(pin)];
    const whole = !("entry" in pin);
    return { title: v?.title ?? (whole ? "A World Info book" : "A World Info entry"), source: v?.source ?? (whole ? "The whole book" : "World Info"), badge: v?.status === "missing" ? "Missing" : v?.status === "off" ? "Off in its book" : null };
  };
  const taken = new Set(list.map(lorePinKey));
  const lore = Object.values(draft.doc.lore).filter((l) => !taken.has(`lore:${l.id}`)).sort((a, b) => a.title.localeCompare(b.title));
  const hint = props.target === "steps" ? (isMindPurpose(props.id) ? MIND_STEP_HINT[props.id] : HINT.steps) : HINT[props.target];
  return (
    <div data-lre-lore-pins={`${props.target}:${props.id}`}>
      <Section title={props.target === "steps" ? STEP_LABEL[props.id] : "Pinned lore"} aside={list.length > 0 ? <Badge>{list.length}</Badge> : undefined}>
        <div class="lre-stack">
          <p class="lre-build-note">{hint} Pins go to the draft as you change them; a chat uses them once you commit and Upgrade it.</p>
          {list.length > 0 ? (
            <ActionRows label="Pinned lore">
              {list.map((pin, i) => {
                const t = titleOf(pin);
                return (
                  <ActionRow
                    key={lorePinKey(pin)}
                    title={t.title}
                    subtitle={t.source}
                    value={t.badge ? <Badge tone={t.badge === "Missing" ? "neg" : t.badge === "Secret" ? "gm" : "neutral"}>{t.badge}</Badge> : undefined}
                    actions={<IconButton icon="close" label={`Unpin ${t.title}`} disabled={busy} onClick={() => save(list.filter((_, j) => j !== i))} />}
                  />
                );
              })}
            </ActionRows>
          ) : null}
          <Issues issues={lintAt(draft.lint, `lorePins.${props.target}.${props.id}`)} />
          {adding === "lore" ? (
            <div class="lre-form-pins-add">
              <label for={loreId}>World lore entry</label>
              <select id={loreId} class="lre-input" value={choice} onChange={(event) => setChoice(event.currentTarget.value)}>
                <option value="">Choose an entry</option>
                {lore.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.title || l.id}
                  </option>
                ))}
              </select>
              <div class="lre-form-pins-actions">
                <Button variant="primary" icon="pin" disabled={choice === "" || busy} onClick={() => save([...list, { lore: choice }])}>
                  Pin it
                </Button>
                <Button variant="ghost" onClick={() => setAdding(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : adding === "book" ? (
            <div class="lre-form-pins-add">
              <label for={bookId}>World Info book</label>
              <select id={bookId} class="lre-input" value={book} onChange={(event) => setBook(event.currentTarget.value)}>
                <option value="">{books === null ? "Loading books…" : books.length === 0 ? "No World Info books" : "Choose a book"}</option>
                {(books ?? []).map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.attached ? `${b.name} (in this chat)` : b.name}
                  </option>
                ))}
              </select>
              {book !== "" ? (
                <>
                  <label for={entryId}>What to pin</label>
                  <select id={entryId} class="lre-input" value={choice} onChange={(event) => setChoice(event.currentTarget.value)}>
                    <option value="">{entries === null ? "Loading entries…" : "Choose the whole book or one entry"}</option>
                    {/* The whole book is read as it is whenever a call reads it: its switched-on entries, new ones too. */}
                    {taken.has(`book:${book}`) ? null : <option value={WHOLE_BOOK}>The whole book (its switched-on entries, new ones too)</option>}
                    {(entries ?? [])
                      .filter((e) => !taken.has(`book:${book}/${e.id}`))
                      .map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.disabled ? `${e.title} (off in the book)` : e.title}
                        </option>
                      ))}
                  </select>
                </>
              ) : null}
              <div class="lre-form-pins-actions">
                <Button variant="primary" icon="pin" disabled={book === "" || choice === "" || busy} onClick={() => save([...list, choice === WHOLE_BOOK ? { book } : { book, entry: choice }])}>
                  Pin it
                </Button>
                <Button variant="ghost" onClick={() => setAdding(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div class="lre-form-pins-actions">
              <Button icon="pin" disabled={busy || lore.length === 0} onClick={() => setAdding("lore")}>
                Pin world lore
              </Button>
              <Button icon="book" disabled={busy} onClick={() => setAdding("book")}>
                Pin from World Info
              </Button>
            </div>
          )}
        </div>
      </Section>
    </div>
  );
}
