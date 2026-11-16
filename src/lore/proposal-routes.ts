// The routes of his lore's proposals and of the writes RPE made to it (plan §9.5, §14), for the Lore page, declared in the route form
// (`src/app/routes.ts`): the queue of what agents drafted, a page at a time; approving one, with his edits, or rejecting it; the record of
// every write with the entry before and after, a page at a time; and putting an entry back. Nothing here is an agent's: an agent drafts through
// RPH's `suggest` and never decides one. They answer only for the user this RPE belongs to.

import { route, RouteError, shape } from "../app";
import type { ApprovalOutcome, LoreProposals, LoreProposalView, LoreWriteView, PutBackOutcome, Refusal } from "./proposals";

const T = shape.text();
const field = shape.field;

export const LORE_PROPOSALS_PATH = "/api/v1/lore/proposals";
export const LORE_PROPOSAL_APPROVE_PATH = "/api/v1/lore/proposals/:id/approve";
export const LORE_PROPOSAL_REJECT_PATH = "/api/v1/lore/proposals/:id/reject";
export const LORE_WRITES_PATH = "/api/v1/lore/writes";
export const LORE_WRITE_PUT_BACK_PATH = "/api/v1/lore/writes/:id/put-back";

const status = shape.oneOf("open", "approved", "rejected", "refused");
const refusal = shape.oneOf("changed", "missing", "draft");

const fields = shape.named(
  "LoreEntryFields",
  "An entry's fields RPE writes: its text, its title and its keys.",
  shape.object({ content: field(T, "The entry's text."), comment: field(T, "Its title."), keys: field(shape.list(T), "Its keys.") }),
);

const proposalRow = shape.named(
  "LoreProposal",
  "What an agent drafted for his lore: a new entry (the book, title and keys it drafted) or an edit to an entry of his books or his world (the passage as it stands and what would replace it), the turn it came from, and where it stands.",
  shape.object({
    id: field(shape.whole(), "Its number."),
    chat: field(T, "The chat it was drafted in."),
    turn: field(shape.nullable(T), "The turn it was drafted in; null for one of no turn."),
    agent: field(T, "The definition of the agent that drafted it."),
    target: field(shape.nullable(T), "The entry it edits, by the id the agent named it; null for a new entry."),
    text: field(T, "The text proposed: a new entry's, or what replaces the passage (the whole entry's text where no passage is named)."),
    was: field(shape.nullable(T), "For an edit: the passage as it stands, which `text` replaces."),
    book: field(shape.nullable(T), "For a new entry: the book the agent drafted it for."),
    title: field(shape.nullable(T), "For a new entry: the title the agent drafted."),
    keys: field(shape.nullable(shape.list(T)), "For a new entry: the keys the agent drafted."),
    world: field(shape.nullable(T), "For an entry of his world: the world's id."),
    reason: field(T, "Why the agent drafted it."),
    status: field(status, "Where it stands: open, approved, rejected, or refused because the entry changed meanwhile."),
    refused: field(shape.nullable(refusal), "For a refused one: why. The entry changed after the draft, is gone, or a draft of his own of the world stands uncommitted."),
    created: field(shape.number(), "When it was drafted, in milliseconds since 1970."),
    decided: field(shape.nullable(shape.number()), "When it was decided; null while open."),
    write: field(shape.nullable(shape.whole()), "The write an approval made."),
  }),
);

const writeRow = shape.named(
  "LoreWrite",
  "A write RPE made to his lore, with the entry before and after, so it can be put back.",
  shape.object({
    id: field(shape.whole(), "Its number."),
    proposal: field(shape.nullable(shape.whole()), "The proposal it settled; null for a write of his own through Build."),
    kind: field(shape.oneOf("edit", "create", "put_back"), "An edit of an entry, a new entry, or a put-back of an earlier write."),
    entry: field(T, "Lumiverse's id of the entry, or for an entry of his world its key there."),
    book: field(T, "Its book's id in Lumiverse; empty for an entry of his world."),
    world: field(shape.nullable(T), "For an entry of his world: the world's id."),
    before: field(shape.nullable(fields), "The entry's fields before the write; null where there was no entry."),
    after: field(shape.nullable(fields), "The entry's fields after the write; null where it left none."),
    of: field(shape.nullable(shape.whole()), "For a put-back: the write it undid."),
    putBack: field(shape.nullable(shape.whole()), "The write that put this one back, once one has."),
    at: field(shape.number(), "When it was made, in milliseconds since 1970."),
  }),
);

const approvalBody = shape.object({
  text: shape.optional(T, "His own text in place of the one proposed."),
  title: shape.optional(T, "His own title in place of the drafted one."),
  keys: shape.optional(shape.list(T), "His own keys in place of the drafted ones."),
  book: shape.optional(T, "For a new entry: the book it goes in, where the agent drafted none or he chooses another."),
});

const approvedReply = shape.named("LoreApproved", "A proposal as it now stands, and the write its approval made.", shape.object({ proposal: field(proposalRow, "The proposal, approved."), write: field(writeRow, "The one write the approval made.") }));
const decidedReply = shape.named("LoreRejected", "A proposal as it now stands.", shape.object({ proposal: field(proposalRow, "The proposal.") }));
const putBackReply = shape.named("LorePutBack", "The write that put an entry back, and the write it undid as it now stands.", shape.object({ write: field(writeRow, "The put-back."), of: field(writeRow, "The write it undid, now marked put back.") }));

