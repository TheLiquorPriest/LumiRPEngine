// Harness → Record (DEPTH2-PLAN §1.2, §1.3, §1.8): a reply's turn as the story record keeps it,
// beat by beat in the order written: who did or said what, where and when, whom it reached and how
// fully, and which agent decided it. A struck beat shows struck through, with why. A reply's footer
// opens the page on its own reply (`openTurnRecord`); otherwise it opens on the newest reply whose
// turn wrote beats, and a picker goes to any other. Below, the drafts kept for later on the chat's
// path, with their tier and state. Read with `lre.story record` each time the reply shown changes.

import { useEffect, useState } from "preact/hooks";
import type { BeatView, DraftView, RecordReply, RecordView, StoryAt, StoryNames } from "../../shared/story-pages";
import type { HarnessRoute } from "../app";
import { useApp } from "../app";
import { Badge, Button, Empty, Section } from "../components";
import { agentWords, andList, beatHead, DRAFT_STATE_WORDS, draftsInOrder, exposureLine, nameIn, reachedLine, TIER_WORDS } from "./model";

export function RecordPage(props: { chatId: string; at?: StoryAt; go(route: HarnessRoute): void }) {
  const app = useApp();
  const [view, setView] = useState<RecordView | null>(null);
  const [failed, setFailed] = useState(false);
  const key = props.at ? `${props.at.messageId}:${props.at.swipeId}` : "";
  useEffect(() => {
    let live = true;
    setFailed(false);
    void app.request({ type: "lre.story", chatId: props.chatId, op: "record", ...(props.at ? { at: props.at } : {}) }).then((answer) => {
      if (!live) return;
      if (answer?.record) setView(answer.record);
      else setFailed(true);
    });
    return () => {
      live = false;
    };
  }, [props.chatId, key]);
  if (failed) return <Empty icon="alert">The record couldn't be read. Open Record again to retry.</Empty>;
  if (view === null) return <Empty icon="hourglass">Reading the record…</Empty>;
  return <RecordBody view={view} onPick={(at) => props.go({ page: "record", at })} onPerson={(entity) => props.go({ page: "cast", entity })} onShow={(at) => app.host.revealMessage(at.messageId)} />;
}

/** A reply in the picker: which one, how many beats, when its first happened. */
export function replyLabel(reply: RecordReply): string {
  const beats = `${reply.beats} ${reply.beats === 1 ? "beat" : "beats"}`;
  return reply.latest || reply.time === null ? `${reply.latest ? "The latest reply" : "A reply"} (${beats})` : `${reply.time.text} (${beats})`;
}

/** The page, without hooks: the picker, the reply's beats and the drafts. */
export function RecordBody(props: { view: RecordView; onPick(at: StoryAt): void; onPerson(entity: string): void; onShow(at: StoryAt): boolean }) {
  const { view } = props;
  const at = view.at;
  const shown = at === null ? -1 : view.replies.findIndex((r) => r.messageId === at.messageId && r.swipeId === at.swipeId);
  return (
    <div class="lre-stack lre-story-page" data-lre-story-page="record">
      <p class="lre-story-lead">What happened in each turn, beat by beat: who did or said it, where and when, and whom it reached.</p>
      {view.replies.length === 0 ? null : (
        <div class="lre-story-picker">
          <label class="lre-field">
            <span class="label">Reply</span>
            <select
              class="lre-input"
              value={shown < 0 ? "" : String(shown)}
              onChange={(event) => {
                const reply = view.replies[Number(event.currentTarget.value)];
                if (reply) props.onPick({ messageId: reply.messageId, swipeId: reply.swipeId });
              }}
            >
              {shown < 0 ? <option value="">This reply</option> : null}
              {view.replies.map((r, i) => (
                <option key={`${r.messageId}:${r.swipeId}`} value={String(i)}>
                  {replyLabel(r)}
                </option>
              ))}
            </select>
          </label>
          {at !== null ? (
            <Button size="sm" icon="message" onClick={() => props.onShow(at)}>
              Show in the chat
            </Button>
          ) : null}
        </div>
      )}
      {at === null ? (
        <Empty icon="scroll" title="No beats yet">
          Each turn, the author records what happened beat by beat: who did or said what, where and when, and whom it reached. The first beats show here after your next message.
        </Empty>
      ) : view.beats.length === 0 ? (
        <Empty icon="scroll">This reply's turn recorded no beats.</Empty>
      ) : (
        <ol class="lre-story-beats">
          {view.beats.map((beat) => (
            <BeatCard key={beat.id} beat={beat} names={view.names} onPerson={props.onPerson} />
          ))}
        </ol>
      )}
      <DraftsSection drafts={view.drafts} names={view.names} />
    </div>
  );
}

