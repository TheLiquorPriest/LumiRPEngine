// Build (DESIGN §13): a stack of pages, Worlds → World → Collection → Item
// → sub-editor pages, each of them usable on a phone. Worlds lists the worlds (open, Export,
// Delete) and New world starts one from a template, a file or LumiRPEngine Studio. Inside a world a
// sticky bar keeps Back, the draft's state and Commit in reach, with Discard in its overflow; the
// world's home groups its parts, its content and its tools; a collection lists its items by name,
// and + New asks for a name and derives the id. Item and part pages keep Save to draft and Revert
// in a sticky bar at the bottom. Packs replace the item page per collection (`UiRegistry.editor`).

import type { ComponentChildren } from "preact";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import type { WorldId } from "../../shared/ids";
import type { JsonObject, JsonValue } from "../../shared/json";
import { hasOwn, isRecord } from "../../shared/json";
import { mapSettingsOf } from "../../shared/maps";
import type { JobKind, LintIssue, WorldCollection, WorldPart } from "../../shared/protocol";
import { spawnCapOf, type WorldDoc, type WorldIndex } from "../../shared/world";
import type { BuildRoute } from "../app";
import { lorePinsJson, lorePinsOf } from "../../shared/lore";
import { routineSettingsOf } from "../../shared/routines";
import { LorePinsSection } from "./lore-pins";
import { useApp, useUi, useView } from "../app";
import { Badge, Banner, Button, Empty, Field, IconButton, IdText, JsonView, List, ListRow, PageHeader, SaveBar, Section, useBusy } from "../components";
import { humanize } from "../format";
import { Icon } from "../icons";
import type { EditorProps } from "../registry";
import { scrollParent } from "../scroll";
import { useSelect } from "../store";
import { CheckView, issuePart, IssueRow } from "./check";
import { COLLECTION_INFO, deleteItem, go, ItemHeader, itemLabel, NewItem, newItemName, OverflowMenu, PART_INFO } from "./chrome";
import { commitDraft, discardDraft, draftSend, loadDraft } from "./draft";
import { ChangedElsewhere, useHeld } from "./held";
import { JOB_INFO, jobStore, JobStatusBadge, JobView, keptJobs } from "./jobs";
import { LookupTableEditor } from "./lookup-editor";
import { MindsEditor } from "./minds-editor";
import { LoreEditor, LoreList } from "./lore-editor";
import { RulesetEditor } from "./ruleset-editor";
import { COLLECTION_SPECS, newItem, PART_SPECS } from "./schema";
import { lintAt, SchemaFields, worldIdentifiers } from "./schema-form";
import type { StudioOfferState } from "./studio-offer";
import { StudioOfferReview, useStudioOffer } from "./studio-offer";
import { TableEditor } from "./table-editor";
import { TiersEditor } from "./tiers-editor";

/** The world's content in the story's own groups. */
const GROUPS: readonly { title: string; collections: readonly WorldCollection[] }[] = [
  { title: "People & things", collections: ["entities", "kinds", "classifications", "relations"] },
  { title: "Places", collections: ["places", "maps", "routes", "grids"] },
  { title: "Rules", collections: ["actions", "checks", "rules", "schedules"] },
  { title: "Story", collections: ["tracks", "lore"] },
  { title: "Engine", collections: ["tables", "sections", "steps", "packs"] },
];

const PARTS: readonly WorldPart[] = ["meta", "calendar", "realism", "tiers", "time", "ruleset", "loreIndex", "minds"];

const TOOLS: readonly JobKind[] = ["import_lore", "index_book", "index_text", "refine", "describe_map", "playtest", "check_world"];

export function Build() {
  const route = useUi((ui) => ui.build);
  const root = useRef<HTMLDivElement>(null);
  const page = JSON.stringify(route);
  // Every page opens at its top, as a new page does, not at the scroll the last one left.
  useLayoutEffect(() => {
    const scroller = root.current ? scrollParent(root.current) : null;
    if (scroller && scroller.scrollTop > 0) scroller.scrollTop = 0;
  }, [page]);
  return (
    <div ref={root} class="lre-build-root">
      <BuildPage route={route} />
    </div>
  );
}

