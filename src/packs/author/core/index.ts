// Author pack (DEPTH-PLAN §4.1, §4.5, §4.6, §4.7, §6.4, §6.5): the author's records beside its
// notebook, in the `author.*` namespace: the poll's log and jobs, predictions and their scores, drift
// checks, its reading of the player's edit of a reply, what a piece of work cost (`author.spend`), an
// episode held for the player's answer past an allowance and his answer (`author.ask`,
// `author.answer`) (`shared/author.ts`), and its drop of a draft (`shared/episodes.ts`). Each lands as
// a basis-anchored layer entry at the reply it read; a spend rides with the work it paid for (a
// turn's record, or its job's entry). The records change no world state; validation is structural,
// never against the state, so a rebased view never drops one, and none is grouped. A drop alone
// marks the draft dropped in the author slice, so a chain never settles a draft it dropped; decided
// at its basis, it lands only where the turns after it still fold as made with it (`later`). The
// notebook itself is the engine's workspace (`engine/notebook.ts`).

import { AUTHOR_ADOPT, AUTHOR_ANSWER, AUTHOR_ASK, AUTHOR_DRIFT, AUTHOR_EDIT, AUTHOR_POLL, AUTHOR_PREDICT, AUTHOR_SCORE, AUTHOR_SPEND, AUTHOR_VERDICT, authorData, authorProblem, type AdoptData, type AnswerData, type AskData, type DriftData, type EditData, type PollData, type PredictData, type ScoreData, type SpendData, type VerdictData } from "../../../shared/author";
import { AUTHOR_DROP, droppedIn, dropOf, dropProblem, settledIn } from "../../../shared/episodes";
import type { PackEvent } from "../../../shared/ledger";
import type { EventTypeDef, PackDef } from "../../../engine/registry";
import { mutableSlice, objOf, own, sliceOf } from "../../../engine/pack-kit";

function record(type: PackEvent["type"], describe: EventTypeDef<PackEvent>["describe"]): EventTypeDef<PackEvent> {
  return {
    type,
    neutral: true,
    validate: (e) => {
      if (e.group !== undefined || e.tiedTo !== undefined) return { code: "author_grouped", reason: "an author's record stands alone (no group)" };
      const problem = authorProblem(type, e.data);
      return problem === null ? null : { code: "bad_author_record", reason: problem };
    },
    apply: () => {},
    describe,
  };
}

export const authorPack: PackDef = {
  id: "author",
  label: "Author",
  version: 1,
  domain: null,
  requires: [],
  register(r) {
    r.event<PackEvent>(
      record(AUTHOR_POLL, (e) => {
        const d = authorData<PollData>(e, AUTHOR_POLL);
        return d ? `the author's poll: ${d.jobs.length} job(s), ${d.considered.length} considered` : "the author's poll";
      }),
    );
    r.event<PackEvent>(record(AUTHOR_PREDICT, (e) => (authorData<PredictData>(e, AUTHOR_PREDICT) ? "the author's prediction" : "a prediction")));
    r.event<PackEvent>(
      record(AUTHOR_SCORE, (e) => {
        const d = authorData<ScoreData>(e, AUTHOR_SCORE);
        return d ? `a prediction scored: ${d.outcome}` : "a prediction scored";
      }),
    );
    r.event<PackEvent>(
      record(AUTHOR_DRIFT, (e, ctx) => {
        const d = authorData<DriftData>(e, AUTHOR_DRIFT);
        return d ? `drift check of ${own(ctx.state.entities, d.who)?.name ?? d.who}: ${d.drift}` : "a drift check";
      }),
    );
    r.event<PackEvent>(
      record(AUTHOR_EDIT, (e) => {
        const d = authorData<EditData>(e, AUTHOR_EDIT);
        if (!d) return "the player's edit of a reply";
        return d.cosmetic ? "the player's edit of a reply, read as cosmetic" : `the player's edit of a reply: ${d.amended.length} beat(s) amended, ${d.struck.length} struck`;
      }),
    );
    r.event<PackEvent>(
      record(AUTHOR_SPEND, (e) => {
        const d = authorData<SpendData>(e, AUTHOR_SPEND);
        return d ? `spent on ${d.treatment}: ${d.cost.calls} call(s), ${d.cost.tokensIn + d.cost.tokensOut} tokens` : "what work cost";
      }),
    );
    r.event<PackEvent>(
      record(AUTHOR_ASK, (e) => {
        const d = authorData<AskData>(e, AUTHOR_ASK);
        return d ? `the author asks to spend past an allowance: ${d.over.length} part(s)` : "the author's ask";
      }),
    );
    r.event<PackEvent>(
      record(AUTHOR_ANSWER, (e) => {
        const d = authorData<AnswerData>(e, AUTHOR_ANSWER);
        return d ? (d.spend ? "the player spends past the allowance" : "the player keeps to the allowance") : "the player's answer";
      }),
    );
    r.event<PackEvent>(
      record(AUTHOR_ADOPT, (e) => {
        const d = authorData<AdoptData>(e, AUTHOR_ADOPT);
        return d ? `the turn waited for ${d.waited.length} piece(s) of work between turns, went on without ${d.without.length}` : "what the turn waited for";
      }),
    );
    r.event<PackEvent>(
      record(AUTHOR_VERDICT, (e) => {
        const d = authorData<VerdictData>(e, AUTHOR_VERDICT);
        const said = d?.verdict === "holds" ? "it holds" : d?.verdict === "contradicts" ? "it contradicts the draft" : d?.verdict;
        return d ? `the author's verdict on page ${d.page} of ${d.of} of a draft's pins: ${said}` : "the author's verdict on a draft's pins";
      }),
    );
    r.event<PackEvent>({
      type: AUTHOR_DROP,
      validate: (e, ctx) => {
        if (e.group !== undefined || e.tiedTo !== undefined) return { code: "author_grouped", reason: "an author's record stands alone (no group)" };
        const problem = dropProblem(e.data);
        if (problem !== null) return { code: "bad_author_record", reason: problem };
        const draft = String(e.data.draft);
        if (settledIn(sliceOf(ctx.state, "story"), draft)) return { code: "draft_settled", reason: "this draft is settled here" };
        return droppedIn(sliceOf(ctx.state, "author"), draft) ? { code: "draft_dropped", reason: "this draft is already dropped here" } : null;
      },
      apply: (e, state) => {
        const d = dropOf(e.data);
        if (!d) return;
        const slice = mutableSlice(state, "author");
        slice.dropped = { ...objOf(slice.dropped), [d.draft]: true };
      },
      later: {},
      describe: (e) => {
        const d = dropOf(e.data);
        return d ? `the author dropped a draft: ${d.why}` : "the author dropped a draft";
      },
    });
  },
};

export default authorPack;
