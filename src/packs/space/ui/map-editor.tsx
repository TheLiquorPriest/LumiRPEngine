// Build's map editor (DESIGN §13): a map as its `lre-map-v1` JSON, checked as it's typed against
// the published schema and the map lint, each problem marked on its line, with a preview drawn
// the way Play's map draws it. Insert template starts a small grid map or node map.

import { useMemo, useRef, useState } from "preact/hooks";
import type { JsonValue } from "../../../shared/json";
import { hasOwn, isRecord } from "../../../shared/json";
import { formatMap, mapProblems, mapTemplate, readMap } from "../../../shared/maps";
import { pathText } from "../../../shared/schema-check";
import type { MapDoc, WorldDoc } from "../../../shared/world";
import { useApp } from "../../../frontend/app";
import { useHeld } from "../../../frontend/build/held";
import { newItem } from "../../../frontend/build/schema";
import { Card, Empty, useBusy } from "../../../frontend/components";
import { lineAt, parseJsonText } from "../../../frontend/json-text";
import type { EditorProps } from "../../../frontend/registry";
import type { MapScopeView } from "../core/map-scope";
import { MapPreview, previewScope } from "./map-preview";

/** The code area's line height in px (the gutter and the text share it). */
const LINE_PX = 18;

export interface MapTextProblem {
  line: number;
  severity: "error" | "warning";
  message: string;
}

export interface CheckedMapText {
  /** The text as JSON, or null while it isn't JSON. */
  value: JsonValue | null;
  /** Every problem, by line. */
  problems: MapTextProblem[];
  /** The map's scope as Play would draw it, once the map reads as lre-map-v1. */
  scope: MapScopeView | null;
}

/** A map's text checked as the editor shows it: JSON first, then the schema and the map lint against the draft, each problem on its line. */
export function checkMapText(text: string, key: string, world: WorldDoc): CheckedMapText {
  const parsed = parseJsonText(text);
  if (!parsed.ok) return { value: null, problems: [{ line: parsed.line, severity: "error", message: `Not JSON yet (column ${parsed.column}): ${parsed.message}.` }], scope: null };
  // Lint reads every map through the schema check, so the candidate goes in as it is.
  const doc: WorldDoc = { ...world, maps: { ...world.maps, [key]: parsed.value as unknown as MapDoc } };
  const problems = (mapProblems(doc).get(key) ?? [])
    .map((p) => ({ line: lineAt(parsed.lines, p.path), severity: p.severity, message: `${p.path.length > 0 ? `${pathText(p.path)}: ` : ""}${p.message}` }))
    .sort((a, b) => a.line - b.line);
  const { map } = readMap(parsed.value);
  return { value: parsed.value, problems, scope: map ? previewScope(world, key, map) : null };
}

