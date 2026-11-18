// The bootstrap on the Jobs page (plan §12, §14 Jobs; PlanPages-35): the chat's bootstrap for any chat, the one open or any he picks: the six facts of
// "done enough", the start with his own token limit, the jobs of the chat and the question of one that waits for his word, all of `bootstrap.tsx`'s own
// parts; a bootstrap job marked as one in the jobs' list with its limit and its brief folded under the skill's name, not printed whole; and, on a bootstrap
// job that asks at its limit, the same question with the six facts as they stand now. Nothing polls: the parts read again when the chat's live view says
// a run or its state changed.

import { useEffect, useRef, useState } from "preact/hooks";
import type { JobView } from "../../../shared/api";
import { useApp } from "../../app";
import { Section } from "../../../frontend/components";
import { onChatChange } from "../../live-watch";
import { useRead } from "../../reading";
import { errorWords } from "../../words";
import { type AnswerWord, type BootstrapReader, type BootstrapShown, BootstrapView, NO_BOOTSTRAP, QuestionView, readBootstrap } from "../bootstrap";

/** The bootstrap of one chat: read, started, answered and read again on the live view's word. */
function ChatBootstrap(props: { chat: string }) {
  const app = useApp();
  const { chat } = props;
  const [shown, setShown] = useState<BootstrapShown>(NO_BOOTSTRAP);
  const reader = useRef<BootstrapReader | null>(null);
  useEffect(() => {
    setShown(NO_BOOTSTRAP);
    const reading = readBootstrap(app.client, chat, setShown);
    reader.current = reading;
    const off = onChatChange(app.client, chat, reading.refresh);
    return () => {
      off();
      reading.stop();
      reader.current = null;
    };
  }, [chat]);
  return <BootstrapView shown={shown} onStart={(choice) => reader.current?.start(choice)} onAnswer={(job, word) => reader.current?.answer(job, word)} onOlder={() => reader.current?.older()} onJobEnded={() => reader.current?.refresh()} />;
}

/** The bootstrap of the chat open, or of any chat he picks. */
export function BootstrapPart(props: { chat: string | null }) {
  const app = useApp();
  const chats = useRead(() => app.client.call("GET /api/v1/chats", {}), []);
  const [picked, setPicked] = useState<string | null>(null);
  const chat = picked ?? props.chat;
  return (
    <Section id="bootstrap-chat" title="Bootstrap, for a chat">
      <label class="lre-field">
        <span class="label">The chat</span>
        <select class="lre-input" value={chat ?? ""} onChange={(e) => setPicked((e.currentTarget as HTMLSelectElement).value || null)}>
          <option value="">choose a chat</option>
          {(chats.value?.chats ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name === "" ? c.id : c.name}
            </option>
          ))}
        </select>
      </label>
      {chats.problem === null ? null : <p class="rpe-line">{chats.problem}</p>}
      {chat === null ? <p class="lre-muted rpe-line">Pick a chat to see how far its record stands and to start a bootstrap job for it.</p> : <ChatBootstrap key={chat} chat={chat} />}
    </Section>
  );
}

/** The question of a bootstrap job that asks at its limit, with what it spent and the six facts as they stand now, and his answer. */
export function BootstrapAsk(props: { chat: string; job: JobView; stamp: number; onChanged(job: JobView): void }) {
  const app = useApp();
  const { chat, job } = props;
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const answer = useRead(() => app.client.call("GET /api/v1/chats/:chat/bootstrap", { chat }), [chat, job.id, job.state, props.stamp]);
  const question = answer.value?.questions.find((q) => q.job === job.id) ?? null;
  const answered = (word: AnswerWord): void => {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    app.client.call("POST /api/v1/chats/:chat/bootstrap/:job/answer", { chat, job: job.id }, { body: word.go === "end" ? { go: "end" } : { go: "on", ...(word.more === null ? {} : { more: word.more }) } }).then(
      (next) => {
        setBusy(false);
        props.onChanged(next);
      },
      (error: unknown) => {
        setBusy(false);
        setProblem(errorWords(error));
      },
    );
  };
  if (answer.problem !== null) return <p class="rpe-line" data-problem>{answer.problem}</p>;
  if (question === null) return answer.loading ? <p class="lre-muted rpe-line">Reading its question…</p> : null;
  return (
    <div class="lre-stack" data-bootstrap-ask>
      <QuestionView question={question} chat={chat} busy={busy} onAnswer={answered} />
      {problem === null ? null : <p class="rpe-line" data-problem>{problem}</p>}
    </div>
  );
}
