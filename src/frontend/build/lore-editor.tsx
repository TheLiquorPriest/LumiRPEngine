// Build → Lore (DESIGN §4.2): the entries, searchable by title, alias, topic, keyword and text, with
// the lookup table and the indexing jobs a tap away, and + New, which names a new entry; and the
// entry page: its title and text, how lookups find it (aliases, topics and keywords as chips, then
// links, group and priority), the source (read-only; an entry indexed from a World Info book whose
// entry changed since can take the book's new text), and secrecy: who may read it, the gate, whose
// own secret it is, and the helpers that may read the secret, with a note on those whose output
// reaches the player.
// Styles: the lore block of styles/forms.ts.

import { useEffect, useId, useMemo, useState } from "preact/hooks";
import type { JsonObject } from "../../shared/json";
import { hasOwn } from "../../shared/json";
import { LORE_AUDIENCE, loreIsSecret, loreSourceOf, PROSE_STEPS } from "../../shared/lore";
import type { LoreDrift } from "../../shared/protocol";
import type { LoreEntryDef, LoreSource, StepPurpose, WorldDoc } from "../../shared/world";
import type { App } from "../app";
import { useApp } from "../app";
import { Badge, Banner, Button, Empty, List, ListRow, PageHeader, SaveBar, Section, useBusy } from "../components";
import { strings } from "../decode";
import { Icon } from "../icons";
import type { EditorProps } from "../registry";
import { STEP_LABEL } from "../settings/steps";
import { useSelect } from "../store";
import { deleteItem, go, ItemHeader, NewItem, newItemName } from "./chrome";
import { CheckField, Issues } from "./form-kit";
import { useHeld } from "./held";
import { COLLECTION_SPECS, newItem } from "./schema";
import { lintAt, SchemaFields, worldIdentifiers } from "./schema-form";
import { TagListInput } from "./selector-editor";
import { BookEntriesSection, LoreBooksSection } from "./book-lore";

const specs = (keys: readonly string[]) => COLLECTION_SPECS.lore.filter((s) => keys.includes(s.key));
const TEXT = specs(["title", "content"]);
// Keywords (`keys`) are laid out as chips beside the aliases and topics, so they aren't here.
const MORE = specs(["links", "group", "priority"]);
const SECRET = specs(["visibility", "secret"]);
const GATE = specs(["gate", "holders"]);

