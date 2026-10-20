// Build's track editor (DESIGN §13): a quest, secret, puzzle or agenda as its
// stages, laid out from the start along `next` and `fail` edges, with the stages it can't reach
// flagged. On a phone the stages are a list in that order, on a desktop a graph; either view is a
// tap away. A stage opens as a sheet: its label, cue and secret truth, objectives, the stages it
// leads to (picked by name, each with its condition), how it fails, hints, effects and rewards.

import { useId, useMemo, useState } from "preact/hooks";
import type { JsonObject, JsonValue } from "../../../shared/json";
import { isRecord } from "../../../shared/json";
import { nameOfId } from "../../../shared/maps";
import type { LintIssue } from "../../../shared/protocol";
import type { StageDef, TrackDef, TrackKind, WorldDoc } from "../../../shared/world";
import { useApp } from "../../../frontend/app";
import { deleteItem, go, ItemHeader, newItemName } from "../../../frontend/build/chrome";
import { ExprEditor } from "../../../frontend/build/expr-editor";
import { AddPicker, CheckField, FormGroup, FormSheet, Issues, ItemRow, RefPicker, type RefOption } from "../../../frontend/build/form-kit";
import { useHeld } from "../../../frontend/build/held";
import { deriveId, EFFECT, type FieldSpec } from "../../../frontend/build/schema";
import { FieldInput, lintAt, refOptions, SchemaFields, worldIdentifiers } from "../../../frontend/build/schema-form";
import { SelectorEditor } from "../../../frontend/build/selector-editor";
import { Badge, Banner, Button, Disclosure, Field, IconButton, IdText, SaveBar, Section, Seg, useBusy } from "../../../frontend/components";
import { isMobile } from "../../../frontend/layout";
import type { EditorProps } from "../../../frontend/registry";
import { useSelect } from "../../../frontend/store";

export interface TrackNode {
  id: string;
  layer: number;
  row: number;
  reachable: boolean;
}

export interface TrackEdge {
  from: string;
  to: string;
  fail: boolean;
}

/** Layers by BFS distance from the start; unreachable stages go in one extra layer. */
export function layoutTrack(track: Pick<TrackDef, "start" | "stages">): { nodes: TrackNode[]; edges: TrackEdge[] } {
  const edges: TrackEdge[] = [];
  for (const [id, stage] of Object.entries(track.stages)) {
    for (const next of stage.next) edges.push({ from: id, to: next.to, fail: false });
    if (stage.fail) edges.push({ from: id, to: stage.fail.to, fail: true });
  }
  const layer = new Map<string, number>();
  if (track.start in track.stages) {
    layer.set(track.start, 0);
    const queue = [track.start];
    while (queue.length > 0) {
      const id = queue.shift() ?? "";
      const depth = layer.get(id) ?? 0;
      for (const edge of edges) {
        if (edge.from === id && edge.to in track.stages && !layer.has(edge.to)) {
          layer.set(edge.to, depth + 1);
          queue.push(edge.to);
        }
      }
    }
  }
  const last = Math.max(-1, ...layer.values()) + 1;
  const rows = new Map<number, number>();
  const nodes = Object.keys(track.stages).map((id) => {
    const reachable = layer.has(id);
    const l = reachable ? layer.get(id) ?? 0 : last;
    const row = rows.get(l) ?? 0;
    rows.set(l, row + 1);
    return { id, layer: l, row, reachable };
  });
  return { nodes, edges };
}

/** The stages in reading order: by distance from the start, then as the track lists them; unreachable ones last. */
export function stageOrder(track: Pick<TrackDef, "start" | "stages">): TrackNode[] {
  return [...layoutTrack(track).nodes].sort((a, b) => a.layer - b.layer || a.row - b.row);
}

/** The track with a stage taken out, and every way to it with it. */
export function removeStage(track: TrackDef, id: string): TrackDef {
  const stages: Record<string, StageDef> = {};
  for (const [sid, s] of Object.entries(track.stages)) {
    if (sid === id) continue;
    stages[sid] = { ...s, next: s.next.filter((n) => n.to !== id), fail: s.fail?.to === id ? undefined : s.fail };
  }
  return { ...track, stages };
}

