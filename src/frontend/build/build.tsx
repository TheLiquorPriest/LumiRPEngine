// Build (DESIGN §13): worlds (create from a template, import, export, delete, attach), a world's
// collections and singletons, the schema-driven editors (packs override per collection through
// `UiRegistry.editor`), Problems (lint), the background jobs (Check world among them) and Commit.

import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { JsonObject, JsonValue } from "../../shared/json";
import { isRecord } from "../../shared/json";
import type { LintIssue, WorldCollection, WorldPart } from "../../shared/protocol";
import type { WorldDoc, WorldIndex } from "../../shared/world";
import type { App, BuildRoute } from "../app";
import { useApp, useUi, useView } from "../app";
import { Card, Empty, useBusy } from "../components";
import type { EditorProps } from "../registry";
import { useSelect } from "../store";
import { CheckView, issueTarget } from "./check";
import { commitDraft, discardDraft, draftSend, loadDraft } from "./draft";
import { JobView } from "./jobs";
import { COLLECTION_SPECS, newItem, PART_SPECS } from "./schema";
import { lintAt, SchemaFields, worldIdentifiers } from "./schema-form";
import { TableEditor } from "./table-editor";

const COLLECTIONS: { id: WorldCollection; label: string; hint: string }[] = [
  { id: "entities", label: "Entities", hint: "People, things, vehicles" },
  { id: "places", label: "Places", hint: "Where things happen" },
  { id: "routes", label: "Routes", hint: "Travel between places" },
  { id: "grids", label: "Grids", hint: "Maps inside places" },
  { id: "kinds", label: "Kinds", hint: "Types and their fields" },
  { id: "relations", label: "Relations", hint: "How entities connect" },
  { id: "actions", label: "Actions", hint: "What the player can do" },
  { id: "checks", label: "Checks", hint: "Dice and outcome bands" },
  { id: "rules", label: "Rules", hint: "When this, do that" },
  { id: "schedules", label: "Schedules", hint: "Routines, shifts, weather" },
  { id: "tracks", label: "Tracks", hint: "Quests, secrets, puzzles, agendas" },
  { id: "lore", label: "Lore", hint: "What the world knows; synced to the engine's book" },
  { id: "tables", label: "Data tables", hint: "Prices, jobs, regions…" },
  { id: "sections", label: "Sections", hint: "What the narrator reads" },
  { id: "steps", label: "Step templates", hint: "Prompted model steps" },
  { id: "packs", label: "Packs", hint: "Enabled domain packs" },
];

const PARTS: { id: WorldPart; label: string }[] = [
  { id: "meta", label: "World" },
  { id: "calendar", label: "Calendar" },
  { id: "realism", label: "Realism defaults" },
  { id: "time", label: "Time defaults" },
];

const TEMPLATES: { id: string | null; label: string }[] = [
  { id: null, label: "Blank" },
  { id: "fantasy_town", label: "Fantasy town" },
  { id: "mystery_manor", label: "Mystery manor" },
  { id: "modern_slice_of_life", label: "Modern slice-of-life (Simulation)" },
];

function go(app: App, build: BuildRoute): void {
  app.ui.update((ui) => ({ ...ui, build }));
}

export function Build() {
  const route = useUi((ui) => ui.build);
  switch (route.view) {
    case "worlds":
      return <Worlds />;
    case "check":
      return (
        <WithDraft worldId={route.worldId}>
          <CheckView worldId={route.worldId} />
        </WithDraft>
      );
    case "job":
      return (
        <WithDraft worldId={route.worldId}>
          <JobView worldId={route.worldId} kind={route.kind} />
        </WithDraft>
      );
    case "world":
      return (
        <WithDraft worldId={route.worldId}>
          <WorldOverview />
        </WithDraft>
      );
    case "collection":
      return (
        <WithDraft worldId={route.worldId}>
          <CollectionView collection={route.collection} />
        </WithDraft>
      );
    case "item":
      return (
        <WithDraft worldId={route.worldId}>
          <ItemView collection={route.collection} id={route.id} />
        </WithDraft>
      );
    case "part":
      return (
        <WithDraft worldId={route.worldId}>
          <PartView part={route.part} />
        </WithDraft>
      );
  }
}