/** The world's book-sourced entries (or just `id`) whose book entry changed or is gone: asked again whenever their sources change. */
function useDrift(app: App, worldId: string, lore: Readonly<Record<string, LoreEntryDef>>, id?: string): Record<string, LoreDrift> | null {
  const [drift, setDrift] = useState<Record<string, LoreDrift> | null>(null);
  const sourced = Object.entries(lore).filter(([key, l]) => (id === undefined || key === id) && loreSourceOf(l.source).kind === "book");
  const signature = JSON.stringify(sourced.map(([key, l]) => [key, l.source]));
  useEffect(() => {
    if (sourced.length === 0) return;
    void app.request(id === undefined ? { type: "lre.lore", op: "drift", worldId } : { type: "lre.lore", op: "drift", worldId, id }).then((body) => setDrift(body?.drift ?? {}));
  }, [worldId, signature]);
  return drift;
}

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
  const drift = useDrift(app, props.worldId, doc?.lore ?? {});
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
      <PageHeader title="Lore" subtitle="Kept in the world. The engine's helpers read it. The narrator gets no lore section, but the brief and the prose outline draw on public entries in what they write for its Outline." actions={add} />
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
          <ListRow icon="book" title="Index a World Info book" subtitle="Optional: copy a book into the world's own lore, with aliases, topics and lookup terms, for a world you export" chevron onClick={() => go(app, { view: "job", worldId: draft.worldId, kind: "index_book" })} />
          <ListRow icon="scroll" title="Index this text" subtitle="The same, from text you paste" chevron onClick={() => go(app, { view: "job", worldId: draft.worldId, kind: "index_text" })} />
        </List>
      </Section>
      <LoreBooksSection />
      <BookEntriesSection />
      <div class="lre-build-search">
        <Icon name="search" size={16} />
        <input class="lre-input" type="search" placeholder="Search titles, aliases, topics and text" aria-label="Search lore" value={query} onInput={(event) => setQuery(event.currentTarget.value)} />
      </div>
      {shown.length === 0 ? (
        all.length === 0 ? (
          <Empty icon="book" title="No lore yet" action={adding ? undefined : add}>
            Write an entry, or index a World Info book or some text.
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
              const changed = drift && hasOwn(drift, id) ? drift[id] : undefined;
              const issues = lintAt(draft.lint, `lore.${id}`).length;
              const aliases = l.aliases ?? [];
              const named = l.topics ?? [];
              const subtitle = [aliases.length > 0 ? `also ${aliases.join(", ")}` : "", named.join(", ")].filter((part) => part !== "").join(" · ");
              const secret = loreIsSecret(l);
              const kind = SOURCE_BADGE[source.kind];
              const badges = secret || kind || changed || issues > 0;
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
                          {kind ? <Badge>{source.kind === "ai" && source.status === "pending" ? "AI · to review" : kind}</Badge> : null}
                          {changed ? <Badge tone={changed.status === "changed" ? "warn" : "neg"}>{changed.status === "changed" ? "Book changed" : "Book entry gone"}</Badge> : null}
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

/** Where the entry came from, read-only; a book entry that changed since can be refreshed into the form. */
function SourceSection(props: { app: App; doc: WorldDoc; id: string; source: LoreSource; onSource(next: LoreSource, content?: string): void }) {
  const names = useBookNames(props.app);
  const drift = useDrift(props.app, props.doc.id, props.doc.lore, props.id);
  const { source } = props;
  if (source.kind === "book") {
    const now = drift && hasOwn(drift, props.id) ? drift[props.id] : undefined;
    const refreshed = now?.status === "changed" && now.hash === source.hash;
    return (
      <Section title="Source" aside={<Badge>World Info</Badge>}>
        <div class="lre-form-lore-source" data-lre-lore-source="book">
          <span>
            {names[source.bookId] ?? source.bookId} · entry <code class="lre-form-lore-mono">{source.entryId}</code>
          </span>
          {drift === null ? (
            <span class="lre-form-lore-note">Checking the book…</span>
          ) : refreshed ? (
            <span class="lre-form-lore-note">Refreshed from the book. Save to draft to keep it.</span>
          ) : now?.status === "changed" ? (
            <Banner
              tone="warn"
              actions={
                <Button size="sm" icon="refresh" onClick={() => props.onSource({ ...source, hash: now.hash }, now.content)}>
                  Refresh from book
                </Button>
              }
            >
              The book entry has changed since this was indexed.
            </Banner>
          ) : now?.status === "missing" ? (
            <Banner tone="warn">The book entry is gone, or its book was deleted. The text here stays as it is.</Banner>
          ) : (
            <span class="lre-form-lore-note">Matches the book.</span>
          )}
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
  const audienceLabel = useId();
  const lint = draft?.lint ?? [];
  const path = `lore.${id}`;
  const ctx = { doc: props.world, lint, path, identifiers, functions: draft?.functions ?? [] };
  const changed = JSON.stringify(value) !== JSON.stringify(stored ?? null);
  const secret = loreIsSecret(value);
  const audience = strings(value.audience).filter((s): s is StepPurpose => (LORE_AUDIENCE as readonly string[]).includes(s));
  const prose = audience.filter((s) => PROSE_STEPS.includes(s));
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
      <SourceSection
        app={app}
        doc={props.world}
        id={id}
        source={loreSourceOf(value.source)}
        onSource={(source, content) => setValue({ ...value, source, ...(content !== undefined ? { content } : {}) })}
      />
      <Section title="Secrecy">
        <div class="lre-form-lore-fields">
          <SchemaFields specs={SECRET} value={value} ctx={ctx} onChange={setValue} />
          {secret ? (
            <div class="lre-form-lore-fields" data-lre-lore-audience>
              <SchemaFields specs={GATE} value={value} ctx={ctx} onChange={setValue} />
              <div class="lre-field" role="group" aria-labelledby={audienceLabel}>
                <span class="label" id={audienceLabel}>
                  Helpers that may read it before the gate holds
                </span>
                {LORE_AUDIENCE.map((purpose) => (
                  <CheckField
                    key={purpose}
                    label={STEP_LABEL[purpose]}
                    help={PROSE_STEPS.includes(purpose) ? "Writes for the player: never reads a secret" : undefined}
                    checked={audience.includes(purpose)}
                    onChange={() => set("audience", audience.includes(purpose) ? audience.filter((p) => p !== purpose) : LORE_AUDIENCE.filter((p) => p === purpose || audience.includes(p)))}
                  />
                ))}
              </div>
              {prose.length > 0 ? (
                <Banner tone="warn">
                  {prose.map((p) => STEP_LABEL[p]).join(", ")} write{prose.length === 1 ? "s" : ""} what the narrator or the player sees, so {prose.length === 1 ? "it never reads" : "they never read"} this secret before its gate holds.
                </Banner>
              ) : null}
              <Issues issues={lintAt(lint, `${path}.audience`)} />
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
