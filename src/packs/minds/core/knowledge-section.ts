// The narrator's Who knows what section (DESIGN §24.11, C5): slot `knowledge`, outlet
// `lre_knowledge`. It follows the narrator's knowledge through its scope (`sectionScope`, which a
// section without one of its own takes from the narrator's view):
//   player     the player character's own holdings in play, as they know them;
//   scene, gm  each person present's too, at most so many a person, the most relevant first: a fact
//              the player character holds plainly; one they don't marked as known to its holder;
//              one kept from them, or one of the world's secrets they don't hold, as a secret line
//              (`FeedLine.secret`), which the narrator gets marked with whom it is known to and kept
//              from, or not at all, as its knowledge says. Of each fact in play the player character
//              holds, the section says who here doesn't know it.
// It goes a fact at a time, each line's `group` its fact: who holds it (the player character first,
// then each person here, in id order), then who here doesn't know it; the facts in the order they
// bear on the moment (`byPlay`, each at its best place on anyone's list). The section's caps and
// budget keep or leave out a fact's lines whole, so they leave out the least relevant facts first and
// never tell a fact by half.
// Its limits and wording are the user's (Settings → Minds → Knowledge), given by the engine run
// (`minds.knowing`). A chat that doesn't track knowledge, or holds none, has no lines. Each claim
// goes in with any secret mark its text carries left out (`applyMarks`).

import type { EntityId } from "../../../shared/ids";
import type { FactId, KnowledgeFact } from "../../../shared/minds";
import { fillText, knowledgeText, knowledgeThreshold, knowledgeTracked, parseFactId, revealsFact } from "../../../shared/minds";
import { loreIsSecret } from "../../../shared/lore";
import { applyMarks } from "../../../shared/secret-marks";
import type { FeedScope } from "../../../shared/world";
import { readEngineSlice } from "../../../engine/engine-pack";
import { acts } from "../../../engine/life";
import { own } from "../../../engine/pack-kit";
import type { FeedLine, ReadContext } from "../../../engine/registry";
import { together } from "../../../engine/presence";
import { isGone, kindIs, placeOfEntity } from "../../../engine/scope";
import { canSeeEntity, loreGateReader } from "../../../engine/visibility";
import { byPlay, holdingLine, holdingsOf, keptFromIt, latestTurns, rankedHoldings, type HoldingWords, type InPlay } from "./knowledge";
import { readSlice } from "./state";

/** The people in the player character's scene it can see, each acting, in id order. */
export function presentPeople(ctx: ReadContext): EntityId[] {
  const { registry: reg, world, state } = ctx;
  const here = placeOfEntity(state, world.pov);
  if (here === null) return [];
  return Object.keys(state.entities)
    .sort()
    .filter((id) => id !== world.pov && together(world, here, placeOfEntity(state, id)) && kindIs(reg, world, own(state.entities, id)?.kind ?? "", "person") && !isGone(state, id) && acts(world, state, id) && canSeeEntity(reg, world, state, world.pov, id));
}

/**
 * Which facts are the world's secrets the player character hasn't had revealed, read against one
 * state: a World Info mark, a secret lore entry whose gate doesn't hold, a track's stage truth not
 * revealed. A claim made in play is a secret only as its holders keep it (`keptFromIt`).
 */
export function worldSecrets(ctx: ReadContext): (id: FactId, fact: KnowledgeFact | undefined) => boolean {
  const open = loreGateReader(ctx.registry, ctx.world, ctx.state);
  const revealed = readEngineSlice(ctx.state).revealed;
  return (id, fact) => {
    const ref = fact ? parseFactId(id) : null;
    if (ref?.kind === "wi") return true;
    if (ref?.kind === "lore") {
      const lore = own(ctx.world.lore, ref.lore);
      return lore !== undefined && loreIsSecret(lore) && !open(lore);
    }
    if (ref?.kind === "track") return !!own(ctx.world.tracks, ref.track)?.stages[ref.stage]?.truth && !(own(revealed, ref.track) ?? []).includes(ref.stage);
    return false;
  };
}

