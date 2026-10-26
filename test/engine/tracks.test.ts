import { describe, expect, test } from "bun:test";
import { agendaFor, answerPuzzle, moveTrack, normalizeAnswer, stepTracks } from "../../src/engine/tracks";
import { findLeaks, hintsEarned, playerTrack, unrevealedTruths } from "../../src/engine/visibility";
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
    expect(hintsEarned(wd, w.state, "riddle")).toEqual(["It answers back."]);
    expect(answerPuzzle(reg, w, "riddle", "something", "s").needsDecision).toBe(true);
    const right = answerPuzzle(reg, w, "riddle", "echo", "s");
    expect([right.correct, right.via]).toEqual([true, "normalized"]);
    expect(w.state.tracks.riddle?.stage).toBe("solved");
    const w2 = new Working(reg, wd, startState(wd));
    expect(answerPuzzle(reg, w2, "riddle", "the sound that comes back", "s", 0.85).via).toBe("decision");
  });

  test("an end stage grants its own rewards when the track reaches it, since it is never left", () => {
    const wd = world();
    wd.tracks.delivery = { ...quest, stages: { ...quest.stages, done: { label: "Delivered", next: [], rewards: [{ type: "add", args: { entity: POV, field: "cash", delta: 250 } }] } } };
    const reg = registryOf();
    const w = new Working(reg, wd, startState(wd));
    w.apply({ type: "stage", track: "delivery", to: "deliver" });
    const cash = Number(w.state.entities[POV]?.fields.cash);
    w.apply({ type: "add", entity: "dev", field: "stress", delta: 5 });
    expect(stepTracks(reg, w, "s").map((c) => c.to)).toEqual(["done"]);
    expect(Number(w.state.entities[POV]?.fields.cash) - cash).toBe(250);
  });

  test("hints are earned stage by stage: one per wrong answer at a puzzle stage, every one at any other stage; opened one at a time", () => {
    const wd = world();
    wd.tracks.riddle = { ...riddle, stages: { ask: { ...riddle.stages.ask!, next: [{ to: "second", when: "false" }] }, second: { label: "The second riddle", answer: { expect: ["fog"], normalize: true }, hints: ["It hides the hills."], next: [{ to: "solved", when: "false" }] }, solved: riddle.stages.solved! } };
    wd.tracks.delivery = { ...quest, stages: { ...quest.stages, start: { ...quest.stages.start!, hints: ["The cafe is on Pier Street."] } } };
    const reg = registryOf();
    const w = new Working(reg, wd, startState(wd));
    const row = (id: string) => playerTrack(reg, wd, w.state, POV, id);
    expect(row("delivery")?.hints).toEqual(["The cafe is on Pier Street."]);
    answerPuzzle(reg, w, "riddle", "a shadow", "s", 0.2);
    answerPuzzle(reg, w, "riddle", "a bell", "s", 0.2);
    expect(row("riddle")?.hints).toEqual(["It answers back.", "Mountains are full of them."]);
    expect(answerPuzzle(reg, w, "riddle", "echo", "s").change?.to).toBe("second");
    // The misses were the first riddle's: the second earns its own.
    expect(row("riddle")?.hints).toEqual([]);
    answerPuzzle(reg, w, "riddle", "rain", "s");
    expect([row("riddle")?.hints, row("riddle")?.opened]).toEqual([["It hides the hills."], 0]);
    // Opened one at a time, never more than are earned, and only at a stage the track has.
    expect(w.apply({ type: "engine.hint", data: { track: "riddle", stage: "second" } })).toBeNull();
    expect(w.apply({ type: "engine.hint", data: { track: "riddle", stage: "second" } })).toBeNull();
    expect(row("riddle")?.opened).toBe(1);
    expect(w.apply({ type: "engine.hint", data: { track: "riddle", stage: "nowhere" } })).not.toBeNull();
  });

  test("the GM's Stage: on to a stage that follows, its entry plays as in the story; back, only the stage is set", () => {
    const wd = world();
    const add = (delta: number) => [{ type: "add", args: { entity: POV, field: "cash", delta } }];
    wd.tracks.delivery = { ...quest, stages: { ...quest.stages, deliver: { ...quest.stages.deliver!, rewards: add(50) }, done: { label: "Delivered", next: [], rewards: add(250) } } };
    const reg = registryOf();
    const w = new Working(reg, wd, startState(wd));
    const cash = () => Number(w.state.entities[POV]?.fields.cash);
    const start = cash();
    // From the start past the hand-over to the end: the start's 100 as it is left, the end's 250 as it is reached.
    expect(moveTrack(reg, w, "delivery", "done", "s")).toBeNull();
    expect([w.state.tracks.delivery?.stage, cash() - start]).toEqual(["done", 350]);
    expect(w.events.some((e) => e.type === "engine.signal" && e.data.class === "quest")).toBe(true);
    // Back: only the stage, so nothing is granted twice.
    const mark = w.events.length;
    expect(moveTrack(reg, w, "delivery", "deliver", "s")).toBeNull();
    expect(w.events.slice(mark).map((e) => e.type)).toEqual(["stage"]);
    // Failing the hand-over grants nothing of what it rewards on the way on.
    expect(moveTrack(reg, w, "delivery", "failed", "s")).toBeNull();
    expect([w.state.tracks.delivery?.stage, cash() - start]).toEqual(["failed", 350]);
    expect(moveTrack(reg, w, "delivery", "nowhere", "s")?.reason).toContain("nowhere");
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
