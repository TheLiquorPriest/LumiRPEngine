// What he does on a running turn from Live (plan §14 Live, R-24): Pause holds it before its next model call and Resume lets it go on (Stop still stops
// it); a line said to the Author is heard by its lead at its next call and shows in the trace where it arrived; the turn's files are listed as they
// are written, each opened on demand; and each agent's session opens on the Sessions page from here. Pause and a line are his own presses, through
// RPE's routes; the files and the sessions sit behind the spoiler gate, since what they hold can give away what comes.

import { useEffect, useRef, useState } from "preact/hooks";
import { useApp } from "../../app";
import { Banner, Button } from "../../../frontend/components";
import { replyOf } from "../../client";
import { type RunNode, pausedIn } from "../../live-model";
import { useRead } from "../../reading";
import { errorWords } from "../../words";
import { Folder, type FolderReader, readFolder } from "../turns/folder";
import { type FolderShown, NO_FOLDER } from "../turns/types";

/** The sessions of the run's agents, each once, as the agents' own records name them. */
export function sessionsOf(run: RunNode): { session: string; agent: string }[] {
  const seen = new Set<string>();
  const out: { session: string; agent: string }[] = [];
  for (const agent of run.agents.values()) {
    const session = agent.info?.session;
    if (session === undefined || seen.has(session)) continue;
    seen.add(session);
    out.push({ session, agent: agent.ref.definition });
  }
  return out;
}

export function RunExtras(props: { chat: string; run: RunNode; gateOpen: boolean }) {
  const app = useApp();
  const { chat, run } = props;
  const turn = run.turn;
  const running = run.outcome === null && turn !== null;
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [folder, setFolder] = useState<FolderShown>(NO_FOLDER);
  const reader = useRef<FolderReader | null>(null);
  const [stamp, setStamp] = useState(0);
  const state = useRead(running ? () => app.client.call("GET /api/v1/chats/:chat/turns/:turn/live", { chat, turn: turn as string }).then(replyOf) : null, [chat, turn, running]);
  const [held, setHeld] = useState<boolean | null>(null);
  const paused = pausedIn(run) ?? held ?? state.value?.paused ?? false;
  // A file written or changed in the turn's folder is read afresh: the live view says so, nothing polls.
  useEffect(() => {
    if (!running || !props.gateOpen) return;
    return app.client.follow(chat, {
      events(events) {
        if (events.some((event) => event.kind === "folder" && event.data.turn === turn)) setStamp((n) => n + 1);
      },
      reset: () => setStamp((n) => n + 1),
      refused: () => undefined,
    });
  }, [chat, turn, running, props.gateOpen]);
  useEffect(() => {
    setFolder(NO_FOLDER);
    if (turn === null || !props.gateOpen) return;
    const reading = readFolder(app.client, chat, turn, setFolder);
    reader.current = reading;
    return () => {
      reading.stop();
      reader.current = null;
    };
  }, [chat, turn, props.gateOpen, stamp]);
  if (!running || turn === null) return null;
  const act = (what: string, go: () => Promise<unknown>, done: () => void): void => {
    if (busy !== null) return;
    setBusy(what);
    setProblem(null);
    go().then(
      () => {
        setBusy(null);
        done();
      },
      (error: unknown) => {
        setBusy(null);
        setProblem(errorWords(error));
      },
    );
  };
  const sessions = sessionsOf(run);
  return (
    <div class="lre-stack" data-run-extras={run.run}>
      <div class="lre-inline rpe-wrap">
        {paused ? (
          <Button size="sm" busy={busy === "resume"} onClick={() => act("resume", () => app.client.call("POST /api/v1/chats/:chat/turns/:turn/resume", { chat, turn }).then(replyOf), () => setHeld(false))}>
            Resume
          </Button>
        ) : (
          <Button size="sm" variant="ghost" busy={busy === "pause"} onClick={() => act("pause", () => app.client.call("POST /api/v1/chats/:chat/turns/:turn/pause", { chat, turn }).then(replyOf), () => setHeld(true))}>
            Pause
          </Button>
        )}
        {paused ? <span class="rpe-meta" data-paused>Held before its next model call; the one in flight finishes.</span> : null}
      </div>
      <label class="lre-field">
        <span class="label">Say something to the Author</span>
        <textarea class="lre-input" rows={2} value={text} onInput={(e) => setText((e.currentTarget as HTMLTextAreaElement).value)} />
      </label>
      <div class="lre-inline rpe-wrap">
        <Button
          size="sm"
          busy={busy === "say"}
          disabled={text.trim() === ""}
          onClick={() =>
            act("say", () => app.client.call("POST /api/v1/chats/:chat/turns/:turn/say", { chat, turn }, { body: { text } }).then(replyOf), () => {
              setText("");
              setSaid("Said: the lead hears it at its next model call.");
            })
          }
        >
          Say it
        </Button>
        {said === null ? null : <span class="rpe-meta" data-said>{said}</span>}
      </div>
      {problem === null ? null : (
        <Banner tone="neg" icon="alert" title="That did not go through">
          <span data-problem>{problem}</span>
        </Banner>
      )}
      {!props.gateOpen ? null : (
        <div class="lre-stack" data-live-files>
          <Folder folder={folder} onOpenFile={(name) => reader.current?.open(name)} onCloseFile={() => reader.current?.close()} />
          {sessions.length === 0 ? null : (
            <div class="lre-inline rpe-wrap" data-sessions>
              {sessions.map((s) => (
                <Button key={s.session} size="sm" variant="ghost" onClick={() => app.go({ page: "sessions", chat, at: [s.session] })}>
                  {s.agent}'s session
                </Button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