function BuildPage(props: { route: BuildRoute }) {
  const route = props.route;
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
          <WorldHome />
        </WithDraft>
      );
    case "collection":
      return (
        <WithDraft worldId={route.worldId}>
          {route.collection === "lore" ? <LoreList worldId={route.worldId} /> : <CollectionView collection={route.collection} />}
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

/** How many issues a part, a collection or an item has, in the colour of the worst, with an icon and words for screen readers. */
function IssueBadge(props: { issues: readonly LintIssue[] }) {
  const count = props.issues.length;
  if (count === 0) return null;
  const tone = props.issues.some((i) => i.severity === "error") ? "neg" : props.issues.some((i) => i.severity === "warning") ? "warn" : "neutral";
  return (
    <Badge tone={tone}>
      <Icon name="alert" size={12} />
      {count}
      <span class="lre-sr">{count === 1 ? " issue" : " issues"}</span>
    </Badge>
  );
}

/**
 * Loads the world's draft once, then shows the world bar over the page: Back one level, the
 * world's name and its draft's state, Commit, and Discard in the overflow. The bar stays under the
 * mode bar while the page scrolls, with the notice of a change made elsewhere when there is one.
 */
function WithDraft(props: { worldId: WorldId; children: ComponentChildren }) {
  const app = useApp();
  const draft = useSelect(app.drafts, (d) => d);
  const route = useUi((ui) => ui.build);
  const [failed, setFailed] = useState(false);
  const [busy, run] = useBusy();
  const load = () => {
    setFailed(false);
    void loadDraft(app, props.worldId).then((loaded) => setFailed(loaded === null));
  };
  useEffect(() => {
    if (draft?.worldId === props.worldId) return;
    load();
  }, [props.worldId]);
  if (!draft || draft.worldId !== props.worldId) {
    return (
      <div class="lre-build-page" data-lre-section="build">
        <PageHeader title="World" onBack={() => go(app, { view: "worlds" })} backLabel="Worlds" />
        {failed ? (
          <Empty icon="alert" title="This world could not be loaded." action={<Button onClick={load}>Try again</Button>} />
        ) : (
          <Empty icon="hourglass">Loading the world…</Empty>
        )}
      </div>
    );
  }
  const errors = draft.lint.filter((issue) => issue.severity === "error").length;
  const warnings = draft.lint.filter((issue) => issue.severity === "warning").length;
  const up: { route: BuildRoute; label: string } =
    route.view === "world"
      ? { route: { view: "worlds" }, label: "Worlds" }
      : route.view === "item"
        ? { route: { view: "collection", worldId: props.worldId, collection: route.collection }, label: COLLECTION_INFO[route.collection].label }
        : { route: { view: "world", worldId: props.worldId }, label: draft.doc.name };
  const blocked = errors > 0 ? `${errors} error${errors === 1 ? "" : "s"} block the commit` : undefined;
  return (
    <div class="lre-build" data-lre-section="build">
      <div class="lre-build-bar" data-lre-world-bar>
        <div class="lre-build-bar-row">
          <IconButton icon="chevron-left" label={`Back to ${up.label}`} onClick={() => go(app, up.route)} />
          <div class="lre-build-bar-text">
            <span class="lre-build-bar-name">{draft.doc.name}</span>
            <span class="lre-build-bar-state" data-lre-draft={draft.dirty ? "changed" : "committed"}>
              {draft.dirty ? <span class="lre-dot" aria-hidden="true" /> : null}
              <span>{draft.dirty ? <>Uncommitted<span class="lre-sr"> changes</span></> : "All committed"}</span>
              {errors > 0 ? <Badge tone="neg">{errors === 1 ? "1 error" : `${errors} errors`}</Badge> : null}
              {warnings > 0 ? <Badge tone="warn">{warnings === 1 ? "1 warning" : `${warnings} warnings`}</Badge> : null}
            </span>
          </div>
          <Button size="sm" variant={draft.dirty ? "primary" : "secondary"} disabled={!draft.dirty} busy={busy} title={blocked} label={blocked ? `Commit, ${blocked}` : undefined} onClick={() => run(() => commitDraft(app))}>
            Commit
          </Button>
          <OverflowMenu label="Draft actions" items={[{ label: "Discard changes", icon: "trash", danger: true, disabled: !draft.dirty || busy, onSelect: () => run(() => discardDraft(app)) }]} />
        </div>
        <ChangedElsewhere />
      </div>
      {props.children}
    </div>
  );
}

// ---------------------------------------------------------------- Worlds

/** What an import flagged (macros in lore and templates), kept on screen until dismissed. */
interface ImportReview {
  worldId: WorldId;
  name: string;
  issues: LintIssue[];
  from: string;
}

function Worlds() {
  const app = useApp();
  const view = useView();
  const [worlds, setWorlds] = useState<WorldIndex[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [review, setReview] = useState<ImportReview | null>(null);
  const [busy, run] = useBusy();
  const fileInput = useRef<HTMLInputElement>(null);
  const refresh = () => void app.request({ type: "lre.world", op: "list" }).then((result) => setWorlds(result?.worlds ?? []));
  useEffect(refresh, []);
  const studio = useStudioOffer({
    installed: () => {
      refresh();
      setAdding(false);
    },
    review: (next) => setReview({ ...next, from: "LumiRPEngine Studio" }),
  });
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
        setReview(result.world && issues.length > 0 ? { worldId: result.world.id, name: result.world.name, issues, from: "a file" } : null);
        setAdding(false);
        refresh();
      }
    });
  const exportWorld = (world: WorldIndex) =>
    run(async () => {
      const result = await app.request({ type: "lre.world", op: "export", worldId: world.id });
      if (result?.file !== undefined) app.host.download(`${world.name.replace(/[^\w-]+/g, "_") || "world"}.lre-world.json`, JSON.stringify(result.file, null, 2));
    });
  const deleteWorld = (world: WorldIndex) =>
    run(async () => {
      if (!(await app.host.confirm("Delete world", `Delete “${world.name}” and all its revisions? Chats attached to it stop simulating.`, "danger", "Delete"))) return;
      if (await app.request({ type: "lre.world", op: "delete", worldId: world.id })) refresh();
    });
  return (
    <div class="lre-build-page" data-lre-section="build">
      {adding ? (
        <PageHeader title="New world" subtitle="Start from a template, or bring one in" onBack={() => setAdding(false)} backLabel="Worlds" />
      ) : (
        <PageHeader
          title="Worlds"
          subtitle={worlds === null ? undefined : worlds.length === 1 ? "1 world" : `${worlds.length} worlds`}
          actions={
            <Button size="sm" variant="primary" icon="plus" onClick={() => setAdding(true)}>
              New world
            </Button>
          }
        />
      )}
      <StudioOfferReview state={studio} />
      {review ? (
        <Section title="Review before playing" aside={<Badge tone="warn">{review.issues.length}</Badge>}>
          <div class="lre-stack" data-lre-import-review>
            <Banner tone="warn">
              “{review.name}” came from {review.from}. Its lore and templates contain macros that Lumiverse runs when it builds a prompt; open each one and check it before you play.
            </Banner>
            <div class="lre-build-issues lre-build-well" role="list">
              {review.issues.map((issue, i) => (
                <IssueRow key={i} issue={issue} worldId={review.worldId} />
              ))}
            </div>
            <div class="lre-build-actions">
              <Button size="sm" variant="ghost" icon="check" onClick={() => setReview(null)}>
                Done reviewing
              </Button>
            </div>
          </div>
        </Section>
      ) : null}
      {adding ? (
        <NewWorld studio={studio} importing={busy} onImport={() => fileInput.current?.click()} />
      ) : worlds === null ? (
        <Empty icon="hourglass">Loading…</Empty>
      ) : worlds.length === 0 ? (
        <Empty
          icon="globe"
          title="No worlds yet"
          action={
            <Button variant="primary" icon="plus" onClick={() => setAdding(true)}>
              New world
            </Button>
          }
        >
          Start one from a template, or import one.
        </Empty>
      ) : (
        <div class="lre-build-worlds" role="list" data-lre-worlds>
          {worlds.map((world) => (
            <div key={world.id} class="lre-build-world" role="listitem">
              <button type="button" class="lre-build-world-open" onClick={() => go(app, { view: "world", worldId: world.id })}>
                <span class="lre-build-tile">
                  <Icon name="globe" />
                </span>
                <span class="lre-build-world-text">
                  <span class="lre-build-world-name">{world.name}</span>
                  <span class="lre-build-note">{world.revisions.length === 1 ? "1 revision" : `${world.revisions.length} revisions`}</span>
                  <IdText id={world.id} />
                </span>
                {view?.worldId === world.id ? <Badge tone="accent">This chat</Badge> : null}
              </button>
              <OverflowMenu
                label={`More for ${world.name}`}
                disabled={busy}
                items={[
                  { label: "Export", icon: "download", onSelect: () => exportWorld(world) },
                  { label: "Delete", icon: "trash", danger: true, onSelect: () => deleteWorld(world) },
                ]}
              />
            </div>
          ))}
        </div>
      )}
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
    </div>
  );
}

