// Build → Lore → Secrecy in your World Info (DESIGN §4.2): moving each of the user's World Info books
// from LRE's old secrecy (fields of its own on an entry, the entry switched off, and each twin of a
// secret kept off as its copy) to secret marks in the entries' own text, book by book. Each step is
// the user's own press: look at what the move does, Apply it, check the book reads right and Confirm,
// or Restore secrecy as it was, which puts the book back exactly as it stood. The page looks at every
// book once as it opens, one after another, so the list says which ones hold anything to move;
// nothing is written until a press, and a press acts on the book only as the page last read it.
// `MoveView` lays a book's move out from its plan alone, so what it shows is tested as it is drawn.
// Styles: the secrecy block of styles/build.ts.

import { useEffect, useMemo, useState } from "preact/hooks";
import { loreBooksOf } from "../../shared/lore";
import type { SecrecyBookPlan, SecrecyBookView, SecrecyEntryView } from "../../shared/protocol";
import { STEP_LABEL } from "../../shared/steps";
import { useApp } from "../app";
import { Badge, Banner, Button, Disclosure, Empty, IconButton, PageHeader, Section, useBusy } from "../components";
import { ActionRow, ActionRows } from "../gm/ui";
import { Icon } from "../icons";
import { useSelect } from "../store";
import { bookLabels } from "./book-lore";

/** A book as the page last read it: its move, or why it couldn't be read. */
type Read = { plan: SecrecyBookPlan } | { failed: string };

type Step = "apply" | "confirm" | "restore";

/** The steps of a book's move, in order. */
const STEPS = ["Look at what moves", "Apply", "Check, then confirm"] as const;

/** A secret mark as the user writes one, with a starter world's name. */
const MARK_EXAMPLE = "{{// Secret (known to Marcus): …}}";

/** The kinds of entry a move lists, each under its heading with what the move does to it. */
const GROUPS: readonly { kind: SecrecyEntryView["kind"]; title: string; note: string }[] = [
  { kind: "mark", title: "Become secret marks", note: "Each one's whole text goes into one secret mark. Lumiverse leaves a mark out of every prompt, and LumiRPEngine gives the narrator what it holds, marked as a secret." },
  { kind: "marked", title: "Marked already", note: "Their text holds secret marks already, and LumiRPEngine reads those instead of their old fields. Their text stays as it is." },
  { kind: "twin", title: "Twins become secret marks", note: "Copies of a secret's text that LumiRPEngine kept switched off with it. Each one's text goes into the same secret mark as its secret's, so Lumiverse leaves it out of any prompt LumiRPEngine doesn't mark, and then it goes back on or off as its note says it stood." },
  { kind: "fields", title: "Old fields only", note: "Entries that keep nothing secret but still carry LumiRPEngine's old secrecy fields, which Confirm takes off. Their links, aliases and Known by stay." },
  { kind: "refused", title: "Can't become a mark", note: "Their text can't be held in a mark, so they keep LumiRPEngine's old secrecy, and a copy of a secret stays switched off. Change the text in Lumiverse's World Info panel, then look again." },
];

/** LRE's old secrecy fields in words, as Confirm takes them off an entry that keeps nothing secret. */
const FIELD_WORDS: Readonly<Record<string, string>> = { secret: "secret switch", gate: "gate", audience: "list of helpers that read it early", holders: "holders" };

