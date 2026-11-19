// The line under each reply (plan §14, PlanChatUI-3 item 2): when and where it happened, what the turn did in
// each lane (story, engine, each opening its short list), the turn's marks (edited, interrupted and the rest),
// each a short word whose meaning shows on hover and when pressed, and a link to its Turn page. It follows the
// swipe shown, is asked for only the rows Lumiverse has mounted (`../replies.ts`), and draws once per message in
// either display mode. A reply made without RPE says so; a migrated reply names the engine that played it. A
// reply whose turn's record was not finished (its run failed or was stopped once the reply had begun to go out)
// says why, with Settle now where that settles it (plan §10.10).

import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { AppContext } from "../../../frontend/app";
import { MessageChips } from "../../../frontend/chips";
import type { Readable } from "../../store";
import { chatPlay } from "../chat-play";
import { type LaneShown, type ReplyLine, type RepliesState, repliesOf } from "../replies";
import { MARK_BADGES, markWords } from "../../pages/turns/sections/marks";
import type { FrameEnv, SurfaceDef } from "../surface";
import { errorWords } from "../../words";
import { messageOfScope } from "./working";

const LANE_NAME: Record<LaneShown["lane"], string> = { story: "Story", engine: "Engine" };

function useReplies(env: FrameEnv, message: string): { line: ReplyLine | undefined; failed: string | null } {
  const replies = repliesOf(env);
  const [state, setState] = useState<RepliesState | null>(replies?.get() ?? null);
  useEffect(() => {
    if (replies === null) return undefined;
    setState(replies.get());
    const unwant = replies.want(message);
    const unsubscribe = (replies as Readable<RepliesState>).subscribe(setState);
    return () => {
      unwant();
      unsubscribe();
    };
  }, [replies, message]);
  return { line: state?.lines.get(message), failed: state?.failed ?? null };
}

function Lane(props: { lane: LaneShown }) {
  const [open, setOpen] = useState(false);
  const { lane } = props;
  return (
    <span class="rpe-chat-lane">
      <button type="button" class="rpe-chat-line-btn" aria-expanded={open} disabled={lane.lines.length === 0} onClick={() => setOpen(!open)}>
        {LANE_NAME[lane.lane]} {lane.count}
      </button>
      {open ? (
        <ul class="rpe-chat-lane-list">
          {lane.lines.map((line, at) => (
            <li key={at}>{line}</li>
          ))}
        </ul>
      ) : null}
    </span>
  );
}

/** A mark as the line under a reply shows it: its short word, and what it means, in the Turns page's own words. */
export interface MarkShown {
  kind: string;
  word: string;
  meaning: string;
}

/** A reply's marks, each kind once, in the order they were set; a kind the page has no words for is shown by its name. */
export function marksShown(marks: readonly { kind: string }[]): MarkShown[] {
  const kinds = [...new Set(marks.map((m) => m.kind))];
  return kinds.map((kind) => {
    if (!Object.hasOwn(MARK_BADGES, kind)) return { kind, word: kind, meaning: `A mark this page has no words for: ${kind}.` };
    const known = kind as keyof typeof MARK_BADGES;
    return { kind, word: MARK_BADGES[known], meaning: markWords({ kind: known, message: null }) };
  });
}

/** One mark: its word, its meaning on hover, and pressed, the meaning said under it with a way to the turn's page. */
function Mark(props: { mark: MarkShown; onTurn: (() => void) | null }) {
  const [open, setOpen] = useState(false);
  return (
    <span class="rpe-chat-lane" data-rpe-mark={props.mark.kind}>
      <button type="button" class="rpe-chat-line-btn rpe-chat-line-mark" title={props.mark.meaning} aria-expanded={open} onClick={() => setOpen(!open)}>
        {props.mark.word}
      </button>
      {open ? (
        <span class="rpe-chat-lane-list" role="note">
          {props.mark.meaning}{" "}
          {props.onTurn === null ? null : (
            <button type="button" class="rpe-chat-line-btn" onClick={props.onTurn}>
              See it on the turn's page
            </button>
          )}
        </span>
      ) : null}
    </span>
  );
}

