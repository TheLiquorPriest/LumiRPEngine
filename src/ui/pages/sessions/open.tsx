// One session open (plan §11, §14 Sessions): what its next turn would carry in each of the three modes, its compactions with the Undo of
// each after a question that says what it costs, Compact now, Close and Reopen on his word; and the turns that ran in it, newest first,
// each with its transcript behind the spoiler gate (the trace view, as Live draws it) filtered to this session's own records, with the
// calls each run made against the limit and each agent's window. Every refusal is shown in RPE's words.

import { useEffect, useState } from "preact/hooks";
import type { CarryMode, CompactionShown, ConnectionShown, SessionShown, SessionTurnRow } from "../../../shared/api";
import { useApp, useNow } from "../../app";
import { Badge, Banner, Button, Gated, Section } from "../../atoms";
import { replyOf, type RpeClient } from "../../client";
import { applyRead, EMPTY_LIVE, type LiveModel, runsOf } from "../../live-model";
import { useNoticeLines } from "../../notice-words";
import { type PageOf, usePaged, useRead } from "../../reading";
import { AgentTree, RunHead } from "../../trace-view";
import { useSelect } from "../../store";
import { useUiSetting } from "../../ui-settings";
import { counted, errorWords, num, when } from "../../words";
import { RunUsage, windowOfModel } from "../usage";

const CARRY_WORDS: Readonly<Record<CarryMode, { name: string; about: string }>> = {
  continuing: { name: "Continuing", about: "what the Author did in its earlier turns, as it did it" },
  records: { name: "Records", about: "the Author's own record of each earlier turn" },
  nothing: { name: "Nothing", about: "only the summary the scene opened with" },
};
const CARRY_MODES: readonly CarryMode[] = ["continuing", "records", "nothing"];

const REASON_WORDS: Readonly<Record<NonNullable<CompactionShown["reason"]>, string>> = {
  "would-not-fit": "the next call would not fit the window",
  refused: "the provider refused a call as too long",
  asked: "he asked for it",
  fold: "records past their share were folded",
};

/** Who started a session that is not a scene's, in a line. */
export function parentWords(session: SessionShown): string {
  const parent = session.parent;
  if (parent === undefined) return "";
  if ("owner" in parent) return "started by him";
  return `started by ${parent.agent}${parent.turn === undefined ? "" : ` in turn ${parent.turn}`}`;
}

/** The compactions the page lists: every one the file holds, the newest first. */
export function newestFirst(compactions: readonly CompactionShown[]): CompactionShown[] {
  return [...compactions].reverse();
}

function CompactionLine(props: { c: CompactionShown; asking: boolean; busy: boolean; onAsk(id: string | null): void; onUndo(id: string): void; onTurn(turn: string): void }) {
  const { c } = props;
  const grew = c.before !== undefined && c.after !== undefined ? c.before - c.after : null;
  return (
    <li class="rpe-entry" data-compaction={c.id} data-stands={c.stands ? "yes" : "no"}>
      <p class="rpe-line">
        <Badge tone={c.stands ? "pos" : undefined}>{c.undone === true ? "undone" : c.stands ? "stands" : "replaced"}</Badge>{" "}
        {c.of === "turns" ? `Stands for ${counted(c.turns.length, "turn")}` : "Stands for the run's older calls"} · written in{" "}
        <Button small kind="ghost" onClick={() => props.onTurn(c.turn)}>
          its turn
        </Button>
      </p>
      <p class="rpe-meta">
        {when(c.at)}
        {c.reason === undefined ? "" : ` · because ${REASON_WORDS[c.reason]}`}
        {c.before === undefined || c.after === undefined ? "" : ` · ${num(c.before)} tokens down to ${num(c.after)}`}
      </p>
      <details class="lre-disclosure">
        <summary>
          <span class="lre-disclosure-label">Its summary</span>
        </summary>
        <p class="rpe-pre prose" data-summary>
          {c.summary}
        </p>
      </details>
      {c.stands && c.of === "turns" ? (
        props.asking ? (
          <Banner tone="warn" icon="alert" title="Undo this summary?">
            <span>
              From its next turn the {counted(c.turns.length, "turn")} it stands for are carried whole again, until a later compaction
              {grew === null ? "" : `: about ${num(grew)} tokens more in every turn's prompt`}. The file keeps both.
            </span>
            <div class="lre-inline">
              <Button kind="danger" busy={props.busy} onClick={() => props.onUndo(c.id)}>
                Yes, undo it
              </Button>
              <Button kind="ghost" onClick={() => props.onAsk(null)}>
                No
              </Button>
            </div>
          </Banner>
        ) : (
          <Button small kind="ghost" onClick={() => props.onAsk(c.id)}>
            Undo the summary
          </Button>
        )
      ) : null}
    </li>
  );
}