/** A moment the backend recorded (Unix ms), in the user's own date and time format. */
function when(ms: number | null): string {
  return ms === null ? "" : new Date(ms).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** "a", "a and b", "a, b and c". */
function listWords(words: readonly string[]): string {
  return words.length <= 1 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} and ${words.at(-1) ?? ""}`;
}

/** A problem the backend words as a clause, as a sentence. */
function sentence(text: string): string {
  const said = text.trim();
  return said === "" ? said : `${said[0]?.toUpperCase() ?? ""}${said.slice(1)}${/[.!?]$/.test(said) ? "" : "."}`;
}

/** The steps of a book's move, the one it is at marked, those before it ticked (`at` 3: all three done). */
export function MoveSteps(props: { at: 0 | 1 | 2 | 3 }) {
  return (
    <ol class="lre-secrecy-steps" aria-label="The move's steps">
      {STEPS.map((words, i) => {
        const state = i < props.at ? "done" : i === props.at ? "now" : "next";
        return (
          <li key={words} data-lre-step={state} aria-current={state === "now" ? "step" : undefined}>
            <span class="lre-secrecy-step-n" aria-hidden="true">
              {state === "done" ? <Icon name="check" size={12} /> : i + 1}
            </span>
            <span>
              {words}
              {state === "done" ? <span class="lre-sr"> (done)</span> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** What a book's move is laid out from, besides its plan: names for ids, and the page's own state. */
export interface MoveViewProps {
  plan: SecrecyBookPlan;
  /** A person's name in the world being edited, or the id when it has none. */
  nameOf(id: string): string;
  /** A book's name as the pickers show it. */
  bookName(id: string): string;
  busy: boolean;
  /** Whether Restore's check is open. */
  asking: boolean;
  onStep(step: Step): void;
  onAsk(open: boolean): void;
}

/** One entry of a move: what the move does to it, and, once moved, how it stands now. */
function EntryRow(props: { e: SecrecyEntryView; view: MoveViewProps }) {
  const { e, view } = props;
  const moved = view.plan.state !== "legacy";
  const notes: string[] = [];
  let subtitle = "";
  if (e.kind === "refused") {
    subtitle = sentence(e.reason ?? "its text can't be held in a mark");
    notes.push(e.original ? "A copy of a secret: it keeps LumiRPEngine's old secrecy and stays switched off, so its text reaches no prompt." : "It keeps LumiRPEngine's old secrecy, gate and all.");
  } else if (e.kind === "mark" || e.kind === "marked") {
    subtitle = e.kind === "marked" ? "Read by the marks in its text" : e.knownTo && e.knownTo.length > 0 ? `Known to ${listWords(e.knownTo.map(view.nameOf))}; kept from everyone else` : "Kept from everyone";
    const lost = [e.gate !== undefined ? `its gate, “${e.gate}”, no longer opens it` : "", e.audience && e.audience.length > 0 ? `${listWords(e.audience.map((p) => STEP_LABEL[p]))} no longer ${e.audience.length === 1 ? "reads" : "read"} it before then` : ""].filter((w) => w !== "");
    if (lost.length > 0) notes.push(e.kind === "mark" ? `Once it is a mark, ${listWords(lost)}: a mark has no gate and no early readers.` : `Its marks have no gate and no early readers, so ${listWords(lost)}.`);
  } else if (e.kind === "twin") {
    const original = e.original;
    const title = original && original.bookId === view.plan.bookId ? view.plan.entries.find((x) => x.id === original.entryId)?.title : undefined;
    subtitle = original ? `A copy of ${title !== undefined ? `“${title}”` : `a secret in “${view.bookName(original.bookId)}”`}` : "A copy of a secret";
    notes.push(e.knownTo && e.knownTo.length > 0 ? `It becomes the same mark as its secret, known to ${listWords(e.knownTo.map(view.nameOf))}.` : "It becomes the same mark as its secret, kept from everyone.");
    if (e.was) notes.push(`Its note says it was switched ${e.was.off ? "off" : "on"}${e.was.fields ? ", with LumiRPEngine fields of its own" : ""}, so it goes back that way.`);
  } else subtitle = `Confirm takes off its old ${listWords((e.removes ?? []).map((key) => FIELD_WORDS[key] ?? key))}`;
  if (moved && e.now === "changed") notes.push(e.kind === "mark" && e.marked === false ? "Changed since the move, and its text holds no secret mark now: as it stands, it is no secret." : "Changed since the move.");
  if (moved && e.now === "gone") notes.push("Deleted from the book since the move: Restore can't put it back.");
  if (e.error) notes.push(`${e.error.step === "apply" ? "Not moved" : e.error.step === "confirm" ? "Its old fields are still on" : "Not put back"}: ${sentence(e.error.message)}`);
  const value = e.error ? <Badge tone="neg">{e.error.step === "apply" ? "Not moved" : "Failed"}</Badge> : moved && e.now === "gone" ? <Badge tone="neg">Gone</Badge> : moved && e.now === "changed" ? <Badge tone="warn">Changed</Badge> : e.off ? <Badge>Off</Badge> : undefined;
  return (
    <ActionRow title={e.title} subtitle={subtitle} value={value}>
      {e.mark !== undefined && (e.kind === "mark" || e.kind === "twin") ? <div class="lre-build-entry lre-secrecy-mark">{e.mark}</div> : null}
      {notes.map((note) => (
        <p key={note} class="lre-build-note">
          {note}
        </p>
      ))}
    </ActionRow>
  );
}

/** A book's move laid out from its plan: the steps, where it stands, what moves, what stays off, and the presses that act on it. */
export function MoveView(props: MoveViewProps) {
  const plan = props.plan;
  const moved = plan.state !== "legacy";
  const moving = plan.entries.filter((e) => e.kind !== "refused");
  const off = plan.entries.filter((e) => e.switchedOff);
  const changed = plan.entries.filter((e) => e.now === "changed");
  const gone = plan.entries.filter((e) => e.now === "gone");
  if (!moved && plan.entries.length === 0) {
    return (
      <div class="lre-secrecy-move" data-lre-secrecy-book={plan.bookId}>
        <Empty icon="check">Nothing in this book holds LumiRPEngine's old secrecy: there is nothing to move.</Empty>
      </div>
    );
  }
  const restore = props.asking ? (
    <Banner
      tone="warn"
      title="Restore secrecy as it was?"
      actions={
        <>
          <Button variant="danger" busy={props.busy} onClick={() => props.onStep("restore")}>
            Restore
          </Button>
          <Button variant="ghost" disabled={props.busy} onClick={() => props.onAsk(false)}>
            Cancel
          </Button>
        </>
      }
    >
      <p>Every entry the move of {when(plan.applied)} listed goes back exactly as it stood before it: its text, its keywords, whether it is switched on, and LumiRPEngine's fields.</p>
      {changed.length > 0 ? <p>Changed since the move: {listWords(changed.map((e) => `“${e.title}”`))}. Restore replaces those changes, and keeps a copy of each in the backup.</p> : null}
      {gone.length > 0 ? <p>Deleted since the move: {listWords(gone.map((e) => `“${e.title}”`))}. Restore can't put back what was deleted.</p> : null}
    </Banner>
  ) : null;
  return (
    <div class="lre-secrecy-move" data-lre-secrecy-book={plan.bookId} data-lre-secrecy-state={plan.state}>
      {moving.length > 0 || moved ? <MoveSteps at={plan.state === "confirmed" ? 3 : moved ? 2 : 1} /> : null}
      {plan.damaged !== null ? (
        <Banner tone="warn" title="Its backup couldn't be read">
          So the book reads as never moved. LumiRPEngine kept the file as “{plan.damaged}”.
        </Banner>
      ) : null}
      {plan.state === "legacy" && plan.restored !== null ? (
        <Banner tone="info" title={`Put back on ${when(plan.restored)}`}>
          The book stands as it did before its move of {when(plan.applied)}. Apply moves it again.
        </Banner>
      ) : null}
      {plan.state === "applied" ? (
        <Banner tone="info" title={`Moved on ${when(plan.applied)}`}>
          LumiRPEngine reads this book's secrets from their marks now. Check the book reads right, here and in a turn or two of a chat: its old fields stay on the entries until you confirm, and the backup stays either way.
        </Banner>
      ) : null}
      {plan.state === "confirmed" ? (
        <Banner tone="info" icon="check" title="Done">
          Moved on {when(plan.applied)} and confirmed on {when(plan.confirmed)}: the old fields are off. LumiRPEngine keeps the backup, so Restore secrecy as it was still puts the book back as it stood before the move.
        </Banner>
      ) : null}
      {plan.state === "restoring" ? (
        <Banner tone="neg" title="The restore didn't finish">
          Some entries weren't put back; each says why below. Restore again to finish it.
        </Banner>
      ) : null}
      {off.length > 0 ? (
        <div class="lre-secrecy-group" data-lre-secrecy-off>
          <h4 class="lre-secrecy-group-title">Switched off by LumiRPEngine ({off.length})</h4>
          <p class="lre-build-note">LumiRPEngine stored these secrets switched off, and nothing says how each stood before, so the move leaves them off. Switch one on in Lumiverse's World Info panel if it should fire.</p>
          <ActionRows label="Switched off by LumiRPEngine">
            {off.map((e) => (
              <ActionRow key={e.id} title={e.title} value={e.off ? <Badge>Off</Badge> : <Badge tone="pos">On</Badge>} subtitle={e.off ? (moved ? "Still off" : "Stays off") : "Switched on since"} />
            ))}
          </ActionRows>
        </div>
      ) : null}
      {GROUPS.map((group) => {
        const entries = plan.entries.filter((e) => e.kind === group.kind);
        if (entries.length === 0) return null;
        return (
          <div key={group.kind} class="lre-secrecy-group" data-lre-secrecy-kind={group.kind}>
            <h4 class="lre-secrecy-group-title">
              {group.title} ({entries.length})
            </h4>
            <p class="lre-build-note">{group.note}</p>
            <ActionRows label={group.title}>
              {entries.map((e) => (
                <EntryRow key={e.id} e={e} view={props} />
              ))}
            </ActionRows>
          </div>
        );
      })}
      {restore}
      {plan.state === "legacy" ? (
        <>
          <div class="lre-build-actions">
            <Button variant="primary" busy={props.busy} disabled={moving.length === 0} onClick={() => props.onStep("apply")}>
              Apply to this book
            </Button>
          </div>
          <p class="lre-build-note">{moving.length === 0 ? "Nothing here can move: each secret keeps its old secrecy until its text can be held in a mark." : "Before it changes anything, LumiRPEngine keeps a copy of every entry listed here as it stands now, so Restore secrecy as it was can put each one back exactly."}</p>
        </>
      ) : props.asking ? null : (
        <div class="lre-build-actions">
          {plan.state === "applied" ? (
            <Button variant="primary" busy={props.busy} onClick={() => props.onStep("confirm")}>
              It reads right: take the old fields off
            </Button>
          ) : null}
          <Button variant="secondary" disabled={props.busy} onClick={() => props.onAsk(true)}>
            {plan.state === "restoring" ? "Restore again…" : "Restore secrecy as it was…"}
          </Button>
        </div>
      )}
    </div>
  );
}

/** One book's move, open under its row: each press answers the book as it stands after it, and one refused reads the book again. */
function BookMove(props: { plan: SecrecyBookPlan; nameOf(id: string): string; bookName(id: string): string; onPlan(next: SecrecyBookPlan): void; onStale(): void }) {
  const app = useApp();
  const [busy, run] = useBusy();
  const [asking, setAsking] = useState(false);
  const step = (op: Step) =>
    run(async () => {
      const body = await app.request({ type: "lre.secrecy", op, bookId: props.plan.bookId, version: props.plan.version });
      setAsking(false);
      const book = body?.book;
      // Refused, because the book changed since the page read it, say: read it again, so the page shows how it stands.
      if (!book) {
        props.onStale();
        return;
      }
      props.onPlan(book);
      if (op === "apply") app.toast(`Moved “${book.name}” to secret marks: check it reads right, then confirm.`, "info");
      if (op === "confirm" && book.state === "confirmed") app.toast(`Took LumiRPEngine's old fields off “${book.name}”.`, "info");
      if (op === "restore" && book.state === "legacy") app.toast(`Put “${book.name}” back as it stood before its move.`, "info");
    });
  return <MoveView plan={props.plan} nameOf={props.nameOf} bookName={props.bookName} busy={busy} asking={asking} onStep={step} onAsk={setAsking} />;
}