/** Loads the world's draft once, then renders the bar (back, commit) and the view. */
function WithDraft(props: { worldId: string; children: ComponentChildren }) {
  const app = useApp();
  const draft = useSelect(app.drafts, (d) => d);
  const route = useUi((ui) => ui.build);
  const [failed, setFailed] = useState(false);
  const [busy, run] = useBusy();
  useEffect(() => {
    if (draft?.worldId === props.worldId) return;
    void loadDraft(app, props.worldId).then((loaded) => setFailed(loaded === null));
  }, [props.worldId]);
  if (!draft || draft.worldId !== props.worldId) return failed ? <Empty>This world could not be loaded.</Empty> : <Empty>Loading the world…</Empty>;
  const errors = draft.lint.filter((issue) => issue.severity === "error").length;
  const back: BuildRoute = route.view === "world" ? { view: "worlds" } : route.view === "item" ? { view: "collection", worldId: props.worldId, collection: route.collection } : { view: "world", worldId: props.worldId };
  return (
    <div class="lre-stack" data-lre-section="build">
      <div class="lre-spread">
        <button type="button" class="lre-btn small" onClick={() => go(app, back)}>
          <span aria-hidden="true">‹</span> Back
        </button>
        <span class="lre-small lre-muted" style={{ minWidth: 0, overflowWrap: "anywhere" }}>
          {draft.doc.name}
          {draft.dirty ? " · unsaved draft" : ""}
        </span>
        {draft.dirty ? (
          <button
            type="button"
            class="lre-btn small ghost"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await discardDraft(app);
              })
            }
          >
            Discard
          </button>
        ) : null}
        <button
          type="button"
          class={draft.dirty ? "lre-btn small primary" : "lre-btn small"}
          disabled={!draft.dirty || busy}
          title={errors > 0 ? `${errors} error(s) block the commit` : undefined}
          aria-label={errors > 0 ? `Commit, ${errors} error(s) block the commit` : undefined}
          onClick={() =>
            run(async () => {
              await commitDraft(app);
            })
          }
        >
          Commit{errors > 0 ? ` (${errors}⚠)` : ""}
        </button>
      </div>
      {props.children}
    </div>
  );
}