/** A template card's choice: a starter `lre.world templates` lists, or a blank world (`id` null). */
interface Start {
  id: string | null;
  name: string;
  summary: string;
}

const BLANK: Start = { id: null, name: "Blank", summary: "An empty world with no people, places or rules yet, to build from scratch." };

/**
 * New world: the starters as cards with their blurbs, a name (a template's own until the user types
 * one), Create; then Import a file and Import from LumiRPEngine Studio.
 */
function NewWorld(props: { studio: StudioOfferState; importing: boolean; onImport(): void }) {
  const app = useApp();
  const [starters, setStarters] = useState<Start[] | null>(null);
  const [template, setTemplate] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [typed, setTyped] = useState(false);
  const [busy, run] = useBusy();
  const nameId = useId();
  const group = useId();
  useEffect(() => {
    void app.request({ type: "lre.world", op: "templates" }).then((result) => setStarters(result?.templates ?? []));
  }, []);
  const create = () => {
    if (!name.trim()) return;
    run(async () => {
      const result = await app.request({ type: "lre.world", op: "create", name: name.trim(), template });
      if (result?.world) go(app, { view: "world", worldId: result.world.id });
    });
  };
  const message = props.studio.message && !props.studio.offer ? props.studio.message : null;
  return (
    <>
      <Section title="Start from">
        <div class="lre-build-templates" role="radiogroup" aria-label="Start from" data-lre-templates>
          {[BLANK, ...(starters ?? [])].map((start) => (
            <label key={start.id ?? ""} class="lre-build-template" data-lre-template={start.id ?? "blank"}>
              <input
                type="radio"
                class="lre-sr"
                name={group}
                checked={template === start.id}
                onChange={() => {
                  setTemplate(start.id);
                  if (!typed) setName(start.id === null ? "" : start.name);
                }}
              />
              <span class="lre-build-template-text">
                <span class="lre-build-template-name">{start.name}</span>
                <span class="lre-build-note">{start.summary}</span>
              </span>
              <span class="lre-build-template-mark" aria-hidden="true">
                <Icon name="check" size={16} />
              </span>
            </label>
          ))}
          {starters === null ? <p class="lre-build-note">Loading the starter worlds…</p> : null}
        </div>
      </Section>
      <form
        class="lre-stack"
        onSubmit={(event) => {
          event.preventDefault();
          create();
        }}
      >
        <Field label="Name" for={nameId}>
          <input
            id={nameId}
            class="lre-input"
            placeholder="Name your world"
            autoComplete="off"
            value={name}
            onInput={(event) => {
              setName(event.currentTarget.value);
              setTyped(event.currentTarget.value !== "");
            }}
          />
        </Field>
        <Button type="submit" variant="primary" block disabled={!name.trim()} busy={busy}>
          Create world
        </Button>
      </form>
      <Section title="Or bring one in" flush>
        <List>
          <ListRow icon="upload" title="Import a file" subtitle="An lre-world-v1 file, as Export writes it" chevron disabled={props.importing} onClick={props.onImport} />
          <ListRow icon="sparkle" title="Import from LumiRPEngine Studio" subtitle={message ?? "Review what the Studio offers, then install it"} chevron disabled={props.studio.busy} onClick={props.studio.load} />
        </List>
      </Section>
    </>
  );
}

