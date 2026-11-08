// The GM's truth links and the holdings projection (DEPTH-PLAN §4.4): a link folds into the holding
// it projects, so a secret the story reveals to the player character stops being gated and stops
// tripping the leak check; taking the link back gates it again, and never takes a holding set since.

import { describe, expect, test } from "bun:test";
import type { LedgerEvent, PackEvent } from "../../../src/shared/ledger";
import type { KnowledgeFact } from "../../../src/shared/minds";
import { heldSecrets, KNOWLEDGE_DEFAULTS } from "../../../src/shared/minds";
import { linksOf, linkVerdict, TRUTH_EVENTS } from "../../../src/shared/truth-links";
import type { LoreEntryDef, WorldDoc } from "../../../src/shared/world";
import { createRegistry } from "../../../src/engine/registry-impl";
import type { WorldState } from "../../../src/engine/state";
import { findLeaks, secretLorePhrases, unrevealedSecrets } from "../../../src/engine/visibility";
import { ALL_PACKS } from "../../../src/packs/index";
import { readKnowledge } from "../../../src/packs/minds/core/state";
import { buildKnownView } from "../../../src/packs/minds/core/known";
import { modernUsWorld } from "../riverton";
import { fold, startState } from "../support";

const reg = createRegistry(ALL_PACKS);
const TILL = "Maya skims the till";
const LEDGER = "The stolen ledger is hidden under the bait shop floor";

function world(): WorldDoc {
  const w = modernUsWorld("w", "R");
  w.tracks.s_till = { id: "s_till", kind: "secret", label: "The till", start: "hidden", stages: { hidden: { label: "Hidden", next: [], truth: TILL } }, visibility: "secret" };
  const ledger: LoreEntryDef = { id: "ledger", title: "The ledger", content: LEDGER, keys: [], links: [], secret: true };
  w.lore.ledger = ledger;
  return w;
}

const fact = (id: string, claim: string): PackEvent => ({ type: "minds.fact", data: { fact: { id, kind: id.startsWith("lore:") ? "lore" : "track", claim, about: ["maya"], truth: "true" } satisfies KnowledgeFact } });

function link(who: string, factId: string, rest: { confidence?: number; belief?: string; from?: Record<string, string> } = {}): PackEvent {
  return {
    type: TRUTH_EVENTS.link,
    data: { who, fact: factId, from: rest.from ?? { beat: "b1" }, words: "Saw Maya pocket the bills from the till", why: "The beat put the till in plain sight of them", how: "witnessed", by: null, evidence: [], belief: rest.belief ?? "true", confidence: rest.confidence ?? 0.9, msg: null, at: 0 },
  };
}

function base(): { w: WorldDoc; s: WorldState } {
  const w = world();
  return { w, s: fold(reg, w, startState(w), [fact("track:s_till:hidden", TILL), fact("lore:ledger", LEDGER)]) };
}

