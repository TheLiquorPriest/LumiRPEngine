// What the bootstrap's routes take and answer (plan §12, §14), declared field by field and held to the
// types the job and the six facts are made of (`./jobs.ts`, `./facts.ts`), so that a change to one stops
// this compiling until the declaration says the same.

import { type Fields, type Holds, type Infer, jobView, type Mutually, shape } from "../../app";
import type { BootstrapBatch, BootstrapChat, BootstrapJob } from "./jobs";

const T = shape.text();
const N = shape.number();

/** What `POST /api/v1/bootstrap` takes in place of a list for every chat the migration carried. */
export const MIGRATED = "migrated";

const relive = shape.optional(shape.nullable(shape.text({ blank: false })), "The player's choice of what to relive: one of the words the bootstrap skill offers for reliving the past; left out or null, none was made.");

export const bootstrapStartBody = shape.named("BootstrapStartAsk", "What starts a chat's bootstrap job: the player's choice of what to relive, where one was made.", shape.object({ relive }));
export const bootstrapBatchBody = shape.named(
  "BootstrapBatchAsk",
  `The chats to start the bootstrap job for, one after another: a list of chat ids, or "${MIGRATED}" for every chat the last migration carried; and the player's choice of what to relive.`,
  shape.object({ chats: shape.union(shape.literal(MIGRATED), shape.list(shape.text({ blank: false }))), relive }),
);

/** A fact that could not be read, and why, as a code. */
const notKnown = shape.named("FactNotKnown", "A fact of \"done enough\" that could not be read, and why, as a code: `unreadable`, its records could not be read (RPE's log has what failed).", shape.object({ known: shape.literal(false), why: shape.literal("unreadable") }));
/** A fact read from its records, with what it counts and names; whether it holds is the bootstrap skill's to say, never the route's. */
const fact = <const F extends Fields>(fields: F) => shape.union(shape.object({ known: shape.literal(true), ...fields }), notKnown);
const stretch = shape.named("MessageStretch", "Messages from `from` to `to`, both kept, as the chat numbers them from 0.", shape.object({ from: N, to: N }));

const doneEnough = shape.named(
  "DoneEnoughShown",
  "The six facts of \"done enough\", in the order the bootstrap skill names them: the lore index, the history the window leaves out, the cast, the story model, the horizon, and each principal's base and memories.",
  shape.object({
    lore: fact({ entries: N, indexed: N, stale: N }),
    history: fact({ messages: N, leftOut: N, covered: N, stretches: N, summarized: N, nearestUncovered: shape.nullable(stretch), nearestUnsummarized: shape.nullable(stretch) }),
    cast: fact({ listed: N, cast: N, uncast: shape.list(T) }),
    story: fact({ premise: N, chapters: N, scenes: N, beats: N, threads: N, openThreads: N, arcs: N, principals: N, principalsWithArc: N, player: N }),
    horizon: fact({ entries: N, named: N, clock: shape.yesNo() }),
    principals: fact({ principals: shape.list(shape.object({ id: T, name: T, base: shape.list(T), memories: N })) }),
  }),
);

const bootstrapJob = shape.named(
  "BootstrapJobShown",
  "A bootstrap job of a chat: what it was given (the player's relive word, the token limit), and its view as RPH gives it (null: RPH no longer holds it).",
  shape.object({ id: T, relive: shape.nullable(T), tokenLimit: N, view: shape.nullable(jobView) }),
);

export const bootstrapChatReply = shape.named("BootstrapChatReply", "A chat's bootstrap: the six facts, and the chat's bootstrap jobs, oldest first.", shape.object({ chat: T, facts: doneEnough, jobs: shape.list(bootstrapJob) }));
export const bootstrapBatchReply = shape.named(
  "BootstrapBatchReply",
  "What came of starting the job for several chats, one after another: each chat started, with its job's view, and each refused, with why.",
  shape.object({ started: shape.list(shape.object({ chat: T, job: jobView })), refused: shape.list(shape.object({ chat: T, why: T })) }),
);

type ChatMirrored = Holds<Mutually<Infer<typeof bootstrapChatReply>, BootstrapChat>>;
type JobMirrored = Holds<Mutually<Infer<typeof bootstrapJob>, BootstrapJob>>;
type BatchMirrored = Holds<Mutually<Infer<typeof bootstrapBatchReply>, BootstrapBatch>>;
/** The checks above hold, and are read by no one. */
export type Mirrors = [ChatMirrored, JobMirrored, BatchMirrored];