function Worlds() {
  const app = useApp();
  const view = useView();
  const [worlds, setWorlds] = useState<WorldIndex[] | null>(null);
  const [name, setName] = useState("");
  const [template, setTemplate] = useState<string | null>(null);
  const [busy, run] = useBusy();
  const fileInput = useRef<HTMLInputElement>(null);
  // What an import flagged (macros in lore and templates), kept on screen until dismissed.
  const [review, setReview] = useState<{ worldId: string; name: string; issues: LintIssue[] } | null>(null);
  const refresh = () => void app.request({ type: "lre.world", op: "list" }).then((result) => setWorlds(result?.worlds ?? []));
  useEffect(refresh, []);
  const importFile = (file: File) =>
    run(async () => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(await file.text());
      } catch {
        app.toast("That file isn't JSON.", "error");
        return;
      }
      const result = await app.request({ type: "lre.world", op: "import", file: parsed as JsonValue });
      if (result) {
        const issues = result.lint ?? [];
        app.toast(issues.length > 0 ? `Imported “${result.world?.name ?? "world"}”. Review ${issues.length} item(s) below before playing.` : `Imported “${result.world?.name ?? "world"}”.`, "info");
        setReview(result.world && issues.length > 0 ? { worldId: result.world.id, name: result.world.name, issues } : null);
        refresh();
      }
    });
  return (
    <div class="lre-stack" data-lre-section="build">
      {review ? (
        <Card title="Review before playing" aside={<span class="lre-badge warn">{review.issues.length}</span>}>
          <div class="lre-banner warn">
            “{review.name}” came from a file. Its lore and templates contain macros that Lumiverse runs when it builds a prompt; open each one and check it before you play.
          </div>
          <div class="lre-list" data-lre-import-review>
            {review.issues.map((issue, i) => {
              const target = issueTarget(issue.path);
              return (
                <div key={i} class="lre-item" style={{ flexWrap: "wrap" }}>
                  <span class="grow" style={{ flexBasis: "180px", minWidth: 0 }}>
                    <span class="title" style={{ overflowWrap: "anywhere" }}>{issue.message}</span>
                    <span class="sub">{issue.path}</span>
                  </span>
                  {target ? (
                    <button type="button" class="lre-btn small" onClick={() => go(app, { view: "item", worldId: review.worldId, collection: target.collection, id: target.id })}>
                      Open
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
          <button type="button" class="lre-btn small ghost" onClick={() => setReview(null)}>
            Done reviewing
          </button>
        </Card>
      ) : null}
      <Card title="Worlds" aside={worlds ? <span class="lre-badge">{worlds.length}</span> : null}>
        {worlds === null ? (
          <Empty>Loading…</Empty>
        ) : worlds.length === 0 ? (
          <Empty>No worlds yet.</Empty>
        ) : (
          <div class="lre-list">
            {worlds.map((world) => (
              <div key={world.id} class="lre-item" style={{ flexWrap: "wrap" }}>
                <button type="button" class="grow" style={{ border: 0, background: "transparent", textAlign: "left", minHeight: "40px", padding: 0, flexBasis: "140px" }} onClick={() => go(app, { view: "world", worldId: world.id })}>
                  <span class="title">{world.name}</span>
                  <span class="sub">
                    {world.revisions.length} revision{world.revisions.length === 1 ? "" : "s"}
                    {view?.worldId === world.id ? " · this chat" : ""}
                  </span>
                </button>
                <button
                  type="button"
                  class="lre-btn small"
                  aria-label={`Export ${world.name}`}
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      const result = await app.request({ type: "lre.world", op: "export", worldId: world.id });
                      if (result?.file !== undefined) app.host.download(`${world.name.replace(/[^\w-]+/g, "_") || "world"}.lre-world.json`, JSON.stringify(result.file, null, 2));
                    })
                  }
                >
                  Export
                </button>
                <button
                  type="button"
                  class="lre-btn small danger"
                  aria-label={`Delete ${world.name}`}
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      if (!(await app.host.confirm("Delete world", `Delete “${world.name}” and all its revisions? Chats attached to it stop simulating.`, "danger", "Delete"))) return;
                      if (await app.request({ type: "lre.world", op: "delete", worldId: world.id })) refresh();
                    })
                  }
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>
      <Card title="New world">
        <form
          class="lre-stack"
          onSubmit={(event) => {
            event.preventDefault();
            if (!name.trim()) return;
            run(async () => {
              const result = await app.request({ type: "lre.world", op: "create", name: name.trim(), template });
              if (result?.world) {
                setName("");
                go(app, { view: "world", worldId: result.world.id });
              }
            });
          }}
        >
          <input class="lre-input" placeholder="World name" aria-label="World name" value={name} onInput={(event) => setName(event.currentTarget.value)} />
          <select class="lre-input" aria-label="Template" value={template ?? ""} onChange={(event) => setTemplate(event.currentTarget.value || null)}>
            {TEMPLATES.map((t) => (
              <option key={t.label} value={t.id ?? ""}>
                {t.label}
              </option>
            ))}
          </select>
          <button type="submit" class="lre-btn primary" disabled={!name.trim() || busy}>
            Create world
          </button>
        </form>
      </Card>
      <Card title="Import">
        <button type="button" class="lre-btn block" onClick={() => fileInput.current?.click()}>
          Import an lre-world-v1 file…
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (file) importFile(file);
            event.currentTarget.value = "";
          }}
        />
      </Card>
    </div>
  );
}

function WorldOverview() {
  const app = useApp();
  const draft = useSelect(app.drafts, (d) => d);
  const view = useView();
  const [busy, run] = useBusy();
  if (!draft) return null;
  const doc = draft.doc;
  const errors = draft.lint.filter((i) => i.severity === "error").length;
  const warnings = draft.lint.length - errors;
  return (
    <div class="lre-stack">
      <Card title="World" aside={<span class="lre-badge">{doc.format}</span>}>
        <div class="lre-list">
          {PARTS.map((part) => (
            <button key={part.id} type="button" class="lre-item" onClick={() => go(app, { view: "part", worldId: draft.worldId, part: part.id })}>
              <span class="grow">{part.label}</span>
              <span class="lre-dim" aria-hidden="true">
                ›
              </span>
            </button>
          ))}
        </div>
      </Card>
      <Card title="Content">
        <div class="lre-list">
          {COLLECTIONS.map((c) => {
            const count = Object.keys(doc[c.id]).length;
            const issues = lintAt(draft.lint, c.id).length;
            return (
              <button key={c.id} type="button" class="lre-item" onClick={() => go(app, { view: "collection", worldId: draft.worldId, collection: c.id })}>
                <span class="grow">
                  <span class="title">{c.label}</span>
                  <span class="sub">{c.hint}</span>
                </span>
                {issues > 0 ? <span class="lre-badge warn">{issues}</span> : null}
                <span class="lre-badge">{count}</span>
              </button>
            );
          })}
        </div>
      </Card>
      <Card title="Tools">
        <div class="lre-list">
          <button type="button" class="lre-item" onClick={() => go(app, { view: "check", worldId: draft.worldId })}>
            <span class="grow">
              <span class="title">Problems</span>
              <span class="sub">{draft.lint.length === 0 ? "No issues in the draft" : `${errors} error(s), ${warnings} warning(s)`}</span>
            </span>
          </button>
          <button type="button" class="lre-item" onClick={() => go(app, { view: "job", worldId: draft.worldId, kind: "import_lore" })}>
            <span class="grow">
              <span class="title">Import from lore</span>
              <span class="sub">Turn lore-book entries into entities, places and facts</span>
            </span>
          </button>
          <button type="button" class="lre-item" onClick={() => go(app, { view: "job", worldId: draft.worldId, kind: "refine" })}>
            <span class="grow">
              <span class="title">Build / Refine with AI</span>
              <span class="sub">Describe changes; review every proposal</span>
            </span>
          </button>
          <button type="button" class="lre-item" onClick={() => go(app, { view: "job", worldId: draft.worldId, kind: "playtest" })}>
            <span class="grow">
              <span class="title">Playtest</span>
              <span class="sub">Run scripted turns on the background lane</span>
            </span>
          </button>
          <button type="button" class="lre-item" onClick={() => go(app, { view: "job", worldId: draft.worldId, kind: "check_world" })}>
            <span class="grow">
              <span class="title">Check world</span>
              <span class="sub">Simulate days on the background lane; report drops, failures and leaks</span>
            </span>
          </button>
          {view && view.status !== "not_world" ? null : view ? (
            <button
              type="button"
              class="lre-item"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  if (!(await app.host.confirm("Attach world", `Attach “${doc.name}” to the open chat?`, "info", "Attach"))) return;
                  if (await app.request({ type: "lre.world", op: "attach", worldId: draft.worldId, chatId: view.chatId })) void app.client.open(view.chatId);
                })
              }
            >
              <span class="grow">
                <span class="title">Attach to this chat</span>
              </span>
            </button>
          ) : null}
        </div>
      </Card>
    </div>
  );
}