/** Who knows what, in a scope, a fact at a time (see the header). */
export function knowledgeLines(ctx: ReadContext, scope: FeedScope): FeedLine[] {
  const { world, state } = ctx;
  const slice = readSlice(state);
  if (!knowledgeTracked(slice) || slice.knowledge === undefined) return [];
  // The user's limits and wording, as the engine run gives them (`minds.knowing`).
  const settings = ctx.query("minds.knowing")(ctx);
  const pov = world.pov;
  const name = (id: EntityId): string => own(state.entities, id)?.name ?? own(world.entities, id)?.name ?? id;
  // How sure a holding must be not to read as a suspicion: the threshold the chat's turns recorded, as reveals read it.
  const threshold = knowledgeThreshold(slice);
  const words: HoldingWords = { texts: settings, threshold, nameOf: name };
  const people = presentPeople(ctx);
  const place = placeOfEntity(state, pov);
  const secret = worldSecrets(ctx);
  const play: InPlay = { here: [pov, ...people, ...(place ? [place] : [])], recent: latestTurns(slice, settings.inPlayTurns), secret };
  const claim = (fact: KnowledgeFact | undefined, id: FactId): string => applyMarks(fact?.claim ?? id, { world, state }, "omit");
  // Each one's most relevant holdings: the player character's, then each person here's but in the player character's own scope.
  const others = scope === "player" ? [] : people;
  const listed = [pov, ...others].flatMap((who) => rankedHoldings(slice, who, play).slice(0, settings.perPerson).map((h) => ({ who, h })));
  const povHolds = holdingsOf(slice, pov);
  const out: FeedLine[] = [];
  for (const id of new Set([...listed].sort((a, b) => byPlay(a.h, b.h)).map((x) => x.h.id))) {
    const holders = listed.filter((x) => x.h.id === id);
    // A secret the player character holds without their holding revealing it (one they hold from the
    // start by the world's design, or only suspect): its lines go as a secret known to them, never as
    // theirs to tell, so the narrator is never told it is kept from them.
    const yours = own(povHolds, id);
    const fact = holders[0]?.h.fact;
    const kept = yours !== undefined && secret(id, fact) && !revealsFact(id, yours, threshold) ? { keptFrom: yours.keptFrom ?? ("everyone" as const), known: [pov] } : null;
    for (const { who, h } of holders) {
      const text = fillText(knowledgeText(settings, "person"), { name: who === pov ? "You" : name(who), line: holdingLine(claim(h.fact, id), h.holding, words) });
      if (yours !== undefined) out.push(kept ? { text, known: "pov", secret: { keptFrom: kept.keptFrom, known: [...new Set([...kept.known, who])] }, group: id } : { text, known: "pov", group: id });
      // A secret line says whom it is kept from: whom its holder keeps it from, and the player character, whom it is beyond.
      else if (keptFromIt(h.holding, pov) || secret(id, h.fact)) {
        const keeps = h.holding.keptFrom;
        out.push({ text, known: "scene", who: name(who), secret: { keptFrom: keeps === "everyone" ? "everyone" : [...new Set([...(keeps ?? []), pov])], known: [who] }, group: id });
      } else out.push({ text, known: "scene", who: name(who), group: id });
    }
    // Who here doesn't know a fact in play the player character holds: the narrator keeps them from it.
    const mine = holders.find((x) => x.who === pov)?.h;
    if (mine && (mine.secret || mine.about || mine.recent))
      for (const who of others) {
        if (own(holdingsOf(slice, who), id) !== undefined) continue;
        const text = fillText(knowledgeText(settings, "notKnown"), { name: name(who), claim: claim(mine.fact, id) });
        out.push(kept ? { text, known: "pov", secret: kept, group: id } : { text, known: "pov", group: id });
      }
  }
  return out;
}
