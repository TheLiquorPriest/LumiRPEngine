import { describe, expect, test } from "bun:test";
import { agendaFor, answerPuzzle, hintsShown, normalizeAnswer, stepTracks } from "../../src/engine/tracks";
import { findLeaks, playerTrack, unrevealedTruths } from "../../src/engine/visibility";
import { Working } from "../../src/engine/working";
import type { TrackDef } from "../../src/shared/world";
import { baseWorld, POV, registryOf, startState } from "../packs/support";

const quest: TrackDef = {
  id: "delivery",
  kind: "quest",
  label: "The delivery",
  start: "start",
  visibility: "public",
  stages: {
    start: { label: "Get to the cafe", objectives: ["at(pov, 'cafe')"], next: [{ to: "deliver", when: "track.complete" }], rewards: [{ type: "add", args: { entity: POV, field: "cash", delta: 100 } }] },
    deliver: { label: "Hand it over", cue: "Dev is waiting for the parcel.", next: [{ to: "done", when: "dev.stress >= 5" }], gate: "hour >= 6", fail: { when: "pov.stress >= 90", to: "failed" } },
    done: { label: "Delivered", next: [] },
    failed: { label: "Lost it", next: [] },
  },
};

const secret: TrackDef = {
  id: "butler",
  kind: "secret",
  label: "Who took the ledger",
  start: "hidden",
  visibility: "secret",
  stages: {
    hidden: { label: "Hidden", next: [{ to: "clue", when: "pov.skill >= 3" }] },
    clue: { label: "A clue", cue: "Ink stains on a cuff.", next: [{ to: "reveal", when: "pov.skill >= 5" }] },
    reveal: { label: "Revealed", truth: "The butler hid the ledger in the wine cellar.", next: [] },
  },
};

const riddle: TrackDef = {
  id: "riddle",
  kind: "puzzle",
  label: "The riddle",
  start: "ask",
  visibility: "public",
  stages: {
    ask: { label: "Answer the riddle", answer: { expect: ["An Echo"], normalize: true, decision: { threshold: 0.8 } }, hints: ["It answers back.", "Mountains are full of them."], next: [{ to: "solved", when: "false" }] },
    solved: { label: "Solved", next: [], effects: [{ type: "note", args: { text: "The door opens." } }] },
  },
};

function world() {
  const w = baseWorld();
  w.tracks = { delivery: quest, butler: secret, riddle };
  return w;
}

describe("tracks", () => {
  test("a quest advances only on predicates, honours gates, grants rewards and signals a quest interrupt", () => {
    const wd = world();
    const reg = registryOf();
    const w = new Working(reg, wd, startState(wd));
    expect(stepTracks(reg, w, "s")).toEqual([]);
    w.apply({ type: "set", entity: POV, field: "place", value: "cafe" });
    const changes = stepTracks(reg, w, "s");
    expect(changes.map((c) => [c.track, c.to])).toEqual([["delivery", "deliver"]]);
    expect(w.state.entities[POV]?.fields.cash).toBe(5100);
    expect(w.events.some((e) => e.type === "engine.signal" && e.data.class === "quest")).toBe(true);
    w.apply({ type: "add", entity: "dev", field: "stress", delta: 5 });
    expect(stepTracks(reg, w, "s").map((c) => c.to)).toEqual(["done"]);
  });

  test("a gate holds the transition until it opens", () => {
    const wd = world();
    wd.tracks.delivery = { ...quest, stages: { ...quest.stages, deliver: { ...quest.stages.deliver!, gate: "hour >= 20" } } };
    const reg = registryOf();
    const w = new Working(reg, wd, startState(wd));
    w.apply({ type: "set", entity: POV, field: "place", value: "cafe" });
    expect(stepTracks(reg, w, "s")).toEqual([]);
    w.apply({ type: "clock", minutes: 12 * 60, cause: "tick" });
    expect(stepTracks(reg, w, "s").map((c) => c.to)).toEqual(["deliver"]);
  });

  test("fail predicates win over next", () => {
    const wd = world();
    const reg = registryOf();
    const w = new Working(reg, wd, startState(wd));
    w.apply({ type: "stage", track: "delivery", to: "deliver" });
    w.apply({ type: "add", entity: POV, field: "stress", delta: 95 });
    w.apply({ type: "add", entity: "dev", field: "stress", delta: 9 });
    expect(stepTracks(reg, w, "s").map((c) => [c.to, c.via])).toEqual([["failed", "fail"]]);
  });

  test("puzzles: normalized answers, the authored decision threshold, attempts and the hint ladder", () => {
    expect(normalizeAnswer("  The ÉCHO!! ")).toBe("echo");
    const wd = world();
    const reg = registryOf();
    const w = new Working(reg, wd, startState(wd));
    expect(answerPuzzle(reg, w, "riddle", "a shadow", "s", 0.2).correct).toBe(false);
    expect(hintsShown(wd, w.state, "riddle")).toEqual(["It answers back."]);
    expect(answerPuzzle(reg, w, "riddle", "something", "s").needsDecision).toBe(true);
    const right = answerPuzzle(reg, w, "riddle", "echo", "s");
    expect([right.correct, right.via]).toEqual([true, "normalized"]);
    expect(w.state.tracks.riddle?.stage).toBe("solved");
    const w2 = new Working(reg, wd, startState(wd));
    expect(answerPuzzle(reg, w2, "riddle", "the sound that comes back", "s", 0.85).via).toBe("decision");
  });

  test("secret ladders reveal truth only at the reveal stage; nothing leaks before", () => {
    const wd = world();
    const reg = registryOf();
    const w = new Working(reg, wd, startState(wd));
    expect(playerTrack(reg, wd, w.state, POV, "butler")).toBeNull();
    w.apply({ type: "add", entity: POV, field: "skill", delta: 1 });
    stepTracks(reg, w, "s");
    const clue = playerTrack(reg, wd, w.state, POV, "butler");
    expect(clue?.cue).toBe("Ink stains on a cuff.");
    expect(findLeaks(JSON.parse(JSON.stringify(clue)), unrevealedTruths(wd, w.state))).toEqual([]);
    expect(clue?.label).not.toContain("ledger");
    // It goes by a stand-in, never its own id, and keeps that one once revealed.
    expect(clue?.id).toMatch(/^~/);
    expect(JSON.stringify(clue)).not.toContain("butler");
    w.apply({ type: "add", entity: POV, field: "skill", delta: 2 });
    stepTracks(reg, w, "s");
    const revealed = playerTrack(reg, wd, w.state, POV, "butler");
    expect(revealed?.truths).toEqual(["The butler hid the ledger in the wine cellar."]);
    expect(revealed?.id).toBe(clue?.id ?? "");
    expect(unrevealedTruths(wd, w.state)).toEqual([]);
    // the secret track never raised a player-visible signal
    expect(w.events.filter((e) => e.type === "engine.signal")).toEqual([]);
  });

  test("agenda priorities come from the owner's current stages", () => {
    const wd = world();
    wd.tracks.plan = { id: "plan", kind: "agenda", label: "Open a bakery", owner: "dev", start: "save", visibility: "known_by", stages: { save: { label: "Save money", priority: 3, next: [] } } };
    expect(agendaFor(wd, startState(wd), "dev")).toEqual([{ track: "plan", label: "Open a bakery", stage: "save", stageLabel: "Save money", priority: 3 }]);
  });
});
