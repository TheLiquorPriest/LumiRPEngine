// Build → Lore (DESIGN §4.2): the entries, searchable by title, alias, topic, keyword and text, with
// the lookup table a tap away; and the entry form: title and text, aliases and topics as chips,
// keywords and links, the source (read-only; an entry indexed from a World Info book whose entry
// changed since can take the book's new text), who may read it, and secrecy: the gate, and the
// helpers that may read the secret, with a note on those whose output reaches the player.

import { useEffect, useMemo, useState } from "preact/hooks";
import type { JsonObject } from "../../shared/json";
import { hasOwn } from "../../shared/json";
import { LORE_AUDIENCE, loreSourceOf, PROSE_STEPS } from "../../shared/lore";
import type { LintIssue, LoreDrift } from "../../shared/protocol";
import type { LoreEntryDef, LoreSource, StepPurpose, WorldDoc } from "../../shared/world";
import type { App, BuildRoute } from "../app";
import { useApp } from "../app";
import { Card, Empty, useBusy } from "../components";
import { strings } from "../decode";
import type { EditorProps } from "../registry";
import { STEP_LABEL } from "../settings/steps";
import { useSelect } from "../store";
import { COLLECTION_SPECS, newItem } from "./schema";
import { lintAt, SchemaFields, worldIdentifiers } from "./schema-form";
import { TagListInput } from "./selector-editor";

function go(app: App, build: BuildRoute): void {
  app.ui.update((ui) => ({ ...ui, build }));
}

const specs = (keys: readonly string[]) => COLLECTION_SPECS.lore.filter((s) => keys.includes(s.key));
const TEXT = specs(["title", "content"]);
const MORE = specs(["keys", "links", "group", "priority"]);
const SECRET = specs(["visibility", "secret"]);
const GATE = specs(["gate"]);

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
  const [newId, setNewId] = useState("");
  const doc = draft?.doc;
  const drift = useDrift(app, props.worldId, doc?.lore ?? {});
  if (!draft || !doc) return null;
  const q = query.trim().toLowerCase();
  const shown = Object.entries(doc.lore).filter(([id, l]) => q === "" || [id, l.title, ...(l.aliases ?? []), ...(l.topics ?? []), ...l.keys, l.content].join("\n").toLowerCase().includes(q));
  const create = () => {
    const id = newId.trim();
    if (!id || hasOwn(doc.lore, id)) return;
    go(app, { view: "item", worldId: draft.worldId, collection: "lore", id: `new:${id}` });
    setNewId("");
  };
  const terms = Object.keys(doc.loreIndex.terms).length;
  const topics = Object.keys(doc.loreIndex.topics).length;
  return (
    <div class="lre-stack" data-lre-lore-list>
      <div class="lre-h2">Lore</div>
      <span class="lre-small lre-muted">Kept in the world; it isn't delivered to the AI yet.</span>
      <div class="lre-list">
        <button type="button" class="lre-item" onClick={() => go(app, { view: "part", worldId: draft.worldId, part: "loreIndex" })}>
          <span class="grow">
            <span class="title">Lookup table</span>
            <span class="sub">
              {terms} term{terms === 1 ? "" : "s"} · {topics} topic{topics === 1 ? "" : "s"}
            </span>
          </span>
          {lintAt(draft.lint, "loreIndex").length > 0 ? <span class="lre-badge warn">{lintAt(draft.lint, "loreIndex").length}</span> : null}
          <span class="lre-dim" aria-hidden="true">
            ›
          </span>
        </button>
        <button type="button" class="lre-item" onClick={() => go(app, { view: "job", worldId: draft.worldId, kind: "index_book" })}>
          <span class="grow">
            <span class="title">Index a World Info book</span>
            <span class="sub">Lore entries, aliases, topics and lookup terms from one of your books</span>
          </span>
        </button>
        <button type="button" class="lre-item" onClick={() => go(app, { view: "job", worldId: draft.worldId, kind: "index_text" })}>
          <span class="grow">
            <span class="title">Index this text</span>
            <span class="sub">The same, from text you paste</span>
          </span>
        </button>
      </div>
      <input class="lre-input" placeholder="Search titles, aliases, topics and text" aria-label="Search lore" value={query} onInput={(event) => setQuery(event.currentTarget.value)} />
      <div class="lre-list">
        {shown.map(([id, l]) => {
          const source = loreSourceOf(l.source);
          const changed = drift && hasOwn(drift, id) ? drift[id] : undefined;
          const issues = lintAt(draft.lint, `lore.${id}`).length;
          return (
            <button key={id} type="button" class="lre-item" data-lre-lore={id} onClick={() => go(app, { view: "item", worldId: draft.worldId, collection: "lore", id })}>
              <span class="grow">
                <span class="title">{l.title || id}</span>
                <span class="sub">
                  <code>{id}</code>
                  {(l.aliases ?? []).length > 0 ? ` · also ${(l.aliases ?? []).join(", ")}` : ""}
                  {(l.topics ?? []).length > 0 ? ` · ${(l.topics ?? []).join(", ")}` : ""}
                </span>
              </span>
              {l.secret === true ? <span class="lre-badge warn">Secret</span> : null}
              {SOURCE_BADGE[source.kind] ? <span class="lre-badge">{source.kind === "ai" && source.status === "pending" ? "AI · to review" : SOURCE_BADGE[source.kind]}</span> : null}
              {changed ? <span class={changed.status === "changed" ? "lre-badge warn" : "lre-badge neg"}>{changed.status === "changed" ? "Book changed" : "Book entry gone"}</span> : null}
              {issues > 0 ? <span class="lre-badge warn">{issues}</span> : null}
            </button>
          );
        })}
        {shown.length === 0 ? <Empty>{Object.keys(doc.lore).length === 0 ? "No lore yet." : "No matches."}</Empty> : null}
      </div>
      <form
        class="lre-inline"
        onSubmit={(event) => {
          event.preventDefault();
          create();
        }}
      >
        <input class="lre-input" style={{ flex: 1 }} placeholder="New id (letters, digits, _)" aria-label="New id" value={newId} onInput={(event) => setNewId(event.currentTarget.value.replace(/[^\w.-]/g, "_"))} />
        <button type="submit" class="lre-btn primary" disabled={!newId.trim() || hasOwn(doc.lore, newId.trim())}>
          + New
        </button>
      </form>
    </div>
  );
}