// ---------------------------------------------------------------- a world

function WorldHome() {
  const app = useApp();
  const draft = useSelect(app.drafts, (d) => d);
  const view = useView();
  const jobs = useSelect(jobStore, (all) => all);
  const [busy, run] = useBusy();
  const worldId = draft?.worldId;
  // The tools say how their last runs went: the backend keeps each world's jobs.
  useEffect(() => {
    if (!worldId) return;
    void app.request({ type: "lre.job", op: "list", worldId }).then((body) => {
      const kept = body?.jobs;
      if (kept) jobStore.update((all) => keptJobs(all, worldId, kept));
    });
  }, [worldId]);
  if (!draft) return null;
  const doc = draft.doc;
  const counts = (["error", "warning", "info"] as const).flatMap((severity) => {
    const n = draft.lint.filter((issue) => issue.severity === severity).length;
    return n === 0 ? [] : [`${n} ${severity === "info" ? "note" : severity}${n === 1 ? "" : "s"}`];
  });
  return (
    <div class="lre-build-page" data-lre-world-home>
      <Section title="World" aside={<IdText id={doc.format} />} flush>
        <List>
          {PARTS.map((part) => (
            <ListRow
              key={part}
              icon={PART_INFO[part].icon}
              title={PART_INFO[part].label}
              subtitle={PART_INFO[part].hint}
              badge={<IssueBadge issues={draft.lint.filter((issue) => issuePart(issue.path) === part)} />}
              chevron
              onClick={() => go(app, { view: "part", worldId: draft.worldId, part })}
            />
          ))}
        </List>
      </Section>
      {GROUPS.map((group) => (
        <Section key={group.title} title={group.title} flush>
          <List>
            {group.collections.map((collection) => (
              <ListRow
                key={collection}
                icon={COLLECTION_INFO[collection].icon}
                title={COLLECTION_INFO[collection].label}
                subtitle={COLLECTION_INFO[collection].hint}
                value={Object.keys(doc[collection] ?? {}).length}
                valueTone="muted"
                badge={<IssueBadge issues={lintAt(draft.lint, collection)} />}
                chevron
                onClick={() => go(app, { view: "collection", worldId: draft.worldId, collection })}
              />
            ))}
          </List>
        </Section>
      ))}
      <Section title="Tools" flush>
        <List>
          <ListRow icon="checklist" title="Problems" subtitle={counts.length === 0 ? "No issues in the draft" : counts.join(", ")} chevron onClick={() => go(app, { view: "check", worldId: draft.worldId })} />
          {TOOLS.map((kind) => {
            const job = jobs[`${draft.worldId}:${kind}`];
            return <ListRow key={kind} icon={JOB_INFO[kind].icon} title={JOB_INFO[kind].title} subtitle={JOB_INFO[kind].hint} badge={job ? <JobStatusBadge status={job.status} /> : undefined} chevron onClick={() => go(app, { view: "job", worldId: draft.worldId, kind })} />;
          })}
          {view && view.status === "not_world" ? (
            <ListRow
              icon="link"
              title="Attach to this chat"
              subtitle="Play this world in the chat that's open"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  if (!(await app.host.confirm("Attach world", `Attach “${doc.name}” to the open chat?`, "info", "Attach"))) return;
                  if (await app.request({ type: "lre.world", op: "attach", worldId: draft.worldId, chatId: view.chatId })) void app.client.open(view.chatId);
                })
              }
            />
          ) : null}
        </List>
      </Section>
    </div>
  );
}

