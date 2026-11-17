// What the World page lets him do with a value and a level, each with state of its own: read a value's
// history by turn, change or remove it as his own edit (with its Undo), add a value or a fact to a level,
// and read the level's typed systems. The page fills the parts' slots with these (parts.tsx).

import { useState } from "preact/hooks";
import type { DueShown, EditOpAsk, FactPrecision, LevelNode, TapReply, TurnId } from "../../../shared/api";
import { useApp } from "../../app";
import { Badge, Banner, Button, Row } from "../../../frontend/components";
import { marksWords, PRECISIONS } from "../../marks";
import { usePaged, useRead } from "../../reading";
import type { ValueChangeShown } from "../../../shared/api";
import { errorWords, when } from "../../words";
import { readHistory, readSystems, sendEdit, sendUndo } from "./read";

/** One change of a value's history: its turn, lane, who, what it left, and how exact and sure; a fact says which later exact record settled it. */
function ChangeLine(props: { change: ValueChangeShown }) {
  const { change } = props;
  return (
    <li class="rpe-entry" data-change={change.id}>
      <p class="rpe-line">
        <span class="rpe-strong">turn {change.n}</span> · {change.lane} lane · {change.op} ·{" "}
        {change.kind === "fact" ? <Badge tone="gm">fact</Badge> : null} {change.value === null ? "removed" : change.value}
      </p>
      <p class="rpe-meta">
        {marksWords(change)}
        {change.by === null ? "" : `, by ${change.by}`} · {when(change.at)}
        {change.settledBy === null ? "" : ` · settled by the exact record of turn ${change.settledBy}`}
      </p>
      {change.reports.length === 0 ? null : (
        <ul class="rpe-reports">
          {change.reports.map((report, i) => (
            <li key={i}>{report}</li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** Every change that wrote one value on the path, newest first, a page at a time. */
export function History(props: { chat: string; at: string; part: string; turn: TurnId | null; onClose(): void }) {
  const app = useApp();
  const list = usePaged((cursor) => readHistory(app.client, props.chat, props.at, props.part, props.turn, cursor), [props.chat, props.at, props.part, props.turn]);
  return (
    <div class="rpe-open lre-stack" data-history={props.part}>
      <div class="lre-spread">
        <span class="rpe-caption">{`History of ${props.part}, turn by turn`}</span>
        <Button size="sm" variant="ghost" onClick={props.onClose}>
          Close
        </Button>
      </div>
      {list.problem === null ? null : (
        <Banner tone="neg" icon="alert" title="The history could not be read">
          <span>{list.problem}</span>
        </Banner>
      )}
      {list.items.length === 0 ? list.loading ? <p class="lre-muted rpe-line">Reading its history…</p> : list.problem === null ? <p class="rpe-meta">Nothing on the path wrote it.</p> : null : (
        <ul class="rpe-plain lre-stack">
          {list.items.map((change) => (
            <ChangeLine key={change.id} change={change} />
          ))}
        </ul>
      )}
      {list.more ? (
        <Button size="sm" busy={list.loading} onClick={list.older}>
          Older changes
        </Button>
      ) : null}
    </div>
  );
}

/** What came of an edit: its words, what the world's rules reported of it, and its Undo while it can be taken back. */
function EditResult(props: { done: TapReply; busy: boolean; onUndo(): void }) {
  const { done } = props;
  return (
    <Banner tone={done.applied ? "info" : "warn"} icon={done.applied ? "check" : "alert"} title={done.applied ? "Recorded as your change" : "Nothing was recorded"} actions={done.undo === null ? undefined : <Button busy={props.busy} onClick={props.onUndo}>Undo</Button>}>
      <span>{done.words}</span>
      {done.reports.length === 0 ? null : (
        <ul class="rpe-reports">
          {done.reports.map((report, i) => (
            <li key={i}>{report}</li>
          ))}
        </ul>
      )}
    </Banner>
  );
}

/** The form of an edit: what to write, how exact it is, whether the Author is told; sent as the owner's change. */
function EditForm(props: { chat: string; level: string; as: "value" | "fact"; part: string | null; current: string; remove?: boolean; onDone(): void; onClose(): void }) {
  const app = useApp();
  const [key, setKey] = useState(props.part ?? "");
  const [as, setAs] = useState(props.as);
  const [value, setValue] = useState(props.current);
  const [precision, setPrecision] = useState<FactPrecision>("exact");
  const [tell, setTell] = useState(true);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<TapReply | null>(null);
  const removing = props.remove === true;
  const send = (): void => {
    setBusy(true);
    setProblem(null);
    const op: EditOpAsk = removing ? { op: "remove", at: props.level, key, as } : { op: "set", at: props.level, key: key.trim(), as, value, precision };
    sendEdit(app.client, props.chat, op, tell).then(
      (reply) => {
        setBusy(false);
        setDone(reply);
        props.onDone();
      },
      (error: unknown) => {
        setBusy(false);
        setProblem(errorWords(error));
      },
    );
  };
  const undo = (): void => {
    if (done?.undo == null) return;
    setBusy(true);
    sendUndo(app.client, props.chat, done.undo).then(
      (reply) => {
        setBusy(false);
        setDone(reply);
        props.onDone();
      },
      (error: unknown) => {
        setBusy(false);
        setProblem(errorWords(error));
      },
    );
  };
  return (
    <form
      class="rpe-open lre-stack"
      data-edit={props.part ?? "new"}
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      {props.part === null ? (
        <>
          <label class="lre-field">
            <span class="label">Name</span>
            <input class="lre-input" name="key" value={key} spellcheck={false} autoComplete="off" onInput={(event) => setKey(event.currentTarget.value)} />
          </label>
          <div class="lre-seg" role="group" aria-label="Kind">
            {(["value", "fact"] as const).map((kind) => (
              <button key={kind} type="button" aria-pressed={as === kind ? "true" : "false"} onClick={() => setAs(kind)}>
                {kind === "value" ? "A value" : "A fact"}
              </button>
            ))}
          </div>
        </>
      ) : null}
      {removing ? (
        <p class="rpe-line">{`Remove ${props.as === "fact" ? "the fact" : "the value"} ${props.part ?? key} from ${props.level}.`}</p>
      ) : (
        <>
          <label class="lre-field">
            <span class="label">{props.part === null ? "What it says" : `${props.part} now says`}</span>
            <textarea class="lre-input" name="value" value={value} rows={2} onInput={(event) => setValue(event.currentTarget.value)} />
          </label>
          <label class="lre-field">
            <span class="label">How exact</span>
            <select class="lre-input" value={precision} onChange={(event) => setPrecision(event.currentTarget.value as FactPrecision)}>
              {PRECISIONS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      <label class="lre-check">
        <input type="checkbox" checked={tell} onChange={(event) => setTell(event.currentTarget.checked)} /> <span>Tell the Author at the next turn</span>
      </label>
      {problem === null ? null : (
        <Banner tone="neg" icon="alert" title="Not recorded">
          <span>{problem}</span>
        </Banner>
      )}
      {done === null ? null : <EditResult done={done} busy={busy} onUndo={undo} />}
      <div class="lre-inline">
        <Button busy={busy} variant={removing ? "danger" : "primary"} onClick={send} disabled={key.trim() === "" || (!removing && value.trim() === "")}>
          {removing ? "Remove it" : "Save as your change"}
        </Button>
        <Button variant="ghost" onClick={props.onClose}>
          {done === null ? "Cancel" : "Close"}
        </Button>
      </div>
    </form>
  );
}

/** What can be done with one value or fact: its history, and (at the chat's head) changing or removing it as his own edit. */
export function RowTools(props: { chat: string; level: string; part: string; as: "value" | "fact"; current: string | null; turn: TurnId | null; startOpen: boolean; onChanged(): void }) {
  const [panel, setPanel] = useState<"history" | "change" | "remove" | null>(props.startOpen ? "history" : null);
  const toggle = (next: "history" | "change" | "remove"): void => setPanel((now) => (now === next ? null : next));
  return (
    <div class="lre-stack">
      <div class="lre-inline rpe-wrap">
        <Button size="sm" variant="ghost" current={panel === "history"} onClick={() => toggle("history")}>
          History
        </Button>
        {props.turn !== null ? null : (
          <>
            <Button size="sm" variant="ghost" current={panel === "change"} onClick={() => toggle("change")}>
              Change
            </Button>
            {props.as === "fact" ? null : (
              <Button size="sm" variant="ghost" current={panel === "remove"} onClick={() => toggle("remove")}>
                Remove
              </Button>
            )}
          </>
        )}
      </div>
      {panel === "history" ? <History chat={props.chat} at={props.level} part={props.part} turn={props.turn} onClose={() => setPanel(null)} /> : null}
      {panel === "change" || panel === "remove" ? <EditForm chat={props.chat} level={props.level} as={props.as} part={props.part} current={props.current ?? ""} remove={panel === "remove"} onDone={props.onChanged} onClose={() => setPanel(null)} /> : null}
    </div>
  );
}

/** A level's typed systems as each system keeps them, read when asked for, each named as the source of what it shows. */
function Systems(props: { chat: string; level: string; turn: TurnId | null; onClose(): void }) {
  const app = useApp();
  const read = useRead(() => readSystems(app.client, props.chat, props.level, props.turn), [props.chat, props.level, props.turn]);
  const systems = read.value?.systems ?? [];
  return (
    <div class="rpe-open lre-stack" data-systems={props.level}>
      <div class="lre-spread">
        <span class="rpe-caption">The game systems at this level</span>
        <Button size="sm" variant="ghost" onClick={props.onClose}>
          Close
        </Button>
      </div>
      {read.problem === null ? null : (
        <Banner tone="neg" icon="alert" title="The systems could not be read">
          <span>{read.problem}</span>
        </Banner>
      )}
      {read.value === null ? read.loading ? <p class="lre-muted rpe-line">Reading the systems…</p> : null : systems.length === 0 ? <p class="rpe-meta">No game system keeps anything at this level.</p> : null}
      {systems.map((system) => (
        <div key={system.system} class="lre-stack" data-system={system.system}>
          <span class="lre-inline">
            <span class="rpe-strong">{system.title}</span>
            <Badge>{`kept by the ${system.system} system`}</Badge>
          </span>
          {system.sections.map((section) => (
            <div key={section.title}>
              <span class="rpe-caption">{section.title}</span>
              {section.rows.map((row, i) => (
                <Row key={`${row.label}${i}`} k={row.label} v={row.value} sub={[row.secret ? "the player could not see this" : null, row.note, row.precision === null && row.standing === null ? null : [row.precision, row.standing].filter((w) => w !== null).join(", ")].filter((w) => w !== null).join(" · ") || undefined} />
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** What time brought due at a level, with the outcome recorded for each. */
export function DueLines(props: { items: readonly DueShown[] }) {
  if (props.items.length === 0) return null;
  return (
    <div class="lre-stack" data-due>
      <span class="rpe-caption">Brought due here</span>
      <ul class="rpe-plain lre-stack">
        {props.items.map((item, i) => (
          <li key={i} class="rpe-entry">
            <p class="rpe-line">
              <Badge>{item.kind}</Badge> {item.words} <span class="rpe-meta">({item.when})</span>
            </p>
            <p class="rpe-meta">{item.outcome === null ? "No outcome recorded yet." : `Outcome: ${item.outcome}`}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** What can be done with a level: add a value or a fact to it, read its typed systems, and what came due at it. */
export function NodeTools(props: { chat: string; node: LevelNode; turn: TurnId | null; due: readonly DueShown[]; onChanged(): void }) {
  const [panel, setPanel] = useState<"add" | "systems" | null>(null);
  const toggle = (next: "add" | "systems"): void => setPanel((now) => (now === next ? null : next));
  return (
    <div class="lre-stack">
      <DueLines items={props.due} />
      <div class="lre-inline rpe-wrap">
        <Button size="sm" variant="ghost" current={panel === "systems"} onClick={() => toggle("systems")}>
          Systems
        </Button>
        {props.turn !== null ? null : (
          <Button size="sm" variant="ghost" current={panel === "add"} onClick={() => toggle("add")}>
            Add a value or fact
          </Button>
        )}
      </div>
      {panel === "systems" ? <Systems chat={props.chat} level={props.node.ref} turn={props.turn} onClose={() => setPanel(null)} /> : null}
      {panel === "add" ? <EditForm chat={props.chat} level={props.node.ref} as="value" part={null} current="" onDone={props.onChanged} onClose={() => setPanel(null)} /> : null}
    </div>
  );
}