export function MapEditor(props: EditorProps) {
  const app = useApp();
  const isNew = props.id?.startsWith("new:") ?? false;
  const id = isNew ? (props.id ?? "").slice(4) : (props.id ?? "");
  const stored = hasOwn(props.world.maps, id) ? props.world.maps[id] : undefined;
  const initial = useMemo(() => formatMap(stored ?? newItem("maps", id, props.world)), [JSON.stringify(stored), id]);
  const [text, setText] = useState(initial);
  const [busy, run] = useBusy();
  const area = useRef<HTMLTextAreaElement>(null);
  const gutter = useRef<HTMLPreElement>(null);
  useHeld(text, setText, initial, `${props.world.id}/maps/${props.id ?? ""}`, initial);
  const checked = useMemo(() => checkMapText(text, id, props.world), [text, id, props.world]);
  const marks = new Map<number, "error" | "warning">();
  for (const p of checked.problems) if (marks.get(p.line) !== "error") marks.set(p.line, p.severity);
  const errors = checked.problems.filter((p) => p.severity === "error").length;
  const lineCount = text.split("\n").length;
  const changed = text !== initial;
  const open = (to: string | null) => app.ui.update((ui) => ({ ...ui, build: to === null ? { view: "collection", worldId: props.world.id, collection: "maps" } : { view: "item", worldId: props.world.id, collection: "maps", id: to } }));

  const jump = (line: number) => {
    const el = area.current;
    if (!el) return;
    const rows = text.split("\n");
    const start = rows.slice(0, line - 1).reduce((at, row) => at + row.length + 1, 0);
    el.focus();
    el.setSelectionRange(start, start + (rows[line - 1]?.length ?? 0));
    el.scrollTop = Math.max(0, (line - 3) * LINE_PX);
    if (gutter.current) gutter.current.scrollTop = el.scrollTop;
  };
  const insert = (kind: "grid" | "node") =>
    run(async () => {
      const current = checked.value;
      const scope = isRecord(current) && typeof current.scope === "string" && current.scope !== "" ? current.scope : props.world.start.place;
      const drawn = isRecord(current) && (Array.isArray(current.layout) || Array.isArray(current.links) || (Array.isArray(current.places) && current.places.length > 0));
      if (drawn && !(await app.host.confirm("Insert template", "Replace this map with the template? Revert brings back the saved map.", "info", "Replace"))) return;
      setText(formatMap(mapTemplate(kind, id, scope)));
    });
  const save = () =>
    run(async () => {
      if (!isRecord(checked.value)) return;
      const message = await props.send({ type: "lre.editor", worldId: props.world.id, base: null, op: "put", collection: "maps", id, value: checked.value });
      if (message.type === "lre.result" && isNew) open(id);
    });
  const remove = () =>
    run(async () => {
      if (!(await app.host.confirm("Delete", `Delete the map “${id}”? The places, grid and routes it draws go with it.`, "danger", "Delete"))) return;
      const message = await props.send({ type: "lre.editor", worldId: props.world.id, base: null, op: "remove", collection: "maps", id });
      if (message.type === "lre.result") open(null);
    });

  return (
    <div class="lre-stack" data-lre-editor="maps">
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
      <span class="lre-small lre-muted">
        The map as lre-map-v1 JSON: a grid map's layout rows and legend, or a node map's places and links. The places it lists are made inside its scope, and the map owns them.
      </span>
      <div class="lre-inline">
        <span class="lre-small lre-muted">Insert template:</span>
        <button type="button" class="lre-btn small" disabled={busy} onClick={() => insert("grid")}>
          Grid map
        </button>
        <button type="button" class="lre-btn small" disabled={busy} onClick={() => insert("node")}>
          Node map
        </button>
        <button type="button" class="lre-btn small ghost" disabled={checked.value === null} onClick={() => setText(formatMap(checked.value))}>
          Tidy
        </button>
      </div>
      <div class="lre-code">
        <pre class="gutter" ref={gutter} aria-hidden="true">
          {Array.from({ length: lineCount }, (_, i) => (
            <span key={i} class={marks.get(i + 1)}>
              {i + 1}
            </span>
          ))}
        </pre>
        <textarea
          ref={area}
          class="text"
          wrap="off"
          spellcheck={false}
          aria-label="The map as lre-map-v1 JSON"
          aria-invalid={errors > 0}
          value={text}
          onInput={(event) => setText(event.currentTarget.value)}
          onScroll={(event) => {
            if (gutter.current) gutter.current.scrollTop = event.currentTarget.scrollTop;
          }}
        />
      </div>
      <div aria-live="polite" data-lre-map-problems={checked.problems.length}>
        {checked.problems.length === 0 ? (
          <span class="lre-small lre-pos">A valid lre-map-v1 map.</span>
        ) : (
          checked.problems.map((p, i) => (
            <button key={`${p.line}:${i}`} type="button" class="lre-lint jump" onClick={() => jump(p.line)}>
              <span class={p.severity === "error" ? "lre-badge neg" : "lre-badge warn"}>Line {p.line}</span>
              <span class="grow">{p.message}</span>
            </button>
          ))
        )}
      </div>
      <Card title="Preview">{checked.scope ? <MapPreview scope={checked.scope} /> : <Empty>The preview shows once the map reads as lre-map-v1.</Empty>}</Card>
      <div class="lre-inline" style={{ position: "sticky", bottom: 0, padding: "8px 0", background: "var(--lre-fill)" }}>
        <button type="button" class="lre-btn primary" disabled={busy || checked.value === null || (!changed && !isNew)} onClick={save}>
          {isNew ? "Create" : "Save to draft"}
        </button>
        <button type="button" class="lre-btn ghost" disabled={busy || !changed} onClick={() => setText(initial)}>
          Revert
        </button>
      </div>
    </div>
  );
}
