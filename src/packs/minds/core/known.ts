// Play → What you know (DESIGN §24.11): the player character's own holdings, newest first, as they
// know them: each fact's claim, how and since when they came by it, what they make of it and how
// sure they are (a suspicion under the user's threshold), whom they keep it from, and whether it is
// an open question. It is theirs alone: never another person's holding, nor a fact they don't hold.
// A chat that doesn't track knowledge says so and lists nothing. A claim's text goes out with any
// secret mark in it left out (`applyMarks`), as on every player surface, and fails closed: one still
// carrying a secret's words, or naming anyone or anything the player character can't see, is never
// worded (`UNWORDED`); nor is a teller, or anyone it is kept from, they may not know (`povMayKnow`).

import { hashParts } from "../../../shared/hash";
import type { KnownItem, KnownView } from "../../../shared/minds";
import { knowledgeThreshold, knowledgeTracked, revealsFact } from "../../../shared/minds";
import { applyMarks } from "../../../shared/secret-marks";
import { calendarOf, formatClock } from "../../../engine/calendar";
import { own } from "../../../engine/pack-kit";
import { hiddenNameCheck, povMayKnow } from "../../../engine/player-events";
import type { ReadContext } from "../../../engine/registry";
import { findLeaks, unrevealedSecrets } from "../../../engine/visibility";
import { factsOf, holdingsOf, isSuspicion } from "./knowledge";
import { worldSecrets } from "./knowledge-section";
import { readSlice } from "./state";

/** What a fact What you know may not word reads as. */
const UNWORDED = "Something you can't put into words yet";

/** Play → What you know, read against the chat's state: suspicions and reveals by the threshold its turns recorded (`knowledgeThreshold`), so the two never disagree. */
export function buildKnownView(ctx: ReadContext): KnownView {
  const { world, state, registry: reg } = ctx;
  const slice = readSlice(state);
  if (!knowledgeTracked(slice)) return { tracking: false, items: [] };
  const facts = factsOf(slice);
  const cal = calendarOf(world);
  const secrets = unrevealedSecrets(reg, world, state);
  const hidden = hiddenNameCheck(reg, world, state, world.pov, { stages: false });
  // Someone the player character may not know reads as no one's, as the chip words them.
  const name = (id: string): string => (povMayKnow(reg, world, state, id) ? (own(state.entities, id)?.name ?? id) : "someone");
  const worded = (text: string): string => (findLeaks(text, secrets).length > 0 || hidden(text) ? UNWORDED : text);
  // A world secret their holding doesn't reveal (one they hold from the start by the world's design, or only suspect) is never worded, however its claim reads.
  const secret = worldSecrets(ctx);
  const sure = knowledgeThreshold(slice);
  const items = Object.entries(holdingsOf(slice, world.pov))
    .sort(([a, x], [b, y]) => y.since.at - x.since.at || (a < b ? -1 : 1))
    .map(([fact, h]): KnownItem => {
      const f = own(facts, fact);
      return {
        key: hashParts("lre.known", fact),
        claim: secret(fact, f) && !revealsFact(fact, h, sure) ? UNWORDED : worded(applyMarks(f?.claim ?? "", { world, state }, "omit")),
        how: h.how,
        byName: h.by === null ? null : name(h.by),
        sinceText: formatClock(cal, h.since.at),
        belief: h.belief,
        confidence: h.confidence,
        suspicion: isSuspicion(h, sure),
        open: f?.truth === "open",
        keptFrom: h.keptFrom === undefined ? null : h.keptFrom === "everyone" ? "everyone" : h.keptFrom.map(name),
      };
    })
    .filter((item) => item.claim.trim() !== "");
  return { tracking: true, items };
}