/** Where the entry came from, read-only; a book entry that changed since can be refreshed into the form. */
function SourceCard(props: { app: App; doc: WorldDoc; id: string; source: LoreSource; onSource(next: LoreSource, content?: string): void }) {
  const names = useBookNames(props.app);
  const drift = useDrift(props.app, props.doc.id, props.doc.lore, props.id);
  const { source } = props;
  if (source.kind === "book") {
    const now = drift && hasOwn(drift, props.id) ? drift[props.id] : undefined;
    const refreshed = now?.status === "changed" && now.hash === source.hash;
    return (
      <Card title="Source" aside={<span class="lre-badge">World Info</span>}>
        <div class="lre-stack" data-lre-lore-source="book">
          <span>
            {names[source.bookId] ?? source.bookId} · entry <code>{source.entryId}</code>
          </span>
          {drift === null ? (
            <span class="lre-small lre-muted">Checking the book…</span>
          ) : refreshed ? (
            <span class="lre-small lre-muted">Refreshed from the book. Save to draft to keep it.</span>
          ) : now?.status === "changed" ? (
            <div class="lre-banner warn">
              The book entry has changed since this was indexed.
              <button type="button" class="lre-btn small" style={{ marginLeft: "8px" }} onClick={() => props.onSource({ ...source, hash: now.hash }, now.content)}>
                Refresh from book
              </button>
            </div>
          ) : now?.status === "missing" ? (
            <div class="lre-banner warn">The book entry is gone, or its book was deleted. The text here stays as it is.</div>
          ) : (
            <span class="lre-small lre-muted">Matches the book.</span>
          )}
        </div>
      </Card>
    );
  }
  if (source.kind === "chat") {
    return (
      <Card title="Source" aside={<span class="lre-badge">Chat</span>}>
        <span data-lre-lore-source="chat">
          Saved from a chat, message <code>{source.messageId}</code>.
        </span>
      </Card>
    );
  }
  if (source.kind === "ai") {
    return (
      <Card title="Source" aside={<span class="lre-badge">AI</span>}>
        <div class="lre-spread" data-lre-lore-source="ai">
          <span>Written by an indexing job from pasted text{source.status === "pending" ? "; not reviewed yet." : "; reviewed."}</span>
          {source.status === "pending" ? (
            <button type="button" class="lre-btn small" onClick={() => props.onSource({ kind: "ai", status: "accepted" })}>
              Mark reviewed
            </button>
          ) : null}
        </div>
      </Card>
    );
  }
  return (
    <Card title="Source" aside={<span class="lre-badge">Authored</span>}>
      <span class="lre-small lre-muted" data-lre-lore-source="authored">
        Written in Build.
      </span>
    </Card>
  );
}