describe("the holdings projection", () => {
  test("a revealed secret stops being gated through the projection, and is gated again when the link is taken back", () => {
    const { w, s } = base();
    expect(unrevealedSecrets(reg, w, s)).toEqual(expect.arrayContaining([TILL]));
    expect(findLeaks(LEDGER, secretLorePhrases(reg, w, s)).length).toBeGreaterThan(0);

    const revealed = fold(reg, w, s, [link(w.pov, "track:s_till:hidden"), link(w.pov, "lore:ledger")]);
    expect(heldSecrets(revealed.packs.minds, w.pov)).toEqual({ stages: { s_till: ["hidden"] }, lore: ["ledger"] });
    expect(unrevealedSecrets(reg, w, revealed)).not.toContain(TILL);
    expect(findLeaks(`${TILL}. ${LEDGER}.`, unrevealedSecrets(reg, w, revealed))).toEqual([]);
    // The projected holding is today's holding, whole, and the link beside it is the GM's.
    expect(readKnowledge(revealed).holdings[w.pov]?.["lore:ledger"]).toEqual({ how: "witnessed", by: null, evidence: [], since: { msg: null, at: 0 }, belief: "true", confidence: 0.9 });
    expect(linksOf(revealed.packs.minds, w.pov)["lore:ledger"]?.why).toBe("The beat put the till in plain sight of them");
    // What you know reads the projected holdings as it reads any: the player character now knows both, and nothing before.
    expect(JSON.stringify(buildKnownView(reg.context(w, revealed)).items)).toContain(LEDGER);
    expect(JSON.stringify(buildKnownView(reg.context(w, s)).items)).not.toContain(LEDGER);

    const back = fold(reg, w, revealed, [{ type: TRUTH_EVENTS.unlink, data: { who: w.pov, fact: "lore:ledger", why: "The beat was struck" } }]);
    expect(findLeaks(LEDGER, secretLorePhrases(reg, w, back)).length).toBeGreaterThan(0);
    expect(heldSecrets(back.packs.minds, w.pov).lore).toEqual([]);
    expect(linksOf(back.packs.minds, w.pov)["lore:ledger"]).toBeUndefined();
  });

  test("gating is the player character's: another's link, a suspicion or a disbelief keeps the secret gated", () => {
    const { w, s } = base();
    for (const e of [link("maya", "lore:ledger", { from: { mind: "minds/maya/beliefs.md" } }), link(w.pov, "lore:ledger", { confidence: KNOWLEDGE_DEFAULTS.threshold / 2 }), link(w.pov, "lore:ledger", { belief: "false" })]) {
      const after = fold(reg, w, s, [e]);
      expect(findLeaks(LEDGER, secretLorePhrases(reg, w, after)).length).toBeGreaterThan(0);
    }
    expect(heldSecrets(fold(reg, w, s, [link("maya", "lore:ledger")]).packs.minds, "maya").lore).toEqual(["ledger"]);
  });

  test("taking a link back never takes a holding a learning set since", () => {
    const { w, s } = base();
    const learned: LedgerEvent = { type: "minds.learn", data: { who: [w.pov], fact: "lore:ledger", how: "told", by: "maya", evidence: [], belief: "true", confidence: 1, msg: null, at: 5 } };
    const after = fold(reg, w, s, [link(w.pov, "lore:ledger"), learned, { type: TRUTH_EVENTS.unlink, data: { who: w.pov, fact: "lore:ledger", why: "Let go" } }]);
    expect(readKnowledge(after).holdings[w.pov]?.["lore:ledger"]?.how).toBe("told");
    expect(heldSecrets(after.packs.minds, w.pov).lore).toEqual(["ledger"]);
  });

  test("a link is refused for a fact the minds don't hold, an authored hold, or no reason", () => {
    const { w, s } = base();
    const ctx = () => reg.context(w, structuredClone(s) as WorldState);
    const check = (e: PackEvent) => reg.get(e.type)?.validate(e as never, ctx());
    expect(check(link(w.pov, "lore:nope"))?.code).toBe("missing_fact");
    expect(check({ ...link(w.pov, "lore:ledger"), data: { ...link(w.pov, "lore:ledger").data, how: "authored" } })?.code).toBe("bad_event");
    expect(check({ ...link(w.pov, "lore:ledger"), data: { ...link(w.pov, "lore:ledger").data, why: " " } })?.code).toBe("bad_event");
    expect(check({ type: TRUTH_EVENTS.unlink, data: { who: w.pov, fact: "lore:ledger", why: "x" } })?.code).toBe("missing_holding");
  });

  test("a chat the GM never linked folds as it always did", () => {
    const { s } = base();
    expect(Object.keys(s.packs.minds?.knowledge ?? {}).sort()).toEqual(["facts", "holdings"]);
  });

  test("verdicts read a belief against the truth", () => {
    expect([linkVerdict("true", "true"), linkVerdict("true", "false"), linkVerdict("uncertain", "true"), linkVerdict("false", "open"), linkVerdict(null, "true")]).toEqual(["true", "false", "partly", "partly", "unlinked"]);
  });
});