/** A turn whose record of this reply was not finished: why, and Settle now where it settles this turn; what came of the press, in RPE's words. */
function Unfinished(props: { env: FrameEnv; chat: string; why: string; settle: boolean }) {
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const press = (): void => {
    setBusy(true);
    props.env.client.call("POST /api/v1/chats/:chat/settle", { chat: props.chat }).then(
      () => {
        setBusy(false);
        setSaid("The Author is finishing the record of this reply now. Nothing is written to your chat.");
      },
      (error: unknown) => {
        setBusy(false);
        setSaid(errorWords(error));
      },
    );
  };
  return (
    <span class="rpe-chat-line-unfinished" role="status">
      <span class="rpe-chat-line-fact">{props.why}</span>
      {props.settle ? (
        <button type="button" class="rpe-chat-line-btn" disabled={busy} title="The Author finishes this turn's record of the reply now; nothing is written to your chat." onClick={press}>
          Settle now
        </button>
      ) : null}
      {said === null ? null : <span class="rpe-chat-line-fact">{said}</span>}
    </span>
  );
}

function Line(props: { env: FrameEnv; message: string }) {
  const { line } = useReplies(props.env, props.message);
  const chat = props.env.chat.get();
  if (line === undefined) return null;
  if (line.empty) {
    // An empty reply Lumiverse kept when a generation failed or was stopped before its first word: what to do with it.
    return (
      <div class="lre rpe-chat-line" data-rpe-line="empty">
        <span class="rpe-chat-line-unfinished">An empty reply: its turn ended before a word of it went out, and its thinking block says why. Swipe it or delete it in Lumiverse.</span>
        <button type="button" class="rpe-chat-line-btn" title="RPE takes such replies away itself where you switch this on: a write to your chat it otherwise never makes." onClick={() => props.env.open({ page: "settings", chat: null, at: ["lumiverse.reply.removeEmpty"] })}>
          Take away an empty reply a failed or stopped turn left
        </button>
      </div>
    );
  }
  if (!line.played) return <div class="lre rpe-chat-line" data-rpe-line="unplayed">Made without RPE.</div>;
  const turn = line.joined?.joined ?? line.turn;
  const facts = [line.time, line.place].filter((fact): fact is string => fact !== null);
  return (
    <div class="lre rpe-chat-line" data-rpe-line="played">
      {line.engine === null ? null : <span class="rpe-chat-line-fact">Played by {line.engine}</span>}
      {facts.map((fact) => (
        <span key={fact} class="rpe-chat-line-fact">
          {fact}
        </span>
      ))}
      {line.lanes.map((lane) => (
        <Lane key={lane.lane} lane={lane} />
      ))}
      {marksShown(line.marks).map((mark) => (
        <Mark key={mark.kind} mark={mark} onTurn={chat === null || turn === null ? null : () => props.env.open({ page: "turns", chat, at: [turn] })} />
      ))}
      {chat === null || turn === null ? null : (
        <button type="button" class="rpe-chat-line-btn rpe-chat-line-turn" onClick={() => props.env.open({ page: "turns", chat, at: [turn] })}>
          Turn
        </button>
      )}
    </div>
  );
}

const claimed = new Map<string, HTMLElement>();

function claim(message: string, root: HTMLElement): boolean {
  const holder = claimed.get(message);
  if (holder !== undefined && holder !== root && holder.isConnected) return false;
  claimed.set(message, root);
  return true;
}

/** The chips of a reply (a review card, a carried chip, an Undo): today's own, over the kept App for the open chat. */
function Chips(props: { env: FrameEnv; message: string }) {
  const play = chatPlay(props.env);
  if (play === null) return null;
  return (
    <AppContext.Provider value={play.app}>
      <div class="lre">
        <MessageChips messageId={props.message} />
      </div>
    </AppContext.Provider>
  );
}

function draw(env: FrameEnv, root: HTMLElement, scope: string): void {
  const message = messageOfScope(scope);
  render(
    message === null || !claim(message, root) ? null : (
      <>
        <Line env={env} message={message} />
        <Chips env={env} message={message} />
      </>
    ),
    root,
  );
}

export const surface: SurfaceDef = {
  id: "reply-line",
  surfaces: (env) => [
    {
      key: "reply-line",
      placement: "dom-decorator",
      options: {
        mount: "message_body_after",
        render(root, ctx) {
          draw(env, root, ctx.scope);
          return () => {
            const message = messageOfScope(ctx.scope);
            if (message !== null && claimed.get(message) === root) claimed.delete(message);
            render(null, root);
          };
        },
        update: (root, ctx) => draw(env, root, ctx.scope),
      },
    },
  ],
};
