// The turn's own tools on the harness engine (HARNESS-SLICE3: "One turn on the harness engine",
// step 5; "Sub-agents get GM-tier writes only when the author grants them"): `commit` makes what
// the turn has staged so far definitive before the reply, and `grant_writes` lets an agent the
// author started make more of the world's changes. Both are the author's alone, and only while its
// turn is open: after the reply nothing waits to be committed, and no agent of a job is the author.

import { ROLE_TIERS, type RoleTier } from "../../../../shared/agent-roles";
import { HARNESS_FAMILY, HARNESS_NOTE, HARNESS_TOOL } from "../../../../shared/harness-texts";
import { refusedAnswer } from "../propose";
import { badValue, needText, objectSchema, text, textArg } from "../schema";
import type { HarnessToolDefinition } from "./kit";

const GRANT = HARNESS_TOOL.grant;
/** The tiers a grant opens. Every agent reads from the start, so a grant of `read` would open nothing. */
const GRANTED: readonly RoleTier[] = ROLE_TIERS.filter((tier) => tier !== "read");

export const TURN_TOOLS: readonly HarnessToolDefinition[] = [
  {
    name: HARNESS_TOOL.commit,
    family: HARNESS_FAMILY.turn,
    tier: "write",
    // The note is optional, and the schema's one property: a tool's arguments are never an object of none.
    parameters: () => objectSchema({ note: text() }),
    async run(args, env) {
      const view = await env.reader.view();
      const turn = env.turn;
      if (!turn) return view.refuse(HARNESS_NOTE.noTurn);
      if (turn.reply !== null) return view.refuse(HARNESS_NOTE.notTurn);
      if (!turn.main) return view.refuse(HARNESS_NOTE.commitAuthor);
      const out = await turn.commit(textArg(args, "note"));
      // A commit's own answer lists what it refused too, so a refusal of the commit itself is told by its code.
      if ("code" in out) return refusedAnswer(out);
      return view.answer({ committed: { landed: out.landed, review: out.review, refused: out.refused } });
    },
  },
  {
    name: GRANT,
    family: HARNESS_FAMILY.turn,
    tier: "write",
    parameters: () => objectSchema({ to: text(), tier: text(GRANTED) }, ["to", "tier"]),
    async run(args, env) {
      const view = await env.reader.view();
      const turn = env.turn;
      if (!turn) return view.refuse(HARNESS_NOTE.noTurn);
      if (!turn.main || turn.reply !== null) return view.refuse(HARNESS_NOTE.grantAuthor);
      const to = needText(view, GRANT, args, "to");
      if (typeof to !== "string") return to;
      const said = needText(view, GRANT, args, "tier");
      if (typeof said !== "string") return said;
      const tier = GRANTED.find((t) => t === said);
      if (tier === undefined) return badValue(view, GRANT, "tier", said, GRANTED);
      // Whom a grant can't reach, and why, is the turn's to say: it knows who started whom and what each holds.
      const granted = turn.grant(to, tier);
      if (granted === false) return view.refuse(HARNESS_NOTE.grantNone, { to });
      if (granted !== true) return refusedAnswer(granted);
      return view.answer({ granted: { to, tier } });
    },
  },
];