/** One turn of the session: its place, and behind the gate each run's work in this session with its calls and windows. */
function TurnOfSession(props: { chat: string; session: string; turn: string; n: number | null; at: number; runs: readonly string[]; gate: boolean; connections: readonly ConnectionShown[]; calls: number | null; onTurn(turn: string): void }) {
  const app = useApp();
  const notices = useNoticeLines(props.chat);
  const read = useRead(props.gate ? () => app.client.call("GET /api/v1/chats/:chat/turns/:turn", { chat: props.chat, turn: props.turn }).then((answer) => replyOf(answer)) : null, [props.chat, props.turn, props.gate]);
  const model: LiveModel | null = read.value === null ? null : applyRead(EMPTY_LIVE, { ...read.value, trace: read.value.trace.filter((r) => r.scope.session === props.session) });
  const running = model !== null && runsOf(model, props.turn).some((r) => r.outcome === null);
  const now = useNow(running);
  return (
    <li class="rpe-entry" data-turn={props.turn}>
      <p class="rpe-line">
        <Button small kind="ghost" onClick={() => props.onTurn(props.turn)}>
          {props.n === null ? "A turn off the path" : `Reply ${props.n}`}
        </Button>
        <span class="rpe-meta"> · {when(props.at)} · {counted(props.runs.length, "run")}</span>
      </p>
      {!props.gate ? null : read.problem !== null ? (
        <p class="rpe-line" data-turn-problem>{read.problem}</p>
      ) : model === null ? (
        <p class="lre-muted rpe-line">Reading its transcript…</p>
      ) : (
        <div class="lre-stack">
          {runsOf(model, props.turn).map((run) => (
            <div key={run.run} class="lre-stack" data-run={run.run}>
              <RunHead run={run} now={now} />
              <RunUsage run={run} limit={props.calls} windowOf={(connection, name) => windowOfModel(props.connections, connection, name)} />
              <AgentTree run={run} now={now} notices={notices} />
            </div>
          ))}
        </div>
      )}
    </li>
  );
}

export interface SessionOpenProps {
  chat: string;
  session: SessionShown;
  /** The session as the list last held it changes when a press answers. */
  onChanged(session: SessionShown): void;
  onTurn(turn: string): void;
}

