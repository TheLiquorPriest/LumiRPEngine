// What the bootstrap's routes take and answer (plan §12, §14), declared field by field and held to the
// types the job and the six facts are made of (`./jobs.ts`, `./facts.ts`), so that a change to one stops
// this compiling until the declaration says the same.

import { type Fields, type Holds, type Infer, jobView, type Mutually, shape, usage } from "../../app";
import type { BootstrapBatch, BootstrapChat, BootstrapJob, CarriedBootstrap } from "./jobs";

const T = shape.text();
const N = shape.number();
const opt = shape.optional;

/** What `POST /api/v1/bootstrap` takes in place of a list for every chat the migration carried. */
export const MIGRATED = "migrated";

const relive = opt(shape.nullable(shape.text({ blank: false })), "His choice of what to relive: one of the words the bootstrap skill's header offers (`relive:`); left out or null, the skill decides. Another word is refused with the words it takes.");
const tokenLimit = opt(shape.whole({ least: 1 }), "His own token limit for this job, a whole number above 0, at which it asks him whether to go on; left out, the setting `bootstrap.tokenLimit` in force for the chat.");

export const bootstrapStartBody = shape.named("BootstrapStartAsk", "What starts a chat's bootstrap job: his choice of what to relive, and his own token limit for it, where he made them.", shape.object({ relive, tokenLimit }));
export const bootstrapBatchBody = shape.named(
  "BootstrapBatchAsk",
  `The chats to start the bootstrap job for, one after another: a list of chat ids, or "${MIGRATED}" for every chat the last migration carried; his choice of what to relive, and his token limit for each job.`,
  shape.object({ chats: shape.union(shape.literal(MIGRATED), shape.list(shape.text({ blank: false }))), relive, tokenLimit }),
);
export const bootstrapAnswerBody = shape.named(
  "BootstrapAnswerAsk",
  "His word to a bootstrap job that waits for it: go on, asking again after `more` tokens (its token limit again when left out), or end with what it has.",
  shape.union(shape.object({ go: shape.literal("on"), more: opt(shape.whole({ least: 1 })) }), shape.object({ go: shape.literal("end") })),
);

/** A fact that could not be read, and why, as a code. */
const notKnown = shape.named("FactNotKnown", "A fact of \"done enough\" that could not be read, and why, as a code: `unreadable`, its records could not be read (RPE's log has what failed).", shape.object({ known: shape.literal(false), why: shape.literal("unreadable") }));
/** A fact read from its records, with what it counts and names; whether it holds is the bootstrap skill's to say, never the route's. */
const fact = <const F extends Fields>(fields: F) => shape.union(shape.object({ known: shape.literal(true), ...fields }), notKnown);
const stretch = shape.named("MessageStretch", "Messages from `from` to `to`, both kept, as the chat numbers them from 0.", shape.object({ from: N, to: N }));
const horizonPart = shape.named(
  "HorizonPartShown",
  "One part of the horizon's seed: whether it is recorded, and how many of its values stand established, assumed or proposed by the change that set each, and how many carry no standing.",
  shape.object({ recorded: shape.yesNo(), established: N, assumed: N, proposed: N, none: N }),
);

const doneEnough = shape.named(
  "DoneEnoughShown",
  "The six facts of \"done enough\", in the order the bootstrap skill names them: the lore index, the history the window leaves out, the cast, the story model, the horizon, and each principal's base and memories.",
  shape.object({
    lore: fact({ entries: N, indexed: N, stale: N }),
    history: fact({ messages: N, leftOut: N, covered: N, stretches: N, summarized: N, nearestUncovered: shape.nullable(stretch), nearestUnsummarized: shape.nullable(stretch) }),
    cast: fact({ listed: N, cast: N, uncast: shape.list(T) }),
    story: fact({ premise: N, chapters: N, scenes: N, beats: N, threads: N, openThreads: N, arcs: N, principals: N, principalsWithArc: N, player: N }),
    horizon: fact({ entries: N, named: N, clock: shape.yesNo(), time: horizonPart, place: horizonPart, onStage: horizonPart, holdings: horizonPart }),
    principals: fact({ principals: shape.list(shape.object({ id: T, name: T, base: shape.list(T), memories: N, own: N, ownFromPerceptions: N })) }),
  }),
);

export const bootstrapJob = shape.named(
  "BootstrapJobShown",
  "A bootstrap job of a chat: what it was given (his relive word, the token limit at which it asks), and its view as RPH gives it (null: RPH no longer holds it).",
  shape.object({ id: T, relive: shape.nullable(T), tokenLimit: N, view: shape.nullable(jobView) }),
);

const startShown = shape.named(
  "BootstrapStartShown",
  "The start as it stands for the chat, before any press: whether the bootstrap skill is in force; the relive words its header offers (none while it is off); the token limit at which a job asks him whether to go on, counted as tokens sent and written by every agent of the job with a cached token at `cachedWeight`; and each cap that ends a bootstrap job's run, as in force for the chat (null: none).",
  shape.object({ skill: shape.yesNo(), relive: shape.list(T), tokenLimit: N, cachedWeight: N, caps: shape.list(shape.object({ key: T, value: shape.nullable(N) })) }),
);

const question = shape.named(
  "BootstrapQuestion",
  "A bootstrap job held at its token limit, waiting for his word: the point it reached and the tokens counted when it did, what it spent and how a cached token counts, what its agent last wrote, the six facts as they stand now, and how many more tokens a go-on gives by default.",
  shape.object({ job: T, at: N, tokens: N, usage, cachedWeight: N, wrote: shape.nullable(T), facts: doneEnough, more: N }),
);

export const bootstrapChatReply = shape.named(
  "BootstrapChatReply",
  "A chat's bootstrap: the six facts, the start as it stands, the chat's bootstrap jobs under way (newest first), and the question of each that waits for his word.",
  shape.object({ chat: T, facts: doneEnough, start: startShown, underWay: shape.list(bootstrapJob), questions: shape.list(question) }),
);

export const carriedBootstrap = shape.named(
  "CarriedBootstrap",
  "A chat the last migration carried, with how its bootstrap stands (none: no job yet; queued, held, running, asking: its newest job; ended: its newest job ended, how and with what on the job), its newest bootstrap job, that job's question when it waits for his word, and the start as it stands for the chat.",
  shape.object({ chat: T, state: shape.oneOf("none", "queued", "held", "running", "asking", "ended"), job: shape.nullable(bootstrapJob), question: shape.nullable(question), start: startShown }),
);

export const bootstrapBatchReply = shape.named(
  "BootstrapBatchReply",
  "What came of starting the job for several chats, one after another: each chat started, with its job's view, and each refused, with why.",
  shape.object({ started: shape.list(shape.object({ chat: T, job: jobView })), refused: shape.list(shape.object({ chat: T, why: T })) }),
);

type ChatMirrored = Holds<Mutually<Infer<typeof bootstrapChatReply>, BootstrapChat>>;
type JobMirrored = Holds<Mutually<Infer<typeof bootstrapJob>, BootstrapJob>>;
type CarriedMirrored = Holds<Mutually<Infer<typeof carriedBootstrap>, CarriedBootstrap>>;
type BatchMirrored = Holds<Mutually<Infer<typeof bootstrapBatchReply>, BootstrapBatch>>;
/** The checks above hold, and are read by no one. */
export type Mirrors = [ChatMirrored, JobMirrored, CarriedMirrored, BatchMirrored];