// Layers run down the drawer, stages of one layer side by side: a narrow drawer holds two across.
const NODE_W = 130;
const NODE_H = 48;
const GAP_X = 16;
const GAP_Y = 36;
/** Room on the right for a way back up to an earlier stage. */
const LOOP = 36;

const KINDS = [
  { value: "quest", label: "Quest" },
  { value: "secret", label: "Secret" },
  { value: "puzzle", label: "Puzzle" },
  { value: "agenda", label: "Agenda" },
] as const satisfies readonly { value: TrackKind; label: string }[];

const VISIBILITY = [
  { value: "public", label: "Everyone" },
  { value: "known_by", label: "Those who know" },
  { value: "secret", label: "Secret" },
] as const satisfies readonly { value: TrackDef["visibility"]; label: string }[];

/** The stage graph; a node opens its stage. Colours come from the theme (visual-editors.ts), and the start and stages it can't reach say so in words too. */
function TrackGraph(props: { track: TrackDef; current: string | null; onOpen(id: string): void }) {
  const { nodes, edges } = layoutTrack(props.track);
  const arrow = useId();
  const pos = new Map(nodes.map((n) => [n.id, { x: 8 + n.row * (NODE_W + GAP_X), y: 8 + n.layer * (NODE_H + GAP_Y) }]));
  const width = 16 + (Math.max(0, ...nodes.map((n) => n.row)) + 1) * (NODE_W + GAP_X) - GAP_X + LOOP;
  const height = 16 + (Math.max(0, ...nodes.map((n) => n.layer)) + 1) * (NODE_H + GAP_Y) - GAP_Y;
  return (
    <div class="lre-ve-graph" data-lre-track-graph>
      <svg width={width} height={height} role="group" aria-label="Stage graph">
        <defs>
          <marker id={`${arrow}-n`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path class="arrow" d="M0,0 L10,5 L0,10 z" />
          </marker>
          <marker id={`${arrow}-f`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path class="arrow fail" d="M0,0 L10,5 L0,10 z" />
          </marker>
        </defs>
        {edges.map((e, i) => {
          const a = pos.get(e.from);
          const b = pos.get(e.to);
          if (!a || !b) return null;
          // Down to a later layer from the bottom edge; back up (or across) by a loop on the right.
          const back = b.y <= a.y;
          const x1 = back ? a.x + NODE_W : a.x + NODE_W / 2;
          const y1 = back ? a.y + NODE_H / 2 : a.y + NODE_H;
          const x2 = back ? b.x + NODE_W : b.x + NODE_W / 2;
          const y2 = back ? b.y + NODE_H / 2 : b.y;
          const mid = (y1 + y2) / 2;
          return <path key={i} class={e.fail ? "edge fail" : "edge"} d={back ? `M${x1},${y1} C${Math.max(x1, x2) + LOOP - 6},${y1} ${Math.max(x1, x2) + LOOP - 6},${y2} ${x2},${y2}` : `M${x1},${y1} C${x1},${mid} ${x2},${mid} ${x2},${y2}`} marker-end={`url(#${arrow}-${e.fail ? "f" : "n"})`} />;
        })}
        {nodes.map((n) => {
          const p = pos.get(n.id);
          const stage = props.track.stages[n.id];
          if (!p || !stage) return null;
          const isStart = n.id === props.track.start;
          const label = stage.label || nameOfId(n.id);
          return (
            <g
              key={n.id}
              class={["node", isStart ? "start" : "", n.reachable ? "" : "lost", n.id === props.current ? "current" : ""].filter(Boolean).join(" ")}
              transform={`translate(${p.x},${p.y})`}
              role="button"
              tabIndex={0}
              aria-label={`Stage ${label}${isStart ? ", the start" : ""}${n.reachable ? "" : ", can't be reached"}`}
              onClick={() => props.onOpen(n.id)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                props.onOpen(n.id);
              }}
            >
              <title>{label}</title>
              <rect width={NODE_W} height={NODE_H} rx={10} />
              <text class="name" x={10} y={20}>
                {label.length > 17 ? `${label.slice(0, 16)}…` : label}
              </text>
              <text class="meta" x={10} y={37}>
                {isStart ? "Start" : n.reachable ? `${stage.next.length} next${stage.fail ? " · can fail" : ""}` : "Can't be reached"}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** A stage's fields the schema form lays out; its next stages and how it fails have their own pickers. */
const STAGE_SPECS: FieldSpec[] = [
  { kind: "text", key: "label", label: "Label" },
  { kind: "text", key: "cue", label: "Cue (the player sees it)", multiline: true, optional: true },
  { kind: "text", key: "truth", label: "Secret truth (GM only until it's revealed)", multiline: true, optional: true },
  { kind: "list", key: "objectives", label: "Objectives", item: { kind: "expr", key: "", label: "Objective" } },
  { kind: "expr", key: "gate", label: "Gate (it can't be entered until this holds)", optional: true },
  { kind: "list", key: "hints", label: "Hints", item: { kind: "text", key: "", label: "Hint" } },
  { kind: "number", key: "priority", label: "Planner priority (agendas)", optional: true },
  { kind: "list", key: "effects", label: "Effects on entering", item: EFFECT, title: "type" },
  { kind: "list", key: "rewards", label: "Rewards", item: EFFECT, title: "type" },
  { kind: "json", key: "answer", label: "Puzzle answer", optional: true, hint: '{"expect": ["…"], "normalize": true, "decision": {"threshold": 0.8}}' },
];

function StageSheet(props: { track: TrackDef; id: string; world: WorldDoc; identifiers: readonly string[]; functions: readonly string[]; lint: readonly LintIssue[]; path: string; onChange(track: TrackDef): void; onOpen(id: string): void; onClose(): void }) {
  const { track, id } = props;
  const stage = track.stages[id];
  if (!stage) {
    return (
      <FormSheet title="Stage" backLabel="Track" onClose={props.onClose}>
        <span class="lre-muted">This stage isn't in the track any more.</span>
      </FormSheet>
    );
  }
  const set = (next: StageDef) => props.onChange({ ...track, stages: { ...track.stages, [id]: next } });
  const stages: RefOption[] = Object.entries(track.stages).map(([sid, s]) => ({ value: sid, label: s.label || nameOfId(sid), ...(sid === track.start ? { sublabel: "the start" } : {}) }));
  const others = stages.filter((s) => s.value !== id);
  const path = `${props.path}.stages.${id}`;
  const exprLint = (at: string) => lintAt(props.lint, at);
  const move = (i: number, delta: -1 | 1) => {
    const next = [...stage.next];
    const [item] = next.splice(i, 1);
    if (item) next.splice(i + delta, 0, item);
    set({ ...stage, next });
  };
  const isStart = track.start === id;
  return (
    <FormSheet title={stage.label || nameOfId(id)} subtitle={isStart ? "The start" : "Stage"} backLabel="Track" onClose={props.onClose}>
      <IdText id={id} />
      <Issues issues={props.lint.filter((issue) => issue.path === path)} />
      {isStart ? (
        <Badge tone="pos">Where the track starts</Badge>
      ) : (
        <div class="lre-inline">
          <Button size="sm" icon="flag" onClick={() => props.onChange({ ...track, start: id })}>
            Make it the start
          </Button>
        </div>
      )}
      <SchemaFields specs={STAGE_SPECS} value={stage as unknown as JsonObject} ctx={{ doc: props.world, lint: props.lint, path, identifiers: props.identifiers, functions: props.functions }} onChange={(next) => set(next as unknown as StageDef)} />
      <FormGroup title="Next stages" aside={<span class="lre-small lre-muted">The first that holds wins</span>}>
        {stage.next.length === 0 ? <span class="lre-small lre-muted">None: the track ends here.</span> : null}
        {stage.next.map((n, i) => (
          <div key={i} class="lre-ve-transition">
            <div class="lre-ve-transition-head">
              <span class="grow">
                {i + 1}. To {track.stages[n.to]?.label || nameOfId(n.to)}
              </span>
              <IconButton icon="chevron-up" label={`Move ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)} />
              <IconButton icon="chevron-down" label={`Move ${i + 1} down`} disabled={i === stage.next.length - 1} onClick={() => move(i, 1)} />
              <IconButton icon="trash" label={`Remove the way to ${track.stages[n.to]?.label || n.to}`} onClick={() => set({ ...stage, next: stage.next.filter((_, j) => j !== i) })} />
            </div>
            <RefPicker label="Goes to" value={n.to} options={others} onChange={(to) => set({ ...stage, next: stage.next.map((x, j) => (j === i ? { ...x, to } : x)) })} />
            <ExprEditor label="When" value={n.when} identifiers={props.identifiers} functions={props.functions} doc={props.world} lint={exprLint(`${path}.next.${i}.when`)} onChange={(when) => set({ ...stage, next: stage.next.map((x, j) => (j === i ? { ...x, when } : x)) })} />
            <div class="lre-inline">
              <Button size="sm" variant="ghost" iconAfter="chevron-right" onClick={() => props.onOpen(n.to)}>
                Open {track.stages[n.to]?.label || nameOfId(n.to)}
              </Button>
            </div>
          </div>
        ))}
        <AddPicker label="Add a next stage" placeholder="+ Next stage…" options={others} onAdd={(to) => set({ ...stage, next: [...stage.next, { to, when: "true" }] })} />
      </FormGroup>
      <FormGroup title="Failing">
        <CheckField label="It can fail" help="When the condition holds, the track goes to the stage you pick instead." checked={stage.fail !== undefined} onChange={(on) => set({ ...stage, fail: on ? { when: "false", to: others[0]?.value ?? id } : undefined })} />
        {stage.fail ? (
          <>
            <ExprEditor label="It fails when" value={stage.fail.when} identifiers={props.identifiers} functions={props.functions} doc={props.world} lint={exprLint(`${path}.fail.when`)} onChange={(when) => set({ ...stage, fail: { to: stage.fail?.to ?? "", when } })} />
            <RefPicker label="Then goes to" value={stage.fail.to} options={others} onChange={(to) => set({ ...stage, fail: { when: stage.fail?.when ?? "false", to } })} />
          </>
        ) : null}
      </FormGroup>
      <div class="lre-inline">
        <Button
          variant="danger"
          icon="trash"
          disabled={isStart}
          title={isStart ? "Make another stage the start first" : undefined}
          onClick={() => {
            props.onChange(removeStage(track, id));
            props.onClose();
          }}
        >
          Delete stage
        </Button>
      </div>
    </FormSheet>
  );
}

function NewStageSheet(props: { track: TrackDef; after: string | null; onAdd(track: TrackDef, id: string): void; onClose(): void }) {
  const [name, setName] = useState("");
  const [after, setAfter] = useState(props.after ?? "");
  const id = deriveId(name || "stage", new Set(Object.keys(props.track.stages)));
  const stages: RefOption[] = Object.entries(props.track.stages).map(([sid, s]) => ({ value: sid, label: s.label || nameOfId(sid) }));
  return (
    <FormSheet title="New stage" backLabel="Track" onClose={props.onClose}>
      <form
        class="lre-stack"
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim()) return;
          const stages: Record<string, StageDef> = { ...props.track.stages, [id]: { label: name.trim(), next: [] } };
          const source = after ? stages[after] : undefined;
          if (after && source) stages[after] = { ...source, next: [...source.next, { to: id, when: "true" }] };
          props.onAdd({ ...props.track, stages }, id);
        }}
      >
        <Field label="Name">
          <input class="lre-input" value={name} placeholder="Ask Rosie" onInput={(event) => setName(event.currentTarget.value)} />
        </Field>
        <IdText id={id} />
        <RefPicker label="Comes after" value={after} options={stages} none="Nothing yet" onChange={setAfter} />
        <span class="lre-small lre-muted">{after ? "It's added as a next stage there, with “true” as its condition until you change it." : "Nothing leads to it yet, so it can't be reached until a stage does."}</span>
        <div class="lre-inline">
          <Button type="submit" variant="primary" icon="plus" disabled={!name.trim()}>
            Add the stage
          </Button>
        </div>
      </form>
    </FormSheet>
  );
}

export function TrackEditor(props: EditorProps) {
  const app = useApp();
  const isNew = props.id?.startsWith("new:") ?? false;
  const id = isNew ? (props.id ?? "").slice(4) : props.id;
  const stored = id ? props.world.tracks[id] : undefined;
  const name = id && isNew ? newItemName(props.world.id, "tracks", id) : undefined;
  const blank: TrackDef = { id: id ?? "", kind: "quest", label: name ?? id ?? "", start: "start", stages: { start: { label: "Start", next: [] } }, visibility: "public" };
  const [track, setTrack] = useState<TrackDef>(stored ? structuredClone(stored) : blank);
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [current, setCurrent] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "graph" | null>(null);
  const [busy, run] = useBusy();
  const [jsonProblem, setJsonProblem] = useState<string | null>(null);
  const draft = useSelect(app.drafts, (d) => d);
  const mobile = useSelect(app.host.viewport, isMobile);
  useHeld(track, setTrack, stored ?? blank, `${props.world.id}/tracks/${props.id ?? ""}`, JSON.stringify(stored ?? null));
  const identifiers = useMemo(() => worldIdentifiers(props.world), [props.world]);
  if (!id) return <span class="lre-muted">Choose a track.</span>;
  const shown = view ?? (mobile ? "list" : "graph");
  const order = stageOrder(track);
  const unreachable = order.filter((n) => !n.reachable).length;
  const changed = JSON.stringify(track) !== JSON.stringify(stored ?? null);
  const lint = lintAt(draft?.lint ?? [], `tracks.${id}`);
  const functions = draft?.functions ?? [];
  const openStage = (sid: string) => {
    setCurrent(sid);
    setOpen(sid);
  };
  const save = () =>
    run(async () => {
      const message = await props.send({ type: "lre.editor", worldId: props.world.id, base: null, op: "put", collection: "tracks", id, value: { ...track, id } as unknown as JsonValue });
      if (message.type === "lre.result" && isNew) go(app, { view: "item", worldId: props.world.id, collection: "tracks", id });
    });
  const remove = () =>
    run(async () => {
      await deleteItem(app, props.send, { worldId: props.world.id, collection: "tracks", id, name: track.label });
    });
  return (
    <div class="lre-build-page" data-lre-editor="tracks">
      <ItemHeader title={track.label || nameOfId(id)} id={id} subtitle={`${KINDS.find((k) => k.value === track.kind)?.label ?? track.kind} · ${order.length} stage${order.length === 1 ? "" : "s"}`} onDelete={isNew ? undefined : remove} busy={busy} />
      <Issues issues={lint.filter((issue) => issue.path === `tracks.${id}` || !issue.path.startsWith(`tracks.${id}.stages`))} />
      <Section title="The track">
        <div class="lre-stack">
          <Field label="Label">
            <input class="lre-input" value={track.label} onChange={(event) => setTrack({ ...track, label: event.currentTarget.value })} />
          </Field>
          <Field label="Kind">
            <Seg<TrackKind> label="Kind" value={track.kind} options={KINDS} onChange={(kind) => setTrack({ ...track, kind })} />
          </Field>
          <Field label="Who knows of it">
            <Seg<TrackDef["visibility"]> label="Who knows of it" value={track.visibility} options={VISIBILITY} onChange={(visibility) => setTrack({ ...track, visibility })} />
          </Field>
          <RefPicker label="Whose it is" value={track.owner ?? ""} options={refOptions(props.world, "entities")} none="No one's" onChange={(owner) => setTrack({ ...track, owner: owner || undefined })} />
          {track.visibility === "known_by" ? <SelectorEditor label="Known by (besides its owner and those who know the owner)" value={track.knownBy} doc={props.world} optional onChange={(knownBy) => setTrack({ ...track, knownBy })} /> : null}
          <CheckField label="Checks roll while it's in progress" help="For a world whose checks roll only where marked." checked={track.adjudicate === true} onChange={(on) => setTrack({ ...track, adjudicate: on ? true : undefined })} />
        </div>
      </Section>
      <Section
        title="Stages"
        aside={
          <span class="lre-inline">
            <Seg<"list" | "graph">
              label="Show the stages as"
              value={shown}
              options={[
                { value: "list", label: "List" },
                { value: "graph", label: "Graph" },
              ]}
              onChange={setView}
            />
          </span>
        }
      >
        <div class="lre-stack">
          {unreachable > 0 ? (
            <Banner tone="warn" title={`${unreachable} stage${unreachable === 1 ? "" : "s"} can't be reached`}>
              Nothing leads there from the start. Add it as a next stage somewhere, or delete it.
            </Banner>
          ) : null}
          {shown === "graph" ? (
            <>
              <TrackGraph track={track} current={current} onOpen={openStage} />
              <span class="lre-small lre-muted">Tap a stage to edit it. Dashed red ways are how a stage fails.</span>
            </>
          ) : (
            <div class="lre-form-items" data-lre-stage-list>
              {order.map((n) => {
                const stage = track.stages[n.id];
                if (!stage) return null;
                const next = stage.next.map((x) => track.stages[x.to]?.label || nameOfId(x.to));
                const issues = lintAt(lint, `tracks.${id}.stages.${n.id}`).length;
                return (
                  <ItemRow
                    key={n.id}
                    title={stage.label || nameOfId(n.id)}
                    subtitle={[next.length > 0 ? `Next: ${next.join(", ")}` : "Ends here", stage.fail ? `fails to ${track.stages[stage.fail.to]?.label || nameOfId(stage.fail.to)}` : ""].filter(Boolean).join(" · ")}
                    badge={
                      <span class="lre-inline">
                        {n.id === track.start ? <Badge tone="pos">Start</Badge> : null}
                        {!n.reachable ? <Badge tone="neg">Can't be reached</Badge> : null}
                        {issues > 0 ? <Badge tone="warn">{issues}</Badge> : null}
                      </span>
                    }
                    openLabel={`Edit the stage ${stage.label || n.id}`}
                    onOpen={() => openStage(n.id)}
                  />
                );
              })}
            </div>
          )}
          <div class="lre-inline">
            <Button icon="plus" onClick={() => setAdding(true)}>
              Stage
            </Button>
          </div>
        </div>
      </Section>
      <Disclosure summary="JSON (Advanced)">
        <FieldInput
          spec={{ kind: "json", key: "", label: "The track as JSON", hint: "Every field as the world file keeps it. A change applies when you leave the box." }}
          value={track as unknown as JsonValue}
          ctx={{ doc: props.world, lint: [], path: `tracks.${id}`, identifiers, functions }}
          path={`tracks.${id}`}
          parent={{}}
          onChange={(next) => {
            if (!isRecord(next) || typeof next.start !== "string" || !isRecord(next.stages) || !Object.values(next.stages).every((s) => isRecord(s) && Array.isArray(s.next))) return setJsonProblem("A track needs its start and its stages, each with its list of next stages; the last track is kept.");
            setJsonProblem(null);
            // The editor needs those to lay the stages out; the backend lints the rest, as it does every save.
            setTrack({ ...(next as unknown as TrackDef), id });
          }}
        />
        {jsonProblem ? <Issues issues={[{ severity: "error", path: `tracks.${id}`, code: "json", message: jsonProblem }]} /> : null}
      </Disclosure>
      {open !== null ? <StageSheet key={open} track={track} id={open} world={props.world} identifiers={identifiers} functions={functions} lint={lint} path={`tracks.${id}`} onChange={setTrack} onOpen={openStage} onClose={() => setOpen(null)} /> : null}
      {adding ? (
        <NewStageSheet
          track={track}
          after={current ?? order.at(-1)?.id ?? null}
          onAdd={(next, sid) => {
            setTrack(next);
            setAdding(false);
            openStage(sid);
          }}
          onClose={() => setAdding(false)}
        />
      ) : null}
      <SaveBar>
        <Button variant="primary" disabled={(!changed && !isNew) || busy} onClick={save}>
          {isNew ? "Create track" : "Save to draft"}
        </Button>
        <Button variant="ghost" disabled={!changed || busy} onClick={() => setTrack(stored ? structuredClone(stored) : blank)}>
          Revert
        </Button>
      </SaveBar>
    </div>
  );
}