function itemLabel(collection: WorldCollection, id: string, value: unknown): string {
  if (!isRecord(value)) return id;
  if (typeof value.name === "string" && value.name) return value.name;
  if (typeof value.label === "string" && value.label) return value.label;
  if (typeof value.title === "string" && value.title) return value.title;
  if (collection === "routes" && typeof value.from === "string") return `${value.from} → ${String(value.to)}`;
  return id;
}

function CollectionView(props: { collection: WorldCollection }) {
  const app = useApp();
  const draft = useSelect(app.drafts, (d) => d);
  const [query, setQuery] = useState("");
  const [newId, setNewId] = useState("");
  if (!draft) return null;
  const entries = Object.entries(draft.doc[props.collection] as Record<string, unknown>);
  const q = query.trim().toLowerCase();
  const shown = entries.filter(([id, value]) => !q || id.toLowerCase().includes(q) || itemLabel(props.collection, id, value).toLowerCase().includes(q));
  const meta = COLLECTIONS.find((c) => c.id === props.collection);
  const create = () => {
    const id = newId.trim();
    if (!id || id in draft.doc[props.collection]) return;
    go(app, { view: "item", worldId: draft.worldId, collection: props.collection, id: `new:${id}` });
    setNewId("");
  };
  return (
    <div class="lre-stack">
      <div class="lre-h2">{meta?.label ?? props.collection}</div>
      {entries.length > 8 ? <input class="lre-input" placeholder="Search" aria-label="Search" value={query} onInput={(event) => setQuery(event.currentTarget.value)} /> : null}
      <div class="lre-list">
        {shown.map(([id, value]) => {
          const issues = lintAt(draft.lint, `${props.collection}.${id}`).length;
          return (
            <button key={id} type="button" class="lre-item" onClick={() => go(app, { view: "item", worldId: draft.worldId, collection: props.collection, id })}>
              <span class="grow">
                <span class="title">{itemLabel(props.collection, id, value)}</span>
                <span class="sub">
                  <code>{id}</code>
                  {isRecord(value) && typeof value.kind === "string" ? ` · ${value.kind}` : ""}
                  {isRecord(value) && typeof value.pack === "string" && value.pack ? ` · ${value.pack}` : ""}
                </span>
              </span>
              {issues > 0 ? <span class="lre-badge warn">{issues}</span> : null}
            </button>
          );
        })}
        {shown.length === 0 ? <Empty>{entries.length === 0 ? "None yet." : "No matches."}</Empty> : null}
      </div>
      <form
        class="lre-inline"
        onSubmit={(event) => {
          event.preventDefault();
          create();
        }}
      >
        <input class="lre-input" style={{ flex: 1 }} placeholder="New id (letters, digits, _)" aria-label="New id" value={newId} onInput={(event) => setNewId(event.currentTarget.value.replace(/[^\w.-]/g, "_"))} />
        <button type="submit" class="lre-btn primary" disabled={!newId.trim() || newId.trim() in draft.doc[props.collection]}>
          + New
        </button>
      </form>
    </div>
  );
}

