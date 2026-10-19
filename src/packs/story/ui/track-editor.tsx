// The track-graph special widget (DESIGN §13): a track's stages laid out in layers from the start
// along `next` and `fail` edges (unreachable stages flagged), tap a stage to edit it.

import { useMemo, useState } from "preact/hooks";
import type { JsonObject, JsonValue } from "../../../shared/json";
import type { StageDef, TrackDef, TrackKind } from "../../../shared/world";
import { useApp } from "../../../frontend/app";
import { lintAt, SchemaFields, worldIdentifiers } from "../../../frontend/build/schema-form";
import { SelectorEditor } from "../../../frontend/build/selector-editor";
import { EFFECT, type FieldSpec } from "../../../frontend/build/schema";
import { useHeld } from "../../../frontend/build/held";
import { Seg, useBusy } from "../../../frontend/components";
import type { EditorProps } from "../../../frontend/registry";

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

const NODE_W = 128;
const NODE_H = 44;
const GAP_X = 44;
const GAP_Y = 18;

function TrackGraph(props: { track: TrackDef; selected: string | null; onSelect(id: string): void }) {
  const { nodes, edges } = layoutTrack(props.track);
  const pos = new Map(nodes.map((n) => [n.id, { x: 8 + n.layer * (NODE_W + GAP_X), y: 8 + n.row * (NODE_H + GAP_Y) }]));
  const width = 16 + (Math.max(0, ...nodes.map((n) => n.layer)) + 1) * (NODE_W + GAP_X);
  const height = 16 + (Math.max(0, ...nodes.map((n) => n.row)) + 1) * (NODE_H + GAP_Y);
  return (
    <div class="lre-graph" data-lre-track-graph>
      <svg width={width} height={height} role="group" aria-label="Stage graph">
        <defs>
          <marker id="lre-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="#a3a3ad" />
          </marker>
          <marker id="lre-arrow-fail" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="#ff8a8a" />
          </marker>
        </defs>
        {edges.map((e, i) => {
          const a = pos.get(e.from);
          const b = pos.get(e.to);
          if (!a || !b) return null;
          const back = b.x <= a.x;
          const x1 = a.x + NODE_W;
          const y1 = a.y + NODE_H / 2;
          const x2 = back ? b.x + NODE_W / 2 : b.x;
          const y2 = back ? b.y + NODE_H : b.y + NODE_H / 2;
          const mid = (x1 + x2) / 2;
          return <path key={i} d={back ? `M${x1},${y1} C${x1 + 30},${y1 + 50} ${x2},${y2 + 40} ${x2},${y2}` : `M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`} fill="none" stroke={e.fail ? "#ff8a8a" : "#a3a3ad"} stroke-width={1.5} stroke-dasharray={e.fail ? "5 4" : undefined} marker-end={e.fail ? "url(#lre-arrow-fail)" : "url(#lre-arrow)"} />;
        })}
        {nodes.map((n) => {
          const p = pos.get(n.id);
          if (!p) return null;
          const stage = props.track.stages[n.id];
          const isStart = n.id === props.track.start;
          return (
            <g
              key={n.id}
              transform={`translate(${p.x},${p.y})`}
              style={{ cursor: "pointer" }}
              role="button"
              tabIndex={0}
              aria-label={`Stage ${stage?.label ?? n.id}`}
              aria-pressed={n.id === props.selected}
              onClick={() => props.onSelect(n.id)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                props.onSelect(n.id);
              }}
            >
              <title>{stage?.label ?? n.id}</title>
              <rect width={NODE_W} height={NODE_H} rx={10} fill={n.id === props.selected ? "#7c6cff" : "#1d2029"} stroke={!n.reachable ? "#ff8a8a" : isStart ? "#7fe0a0" : "#3a3d48"} stroke-width={2} />
              <text x={10} y={18} fill="#f0f0f6" font-size="12" font-family="system-ui">
                {(stage?.label ?? n.id).slice(0, 18)}
              </text>
              <text x={10} y={34} fill="#a3a3ad" font-size="10" font-family="ui-monospace,Menlo,monospace">
                {isStart ? "start · " : ""}
                {!n.reachable ? "unreachable · " : ""}
                {n.id.slice(0, 14)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function stageSpecs(stageIds: string[]): FieldSpec[] {
  return [
    { kind: "text", key: "label", label: "Label" },
    { kind: "text", key: "cue", label: "Cue (player-facing)", multiline: true, optional: true },
    { kind: "text", key: "truth", label: "Secret truth (GM only until reveal)", multiline: true, optional: true },
    { kind: "list", key: "objectives", label: "Objectives", item: { kind: "expr", key: "", label: "Objective" } },
    {
      kind: "list",
      key: "next",
      label: "Next stages",
      title: "to",
      item: {
        kind: "object",
        key: "",
        label: "Transition",
        fields: [
          { kind: "enum", key: "to", label: "To", values: stageIds },
          { kind: "expr", key: "when", label: "When" },
        ],
      },
    },
    { kind: "expr", key: "gate", label: "Gate", optional: true },
    {
      kind: "object",
      key: "fail",
      label: "Fails",
      optional: true,
      fields: [
        { kind: "expr", key: "when", label: "When" },
        { kind: "enum", key: "to", label: "To", values: stageIds },
      ],
    },
    { kind: "list", key: "hints", label: "Hints", item: { kind: "text", key: "", label: "Hint" } },
    { kind: "number", key: "priority", label: "Planner priority (agendas)", optional: true },
    { kind: "list", key: "effects", label: "Effects on entering", item: EFFECT, title: "type" },
    { kind: "list", key: "rewards", label: "Rewards", item: EFFECT, title: "type" },
    { kind: "json", key: "answer", label: "Puzzle answer", optional: true, hint: '{"expect": ["…"], "normalize": true, "decision": {"threshold": 0.8}}' },
  ];
}

export function TrackEditor(props: EditorProps) {
  const app = useApp();
  const isNew = props.id?.startsWith("new:") ?? false;
  const id = isNew ? (props.id ?? "").slice(4) : props.id;
  const stored = id ? props.world.tracks[id] : undefined;
  const blank: TrackDef = { id: id ?? "", kind: "quest", label: id ?? "", start: "start", stages: { start: { label: "Start", next: [] } }, visibility: "public" };
  const [track, setTrack] = useState<TrackDef>(stored ? structuredClone(stored) : blank);
  const [selected, setSelected] = useState<string | null>(track.start);
  const [newStage, setNewStage] = useState("");
  const [busy, run] = useBusy();
  useHeld(track, setTrack, stored ?? blank, `${props.world.id}/tracks/${props.id ?? ""}`, JSON.stringify(stored ?? null));
  const identifiers = useMemo(() => worldIdentifiers(props.world), [props.world]);
  if (!id) return <span class="lre-muted">Choose a track.</span>;
  const stageIds = Object.keys(track.stages);
  const stage = selected ? track.stages[selected] : undefined;
  const changed = JSON.stringify(track) !== JSON.stringify(stored ?? null);
  const unreachable = layoutTrack(track).nodes.filter((n) => !n.reachable).length;
  return (
    <div class="lre-stack" data-lre-editor="tracks">
      <div class="lre-h2">
        <code>{id}</code>
      </div>
      <label class="lre-field">
        <span class="label">Label</span>
        <input class="lre-input" value={track.label} onChange={(event) => setTrack({ ...track, label: event.currentTarget.value })} />
      </label>
      <Seg<TrackKind>
        label="Kind"
        value={track.kind}
        options={[
          { value: "quest", label: "Quest" },
          { value: "secret", label: "Secret" },
          { value: "puzzle", label: "Puzzle" },
          { value: "agenda", label: "Agenda" },
        ]}
        onChange={(kind) => setTrack({ ...track, kind })}
      />
      <div class="lre-inline">
        <label class="lre-field" style={{ flex: 1 }}>
          <span class="label">Visibility</span>
          <select class="lre-input" value={track.visibility} onChange={(event) => setTrack({ ...track, visibility: event.currentTarget.value === "secret" ? "secret" : event.currentTarget.value === "known_by" ? "known_by" : "public" })}>
            <option value="public">public</option>
            <option value="known_by">known_by</option>
            <option value="secret">secret</option>
          </select>
        </label>
        <label class="lre-field" style={{ flex: 1 }}>
          <span class="label">Owner</span>
          <select class="lre-input" value={track.owner ?? ""} onChange={(event) => setTrack({ ...track, owner: event.currentTarget.value || undefined })}>
            <option value="">—</option>
            {Object.values(props.world.entities).map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {track.visibility === "known_by" ? <SelectorEditor label="Known by (besides its owner and those who know the owner)" value={track.knownBy} doc={props.world} optional onChange={(knownBy) => setTrack({ ...track, knownBy })} /> : null}
      <TrackGraph track={track} selected={selected} onSelect={setSelected} />
      {unreachable > 0 ? <span class="lre-small lre-neg">{unreachable} stage(s) can't be reached from the start.</span> : null}
      <form
        class="lre-inline"
        onSubmit={(event) => {
          event.preventDefault();
          const sid = newStage.trim();
          if (!sid || sid in track.stages) return;
          const from = selected && track.stages[selected] ? selected : null;
          const stages: Record<string, StageDef> = { ...track.stages, [sid]: { label: sid, next: [] } };
          if (from) {
            const source = stages[from];
            if (source) stages[from] = { ...source, next: [...source.next, { to: sid, when: "true" }] };
          }
          setTrack({ ...track, stages });
          setSelected(sid);
          setNewStage("");
        }}
      >
        <input class="lre-input" style={{ flex: 1 }} placeholder={selected ? `New stage after ${selected}` : "New stage id"} aria-label="New stage id" value={newStage} onInput={(event) => setNewStage(event.currentTarget.value.replace(/[^\w.-]/g, "_"))} />
        <button type="submit" class="lre-btn small" disabled={!newStage.trim() || newStage.trim() in track.stages}>
          + Stage
        </button>
      </form>
      {stage && selected ? (
        <section class="lre-card" data-lre-stage={selected}>
          <div class="lre-h">
            <span>
              Stage <code>{selected}</code>
            </span>
            <span class="lre-inline">
              {track.start !== selected ? (
                <button type="button" class="lre-btn small" onClick={() => setTrack({ ...track, start: selected })}>
                  Make start
                </button>
              ) : (
                <span class="lre-badge pos">start</span>
              )}
              <button
                type="button"
                class="lre-btn small danger"
                disabled={track.start === selected}
                onClick={() => {
                  const stages: Record<string, StageDef> = {};
                  for (const [sid, s] of Object.entries(track.stages)) {
                    if (sid === selected) continue;
                    stages[sid] = { ...s, next: s.next.filter((n) => n.to !== selected), fail: s.fail?.to === selected ? undefined : s.fail };
                  }
                  setTrack({ ...track, stages });
                  setSelected(track.start);
                }}
              >
                Delete
              </button>
            </span>
          </div>
          <SchemaFields
            specs={stageSpecs(stageIds)}
            value={stage as unknown as JsonObject}
            ctx={{ doc: props.world, lint: lintAt(app.drafts.get()?.lint ?? [], `tracks.${id}`), path: `tracks.${id}.stages.${selected}`, identifiers, functions: app.drafts.get()?.functions ?? [] }}
            onChange={(next) => setTrack({ ...track, stages: { ...track.stages, [selected]: next as unknown as StageDef } })}
          />
        </section>
      ) : null}
      <div class="lre-inline">
        <button
          type="button"
          class="lre-btn primary"
          disabled={(!changed && !isNew) || busy}
          onClick={() =>
            run(async () => {
              const message = await props.send({ type: "lre.editor", worldId: props.world.id, base: null, op: "put", collection: "tracks", id, value: { ...track, id } as unknown as JsonValue });
              if (message.type === "lre.result" && isNew) app.ui.update((ui) => ({ ...ui, build: { view: "item", worldId: props.world.id, collection: "tracks", id } }));
            })
          }
        >
          {isNew ? "Create track" : "Save to draft"}
        </button>
        <button type="button" class="lre-btn ghost" disabled={!changed || busy} onClick={() => setTrack(stored ? structuredClone(stored) : blank)}>
          Revert
        </button>
      </div>
    </div>
  );
}