/** Why a write was not made, in words the Lore page shows. */
function refusedWords(why: Refusal): string {
  if (why === "missing") return "The entry is not there any more, so nothing was written.";
  if (why === "draft") return "You have a draft of this world you have not committed: commit or discard it in Build first, so nothing of it is committed with this write.";
  return "The entry changed after the draft was made, so nothing was written.";
}

function problemWords(problem: Exclude<ApprovalOutcome, { written: unknown } | { refused: unknown }>["problem"] | Exclude<PutBackOutcome, { written: unknown } | { refused: unknown }>["problem"]): { code: number; words: string } {
  switch (problem) {
    case "not_open":
      return { code: 409, words: "That proposal was decided already." };
    case "no_book":
      return { code: 400, words: "A new entry needs the book it goes in: name it as `book`." };
    case "no_world_writes":
      return { code: 503, words: "RPE has no way to write to your worlds yet, so an entry of one cannot be written." };
    case "no_write":
      return { code: 404, words: "There is no such write." };
    case "put_back_already":
      return { code: 409, words: "That write was put back already." };
    case "not_undoable":
      return { code: 409, words: "That write cannot be put back." };
  }
}

/** A whole number from a path's text; a 404 for any other. */
function numberOf(text: string, what: string): number {
  if (!/^\d+$/.test(text)) throw new RouteError(404, `There is no ${what} ${text}.`);
  return Number(text);
}

export function proposalRoutes(proposals: LoreProposals) {
  const sizes = () => ({ default: proposals.settings.page, most: proposals.settings.page * 10 });
  const after = (text: string | undefined): number | undefined => (text === undefined ? undefined : numberOf(text, "page"));
  const written = (outcome: { written: LoreWriteView } | { refused: Refusal } | { problem: Parameters<typeof problemWords>[0] }): LoreWriteView => {
    if ("written" in outcome) return outcome.written;
    if ("refused" in outcome) throw new RouteError(409, refusedWords(outcome.refused));
    const said = problemWords(outcome.problem);
    throw new RouteError(said.code, said.words);
  };
  return [
    route({
      method: "GET",
      path: LORE_PROPOSALS_PATH,
      access: "page",
      group: "lore",
      does: "The proposals his agents drafted for his lore, newest first, a page at a time (every chat's when none is named, only those in a state when one is): each with the draft, the turn it came from and where it stands.",
      query: { chat: shape.optional(shape.text({ blank: false }), "Only the proposals drafted in this chat."), status: shape.optional(status, "Only the proposals in this state.") },
      reply: shape.page(proposalRow),
      paged: { sizes },
      handle: ({ user, query }): { items: LoreProposalView[]; next: string | null } => {
        const from = after(query.after);
        return proposals.proposals(user, { ...(query.chat === undefined ? {} : { chat: query.chat }), ...(query.status === undefined ? {} : { status: query.status }), ...(from === undefined ? {} : { after: from }), limit: query.limit });
      },
    }),
    route({
      method: "POST",
      path: LORE_PROPOSAL_APPROVE_PATH,
      access: "page",
      group: "lore",
      does: "Approves an open proposal, with his edits if he sends any: one write, to his Lumiverse book over HTTP as him, or to his world as its next revision, checked against the entry's revision when the draft was made. An edit changes only the passage it names. Refused (409) where the entry changed meanwhile, is gone, or a draft of his own of the world stands uncommitted; the proposal then says why.",
      body: approvalBody,
      reply: approvedReply,
      handle: async ({ user, params, body }) => {
        const id = numberOf(params.id, "proposal");
        const outcome = await proposals.approve(user, id, { ...(body.text === undefined ? {} : { text: body.text }), ...(body.title === undefined ? {} : { title: body.title }), ...(body.keys === undefined ? {} : { keys: body.keys }), ...(body.book === undefined ? {} : { book: body.book }) });
        const write = written(outcome);
        const proposal = proposals.one(user, id);
        if (proposal === null) throw new Error(`The proposal ${id} was approved and cannot be read back.`);
        return { proposal, write };
      },
    }),
    route({
      method: "POST",
      path: LORE_PROPOSAL_REJECT_PATH,
      access: "page",
      group: "lore",
      does: "Rejects an open proposal: nothing is written. Answers the proposal as it now stands.",
      reply: decidedReply,
      handle: async ({ user, params }) => {
        const id = numberOf(params.id, "proposal");
        const proposal = await proposals.reject(user, id);
        if (proposal === null) throw new RouteError(404, `There is no proposal ${id}.`);
        return { proposal };
      },
    }),
    route({
      method: "GET",
      path: LORE_WRITES_PATH,
      access: "page",
      group: "lore",
      does: "Every write RPE made to his lore, newest first, a page at a time: each with the entry before and after, so he can put it back.",
      reply: shape.page(writeRow),
      paged: { sizes },
      handle: ({ user, query }): { items: LoreWriteView[]; next: string | null } => {
        const from = after(query.after);
        return proposals.writesMade(user, { ...(from === undefined ? {} : { after: from }), limit: query.limit });
      },
    }),
    route({
      method: "POST",
      path: LORE_WRITE_PUT_BACK_PATH,
      access: "page",
      group: "lore",
      does: "Puts an entry back as it was before one of RPE's writes (an entry RPE made is taken away; one of his world goes back as the world's next revision), under the same check as a write: refused (409) where the entry changed since.",
      reply: putBackReply,
      handle: async ({ user, params }) => {
        const id = numberOf(params.id, "write");
        const write = written(await proposals.putBack(user, id));
        const of = write.of === null ? null : proposals.writeOne(user, write.of);
        if (of === null) throw new Error(`The write ${id} was put back and cannot be read back.`);
        return { write, of };
      },
    }),
  ] as const;
}
