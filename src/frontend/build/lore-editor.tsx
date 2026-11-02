// Build → Lore (DESIGN §4.2): the entries, searchable by title, alias, topic, keyword and text, with
// the lookup table and Index this text a tap away, and + New, which names a new entry; the lore index
// of the world's books (each entry by its short id) with Build an index entry, which writes it into a
// book the user picks, on their press only, for LRE to keep in sync until Settings → Lore stops it;
// and the entry page: its title and text, how lookups find it (aliases, topics and keywords as chips,
// then links, group and priority), the source (read-only; a copy an earlier build made of a World Info
// entry says it is no longer read, its book entry being read live), and secrecy: who may read it, the
// gate (with examples made of the world's names), whose own secret it is, and the helpers that may
// read the secret, those whose output reaches the player not offered.
// Styles: the lore block of styles/forms.ts.

import { useEffect, useMemo, useState } from "preact/hooks";
import type { JsonObject } from "../../shared/json";
import { hasOwn } from "../../shared/json";
import { LORE_AUDIENCE, loreIsSecret, loreSourceOf } from "../../shared/lore";
import type { LoreBookView, LoreIndexView } from "../../shared/protocol";
import type { LoreEntryDef, LoreSource, StepPurpose, WorldDoc } from "../../shared/world";
import type { App } from "../app";
import { useApp } from "../app";
import { Badge, Banner, Button, Empty, HostSelect, List, ListRow, PageHeader, SaveBar, Section, useBusy } from "../components";
import { strings } from "../decode";
import { Icon } from "../icons";
import type { EditorProps } from "../registry";
import { useSelect } from "../store";
import { deleteItem, go, ItemHeader, NewItem, newItemName } from "./chrome";
import { Issues } from "./form-kit";
import { useHeld } from "./held";
import { COLLECTION_SPECS, newItem } from "./schema";
import { FieldInput, lintAt, SchemaFields, worldIdentifiers } from "./schema-form";
import { TagListInput } from "./selector-editor";
import { BookEntriesSection, bookLabels, GateExamples, LoreBooksSection, SecretAudience, SECRET_GATE_SPEC } from "./book-lore";

const specs = (keys: readonly string[]) => COLLECTION_SPECS.lore.filter((s) => keys.includes(s.key));
const TEXT = specs(["title", "content"]);
// Keywords (`keys`) are laid out as chips beside the aliases and topics, so they aren't here.
const MORE = specs(["links", "group", "priority"]);
const SECRET = specs(["visibility", "secret"]);
const HOLDERS = specs(["holders"]);


function useBookNames(app: App): Record<string, string> {
  const [names, setNames] = useState<Record<string, string>>({});
  useEffect(() => {
    void app.host.worldBooks().then(
      (books) => setNames(Object.fromEntries(books.map((book) => [book.id, book.name]))),
      () => setNames({}),
    );
  }, [app]);
  return names;
}

const SOURCE_BADGE: Record<LoreSource["kind"], string> = { authored: "", book: "Book", chat: "Chat", ai: "AI" };

