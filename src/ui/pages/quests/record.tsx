// One quest as the Author keeps it (plan §8.3, §14 Quests): what it is, its stages with the condition that moves it on, what was called on each and why,
// who and where, its stakes and rewards, how it is shown to the player, where it came from, how it closed, and its history: each write made to it, in
// the order made, with the turn that made it. Behind the spoiler gate: it can give away what comes.

import type { QuestRecord, QuestRecordRow } from "../../../shared/api";
import { useApp } from "../../app";
import { Badge, Banner, Button, Row, Section } from "../../atoms";
import { useRead } from "../../reading";
import { KIND_WORDS, StageList } from "./journal";

/** How the quest's own visibility reads. */
export const VISIBILITY_WORDS: Readonly<Record<NonNullable<QuestRecordRow["visibility"]>, string>> = { public: "known to the player", known_by: "known only by those it names", secret: "a secret" };

/** What the Author set the player to be shown of it, in words. */
export function shownWords(shown: QuestRecordRow["shown"], visibility: QuestRecordRow["visibility"]): string {
  if (shown === "all") return "the whole quest is shown to the player";
  if (shown === "none") return "nothing of it is shown to the player";
  if (Array.isArray(shown)) return shown.length === 0 ? "no stage is shown to the player" : `only these stages are shown to the player: ${shown.join(", ")}`;
  return visibility === null ? "as the quest's own visibility says (none was given)" : `as the quest's own visibility says: ${VISIBILITY_WORDS[visibility]}`;
}

function Refs(props: { label: string; refs: readonly string[] }) {
  if (props.refs.length === 0) return null;
  return <Row label={props.label} value={<span class="rpe-meta">{props.refs.join(", ")}</span>} />;
}

export function QuestRecordView(props: { record: QuestRecord; onTurn?: (turn: string) => void }) {
  const { quest, history } = props.record;
  return (
    <div class="lre-stack" data-quest={quest.id}>
      <p class="rpe-line">
        <strong>{quest.name}</strong> <Badge>{KIND_WORDS[quest.kind]}</Badge> {quest.open ? <Badge tone="accent">open</Badge> : <Badge tone="warn">closed</Badge>} {quest.world ? <Badge>the world's own</Badge> : <Badge>opened in play</Badge>}
      </p>
      <p class="rpe-meta" data-shown>{shownWords(quest.shown, quest.visibility)}</p>
      {quest.closed === null ? null : (
        <p class="rpe-meta" data-closed>
          Closed: {quest.closed.outcome}
          {quest.closed.why === null ? "" : `. ${quest.closed.why}`}
        </p>
      )}
      <div class="lre-stack">
        {quest.objective === null ? null : <Row label="What it is" value={quest.objective} />}
        {quest.why === null ? null : <Row label="Why it matters" value={quest.why} />}
        {quest.stakes === null ? null : <Row label="What is at stake" value={quest.stakes} />}
        {quest.rewards === null ? null : <Row label="What it may give" value={quest.rewards} />}
        {quest.thread === null ? null : <Row label="Its thread" value={quest.thread} />}
        <Refs label="Who it involves" refs={quest.who} />
        <Refs label="Where" refs={quest.where} />
        <Refs label="What it involves" refs={quest.things} />
      </div>
      <Section id="stages" title="Stages">
        {quest.stages.length === 0 ? <p class="lre-muted rpe-line">It names no stage.</p> : <StageList stages={quest.stages} withCondition />}
      </Section>
      <Section id="history" title="History">
        {history.length === 0 ? (
          <p class="lre-muted rpe-line" data-history-none>{quest.world ? "The world's own quest has no writes made to it." : "No write is recorded."}</p>
        ) : (
          <ol class="rpe-plain lre-stack" data-history>
            {history.map((entry, i) => (
              <li key={i} class="rpe-entry lre-stack" data-op={entry.op}>
                <p class="rpe-line">
                  <strong>{entry.op}</strong>
                  {entry.by === null ? "" : ` · ${entry.by}`}
                  {entry.turn !== null && props.onTurn !== undefined ? (
                    <>
                      {" · "}
                      <Button small kind="ghost" onClick={() => props.onTurn?.(entry.turn as string)}>
                        its turn
                      </Button>
                    </>
                  ) : null}
                </p>
                <p class="rpe-pre rpe-meta">{JSON.stringify(entry.value)}</p>
              </li>
            ))}
          </ol>
        )}
      </Section>
    </div>
  );
}

export function QuestOpen(props: { chat: string; quest: string; stamp: number; onTurn(turn: string): void }) {
  const app = useApp();
  const { chat, quest } = props;
  const record = useRead(() => app.client.call("GET /api/v1/chats/:chat/quests/:quest", { chat, quest }), [chat, quest, props.stamp]);
  return (
    <div class="lre-stack">
      {record.problem === null ? null : (
        <Banner tone="neg" icon="alert" title="The quest could not be read">
          <span>{record.problem}</span>
        </Banner>
      )}
      {record.value === null ? record.loading ? <p class="lre-muted rpe-line">Reading the quest…</p> : null : <QuestRecordView record={record.value} onTurn={props.onTurn} />}
    </div>
  );
}
