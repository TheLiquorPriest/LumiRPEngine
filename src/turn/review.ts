// The turn's one review card and its undo (plan §6.8, §14 the Turn row; READINGS R-72): what a turn changed, lane by lane, each change
// applied or not with its reports and provenance and its undo (what undoing would record and what would be left), the questions that
// wait for his word under a lane set to Confirm (the card is the question), and, for a turn carried in from the earlier engine, the
// card as it was. The routes read the store's own `reviewCard` and call its `undo`; his word on a question is the approvals port's
// `answer`. Every route is a page's.

import { route, RouteError, shape } from "../app";
import { JoinedTurnError, type UserStore } from "../store";
import { answerOf, type ApprovalRow } from "./approvals";
import type { Turns } from "./lane";

const T = shape.text();
const N = shape.number();
const opt = shape.optional;
const nullable = shape.nullable;

const report = shape.named(
  "ReportShown",
  "What a change did not add up to, or why it did not apply: a code and its values, never words.",
  shape.object({ code: T, values: opt(shape.record(shape.json())) }),
);

const changeShown = shape.named(
  "CardChange",
  "One change of a turn on its card: its id, its operation, whether it applied, who decided it, where it came from, how sure it is, its reports, its undo (the operations undoing it would record, and what would be left, as report codes) and the changes that already undid it.",
  shape.object({
    id: T,
    op: T,
    applied: shape.yesNo(),
    by: nullable(T),
    source: nullable(T),
    standing: nullable(T),
    value: shape.json(),
    reports: shape.list(report),
    undo: shape.object({ ops: shape.list(T), left: shape.list(report) }),
    undoneBy: shape.list(T),
  }),
);

const question = shape.named(
  "CardQuestion",
  "A call held for his word under a lane set to Confirm: its id, the agent, the tool, the lane and the arguments, when it was asked, where it stands (waiting, answered, or taken down when the turn stopped), and his answer once given.",
  shape.object({
    id: T,
    agent: T,
    tool: T,
    lane: T,
    args: shape.json(),
    asked: N,
    state: shape.oneOf("waiting", "answered", "taken_down"),
    answer: nullable(shape.object({ go: shape.yesNo(), reason: opt(T) })),
  }),
);

const cardReply = shape.named(
  "ReviewCardReply",
  "A turn's one card: its changes by lane, the questions asked on it (those waiting first), and, for a turn carried in, the cards the earlier engine kept for it.",
  shape.object({
    turn: T,
    lanes: shape.list(shape.object({ lane: shape.oneOf("story", "engine"), changes: shape.list(changeShown) })),
    questions: shape.list(question),
    imported: shape.list(shape.object({ id: T, kind: T, at: N, data: shape.json() })),
  }),
);

const undoReply = shape.named(
  "UndoReply",
  "What undoing a change of a turn recorded (the ids of the changes that reverse it, his own, citing it) and what is left, as report codes: a part a later change has written since, or one with no reversal.",
  shape.object({ recorded: shape.list(T), left: shape.list(report) }),
);

const answerBody = shape.named("ApprovalAnswerBody", "His word on a question: go ahead, or not, with a reason the agent is given.", shape.object({ go: shape.yesNo(), reason: opt(T) }));

const answerReply = shape.named("ApprovalAnswerReply", "Whether his word reached a question that was waiting.", shape.object({ answered: shape.yesNo(), state: shape.oneOf("answered", "settled", "unknown") }));

/** A question as the card shows it. */
function questionOf(row: ApprovalRow): {
  id: string;
  agent: string;
  tool: string;
  lane: string;
  args: ApprovalRow["args"];
  asked: number;
  state: ApprovalRow["state"];
  answer: { go: boolean; reason?: string } | null;
} {
  const agent = typeof row.agent === "object" && row.agent !== null && !Array.isArray(row.agent) && typeof row.agent.id === "string" ? row.agent.id : "";
  return { id: row.id, agent, tool: row.tool, lane: row.lane, args: row.args, asked: row.asked, state: row.state, answer: row.answer === null ? null : row.answer.go ? { go: true } : { go: false, ...(row.answer.reason !== undefined ? { reason: row.answer.reason } : {}) } };
}