/** What a book's row says of where its move stands, with a badge when there is something to do or done. */
function standingOf(read: Read | undefined): { words: string; badge?: { tone: "accent" | "warn" | "pos" | "neg"; text: string } } {
  if (!read) return { words: "Looking at it…" };
  if ("failed" in read) return { words: `Couldn't read it: ${read.failed}`, badge: { tone: "neg", text: "Not read" } };
  const plan = read.plan;
  if (plan.state === "applied") return { words: `Moved on ${when(plan.applied)}: check it, then confirm`, badge: { tone: "warn", text: "Check it" } };
  if (plan.state === "confirmed") return { words: `Moved, and confirmed on ${when(plan.confirmed)}`, badge: { tone: "pos", text: "Done" } };
  if (plan.state === "restoring") return { words: "Its restore didn't finish", badge: { tone: "neg", text: "Restore again" } };
  const moving = plan.entries.filter((e) => e.kind !== "refused").length;
  const refused = plan.entries.length - moving;
  const said = [moving > 0 ? `${moving} ${moving === 1 ? "entry" : "entries"} to move` : "", refused > 0 ? `${refused} can't move` : "", plan.restored !== null ? `Put back on ${when(plan.restored)}` : ""].filter((w) => w !== "");
  return { words: said.length === 0 ? "Nothing to move" : said.join(" · "), ...(moving > 0 ? { badge: { tone: "accent" as const, text: "To move" } } : {}) };
}