export function LoreList(props: { worldId: string }) {
  const app = useApp();
  const draft = useSelect(app.drafts, (d) => d);
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const doc = draft?.doc;
  if (!draft || !doc) return null;
  const q = query.trim().toLowerCase();
  const all = Object.entries(doc.lore);
  const shown = all.filter(([id, l]) => q === "" || [id, l.title, ...(l.aliases ?? []), ...(l.topics ?? []), ...l.keys, l.content].join("\n").toLowerCase().includes(q));
  const terms = Object.keys(doc.loreIndex.terms).length;
  const topics = Object.keys(doc.loreIndex.topics).length;
  const indexIssues = lintAt(draft.lint, "loreIndex").length;
  const add = (
    <Button variant="primary" icon="plus" label="New lore entry" onClick={() => setAdding((open) => !open)}>
      New
    </Button>
  );
  return (
    <div class="lre-build-page" data-lre-lore-list>
      <PageHeader title="Lore" subtitle="Kept in the world. The engine's helpers read it, and the narrator gets the entries about where your character is in the Place section; the brief and the prose outline draw on the other public entries for its Outline." actions={add} />
      {adding ? <NewItem worldId={draft.worldId} collection="lore" taken={new Set(Object.keys(doc.lore))} onDone={() => setAdding(false)} /> : null}
      <Section title="Tools" flush>
        <List>
          <ListRow
            icon="search"
            title="Lookup table"
            subtitle={`${terms} term${terms === 1 ? "" : "s"} · ${topics} topic${topics === 1 ? "" : "s"}`}
            badge={indexIssues > 0 ? <Badge tone="warn">{indexIssues}</Badge> : undefined}
            chevron
            onClick={() => go(app, { view: "part", worldId: draft.worldId, part: "loreIndex" })}
          />
          <ListRow icon="book" title="World Info is read live" subtitle="The helpers and agents read your World Info books as they are now; nothing to copy or refresh. Settings → Lore picks which books they read." />
          <ListRow icon="scroll" title="Index this text" subtitle="Lore entries made from text you paste, each for you to review" chevron onClick={() => go(app, { view: "job", worldId: draft.worldId, kind: "index_text" })} />
          <ListRow icon="lock" title="Secrecy in your World Info" subtitle="Move your books' secrets from LumiRPEngine's old fields to secret marks in their text, book by book, with a restore" chevron onClick={() => go(app, { view: "secrecy", worldId: draft.worldId })} />
        </List>
      </Section>
      <LoreBooksSection />
      <LoreIndexSection worldId={draft.worldId} />
      <BookEntriesSection />
      <div class="lre-build-search">
        <Icon name="search" size={16} />
        <input class="lre-input" type="search" placeholder="Search titles, aliases, topics and text" aria-label="Search lore" value={query} onInput={(event) => setQuery(event.currentTarget.value)} />
      </div>
      {shown.length === 0 ? (
        all.length === 0 ? (
          <Empty icon="book" title="No lore yet" action={adding ? undefined : add}>
            Write an entry, or index some text. Your World Info books are read as they are, with no entry here.
          </Empty>
        ) : (
          <Empty icon="search" title="No matches">
            No entry matches “{query.trim()}”.
          </Empty>
        )
      ) : (
        <Section title="Entries" aside={<Badge>{shown.length}</Badge>} flush>
          <List>
            {shown.map(([id, l]) => {
              const source = loreSourceOf(l.source);
              const copy = source.kind === "book";
              const issues = lintAt(draft.lint, `lore.${id}`).length;
              const aliases = l.aliases ?? [];
              const named = l.topics ?? [];
              const subtitle = [aliases.length > 0 ? `also ${aliases.join(", ")}` : "", named.join(", ")].filter((part) => part !== "").join(" · ");
              const secret = loreIsSecret(l);
              const kind = SOURCE_BADGE[source.kind];
              const badges = secret || kind || copy || issues > 0;
              return (
                // The wrapper only carries the row's hook for scripts and tests; it takes no box.
                <div key={id} class="lre-form-lore-row" data-lre-lore={id}>
                  <ListRow
                    title={l.title || id}
                    subtitle={subtitle === "" ? undefined : subtitle}
                    id={id}
                    badge={
                      badges ? (
                        <span class="lre-form-lore-badges">
                          {secret ? <Badge tone="warn">Secret</Badge> : null}
                          {kind && !copy ? <Badge>{source.kind === "ai" && source.status === "pending" ? "AI · to review" : kind}</Badge> : null}
                          {copy ? <Badge tone="warn">Old copy · not read</Badge> : null}
                          {issues > 0 ? <Badge tone="warn">{issues}</Badge> : null}
                        </span>
                      ) : undefined
                    }
                    chevron
                    onClick={() => go(app, { view: "item", worldId: draft.worldId, collection: "lore", id })}
                  />
                </div>
              );
            })}
          </List>
        </Section>
      )}
    </div>
  );
}

export interface LoreIndexProps {
  worldId: string;
  /** The index as `lre.lore index` answers it, once read. */
  view: LoreIndexView | null;
  /** The user's World Info books (the engine's own left out), once loaded: those Build an index entry may write into. */
  books: readonly LoreBookView[] | null;
  /** The book picked to write the entry into ("" for none). */
  target: string;
  pickTarget(bookId: string): void;
  /** Build an index entry, on the user's press: `lre.lore build` into `target`. */
  build(): void;
  openSettings(): void;
  busy: boolean;
}