export function reviewRoutes(turns: Turns) {
  /** A chat RPE holds, and a turn of it that is not joined to another (a joined one is answered as the fact it is). */
  const held = (user: string, chat: string, turn: string): UserStore => {
    const s = turns.store.user(user);
    if (s.chat(chat) === null) throw new RouteError(404, `RPE holds no chat ${chat} of yours.`);
    const row = s.turn(turn);
    if (row === null || row.chat !== chat) throw new RouteError(404, `Chat ${chat} has no turn ${turn}.`);
    if (row.joined !== null) throw new JoinedTurnError(turn, row.joined);
    return s;
  };

  return [
    route({
      method: "GET",
      path: "/api/v1/chats/:chat/turns/:turn/card",
      access: "page",
      group: "turns",
      does: "A turn's one review card: its changes by lane (the story's and the engine's, every area's), each applied or not with its reports and who decided it, its undo and the changes that undid it; the questions asked on it, those waiting for his word first; and the cards the earlier engine kept for a turn carried in.",
      reply: cardReply,
      joined: true,
      handle: async ({ user, params }) => {
        const s = held(user, params.chat, params.turn);
        const lanes = s.reviewCard(params.turn).map((l) => ({
          lane: l.lane,
          changes: l.changes.map(({ change, undo, undoneBy }) => ({
            id: String(change.id),
            op: change.op,
            applied: change.applied,
            by: change.by,
            source: change.source,
            standing: change.standing,
            value: change.value,
            reports: change.reports,
            undo,
            undoneBy: undoneBy.map(String),
          })),
        }));
        const imported = turns.approvals.chipsOf(user, params.chat, params.turn);
        return { turn: params.turn, lanes, questions: turns.approvals.ofTurn(user, params.chat, params.turn).map(questionOf), imported };
      },
    }),
    route({
      method: "POST",
      path: "/api/v1/chats/:chat/turns/:turn/changes/:change/undo",
      access: "page",
      group: "turns",
      does: "Undoes one change of a turn as his own (source player): records the changes that reverse it, citing it, at the chat's head; nothing recorded is taken away. Says what was recorded and what is left, as report codes (a part a later change wrote since, a change with no reversal).",
      reply: undoReply,
      joined: true,
      handle: async ({ user, params }) => {
        const s = held(user, params.chat, params.turn);
        const id = Number(params.change);
        if (!Number.isInteger(id) || !s.reviewCard(params.turn).some((l) => l.changes.some((c) => c.change.id === id))) throw new RouteError(404, `Turn ${params.turn} has no change ${params.change}.`);
        const undone = await turns.writes.run(() => s.undo(id), "undoing a change from the turn's card");
        return { recorded: undone.changes.map((c) => String(c.id)), left: undone.left };
      },
    }),
    route({
      method: "POST",
      path: "/api/v1/chats/:chat/approvals/:approval/answer",
      access: "page",
      group: "turns",
      does: "His word on a question a lane set to Confirm is waiting on: go ahead, or not with a reason the agent is given. Says whether it reached a question that was waiting.",
      body: answerBody,
      reply: answerReply,
      handle: async ({ user, params, body }) => {
        if (turns.store.user(user).chat(params.chat) === null) throw new RouteError(404, `RPE holds no chat ${params.chat} of yours.`);
        const word = answerOf(body);
        if (word === null) throw new RouteError(400, "His word is go, true or false, and with false a reason.");
        const done = await turns.approvals.answer(user, params.approval, word);
        return done.ok ? { answered: true, state: "answered" as const } : { answered: false, state: done.why };
      },
    }),
  ] as const;
}