export function SecrecyPage() {
  const app = useApp();
  const draft = useSelect(app.drafts, (d) => d);
  const [books, setBooks] = useState<SecrecyBookView[] | null>(null);
  const [reads, setReads] = useState<Record<string, Read>>({});
  const [open, setOpen] = useState<string | null>(null);
  const labels = useMemo(() => bookLabels(books ?? []), [books]);
  const look = async (bookId: string): Promise<void> => {
    // Quietly: a book that can't be read says so on its own row, not in a toast for each.
    const m = await app.send({ type: "lre.secrecy", op: "preview", bookId });
    const read: Read = m.type === "lre.result" && m.request === "lre.secrecy" && m.body.book ? { plan: m.body.book } : { failed: m.type === "lre.error" ? m.message : "no answer came" };
    setReads((was) => ({ ...was, [bookId]: read }));
  };
  useEffect(() => {
    let live = true;
    void (async () => {
      const found = (await app.request({ type: "lre.secrecy", op: "books" }))?.books ?? [];
      if (!live) return;
      setBooks(found);
      // One book after another, so a long list of books never asks for all of them at once.
      for (const b of found) {
        if (!live) return;
        await look(b.id);
      }
    })();
    return () => {
      live = false;
    };
  }, []);
  if (!draft) return null;
  const doc = draft.doc;
  const own = new Set(loreBooksOf(doc));
  const ordered = [...(books ?? [])].sort((a, b) => Number(own.has(b.id)) - Number(own.has(a.id)));
  const nameOf = (id: string): string => doc.entities[id]?.name ?? id;
  const bookName = (id: string): string => labels[id] ?? "another book";
  const row = (b: SecrecyBookView) => {
    const read = reads[b.id];
    const title = labels[b.id] ?? b.name;
    const standing = standingOf(read);
    const plan = read && "plan" in read ? read.plan : null;
    return (
      <ActionRow
        key={b.id}
        title={title}
        subtitle={own.has(b.id) ? `This world reads it · ${standing.words}` : standing.words}
        value={standing.badge ? <Badge tone={standing.badge.tone}>{standing.badge.text}</Badge> : undefined}
        actions={plan ? <IconButton icon={open === b.id ? "close" : "chevron-down"} label={open === b.id ? `Close ${title}` : `Open ${title}`} onClick={() => setOpen(open === b.id ? null : b.id)} /> : undefined}
      >
        {/* Open under its own row, so a book's move is read where it was tapped. */}
        {open === b.id && plan ? <BookMove plan={plan} nameOf={nameOf} bookName={bookName} onPlan={(next) => setReads((was) => ({ ...was, [b.id]: { plan: next } }))} onStale={() => void look(b.id)} /> : null}
      </ActionRow>
    );
  };
  const listed: SecrecyBookView[] = [];
  const quiet: SecrecyBookView[] = [];
  for (const b of ordered) {
    const read = reads[b.id];
    // Read, never moved and holding nothing: with the books that have nothing to move.
    (read && "plan" in read && read.plan.state === "legacy" && read.plan.entries.length === 0 ? quiet : listed).push(b);
  }
  return (
    <div class="lre-build-page" data-lre-secrecy>
      <PageHeader title="Secrecy in your World Info" subtitle="Your books' secrets, moved from LumiRPEngine's old fields to secret marks, book by book" />
      <Section title="What a move does">
        <div class="lre-stack">
          <p class="lre-build-note">
            LumiRPEngine used to keep a secret by storing fields of its own on the entry and switching the entry off, and kept each copy of a secret's text switched off with it. Now a secret is a mark in the entry's own text, <code class="lre-build-mono">{MARK_EXAMPLE}</code>: Lumiverse leaves a mark out of every prompt, and LumiRPEngine gives the narrator what it holds, marked as a secret.
          </p>
          <ol class="lre-build-notes">
            <li>Look at what moves: open a book to see what its move would do. Looking writes nothing.</li>
            <li>Apply: LumiRPEngine first keeps a copy of every entry it lists, then writes each secret's mark and puts each twin back as it stood. Entries it switched off stay off, listed for you to switch on.</li>
            <li>Check, then confirm: once the book reads right, Confirm takes LumiRPEngine's old fields off its entries. The copy stays.</li>
          </ol>
          <p class="lre-build-note">Restore secrecy as it was puts a book back exactly as it stood before its move, whenever you press it. Books you haven't moved keep their old secrecy, as before.</p>
        </div>
      </Section>
      <Section title="Your books" aside={books ? <Badge>{books.length}</Badge> : undefined}>
        {books === null ? (
          <Empty icon="hourglass">Loading your books…</Empty>
        ) : books.length === 0 ? (
          <Empty icon="book">You have no World Info books.</Empty>
        ) : (
          <div class="lre-stack">
            {listed.length > 0 ? <ActionRows label="Your books">{listed.map(row)}</ActionRows> : <p class="lre-build-note">None of your books holds LumiRPEngine's old secrecy.</p>}
            {quiet.length > 0 ? (
              <Disclosure summary={`${quiet.length} ${quiet.length === 1 ? "book" : "books"} with nothing to move`}>
                <ActionRows label="Books with nothing to move">{quiet.map(row)}</ActionRows>
              </Disclosure>
            ) : null}
          </div>
        )}
      </Section>
    </div>
  );
}