export function SessionOpen(props: SessionOpenProps) {
  const app = useApp();
  const { chat, session } = props;
  const [mode, setMode] = useState<CarryMode | null>(null);
  const settings = useRead(() => app.client.call("GET /api/v1/settings", {}, { query: { chat } }), [chat]);
  const inForce = ((): CarryMode => {
    const value = settings.value?.settings.find((s) => s.key === "carry")?.value;
    return value === "records" || value === "nothing" ? value : "continuing";
  })();
  const shownMode = mode ?? inForce;
  const calls = ((): number | null => {
    const value = settings.value?.settings.find((s) => s.key === "limits.turn.calls")?.value;
    return typeof value === "number" ? value : null;
  })();
  const read = useRead(() => app.client.call("GET /api/v1/chats/:chat/sessions/:session", { chat, session: session.id }, { query: { carry: shownMode } }), [chat, session.id, shownMode]);
  const [compactions, setCompactions] = useState<readonly CompactionShown[] | null>(null);
  useEffect(() => setCompactions(read.value?.compactions ?? null), [read.value]);
  const [asking, setAsking] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [closed, setClosed] = useState<{ change: number | null } | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [made, setMade] = useState<CarryMode | null>(null);
  const gate = useSelect(app.gate, (open) => open.has(chat));
  const perPage = useUiSetting("sessionsAtATime");
  const turns = usePaged(
    (cursor) => app.client.call("GET /api/v1/chats/:chat/sessions/:session/turns", { chat, session: session.id }, { query: { limit: perPage, ...(cursor === undefined ? {} : { cursor }) } }).then((page): PageOf<SessionTurnRow> => ({ items: page.items, next: page.next })),
    [chat, session.id],
  );
  const connections = useRead(() => app.client.call("GET /api/v1/connections", {}), []);
  const press = (what: string, run: () => Promise<void>): void => {
    if (busy !== null) return;
    setBusy(what);
    setProblem(null);
    run().then(
      () => setBusy(null),
      (error: unknown) => {
        setBusy(null);
        setProblem(errorWords(error));
      },
    );
  };
  const call = app.client as Pick<RpeClient, "call">;
  const close = (): void =>
    press("close", async () => {
      const answer = await call.call("POST /api/v1/chats/:chat/sessions/:session/close", { chat, session: session.id });
      setClosed({ change: answer.change });
      setSaid(answer.scene === null ? "The session is closed. The story record held no scene open." : "The scene is closed, as your own change, with its session.");
      props.onChanged(answer.session);
    });
  const reopen = (): void =>
    press("reopen", async () => {
      const answer = await call.call("POST /api/v1/chats/:chat/sessions/:session/reopen", { chat, session: session.id }, { body: closed?.change == null ? {} : { change: closed.change } });
      setClosed(null);
      setSaid("The close is taken back: the scene and its session stand open.");
      props.onChanged(answer.session);
    });
  const compact = (): void =>
    press("compact", async () => {
      const answer = await call.call("POST /api/v1/chats/:chat/sessions/:session/compact", { chat, session: session.id });
      setSaid("Compaction asked for: it runs at the session's next turn, the Author first given its chance to save what it wants kept.");
      props.onChanged(answer.session);
    });
  const undo = (id: string): void =>
    press("uncompact", async () => {
      const answer = await call.call("POST /api/v1/chats/:chat/sessions/:session/uncompact", { chat, session: session.id }, { body: { id } });
      setCompactions(answer.compactions);
      setAsking(null);
      read.again();
    });
  const makeDefault = (): void =>
    press("default", async () => {
      await call.call("PUT /api/v1/settings", {}, { body: { level: "global", key: "carry", value: shownMode } });
      setMade(shownMode);
      settings.again();
    });
  const isOpen = session.state === "open";
  return (
    <div class="lre-stack" data-session={session.id}>
      {problem === null ? null : (
        <Banner tone="neg" icon="alert" title="Not done">
          <span>{problem}</span>
        </Banner>
      )}
      {said === null ? null : (
        <Banner tone="info" icon="check" title="Done">
          <span data-said>{said}</span>
        </Banner>
      )}
      <div class="lre-inline rpe-wrap" data-session-actions>
        {session.kind === "scene" && isOpen ? (
          <Button busy={busy === "close"} onClick={close}>
            Close this scene
          </Button>
        ) : null}
        {session.kind === "scene" && !isOpen && session.by === "user" ? (
          <Button busy={busy === "reopen"} onClick={reopen}>
            Reopen it
          </Button>
        ) : null}
        {isOpen && session.compactAsked !== true ? (
          <Button busy={busy === "compact"} onClick={compact}>
            Compact now
          </Button>
        ) : null}
        {session.compactAsked === true ? <Badge tone="warn">compaction asked; it runs at the next turn</Badge> : null}
      </div>
      <Section id="carries" title="What its next turn carries">
        <div class="lre-inline rpe-wrap">
          {CARRY_MODES.map((m) => (
            <Button key={m} small kind="ghost" current={m === shownMode} onClick={() => setMode(m)}>
              {CARRY_WORDS[m].name}
              {m === inForce ? " (in force)" : ""}
            </Button>
          ))}
        </div>
        <p class="rpe-meta">
          {CARRY_WORDS[shownMode].name}: {CARRY_WORDS[shownMode].about}.
        </p>
        {read.problem === null ? null : <p class="rpe-line" data-carry-problem>{read.problem}</p>}
        {read.value === null ? (
          read.problem === null ? <p class="lre-muted rpe-line">Reading what it carries…</p> : null
        ) : read.value.carried === "" ? (
          <p class="lre-muted rpe-line" data-carried-none>In this mode it would carry nothing.</p>
        ) : (
          <p class="rpe-pre" data-carried>
            {read.value.carried}
          </p>
        )}
        {shownMode === inForce ? null : (
          <div class="lre-inline">
            <Button small busy={busy === "default"} onClick={makeDefault}>
              Make {CARRY_WORDS[shownMode].name} the default
            </Button>
          </div>
        )}
        {made === null ? null : <p class="rpe-meta" data-made>Your default is now {CARRY_WORDS[made].name}, in your own settings file; a chat's own setting still wins.</p>}
      </Section>
      <Section id="compactions" title="Its compactions">
        {compactions === null ? (
          <p class="lre-muted rpe-line">Reading them…</p>
        ) : compactions.length === 0 ? (
          <p class="lre-muted rpe-line" data-compactions-none>It has never been compacted.</p>
        ) : (
          <ul class="rpe-plain lre-stack">
            {newestFirst(compactions).map((c) => (
              <CompactionLine key={c.id} c={c} asking={asking === c.id} busy={busy === "uncompact"} onAsk={setAsking} onUndo={undo} onTurn={props.onTurn} />
            ))}
          </ul>
        )}
      </Section>
      <Section id="turns" title="Its turns">
        <Gated open={gate} onOpen={() => app.gate.open(chat)} onClose={() => app.gate.close(chat)} why="What the agents planned and did in a turn can give away what comes next.">
          {null}
        </Gated>
        {turns.problem === null ? null : (
          <Banner tone="neg" icon="alert" title="Its turns could not be read">
            <span>{turns.problem}</span>
          </Banner>
        )}
        {turns.items.length === 0 && !turns.loading && turns.problem === null ? (
          <p class="lre-muted rpe-line" data-turns-none>No turn has run in it.</p>
        ) : (
          <ul class="rpe-plain lre-stack" data-turns>
            {turns.items.map((t) => (
              <TurnOfSession key={t.turn} chat={chat} session={session.id} turn={t.turn} n={t.n} at={t.at} runs={t.runs} gate={gate} connections={connections.value?.connections ?? []} calls={calls} onTurn={props.onTurn} />
            ))}
          </ul>
        )}
        {turns.more ? (
          <Button busy={turns.loading} onClick={turns.older}>
            Older turns
          </Button>
        ) : null}
      </Section>
    </div>
  );
}