export function LoreEditor(props: EditorProps) {
  const app = useApp();
  const draft = useSelect(app.drafts, (d) => d);
  const isNew = props.id?.startsWith("new:") ?? false;
  const id = isNew ? (props.id ?? "").slice(4) : (props.id ?? "");
  const stored = hasOwn(props.world.lore, id) ? props.world.lore[id] : undefined;
  // The form edits the entry as the JSON the draft stores, like every Build editor.
  const initial: JsonObject = stored ? (JSON.parse(JSON.stringify(stored)) as JsonObject) : newItem("lore", id, props.world);
  const [value, setValue] = useState<JsonObject>(initial);
  const [busy, run] = useBusy();
  useEffect(() => setValue(initial), [JSON.stringify(stored)]);
  const identifiers = useMemo(() => worldIdentifiers(props.world), [props.world]);
  const lint = draft?.lint ?? [];
  const path = `lore.${id}`;
  const ctx = { doc: props.world, lint, path, identifiers, functions: draft?.functions ?? [] };
  const changed = JSON.stringify(value) !== JSON.stringify(stored ?? null);
  const secret = value.secret === true;
  const audience = strings(value.audience).filter((s): s is StepPurpose => (LORE_AUDIENCE as readonly string[]).includes(s));
  const prose = audience.filter((s) => PROSE_STEPS.includes(s));
  const topicsInUse = useMemo(() => [...new Set(Object.values(props.world.lore).flatMap((l) => l.topics ?? []))].sort((a, b) => a.localeCompare(b)), [props.world.lore]);
  const set = (key: string, next: string[]) => {
    const out = { ...value };
    if (next.length > 0) out[key] = next;
    else delete out[key];
    setValue(out);
  };
  const banners = lint.filter((issue: LintIssue) => issue.path === path || issue.path === `${path}.id` || issue.path === `${path}.links` || issue.path === `${path}.visibility`);
  const save = () =>
    run(async () => {
      const message = await props.send({ type: "lre.editor", worldId: props.world.id, base: null, op: "put", collection: "lore", id, value });
      if (message.type === "lre.result" && isNew) go(app, { view: "item", worldId: props.world.id, collection: "lore", id });
    });
  const remove = () =>
    run(async () => {
      if (!(await app.host.confirm("Delete", `Delete lore “${id}”? Terms and topics that lead to it will show in Problems.`, "danger", "Delete"))) return;
      const message = await props.send({ type: "lre.editor", worldId: props.world.id, base: null, op: "remove", collection: "lore", id });
      if (message.type === "lre.result") go(app, { view: "collection", worldId: props.world.id, collection: "lore" });
    });
  return (
    <div class="lre-stack" data-lre-editor="lore">
      <div class="lre-spread">
        <span class="lre-h2">
          <code>{id}</code>
        </span>
        {!isNew ? (
          <button type="button" class="lre-btn small danger" disabled={busy} onClick={remove}>
            Delete
          </button>
        ) : null}
      </div>
      {banners.map((issue, i) => (
        <div key={`${issue.code}:${i}`} class={issue.severity === "error" ? "lre-banner warn" : "lre-banner info"}>
          {issue.message}
        </div>
      ))}
      <SchemaFields specs={TEXT} value={value} ctx={ctx} onChange={setValue} />
      <TagListInput label="Aliases" noun="alias" value={strings(value.aliases)} suggestions={[]} onChange={(next) => set("aliases", next)} />
      <TagListInput label="Topics" noun="topic" value={strings(value.topics)} suggestions={topicsInUse} onChange={(next) => set("topics", next)} />
      <SchemaFields specs={MORE} value={value} ctx={ctx} onChange={setValue} />
      <SourceCard
        app={app}
        doc={props.world}
        id={id}
        source={loreSourceOf(value.source)}
        onSource={(source, content) => setValue({ ...value, source, ...(content !== undefined ? { content } : {}) })}
      />
      <Card title="Secrecy">
        <SchemaFields specs={SECRET} value={value} ctx={ctx} onChange={setValue} />
        {secret ? (
          <div class="lre-stack" data-lre-lore-audience>
            <SchemaFields specs={GATE} value={value} ctx={ctx} onChange={setValue} />
            <span class="label lre-small">Helpers that may read it before the gate holds</span>
            {LORE_AUDIENCE.map((purpose) => (
              <label key={purpose} class="lre-row">
                <span class="k">
                  {STEP_LABEL[purpose]}
                  {PROSE_STEPS.includes(purpose) ? <span class="sub">Writes for the player: never reads a secret</span> : null}
                </span>
                <span class="lre-check">
                  <input type="checkbox" checked={audience.includes(purpose)} onChange={() => set("audience", audience.includes(purpose) ? audience.filter((p) => p !== purpose) : LORE_AUDIENCE.filter((p) => p === purpose || audience.includes(p)))} />
                </span>
              </label>
            ))}
            {prose.length > 0 ? <div class="lre-banner warn">{prose.map((p) => STEP_LABEL[p]).join(", ")} write{prose.length === 1 ? "s" : ""} what the narrator or the player sees, so {prose.length === 1 ? "it never reads" : "they never read"} this secret before its gate holds.</div> : null}
            {lintAt(lint, `${path}.audience`).map((issue, i) => (
              <span key={`${issue.code}:${i}`} class="lre-small lre-warn">
                {issue.message}
              </span>
            ))}
          </div>
        ) : null}
      </Card>
      <div class="lre-savebar">
        <button type="button" class="lre-btn primary" disabled={busy || (!changed && !isNew)} onClick={save}>
          {isNew ? "Create" : "Save to draft"}
        </button>
        <button type="button" class="lre-btn ghost" disabled={busy || !changed} onClick={() => setValue(initial)}>
          Revert
        </button>
      </div>
    </div>
  );
}