/** A name that opens the person on Cast; the world and a place are plain words. */
function Who(props: { id: string; names: StoryNames; onPerson(entity: string): void }) {
  if (props.id === "world") return <>{nameIn(props.names, props.id)}</>;
  return (
    <button type="button" class="lre-story-who" onClick={() => props.onPerson(props.id)}>
      {nameIn(props.names, props.id)}
    </button>
  );
}

/** One beat, without hooks: who and what kind of thing, where and when, what happened, the words spoken, whom it reached and how, who decided it; struck through with why where it no longer stands. */
export function BeatCard(props: { beat: BeatView; names: StoryNames; onPerson(entity: string): void }) {
  const { beat, names } = props;
  const head = beatHead(beat, names);
  const struck = beat.struck !== null;
  const notes = [`Decided by ${agentWords(beat.decidedBy.agent, beat.decidedBy.as, names)}`, beat.past ? "recorded from the chat's past" : null, beat.settles !== null ? "plays a draft kept for later" : null].filter((n): n is string => n !== null);
  return (
    <li class="lre-story-beat" data-lre-beat={beat.id} data-lre-beat-kind={beat.kind} data-lre-struck={struck ? "" : undefined}>
      <div class="lre-story-beat-head">
        <span class="lre-story-beat-who">
          {beat.by === "world" ? head.who : <><Who id={beat.by} names={names} onPerson={props.onPerson} /> {head.kind}</>}
        </span>
        <span class="lre-story-when">{head.where !== null ? `${head.where} · ${head.when}` : head.when}</span>
        {struck ? <Badge tone="neg">Struck</Badge> : null}
      </div>
      <div class="lre-story-beat-body">
        <p class="lre-story-beat-what">{beat.what}</p>
        {beat.quotes.map((q) => (
          <blockquote key={q} class="lre-story-quote">
            {q}
          </blockquote>
        ))}
        {beat.kind !== "inner" && beat.surface !== beat.what ? <p class="lre-story-note">{`What anyone there could tell: ${beat.surface}`}</p> : null}
        {beat.to.length > 0 ? <p class="lre-story-note">{`To ${andList(beat.to.map((id) => nameIn(names, id)))}`}</p> : null}
      </div>
      <div class="lre-story-reach">
        <span class="lre-story-reach-title">{reachedLine(beat, names)}</span>
        {beat.exposure.length > 0 ? (
          <ul class="lre-story-reach-list">
            {beat.exposure.map((e) => {
              const line = exposureLine(e, names);
              return (
                <li key={e.who} data-lre-reach={e.reach}>
                  <Who id={e.who} names={names} onPerson={props.onPerson} />
                  <span class="lre-story-reach-how">{line.how}</span>
                  {line.got !== null ? <span class="lre-story-reach-got">{line.got}</span> : null}
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
      <p class="lre-story-by">{notes.join(" · ")}</p>
      {struck ? <p class="lre-story-struck-why">{`Struck: ${beat.struck}`}</p> : null}
    </li>
  );
}

/** The drafts kept for later, without hooks: waiting ones first. */
export function DraftsSection(props: { drafts: readonly DraftView[]; names: StoryNames }) {
  const drafts = draftsInOrder(props.drafts);
  return (
    <Section title="Kept for later">
      {drafts.length === 0 ? (
        <Empty icon="clock">Nothing is kept for later. When the world moves outside your view, the author may keep what happens here until the story needs it.</Empty>
      ) : (
        <ul class="lre-story-drafts">
          {drafts.map((d) => (
            <li key={d.id} class="lre-story-draft" data-lre-draft={d.id} data-lre-draft-state={d.state}>
              <div class="lre-story-beat-head">
                <Badge tone="accent">{TIER_WORDS[d.tier].short}</Badge>
                <span class="lre-story-when">{d.time.text}</span>
                <Badge tone={d.state === "open" ? "warn" : d.state === "stale" ? "neg" : "neutral"}>{DRAFT_STATE_WORDS[d.state]}</Badge>
              </div>
              <p class="lre-story-beat-what">{d.what}</p>
              <p class="lre-story-note">{[d.who.length > 0 ? `Who: ${andList(d.who.map((id) => nameIn(props.names, id)))}` : null, d.where.length > 0 ? `Where: ${andList(d.where.map((id) => nameIn(props.names, id)))}` : null, TIER_WORDS[d.tier].long].filter((p): p is string => p !== null).join(" · ")}</p>
              {d.notes !== null ? <p class="lre-story-note">{`Notes: ${d.notes}`}</p> : null}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
