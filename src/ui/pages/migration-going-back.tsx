// The Migration page's going back (plan §15.6; R-80, R-84, R-90; N-17's default): the steps as they stand (the configured
// branch, the chats moved onto RPE's connections since the swap, RPE's own earlier connection, a key to put back), the
// permissions by name, and what today's build put in Lumiverse, left as it is. His word that he will not go back is one
// press, confirmed before it is kept. Only after it are the engine books listed, each with the chats it is attached to and a
// press that removes that book and its attachments: what the press will remove is shown before, what it removed after. The
// regex scripts are never offered.

import { useState } from "preact/hooks";
import type { EngineBookRemoved, EngineBookShown, JsonValue } from "../../shared/api";
import { useApp } from "../app";
import { Banner, Button } from "../atoms";
import { useRead } from "../reading";
import { counted, errorWords } from "../words";

/** What today's build put in Lumiverse, from the counts the last real run kept, in words; none where it holds none. */
function leftWords(left: JsonValue | null): string[] {
  if (left === null || typeof left !== "object" || Array.isArray(left)) return [];
  const n = (key: string): number => (typeof left[key] === "number" ? (left[key] as number) : 0);
  const scheduler = left.schedulerExclusions;
  const lines = [
    `${counted(n("engineBooks"), "engine book")} with ${counted(n("engineEntries"), "entry", "entries")}, attached to ${counted(n("chatsWithEngineBook"), "chat")}`,
    `${counted(n("markedEntries"), "entry", "entries")} of your own books carrying the engine's fields`,
    `${counted(n("regexScripts"), "regex script")}`,
    `${counted(n("presetBlocks"), "preset block")}, and ${counted(n("outletReferences"), "outlet reference")}`,
    `${counted(n("panelMessages"), "message")} the panels put in your chats`,
    `${counted(n("chatsPinned"), "chat")} pinned to the engine's connection, ${n("chatsPinnedToModel")} of them to a model too`,
  ];
  if (scheduler !== null && typeof scheduler === "object" && !Array.isArray(scheduler)) lines.push(`${counted(typeof scheduler.listed === "number" ? scheduler.listed : 0, "origin")} on the scheduler's exclusions, ${typeof scheduler.engine === "number" ? scheduler.engine : 0} of them the engine's address`);
  return lines;
}

function BookLine(props: { book: EngineBookShown; done: EngineBookRemoved | null; onRemoved: (done: EngineBookRemoved) => void }) {
  const app = useApp();
  const b = props.book;
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const remove = (): void => {
    setBusy(true);
    setProblem(null);
    app.client.call("POST /api/v1/migration/engine-books/:book/removal", { book: b.book }).then(
      (done) => {
        setBusy(false);
        setAsking(false);
        props.onRemoved(done);
      },
      (error: unknown) => {
        setBusy(false);
        setProblem(errorWords(error));
      },
    );
  };
  const d = props.done;
  return (
    <li class="lre-stack" data-book={b.book}>
      <p class="rpe-line">
        <strong>{b.name}</strong> · {counted(b.entries, "entry", "entries")} · attached to {counted(b.chats.length, "chat")}
      </p>
      {b.chats.length === 0 ? null : <p class="rpe-meta">{b.chats.map((c) => c.name).join(", ")}</p>}
      {d !== null ? (
        <p class="rpe-line" data-removed={d.removed ? "true" : "false"}>
          {d.removed ? `Removed, and taken out of ${counted(d.detached.length, "chat")}.` : d.failed === null ? `Lumiverse holds it no longer; taken out of ${counted(d.detached.length, "chat")}.` : `Not removed: ${d.failed}. Taken out of ${counted(d.detached.length, "chat")} before it stopped; press again to finish.`}
        </p>
      ) : null}
      {d?.removed === true ? null : asking ? (
        <div class="lre-stack" data-confirm="true">
          <p class="rpe-line">
            This removes the book {b.name} with its {counted(b.entries, "entry", "entries")} from Lumiverse
            {b.chats.length === 0 ? "" : `, and takes it out of ${b.chats.map((c) => c.name).join(", ")}`}. Nothing else of any chat changes, and it cannot be undone.
          </p>
          <div class="lre-row">
            <Button kind="danger" small busy={busy} onClick={remove}>
              Remove it
            </Button>
            <Button kind="ghost" small disabled={busy} onClick={() => setAsking(false)}>
              Keep it
            </Button>
          </div>
        </div>
      ) : (
        <Button kind="ghost" small onClick={() => setAsking(true)}>
          Remove this book…
        </Button>
      )}
      {problem === null ? null : <p class="lre-muted rpe-line">{problem}</p>}
    </li>
  );
}