/** The default editor for any collection: the schema-driven form over `COLLECTION_SPECS`. */
export function SchemaEditor(props: EditorProps) {
  const app = useApp();
  const draft = useSelect(app.drafts, (d) => d);
  const isNew = props.id?.startsWith("new:") ?? false;
  const id = isNew ? (props.id ?? "").slice(4) : props.id ?? "";
  const stored = (props.world[props.collection] as Record<string, unknown>)[id];
  const initial: JsonObject = isRecord(stored) ? (stored as JsonObject) : newItem(props.collection, id);
  const [value, setValue] = useState<JsonObject>(initial);
  const [busy, run] = useBusy();
  useEffect(() => setValue(initial), [JSON.stringify(stored)]);
  const identifiers = useMemo(() => worldIdentifiers(props.world), [props.world]);
  // Pickers and kind-typed fields see the packs' kinds too (DESIGN §13); the world's own kinds win.
  const formDoc = useMemo(() => ({ ...props.world, kinds: { ...draft?.packKinds, ...props.world.kinds } }), [props.world, draft?.packKinds]);
  const path = `${props.collection}.${id}`;
  const changed = JSON.stringify(value) !== JSON.stringify(isRecord(stored) ? stored : null);
  const save = () =>
    run(async () => {
      const message = await props.send({ type: "lre.editor", worldId: props.world.id, base: null, op: "put", collection: props.collection, id, value });
      if (message.type === "lre.result" && isNew) go(app, { view: "item", worldId: props.world.id, collection: props.collection, id });
    });
  const remove = () =>
    run(async () => {
      if (!(await app.host.confirm("Delete", `Delete ${props.collection} “${id}”? References to it will show in Problems.`, "danger", "Delete"))) return;
      const message = await props.send({ type: "lre.editor", worldId: props.world.id, base: null, op: "remove", collection: props.collection, id });
      if (message.type === "lre.result") go(app, { view: "collection", worldId: props.world.id, collection: props.collection });
    });
  return (
    <div class="lre-stack" data-lre-editor={props.collection}>
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
      {lintAt(draft?.lint ?? [], path)
        .filter((issue) => issue.path === path)
        .map((issue) => (
          <div key={issue.code} class={issue.severity === "error" ? "lre-banner warn" : "lre-banner info"}>
            {issue.message}
          </div>
        ))}
      <SchemaFields specs={COLLECTION_SPECS[props.collection]} value={value} ctx={{ doc: formDoc, lint: draft?.lint ?? [], path, identifiers }} onChange={setValue} />
      <div class="lre-inline" style={{ position: "sticky", bottom: 0, padding: "8px 0", background: "var(--lre-fill)" }}>
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

function ItemView(props: { collection: WorldCollection; id: string | null }) {
  const app = useApp();
  const draft = useSelect(app.drafts, (d) => d);
  const send = useMemo(() => draftSend(app), [app]);
  if (!draft) return null;
  const registered = app.catalog.editors.get(props.collection);
  const Editor = registered ? registered.component : props.collection === "tables" ? TableEditor : SchemaEditor;
  return <Editor world={draft.doc} collection={props.collection} id={props.id} send={send} />;
}

function partValue(doc: WorldDoc, part: WorldPart): JsonObject {
  switch (part) {
    case "calendar":
      return doc.calendar as unknown as JsonObject;
    case "realism":
      return doc.realism as unknown as JsonObject;
    case "time":
      return doc.time as unknown as JsonObject;
    case "meta":
      return { name: doc.name, pov: doc.pov, start: { ...doc.start }, seedMode: doc.seedMode, lenientPricing: doc.lenientPricing, currency: { ...doc.currency } };
  }
}

function PartView(props: { part: WorldPart }) {
  const app = useApp();
  const draft = useSelect(app.drafts, (d) => d);
  const send = useMemo(() => draftSend(app), [app]);
  const initial = draft ? partValue(draft.doc, props.part) : {};
  const [value, setValue] = useState<JsonObject>(initial);
  const [busy, run] = useBusy();
  useEffect(() => setValue(initial), [JSON.stringify(initial)]);
  const identifiers = useMemo(() => (draft ? worldIdentifiers(draft.doc) : []), [draft?.doc]);
  if (!draft) return null;
  const changed = JSON.stringify(value) !== JSON.stringify(initial);
  return (
    <div class="lre-stack" data-lre-editor={`part:${props.part}`}>
      <div class="lre-h2">{PARTS.find((p) => p.id === props.part)?.label}</div>
      <SchemaFields specs={PART_SPECS[props.part]} value={value} ctx={{ doc: draft.doc, lint: draft.lint, path: props.part, identifiers }} onChange={setValue} />
      <div class="lre-inline">
        <button
          type="button"
          class="lre-btn primary"
          disabled={!changed || busy}
          onClick={() =>
            run(async () => {
              await send({ type: "lre.editor", worldId: draft.worldId, base: draft.base, op: "set", part: props.part, value });
            })
          }
        >
          Save to draft
        </button>
        <button type="button" class="lre-btn ghost" disabled={!changed || busy} onClick={() => setValue(initial)}>
          Revert
        </button>
      </div>
    </div>
  );
}
