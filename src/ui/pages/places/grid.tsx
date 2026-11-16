// A place's grid as the chat plays it (plan §8.2, §14 Places): the squares as drawn with the chat's own changes laid over, everyone and everything
// on them and each door as it stands, in a pane of its own that scrolls however large the grid is; those at the place with no square said in
// words; where the grid comes from, and, for one that is the chat's own, "Keep in the world", which copies it into the world's draft. A person or
// thing picked and then a square tapped moves it there: a correction of his own, applied at once, with its Undo.

import { useState } from "preact/hooks";
import type { JsonValue, MapGridReply, MapKept, MapPieceShown, MapWrote } from "../../../shared/api";
import { useApp } from "../../app";
import { Badge, Banner, Button } from "../../atoms";
import { replyOf } from "../../client";
import { useRead } from "../../reading";
import { counted, errorWords } from "../../words";

const FROM_WORDS: Readonly<Record<MapGridReply["from"], string>> = {
  world: "the world's own map",
  laid: "laid in this chat: the world does not have it",
  changed: "the world's own map, changed in this chat",
};

const DOOR_MARK: Readonly<Record<string, string>> = { open: "'", closed: "+", locked: "×" };

function recordOf(value: JsonValue | undefined): { [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
}

/** How wide a square is and how the clock counts a step on the grid, in words. */
export function scaleWords(scale: JsonValue): string {
  const s = recordOf(scale);
  const metric = s.unit === "metres";
  const width = metric ? s.metres : s.feet;
  const step = recordOf(s.step);
  const clock = step.per === "round" ? `a round of ${String(step.seconds)} seconds moves ${counted(Number(step.squares), "square")}` : "a minute moves one square";
  return `${typeof width === "number" ? `A square is ${Math.round(width * 100) / 100} ${metric ? "metres" : "feet"} wide` : "A square's width is not said"}; ${clock}.`;
}

/** What a legend symbol stands for, in words: its own word, or what the map's format holds for it. */
export function legendWords(value: JsonValue | undefined): string {
  if (value === undefined) return "not in the legend";
  if (typeof value === "string") return value;
  const fields = Object.entries(recordOf(value)).map(([k, v]) => (v === true ? k : `${k} ${typeof v === "string" ? v : JSON.stringify(v)}`));
  return fields.length === 0 ? "nothing said" : fields.join(", ");
}

const DEFAULT_SYMBOLS: Readonly<Record<string, string>> = { "#": "wall", ".": "floor", "+": "door", " ": "nothing" };

/** The squares a piece covers, from its top left. */
function footprint(piece: MapPieceShown): [number, number][] {
  const [x, y] = piece.square;
  const [w, h] = piece.size ?? [1, 1];
  const cells: [number, number][] = [];
  for (let dy = 0; dy < (h ?? 1); dy++) for (let dx = 0; dx < (w ?? 1); dx++) cells.push([(x ?? 1) + dx, (y ?? 1) + dy]);
  return cells;
}

/** Who stands on each square, by `x,y`; a piece covering more than one square stands on each. */
export function standing(pieces: readonly MapPieceShown[]): Map<string, MapPieceShown[]> {
  const by = new Map<string, MapPieceShown[]>();
  for (const piece of pieces) for (const [x, y] of footprint(piece)) by.set(`${x},${y}`, [...(by.get(`${x},${y}`) ?? []), piece]);
  return by;
}

function Squares(props: { grid: MapGridReply; picked: string | null; onSquare(x: number, y: number): void }) {
  const { grid } = props;
  const on = standing(grid.pieces);
  const doors = new Map<string, string>(grid.doors.map((d): [string, string] => [`${d.square[0]},${d.square[1]}`, d.state]));
  return (
    <div
      class="rpe-grid"
      role="grid"
      aria-label={`The grid of ${grid.name}, ${grid.width} by ${grid.height} squares`}
      style={{ gridTemplateColumns: `repeat(${grid.width}, var(--rpe-square, 1.7em))` }}
      onClick={(e) => {
        const at = (e.target as HTMLElement).closest<HTMLElement>("[data-sq]")?.dataset.sq;
        const [x, y] = at === undefined ? [] : at.split(",").map(Number);
        if (x !== undefined && y !== undefined) props.onSquare(x, y);
      }}
    >
      {grid.rows.flatMap((row, r) =>
        [...row].map((symbol, c) => {
          const key = `${c + 1},${r + 1}`;
          const here = on.get(key) ?? [];
          const door = doors.get(key);
          const meaning = grid.legend[symbol] ?? DEFAULT_SYMBOLS[symbol];
          const wall = meaning === "wall" || recordOf(meaning).blocked === true;
          const first = here[0];
          return (
            <span
              key={key}
              class={`rpe-square${wall ? " wall" : ""}${first === undefined ? "" : " held"}${first !== undefined && first.id === props.picked ? " picked" : ""}`}
              data-sq={key}
              title={`${key}: ${first === undefined ? legendWords(meaning === undefined ? undefined : (meaning as JsonValue)) : here.map((p) => `${p.name} (${p.kind})`).join(", ")}${door === undefined ? "" : `; a door, ${door}`}`}
            >
              {first === undefined ? (door === undefined ? symbol : (DOOR_MARK[door] ?? symbol)) : (first.name.trim()[0] ?? "?").toUpperCase()}
            </span>
          );
        }),
      )}
    </div>
  );
}

function PieceLine(props: { piece: MapPieceShown; picked: boolean; movable: boolean; onPick(): void }) {
  const { piece } = props;
  return (
    <li class="lre-inline rpe-wrap" data-piece={piece.id}>
      <span class="rpe-line">
        <strong>{piece.name}</strong> <span class="rpe-meta">{piece.kind}, at ({piece.square.join(", ")}){piece.size === undefined ? "" : `, covering ${piece.size.join(" by ")}`}{piece.on === undefined ? "" : `, ${piece.within === true ? "in" : "on"} ${piece.on}`}{piece.state === undefined ? "" : `, ${piece.state}`}{piece.blocks?.way === true ? ", blocks the way" : ""}{piece.blocks?.view === true ? ", blocks the view" : ""}</span>
      </span>
      {props.movable && piece.on === undefined ? (
        <Button small kind={props.picked ? "primary" : "ghost"} onClick={props.onPick}>
          {props.picked ? "Tap a square to move it there" : "Move it"}
        </Button>
      ) : null}
    </li>
  );
}

export function GridPane(props: { chat: string; place: string; turn: string | null; stamp: number; onChanged(): void }) {
  const app = useApp();
  const { chat, place, turn } = props;
  const [read, setRead] = useState(0);
  const grid = useRead(() => app.client.call("GET /api/v1/chats/:chat/maps/:place", { chat, place }, { query: turn === null ? {} : { turn } }).then(replyOf), [chat, place, turn, props.stamp, read]);
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [wrote, setWrote] = useState<{ words: string; undo: string | null } | null>(null);
  const [kept, setKept] = useState<MapKept | null>(null);
  const g = grid.value;
  const edit = turn === null;
  const press = <T,>(what: string, go: () => Promise<T>, done: (answer: T) => void): void => {
    if (busy !== null) return;
    setBusy(what);
    setProblem(null);
    go().then(
      (answer) => {
        setBusy(null);
        done(answer);
        setRead((n) => n + 1);
        props.onChanged();
      },
      (error: unknown) => {
        setBusy(null);
        setProblem(errorWords(error));
      },
    );
  };
  const move = (x: number, y: number): void => {
    if (picked === null || g === null) return;
    const who = g.pieces.find((p) => p.id === picked) ?? g.unplaced.find((p) => p.id === picked);
    press<MapWrote>(
      "move",
      () => app.client.call("POST /api/v1/chats/:chat/maps/:place/moves", { chat, place }, { body: { who: picked, square: [x, y] } }),
      (answer) => {
        setPicked(null);
        setWrote({ words: `${who?.name ?? picked} is at (${x}, ${y}) now: a change of yours, which the Author is told of at the next turn.`, undo: answer.undo });
      },
    );
  };
  const undo = (): void => {
    const edit = wrote?.undo;
    if (edit === null || edit === undefined) return;
    press("undo", () => app.client.call("POST /api/v1/chats/:chat/edits/:edit/undo", { chat, edit }), () => setWrote({ words: "Put back.", undo: null }));
  };
  const keep = (): void => press("keep", () => app.client.call("POST /api/v1/chats/:chat/maps/:place/keep", { chat, place }, { body: {} }), setKept);
  if (grid.problem !== null && g === null) {
    return (
      <Banner tone="neg" icon="alert" title="Its grid could not be read">
        <span>{grid.problem}</span>
      </Banner>
    );
  }
  if (g === null) return <p class="lre-muted rpe-line">Reading its grid…</p>;
  return (
    <div class="lre-stack" data-grid={g.grid}>
      <p class="rpe-line" data-grid-from>
        <Badge tone={g.from === "world" ? undefined : "accent"}>{g.from === "world" ? "the world's" : "this chat's own"}</Badge> {FROM_WORDS[g.from]}; {g.width} by {g.height} squares. {scaleWords(g.scale)}
      </p>
      {g.edits.squares === 0 && g.edits.legend.length === 0 ? null : <p class="rpe-meta">The chat changed {counted(g.edits.squares, "square")}{g.edits.legend.length === 0 ? "" : ` and ${counted(g.edits.legend.length, "symbol")} (${g.edits.legend.join(" ")})`} of the map as the world draws it.</p>}
      <div class="rpe-grid-pane" data-grid-pane>
        <Squares grid={g} picked={picked} onSquare={move} />
      </div>
      {problem === null ? null : (
        <Banner tone="neg" icon="alert" title="Not done">
          <span data-problem>{problem}</span>
        </Banner>
      )}
      {wrote === null ? null : (
        <Banner tone="info" icon="check" title="Done">
          <span data-said>{wrote.words}</span>
          {wrote.undo === null ? null : (
            <Button small kind="ghost" busy={busy === "undo"} onClick={undo}>
              Undo it
            </Button>
          )}
        </Banner>
      )}
      <ul class="rpe-plain lre-stack" data-pieces>
        {g.pieces.map((p) => (
          <PieceLine key={p.id} piece={p} picked={picked === p.id} movable={edit} onPick={() => setPicked(picked === p.id ? null : p.id)} />
        ))}
        {g.unplaced.map((p) => (
          <li key={p.id} class="lre-inline rpe-wrap" data-unplaced={p.id}>
            <span class="rpe-line">
              <strong>{p.name}</strong> <span class="rpe-meta">{p.kind}, at the place with no square of its own{p.zone === undefined ? "" : `, in ${p.zone}`}{p.words === undefined ? "" : `: ${p.words}`}</span>
            </span>
            {edit ? (
              <Button small kind={picked === p.id ? "primary" : "ghost"} onClick={() => setPicked(picked === p.id ? null : p.id)}>
                {picked === p.id ? "Tap a square to put it there" : "Put it on a square"}
              </Button>
            ) : null}
          </li>
        ))}
        {g.pieces.length === 0 && g.unplaced.length === 0 ? <li class="lre-muted rpe-line">Nobody and nothing is on this grid.</li> : null}
      </ul>
      {Object.keys(g.legend).length === 0 ? null : (
        <p class="rpe-meta" data-legend>
          Legend: {Object.entries(g.legend).map(([symbol, meaning]) => `${symbol} ${legendWords(meaning)}`).join(" · ")}
        </p>
      )}
      {g.from !== "world" && edit ? (
        <div class="lre-stack" data-keep>
          <Button small busy={busy === "keep"} onClick={keep}>
            Keep in the world
          </Button>
          <p class="rpe-meta">Copies this grid, with the squares the chat drew on it, into the world's draft, the working copy Build edits. The chat keeps its own changes until the world takes them in.</p>
        </div>
      ) : null}
      {kept === null ? null : (
        <Banner tone="info" icon="check" title={kept.draft.written ? `Kept in the world's draft, version ${kept.draft.version}` : "Nothing was written to the world's draft"}>
          <span data-kept>
            {kept.kept.maps.length === 0 ? "" : `Maps kept: ${kept.kept.maps.join(", ")}. `}
            {kept.kept.places.length === 0 ? "" : `Places kept: ${kept.kept.places.join(", ")}. `}
            {kept.kept.paths.length === 0 ? "" : `Paths kept: ${kept.kept.paths.join(", ")}. `}
            {kept.skipped.length === 0 ? "" : `Left: ${kept.skipped.map((s) => `${s.id} (${s.code === "not_changed" ? "the chat did not change it" : s.code === "in_draft_already" ? "the draft has it already" : "it has no map"})`).join(", ")}.`}
          </span>
        </Banner>
      )}
    </div>
  );
}