export function GoingBack() {
  const app = useApp();
  const read = useRead(() => app.client.call("GET /api/v1/migration/going-back", {}), []);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, EngineBookRemoved>>({});
  const shown = read.value;
  if (shown === null) {
    return read.problem === null ? (
      <p class="lre-muted rpe-line">Reading going back…</p>
    ) : (
      <Banner tone="neg" icon="alert" title="Going back could not be read">
        <span>{read.problem}</span>
      </Banner>
    );
  }
  const say = (): void => {
    setBusy(true);
    setProblem(null);
    app.client.call("POST /api/v1/migration/going-back", {}, { body: { sure: true } }).then(
      () => {
        setBusy(false);
        setAsking(false);
        read.again();
      },
      (error: unknown) => {
        setBusy(false);
        setProblem(errorWords(error));
      },
    );
  };
  const left = leftWords(shown.lumiverse);
  return (
    <div class="lre-stack" data-going-back="true">
      <ul class="lre-stack rpe-plain">
        {shown.steps.map((step, i) => (
          <li key={i} class="rpe-line">
            {step}
          </li>
        ))}
      </ul>
      <p class="rpe-meta">The permissions the previous build asks for, to approve again ({shown.permissions.length}):</p>
      <ul class="rpe-files" data-permissions="true">
        {shown.permissions.map((p) => (
          <li key={p}>
            <code>{p}</code>
          </li>
        ))}
      </ul>
      <p class="rpe-meta">What today's build put in Lumiverse, left as it is{shown.said === null ? " until you say you will not go back" : ""}:</p>
      {left.length === 0 ? (
        <p class="lre-muted rpe-line">No real run has counted it yet.</p>
      ) : (
        <ul class="rpe-reports" data-left="true">
          {left.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      )}
      {shown.said !== null ? (
        <p class="rpe-line" data-said="true">
          You said you will not go back ({new Date(shown.said).toLocaleString()}). Going back's steps still hold; what you remove below is gone from Lumiverse.
        </p>
      ) : asking ? (
        <div class="lre-stack" data-confirm="true">
          <p class="rpe-line">Once you say it, this page offers to remove the books today's build made for its worlds, one book per press. Going back's steps still hold, but a book you remove is gone, and the previous build would play without it. Say you will not go back?</p>
          <div class="lre-row">
            <Button kind="danger" small busy={busy} onClick={say}>
              I will not go back
            </Button>
            <Button kind="ghost" small disabled={busy} onClick={() => setAsking(false)}>
              Not now
            </Button>
          </div>
        </div>
      ) : (
        <Button kind="ghost" small onClick={() => setAsking(true)}>
          I will not go back…
        </Button>
      )}
      {problem === null ? null : <p class="lre-muted rpe-line">{problem}</p>}
      {shown.said === null ? null : shown.books === null ? (
        <p class="lre-muted rpe-line">{shown.booksWhy ?? "No engine book is listed."}</p>
      ) : shown.books.length === 0 ? (
        <p class="lre-muted rpe-line">Lumiverse holds no book today's build made.</p>
      ) : (
        <ul class="lre-stack rpe-plain" data-books="true">
          {shown.books.map((b) => (
            <BookLine key={b.book} book={b} done={done[b.book] ?? null} onRemoved={(d) => setDone({ ...done, [b.book]: d })} />
          ))}
        </ul>
      )}
    </div>
  );
}