function CollectionView(props: { collection: WorldCollection }) {
  const app = useApp();
  const draft = useSelect(app.drafts, (d) => d);
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  if (!draft) return null;
  const doc = draft.doc;
  const info = COLLECTION_INFO[props.collection];
  const items = Object.entries(doc[props.collection] as Record<string, unknown>).map(([id, value]) => ({ id, value, label: itemLabel(props.collection, id, value, doc.places) }));
  const q = query.trim().toLowerCase();
  const shown = items.filter((item) => !q || item.id.toLowerCase().includes(q) || item.label.toLowerCase().includes(q));
  const kinds = { ...draft.packKinds, ...doc.kinds };
  // Data tables come from packs: a world edits its copy of one and never starts one.
  const canAdd = props.collection !== "tables";
  const detail = (value: unknown): string | undefined => {
    if (!isRecord(value)) return undefined;
    const parts: string[] = [];
    if (typeof value.kind === "string" && value.kind) parts.push(hasOwn(kinds, value.kind) ? (kinds[value.kind]?.label ?? value.kind) : humanize(value.kind));
    if (typeof value.pack === "string" && value.pack) parts.push(humanize(value.pack));
    if (typeof value.map === "string") parts.push(`Drawn by the map ${itemLabel("maps", value.map, hasOwn(doc.maps, value.map) ? doc.maps[value.map] : undefined)}`);
    return parts.length > 0 ? parts.join(" · ") : undefined;
  };
  const add = (
    <Button variant="primary" icon="plus" onClick={() => setAdding(true)}>
      New {info.noun}
    </Button>
  );
  return (
    <div class="lre-build-page" data-lre-collection={props.collection}>
      <PageHeader
        title={info.label}
        subtitle={info.hint}
        actions={
          canAdd && !adding ? (
            <Button size="sm" variant="primary" icon="plus" label={`New ${info.noun}`} onClick={() => setAdding(true)}>
              New
            </Button>
          ) : undefined
        }
      />
      {adding ? <NewItem worldId={draft.worldId} collection={props.collection} taken={new Set(items.map((item) => item.id))} onDone={() => setAdding(false)} /> : null}
      {canAdd ? null : <p class="lre-build-note">New data tables come from packs; open one to edit this world's copy of it.</p>}
      {items.length > 8 ? (
        <div class="lre-build-search">
          <Icon name="search" size={16} />
          <input class="lre-input" type="search" placeholder={`Search ${info.label.toLowerCase()}`} aria-label={`Search ${info.label.toLowerCase()}`} value={query} onInput={(event) => setQuery(event.currentTarget.value)} />
        </div>
      ) : null}
      {shown.length === 0 ? (
        items.length === 0 ? (
          <Empty icon={info.icon} title={`No ${info.label.toLowerCase()} yet`} action={canAdd && !adding ? add : undefined}>
            {info.hint}
          </Empty>
        ) : (
          <Empty icon="search" title="No matches">
            Nothing here matches “{query.trim()}”.
          </Empty>
        )
      ) : (
        <Section flush>
          <List>
            {shown.map((item) => (
              <ListRow
                key={item.id}
                title={item.label}
                subtitle={detail(item.value)}
                id={item.id}
                badge={<IssueBadge issues={lintAt(draft.lint, `${props.collection}.${item.id}`)} />}
                chevron
                onClick={() => go(app, { view: "item", worldId: draft.worldId, collection: props.collection, id: item.id })}
              />
            ))}
          </List>
        </Section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- item and part pages

/** An item a map draws (DESIGN §4.1): read-only here, edited in its map. */
export function MapOwned(props: { worldId: string; collection: WorldCollection; id: string; value: unknown; map: string }) {
  const app = useApp();
  const doc = useSelect(app.drafts, (d) => d?.doc);
  const map = itemLabel("maps", props.map, doc && hasOwn(doc.maps, props.map) ? doc.maps[props.map] : undefined);
  return (
    <div class="lre-build-page" data-lre-editor={props.collection} data-lre-owned={props.map}>
      <ItemHeader title={itemLabel(props.collection, props.id, props.value, doc?.places)} id={props.id} />
      <Banner
        tone="info"
        icon="lock"
        title="Drawn by a map"
        actions={
          <Button size="sm" variant="primary" icon="map" onClick={() => go(app, { view: "item", worldId: props.worldId, collection: "maps", id: props.map })}>
            Edit in map
          </Button>
        }
      >
        The map {map} draws this {COLLECTION_INFO[props.collection].noun}, so it's read-only here.
      </Banner>
      <Section title="As stored">
        <JsonView value={props.value} />
      </Section>
      {props.collection === "places" ? <LorePinsSection target="places" id={props.id} /> : null}
    </div>
  );
}

/**
 * The default editor for any collection: the schema-driven form over `COLLECTION_SPECS` on an item
 * page; an item a map draws shows read-only. `children` (a pack's own section) follow the fields.
 */
export function SchemaEditor(props: EditorProps & { children?: ComponentChildren }) {
  const app = useApp();
  const draft = useSelect(app.drafts, (d) => d);
  const isNew = props.id?.startsWith("new:") ?? false;
  const id = isNew ? (props.id ?? "").slice(4) : (props.id ?? "");
  const stored = (props.world[props.collection] as Record<string, unknown>)[id];
  const initial: JsonObject = isRecord(stored) ? (stored as JsonObject) : newItem(props.collection, id, props.world, newItemName(props.world.id, props.collection, id));
  const [value, setValue] = useState<JsonObject>(initial);
  const [busy, run] = useBusy();
  useHeld(value, setValue, initial, `${props.world.id}/${props.collection}/${props.id ?? ""}`, JSON.stringify(stored ?? null));
  const identifiers = useMemo(() => worldIdentifiers(props.world), [props.world]);
  // Pickers and kind-typed fields see the packs' kinds and relation types too (DESIGN §13); the world's own win.
  const formDoc = useMemo(() => ({ ...props.world, kinds: { ...draft?.packKinds, ...props.world.kinds }, relations: { ...draft?.packRelations, ...props.world.relations } }), [props.world, draft?.packKinds, draft?.packRelations]);
  const path = `${props.collection}.${id}`;
  const changed = JSON.stringify(value) !== JSON.stringify(isRecord(stored) ? stored : null);
  // A pack's entry shows the pack's own config fields, when its ui registers them, above the JSON.
  const PackConfig = props.collection === "packs" ? app.catalog.configs.get(id) : undefined;
  if (isRecord(stored) && typeof stored.map === "string") return <MapOwned worldId={props.world.id} collection={props.collection} id={id} value={stored} map={stored.map} />;
  const noun = COLLECTION_INFO[props.collection].noun;
  const name = itemLabel(props.collection, id, value, props.world.places);
  const save = () =>
    run(async () => {
      const message = await props.send({ type: "lre.editor", worldId: props.world.id, base: null, op: "put", collection: props.collection, id, value });
      if (message.type === "lre.result" && isNew) go(app, { view: "item", worldId: props.world.id, collection: props.collection, id });
    });
  return (
    <div class="lre-build-page" data-lre-editor={props.collection}>
      <ItemHeader title={name} id={id} subtitle={isNew ? `New ${noun}, not in the draft until you create it` : undefined} onDelete={isNew ? undefined : () => run(() => deleteItem(app, props.send, { worldId: props.world.id, collection: props.collection, id, name }))} busy={busy} />
      {lintAt(draft?.lint ?? [], path)
        .filter((issue) => issue.path === path)
        .map((issue) => (
          <Banner key={issue.code} tone={issue.severity === "error" ? "neg" : issue.severity === "warning" ? "warn" : "info"}>
            {issue.message}
          </Banner>
        ))}
      {PackConfig ? <PackConfig world={props.world} config={isRecord(value.config) ? value.config : {}} lint={lintAt(draft?.lint ?? [], `${path}.config`)} onChange={(config) => setValue({ ...value, config })} /> : null}
      <SchemaFields specs={COLLECTION_SPECS[props.collection]} value={value} ctx={{ doc: formDoc, lint: draft?.lint ?? [], path, identifiers, functions: draft?.functions ?? [], fieldEditors: app.catalog.fields }} onChange={setValue} />
      {props.collection === "places"
        ? app.catalog.placeFields.map((def) => {
            // A pack's place field is edited inside the place's `fields`, which the JSON above shows too.
            const fields: JsonObject = isRecord(value.fields) ? (value.fields as JsonObject) : {};
            return (
              <div key={def.field} data-lre-place-field={def.field}>
                <Section title={def.label}>
                  <def.component
                    doc={formDoc}
                    place={{ id, fields }}
                    field={def.field}
                    value={fields[def.field]}
                    lint={lintAt(draft?.lint ?? [], `${path}.fields.${def.field}`)}
                    path={`${path}.fields.${def.field}`}
                    onChange={(next) => {
                      const out: JsonObject = { ...fields };
                      if (next === undefined) delete out[def.field];
                      else out[def.field] = next;
                      setValue({ ...value, fields: out });
                    }}
                  />
                </Section>
              </div>
            );
          })
        : null}
      {!isNew && (props.collection === "entities" || props.collection === "places") ? <LorePinsSection target={props.collection === "entities" ? "characters" : "places"} id={id} /> : null}
      {props.children}
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

function ItemView(props: { collection: WorldCollection; id: string | null }) {
  const app = useApp();
  const draft = useSelect(app.drafts, (d) => d);
  const send = useMemo(() => draftSend(app), [app]);
  if (!draft) return null;
  const registered = app.catalog.editors.get(props.collection);
  const Editor = registered ? registered.component : props.collection === "tables" ? TableEditor : props.collection === "lore" ? LoreEditor : SchemaEditor;
  return <Editor world={draft.doc} collection={props.collection} id={props.id} send={send} />;
}

function partValue(doc: WorldDoc, part: Exclude<WorldPart, "tiers" | "loreIndex" | "ruleset" | "minds" | "lorePins" | "routineSettings">): JsonObject {
  switch (part) {
    case "calendar":
      return doc.calendar as unknown as JsonObject;
    case "realism":
      return doc.realism as unknown as JsonObject;
    case "time":
      return doc.time as unknown as JsonObject;
    case "meta":
      // Map settings and the spawn cap show as the world plays them: a world without them, with the defaults.
      return { name: doc.name, pov: doc.pov, start: { ...doc.start }, seedMode: doc.seedMode, lenientPricing: doc.lenientPricing, spawnCap: spawnCapOf(doc), lifeStates: structuredClone(doc.lifeStates ?? {}) as unknown as JsonObject, currency: { ...doc.currency }, mapSettings: structuredClone(mapSettingsOf(doc)) as unknown as JsonObject };
  }
}

function PartView(props: { part: WorldPart }) {
  const app = useApp();
  const draft = useSelect(app.drafts, (d) => d);
  const send = useMemo(() => draftSend(app), [app]);
  if (!draft) return null;
  if (props.part === "tiers") return <TiersEditor doc={draft.doc} lint={draft.lint} save={(value) => send({ type: "lre.editor", worldId: draft.worldId, base: draft.base, op: "set", part: "tiers", value })} />;
  if (props.part === "loreIndex") return <LookupTableEditor doc={draft.doc} lint={draft.lint} save={(value) => send({ type: "lre.editor", worldId: draft.worldId, base: draft.base, op: "set", part: "loreIndex", value })} />;
  if (props.part === "ruleset") return <RulesetEditor />;
  if (props.part === "minds") return <MindsEditor />;
  if (props.part === "lorePins") {
    return (
      <div class="lre-build-page" data-lre-editor="part:lorePins">
        <PageHeader title={PART_INFO.lorePins.label} subtitle={PART_INFO.lorePins.hint} />
        <Section title="As stored">
          <JsonView value={lorePinsJson(lorePinsOf(draft.doc))} />
        </Section>
      </div>
    );
  }
  if (props.part === "routineSettings") {
    return (
      <div class="lre-build-page" data-lre-editor="part:routineSettings">
        <PageHeader title={PART_INFO.routineSettings.label} subtitle={PART_INFO.routineSettings.hint} />
        <Section title="In force">
          <JsonView value={{ ...routineSettingsOf(draft.doc) }} />
        </Section>
      </div>
    );
  }
  return <SchemaPartView part={props.part} />;
}

function SchemaPartView(props: { part: Exclude<WorldPart, "tiers" | "loreIndex" | "ruleset" | "minds" | "lorePins" | "routineSettings"> }) {
  const app = useApp();
  const draft = useSelect(app.drafts, (d) => d);
  const send = useMemo(() => draftSend(app), [app]);
  const initial = draft ? partValue(draft.doc, props.part) : {};
  const [value, setValue] = useState<JsonObject>(initial);
  const [busy, run] = useBusy();
  useHeld(value, setValue, initial, `${draft?.worldId ?? ""}/${props.part}`);
  const identifiers = useMemo(() => (draft ? worldIdentifiers(draft.doc) : []), [draft?.doc]);
  if (!draft) return null;
  const changed = JSON.stringify(value) !== JSON.stringify(initial);
  return (
    <div class="lre-build-page" data-lre-editor={`part:${props.part}`}>
      <PageHeader title={PART_INFO[props.part].label} subtitle={PART_INFO[props.part].hint} />
      <SchemaFields specs={PART_SPECS[props.part]} value={value} ctx={{ doc: draft.doc, lint: draft.lint, path: props.part, identifiers, functions: draft.functions }} onChange={setValue} />
      <SaveBar>
        <Button
          variant="primary"
          disabled={!changed}
          busy={busy}
          onClick={() =>
            run(async () => {
              await send({ type: "lre.editor", worldId: draft.worldId, base: draft.base, op: "set", part: props.part, value });
            })
          }
        >
          Save to draft
        </Button>
        <Button variant="ghost" disabled={!changed || busy} onClick={() => setValue(initial)}>
          Revert
        </Button>
      </SaveBar>
    </div>
  );
}