/**
 * The lore index of the world's books as Build shows it, without hooks: each book with how many of
 * its entries the index lists, the text an index entry would hold, and either the entry LRE keeps in
 * sync (Settings → Lore stops it) or a book picker and Build an index entry.
 */
export function LoreIndexBody(props: LoreIndexProps) {
  const { view, busy } = props;
  const labels = bookLabels(props.books ?? []);
  const built = view?.built ?? null;
  const settings = (
    <Button size="sm" variant="secondary" icon="sliders" onClick={props.openSettings}>
      Open Settings → Lore
    </Button>
  );
  return (
    <Section title="Lore index" aside={built ? <Badge tone="accent">Kept in sync</Badge> : undefined}>
      <div class="lre-stack" data-lre-lore-index>
        <span class="lre-small lre-muted">The agents find World Info entries by the short id each has here: one line per entry, with its title and what it holds. They ask for it with lore_index, or get it in their prompts when Settings → Lore says so.</span>
        {view === null ? (
          <span class="lre-small lre-muted">Reading the index…</span>
        ) : (
          <>
            {view.books.length > 0 ? (
              <List>
                {view.books.map((b) => (
                  <ListRow key={b.id} icon="book" title={b.name} value={`${b.entries} ${b.entries === 1 ? "entry" : "entries"}`} valueTone="muted" />
                ))}
              </List>
            ) : (
              <span class="lre-small lre-muted">No book this world reads has an entry anyone may read.</span>
            )}
            <details class="lre-form-lore-index-preview">
              <summary>What an index entry holds</summary>
              <pre class="lre-form-lore-mono" data-lre-lore-index-text>
                {view.text}
              </pre>
            </details>
          </>
        )}
        {built ? (
          <Banner tone="info" actions={settings}>
            <span data-lre-lore-index-built>
              {built.worldId === props.worldId ? `${built.book} has this index as entry ${built.entryId}, which LumiRPEngine writes again whenever the index changes.` : `${built.book} has an index entry LumiRPEngine keeps in sync for another world (${built.worldId}). One is kept at a time: stop it before building one for this world.`} Stop it in Settings → Lore; the entry stays in its book.
            </span>
          </Banner>
        ) : (
          <div class="lre-stack">
            <HostSelect label="Book to write the index entry into" value={props.target} placeholder="Pick one of your books" options={(props.books ?? []).map((b) => ({ value: b.id, label: labels[b.id] ?? b.name }))} disabled={busy} onChange={props.pickTarget} />
            <span class="lre-small lre-muted">Writes one entry, always on and kept out of recursion, that lists every entry anyone may read. Nothing is written until you press Build.</span>
            <span>
              <Button variant="secondary" icon="plus" disabled={busy || props.target === "" || view === null} onClick={props.build}>
                Build an index entry
              </Button>
            </span>
          </div>
        )}
      </div>
    </Section>
  );
}

/** Build → Lore's lore index: read when the page opens, and built into the book picked on the user's press. */
function LoreIndexSection(props: { worldId: string }) {
  const app = useApp();
  const [view, setView] = useState<LoreIndexView | null>(null);
  const [books, setBooks] = useState<LoreBookView[] | null>(null);
  const [target, setTarget] = useState("");
  const [busy, run] = useBusy();
  useEffect(() => {
    void app.request({ type: "lre.lore", op: "index", worldId: props.worldId }).then((body) => setView(body?.index ?? null));
    void app.request({ type: "lre.lore", op: "books" }).then((body) => setBooks(body?.books ?? []));
  }, [props.worldId]);
  return (
    <LoreIndexBody
      worldId={props.worldId}
      view={view}
      books={books}
      target={target}
      pickTarget={setTarget}
      busy={busy}
      build={() =>
        run(async () => {
          const body = await app.request({ type: "lre.lore", op: "build", worldId: props.worldId, bookId: target });
          if (body?.index) setView(body.index);
        })
      }
      openSettings={() => app.ui.update((ui) => ({ ...ui, mode: "settings", settings: { page: "lore" } }))}
    />
  );
}

