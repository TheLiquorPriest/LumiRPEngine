// The line under each reply (plan §14, PlanChatUI-3 item 2): when and where it happened, what the turn did in
// each lane (story, engine, each opening its short list), and a link to its Turn page. It follows the swipe
// shown, is asked for only the rows Lumiverse has mounted (`../replies.ts`), and draws once per message in
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
    replies.want(message);
    return (replies as Readable<RepliesState>).subscribe(setState);
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
      {chat === null || line.unfinished === null ? null : <Unfinished env={props.env} chat={chat} why={line.unfinished.why} settle={line.unfinished.settle} />}
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
