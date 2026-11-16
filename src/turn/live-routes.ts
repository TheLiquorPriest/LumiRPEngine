// Live's controls of a turn going on (plan §14 Live: "Stop, pause, say something to the Author"; C-19): his pause holds the run before
// its agents' next model call (the call in flight finishes, and Stop still stops it), his resume lets it go, and a line he says reaches
// the lead at its next call as his words. Each is RPH's (`LiveApi.pause`, `letGo`, `say`, his own presses) on the run's own id; RPH tells
// each in the trace (`paused`, `resumed`, `said`), which the live hub carries, and a page opened while a run is held reads that at once
// here. A file written into a turn's folder is told on the chat's live socket (`FOLDER_KIND`), so the page shows the folder as it grows.

import { liveKind, route, RouteError, shape } from "../app";
import { JoinedTurnError } from "../store";
import type { Turns } from "./lane";

const T = shape.text();

/** A turn's folder gained or changed a file: the turn and the file's path in the agents' view; a page reads the folder again. */
export const FOLDER_KIND = liveKind("folder", {
  data: shape.object({ turn: T, path: T }),
  does: "A turn's folder gained or changed a file: the turn and the file's path; a page reads the folder again.",
});

const liveState = shape.named("TurnLiveState", "Whether a turn runs now, and whether his pause holds its run.", shape.object({ running: shape.yesNo(), paused: shape.yesNo() }));
const controlled = shape.named("TurnControlled", "Whether the control took: false when the turn's run is not going on (or, for resume, was not held by his pause; for say, the words were empty).", shape.object({ done: shape.yesNo() }));
const said = shape.named("TurnSay", "What he says to the Author while the turn runs: it reaches the lead at its next model call, as his words.", shape.object({ text: T }));

export function liveRoutes(turns: Turns) {
  /** The RPH run of the turn going on now; null when none runs. A turn of another chat is not there; a joined one is answered as a fact. */
  const runOf = (user: string, chat: string, turn: string): string | null => {
    const row = turns.store.user(user).turn(turn);
    if (row === null || row.chat !== chat) throw new RouteError(404, `Chat ${chat} has no turn ${turn}.`);
    if (row.joined !== null) throw new JoinedTurnError(turn, row.joined);
    return turns.runs.running(user, turn)?.traceRun ?? null;
  };
  return [
    route({
      method: "GET",
      path: "/api/v1/chats/:chat/turns/:turn/live",
      access: "page",
      group: "turns",
      does: "Whether a turn runs now and whether his pause holds it, read at once, for a page opened while it runs.",
      reply: liveState,
      joined: true,
      handle: ({ user, params }) => {
        const run = runOf(user, params.chat, params.turn);
        const view = run === null ? undefined : turns.harness.live.running(user).find((r) => r.run === run);
        return { running: view !== undefined, paused: view?.held === true };
      },
    }),
    route({
      method: "POST",
      path: "/api/v1/chats/:chat/turns/:turn/pause",
      access: "page",
      group: "turns",
      does: "Holds a turn's run before its next model call (the call in flight finishes; Stop still stops it).",
      reply: controlled,
      joined: true,
      handle: ({ user, params }) => {
        const run = runOf(user, params.chat, params.turn);
        return { done: run !== null && turns.harness.live.pause(user, run) };
      },
    }),
    route({
      method: "POST",
      path: "/api/v1/chats/:chat/turns/:turn/resume",
      access: "page",
      group: "turns",
      does: "Lets a turn's run go on where his pause held it.",
      reply: controlled,
      joined: true,
      handle: ({ user, params }) => {
        const run = runOf(user, params.chat, params.turn);
        return { done: run !== null && turns.harness.live.letGo(user, run) };
      },
    }),
    route({
      method: "POST",
      path: "/api/v1/chats/:chat/turns/:turn/say",
      access: "page",
      group: "turns",
      does: "Says something to the Author while the turn runs: the lead hears it at its next model call as his words, and the trace shows it.",
      body: said,
      reply: controlled,
      joined: true,
      handle: ({ user, params, body }) => {
        const run = runOf(user, params.chat, params.turn);
        return { done: run !== null && turns.harness.live.say(user, run, body.text) };
      },
    }),
  ] as const;
}