/** Where the entry came from, read-only. */
function SourceSection(props: { app: App; source: LoreSource; onSource(next: LoreSource): void }) {
  const names = useBookNames(props.app);
  const { source } = props;
  if (source.kind === "book") {
    return (
      <Section title="Source" aside={<Badge tone="warn">Old copy</Badge>}>
        <div class="lre-form-lore-source" data-lre-lore-source="book">
          <span>
            {names[source.bookId] ?? source.bookId} · entry <code class="lre-form-lore-mono">{source.entryId}</code>
          </span>
          <Banner tone="info">
            An earlier version of LumiRPEngine copied this entry from your World Info. LumiRPEngine now reads the book entry itself, as the book has it, so this copy isn't read. Its secrecy still holds the book entry back; delete the copy once you no longer need that.
          </Banner>
        </div>
      </Section>
    );
  }
  if (source.kind === "chat") {
    return (
      <Section title="Source" aside={<Badge>Chat</Badge>}>
        <span class="lre-form-lore-source" data-lre-lore-source="chat">
          <span>
            Saved from a chat, message <code class="lre-form-lore-mono">{source.messageId}</code>.
          </span>
        </span>
      </Section>
    );
  }
  if (source.kind === "ai") {
    const pending = source.status === "pending";
    return (
      <Section title="Source" aside={<Badge tone={pending ? "warn" : undefined}>AI</Badge>}>
        <div class="lre-form-lore-source" data-lre-lore-source="ai">
          <span>Written by an indexing job from pasted text{pending ? "; not reviewed yet." : "; reviewed."}</span>
          {pending ? (
            <span class="lre-form-lore-actions">
              <Button size="sm" icon="check" onClick={() => props.onSource({ kind: "ai", status: "accepted" })}>
                Mark reviewed
              </Button>
            </span>
          ) : null}
        </div>
      </Section>
    );
  }
  return (
    <Section title="Source" aside={<Badge>Authored</Badge>}>
      <span class="lre-form-lore-note" data-lre-lore-source="authored">
        Written in Build.
      </span>
    </Section>
  );
}

export function LoreEditor(props: EditorProps) {
  const app = useApp();
  const draft = useSelect(app.drafts, (d) => d);
  const isNew = props.id?.startsWith("new:") ?? false;
  const id = isNew ? (props.id ?? "").slice(4) : (props.id ?? "");
  const stored = hasOwn(props.world.lore, id) ? props.world.lore[id] : undefined;
  // The form edits the entry as the JSON the draft stores, like every Build editor.
  const initial: JsonObject = stored ? (JSON.parse(JSON.stringify(stored)) as JsonObject) : newItem("lore", id, props.world, newItemName(props.world.id, "lore", id));
  const [value, setValue] = useState<JsonObject>(initial);
  const [busy, run] = useBusy();
  useHeld(value, setValue, initial, `${props.world.id}/lore/${props.id ?? ""}`, JSON.stringify(stored ?? null));
  const identifiers = useMemo(() => worldIdentifiers(props.world), [props.world]);
  const lint = draft?.lint ?? [];
  const path = `lore.${id}`;
  const ctx = { doc: props.world, lint, path, identifiers, functions: draft?.functions ?? [] };
  const changed = JSON.stringify(value) !== JSON.stringify(stored ?? null);
  const secret = loreIsSecret(value);
  const audience = strings(value.audience).filter((s): s is StepPurpose => (LORE_AUDIENCE as readonly string[]).includes(s));
  const gate = typeof value.gate === "string" ? value.gate : "";
  const topicsInUse = useMemo(() => [...new Set(Object.values(props.world.lore).flatMap((l) => l.topics ?? []))].sort((a, b) => a.localeCompare(b)), [props.world.lore]);
  const keywordsInUse = useMemo(
    () =>
      [
        ...new Set(
          Object.entries(props.world.lore)
            .filter(([other]) => other !== id)
            .flatMap(([, l]) => l.keys),
        ),
      ].sort((a, b) => a.localeCompare(b)),
    [props.world.lore, id],
  );
  const set = (key: string, next: string[]) => {
    const out = { ...value };
    if (next.length > 0) out[key] = next;
    else delete out[key];
    setValue(out);
  };
  const title = typeof value.title === "string" && value.title.trim() !== "" ? value.title : id;
  // Lint on a field shows under it; what concerns the entry as a whole shows at the top.
  const banners = lint.filter((issue) => issue.path === path || issue.path === `${path}.id`);
  const save = () =>
    run(async () => {
      const message = await props.send({ type: "lre.editor", worldId: props.world.id, base: null, op: "put", collection: "lore", id, value });
      if (message.type === "lre.result" && isNew) go(app, { view: "item", worldId: props.world.id, collection: "lore", id });
    });
  const remove = () =>
    run(() =>
      deleteItem(app, props.send, {
        worldId: props.world.id,
        collection: "lore",
        id,
        name: title,
        message: `Delete the lore entry “${title}”? Terms and topics that lead to it will show in Problems.`,
      }),
    );
  return (
    <div class="lre-build-page" data-lre-editor="lore">
      <ItemHeader title={title} id={id} subtitle={isNew ? "New lore entry, not in the draft until you create it" : undefined} onDelete={isNew ? undefined : remove} busy={busy} />
      {banners.map((issue, i) => (
        <Banner key={`${issue.code}:${i}`} tone={issue.severity === "error" ? "warn" : "info"}>
          {issue.message}
        </Banner>
      ))}
      <Section title="Entry">
        <SchemaFields specs={TEXT} value={value} ctx={ctx} onChange={setValue} />
      </Section>
      <Section title="How it's found">
        <div class="lre-form-lore-fields">
          <TagListInput label="Aliases" noun="alias" value={strings(value.aliases)} suggestions={[]} onChange={(next) => set("aliases", next)}>
            <span class="lre-field-help">Other names it goes by</span>
            <Issues issues={lintAt(lint, `${path}.aliases`)} />
          </TagListInput>
          <TagListInput label="Topics" noun="topic" value={strings(value.topics)} suggestions={topicsInUse} onChange={(next) => set("topics", next)}>
            <span class="lre-field-help">What it's about; the lookup table can file it under these</span>
            <Issues issues={lintAt(lint, `${path}.topics`)} />
          </TagListInput>
          {/* The engine reads `keys` as a list, so an entry without keywords keeps an empty one. */}
          <TagListInput label="Keywords" noun="keyword" value={strings(value.keys)} suggestions={keywordsInUse} onChange={(next) => setValue({ ...value, keys: next })}>
            <span class="lre-field-help">Words that bring it up in a lookup</span>
            <Issues issues={lintAt(lint, `${path}.keys`)} />
          </TagListInput>
          <SchemaFields specs={MORE} value={value} ctx={ctx} onChange={setValue} />
        </div>
      </Section>
      <SourceSection app={app} source={loreSourceOf(value.source)} onSource={(source) => setValue({ ...value, source })} />
      <Section title="Secrecy">
        <div class="lre-form-lore-fields">
          <SchemaFields specs={SECRET} value={value} ctx={ctx} onChange={setValue} />
          {secret ? (
            <div class="lre-form-lore-fields" data-lre-lore-audience>
              {/* An emptied gate leaves the entry, as the stored field's own editor does. */}
              <FieldInput
                spec={SECRET_GATE_SPEC}
                value={value.gate}
                ctx={ctx}
                path={path}
                parent={value}
                onChange={(next) => {
                  const out = { ...value };
                  if (typeof next === "string" && next !== "") out.gate = next;
                  else delete out.gate;
                  setValue(out);
                }}
              />
              {gate.trim() === "" ? <GateExamples doc={props.world} onPick={(formula) => setValue({ ...value, gate: formula })} /> : null}
              <SchemaFields specs={HOLDERS} value={value} ctx={ctx} onChange={setValue} />
              <SecretAudience audience={audience} issues={lintAt(lint, `${path}.audience`)} onChange={(next) => set("audience", next)} />
            </div>
          ) : null}
        </div>
      </Section>
      <SaveBar>
        <Button variant="primary" disabled={!changed && !isNew} busy={busy} onClick={save}>
          {isNew ? "Create" : "Save to draft"}
        </Button>
        <Button variant="ghost" disabled={busy || !changed} onClick={() => setValue(initial)}>
          Revert
        </Button>
      </SaveBar>
    </div>
  );
}
