// What a depth reply's change chip says its turn did (LIVE3 lane 1b): "What this turn did" said "8
// changes" and listed the scene, three stagings and three of the turn's five beats, each by its raw
// id ("beat b…: marcus_delgado said"), so the world's beat and Marcus's answer weren't there. It now
// lists every beat that reached the player character by what reached him (what there was to sense
// with the words said, or his own point of view), none past him, and counts each line it lists;
// stagings and the narrator's rendering, the author's and the narrator's bookkeeping, aren't the player's lines.

import { describe, expect, test } from "bun:test";
import { beatTextHashes, buildView, ViewMemo } from "../../src/backend/view";
import { resolveFix } from "../../src/engine/edits";
import { enginePack } from "../../src/engine/engine-pack";
import type { ChainMessage } from "../../src/engine/ledger/chain";
import { LedgerFold } from "../../src/engine/ledger/fold";
import { emptyJournal, LedgerCore } from "../../src/engine/ledger/journal";
import { computePaths, contentId, nextPath } from "../../src/engine/ledger/path";
import { createRegistry } from "../../src/engine/registry-impl";
import storyPack from "../../src/packs/story/core/index";
import { hashJson } from "../../src/shared/hash";
import type { ChatRun, LedgerEvent, Rec } from "../../src/shared/ledger";
import { OFFSTAGE_DEFAULTS } from "../../src/shared/offstage";
import { passageEvent } from "../../src/shared/passage";
import { sceneEvent } from "../../src/shared/scene";
import { NARRATOR_DEFAULTS } from "../../src/shared/settings";
import type { StateView } from "../../src/shared/state-view";
import { beatEvent, stagingEvent, type Beat, type Exposure } from "../../src/shared/story";
import { blobHash } from "../../src/shared/stores";
import { POV, testModel, testPack, testWorld } from "../support/test-pack";
import mindsPack from "../../src/packs/minds/core/index";
import { mindPovEvent } from "../../src/shared/character-engine";

const reg = createRegistry([enginePack, testPack, storyPack, mindsPack]);
const base = testWorld();
const world = { ...base, places: { ...base.places, shop: { id: "shop", name: "Alder Automotive", fields: {} } } };
const revision = hashJson(world);
const run: ChatRun = { v: 1, worldId: world.id, revision, runSeed: "receipt", startedAt: 0 };

/** Every text the record names, by its hash, as the blob store holds them. */
const texts = new Map<string, string>();
const put = (text: string): string => {
  const hash = blobHash(text);
  texts.set(hash, text);
  return hash;
};

const WHOLE: Exposure = { who: POV, channel: "sight", reach: "whole" };
let made = 0;
function beat(o: { surface: string; actors?: string[]; quotes?: string; exposure?: Exposure[] }): Beat {
  const id = `b${(made++).toString(16).padStart(31, "0")}`;
  return { id, at: 0, order: 0, scene: "s1", place: "shop", actors: o.actors ?? [], act: o.quotes ? "said" : "did", about: [], what: put(`what of ${o.surface}`), surface: put(o.surface), ...(o.quotes ? { quotes: put(o.quotes) } : {}), exposure: o.exposure ?? [WHOLE], by: { turn: "t1", decided: "author" } };
}

// The live turn's five beats, his two among them, and more after, past the old cap of eight lines.
const crouch = beat({ surface: "Sam steps in past Dev and crouches by the truck's front wheel.", actors: [POV] });
const call = beat({ surface: "Sam calls out to Dev from under the truck.", actors: [POV], quotes: "Morning. That Dale's truck?" });
const shop = beat({ surface: "The shop smells of brake cleaner, and a clock ticks over the bench." });
const pot = beat({ surface: "Dev sets his keys on the bench and pours a coffee.", actors: ["dev"] });
const answer = beat({ surface: "Dev rolls out on the creeper and answers.", actors: ["dev"], quotes: "Dale's, yeah. Same as last time.", exposure: [{ who: POV, channel: "hearing", reach: "whole" }] });
const glimpse = put("A hand moves near the fender and something goes into a pocket.");
const pocket = beat({ surface: "Dev pockets the bleeder screw.", actors: ["dev"], exposure: [{ who: POV, channel: "sight", reach: "partial", pov: glimpse }] });
const unseen = beat({ surface: "Dev slides the invoice under the bench.", actors: ["dev"], exposure: [{ who: "dev", channel: "sight", reach: "whole" }] });
const later = ["A truck goes by outside.", "The coffee maker gurgles.", "Rain starts on the roof.", "The radio cuts to the news."].map((surface) => beat({ surface }));
const beats = [crouch, call, shop, pot, answer, pocket, unseen, ...later];

/** A chat whose one reply's record holds a depth turn: the scene at the shop, the player character moved there, its staging, the beats, and the passage. */
function chat(switchTo?: string): { core: LedgerCore; observed: ChainMessage[] } {
  const observed: ChainMessage[] = [{ id: "m0", isUser: false, swipeId: 0, swipes: ["Morning, Sam."], ledger: null }];
  let parent = computePaths(observed, [])[0]?.path ?? "";
  const user: ChainMessage = { id: "u1", isUser: true, swipeId: 0, swipes: ["I step in past Dev and crouch by the wheel."], ledger: null };
  parent = nextPath(user, parent, []);
  const pre: LedgerEvent[] = [
    sceneEvent({ scene: "s1", place: "shop", at: 0, cast: [{ who: "dev", effort: "author", why: "He's at work." }], opens: true }),
    { type: "set", entity: POV, field: "place", value: "shop" },
    ...(switchTo !== undefined ? [mindPovEvent(switchTo)] : []),
    stagingEvent({ who: POV, scene: "s1", where: put("by the front wheel"), doing: put("crouching") }),
    stagingEvent({ who: "dev", scene: "s1", where: put("on the creeper"), doing: put("under the truck") }),
    ...beats.map(beatEvent),
  ];
  const read = [passageEvent({ moment: 0, index: 0, beats: beats.map((b) => b.id), pov: POV, text: put("The reply."), drafts: [{ text: put("The reply."), faithful: true }] })];
  const text = "The reply.";
  const rec: Rec = { v: 1, defHash: revision, seq: 1, swipeHash: contentId(text), path: parent, seed: "s1", pre: pre.length, events: [...pre, ...read], post: [], markersApplied: 0, status: "ok", undone: [], intents: {} };
  observed.push(user, { id: "a1", isUser: false, swipeId: 0, swipes: [text], ledger: { v: 1, swipes: { "0": rec }, markers: [] } });
  const core = new LedgerCore(emptyJournal("receipt"), { types: reg, worlds: (r) => (r === revision ? world : undefined), run, model: testModel, startMarkers: () => [], newSeed: () => "fresh", resolveFix: (doc, state, entry) => resolveFix(reg, doc, state, entry, run.runSeed) }, new LedgerFold(reg));
  return { core, observed };
}

function viewOf(core: LedgerCore, observed: ChainMessage[], beatTexts?: ReadonlyMap<string, string>): StateView {
  return buildView({ chatId: "receipt", run, core, observed, registry: reg, world: (r) => core.worldAt(r), stored: [], meter: null, knowledge: { chat: {}, tracking: false, narrator: NARRATOR_DEFAULTS }, offstage: OFFSTAGE_DEFAULTS, depth: true, memo: new ViewMemo(), ...(beatTexts ? { beatTexts } : {}) });
}

describe("What this turn did, on a depth reply (LIVE3 lane 1b)", () => {
  test("lists every beat that reached the player character by what reached him, never one that didn't, never by id, and counts every line it lists", () => {
    const { core, observed } = chat();
    // The texts the view reads first: each beat's surface, its words and every point of view of it.
    expect(new Set(beatTextHashes(core, observed))).toEqual(new Set(beats.flatMap((b) => [b.surface, ...(b.quotes ? [b.quotes] : []), ...b.exposure.flatMap((x) => (x.pov ? [x.pov] : []))])));
    const read = new Map(beatTextHashes(core, observed).map((hash) => [hash, texts.get(hash) ?? ""]));
    const chip = viewOf(core, observed, read).chips.find((c) => c.kind === "change" && c.messageId === "a1");
    const lines = chip?.detail?.split("\n") ?? [];
    // Each line counted: the world's changes (the scene, his move there) and each beat.
    expect(chip?.label).toBe(`${lines.length} changes`);
    const told = [
      "Sam steps in past Dev and crouches by the truck's front wheel.",
      "Sam calls out to Dev from under the truck. “Morning. That Dale's truck?”",
      "The shop smells of brake cleaner, and a clock ticks over the bench.",
      "Dev sets his keys on the bench and pours a coffee.",
      "Dev rolls out on the creeper and answers. “Dale's, yeah. Same as last time.”",
      "A hand moves near the fender and something goes into a pocket.",
      "A truck goes by outside.",
      "The coffee maker gurgles.",
      "Rain starts on the roof.",
      "The radio cuts to the news.",
    ];
    expect(lines.slice(-told.length)).toEqual(told);
    expect(lines.length).toBeGreaterThan(told.length);
    const detail = chip?.detail ?? "";
    // What never reached him isn't his to read, nor what only part of it reached him.
    expect(detail).not.toContain("invoice");
    expect(detail).not.toContain("bleeder screw");
    // No raw id, no staging or passage line.
    for (const b of beats) expect(detail).not.toContain(b.id);
    expect(detail).not.toMatch(/staging of|passage \d|beat\(s\)/);
  });

  test("before the beats' texts are read, none is listed, and none by its id", () => {
    const { core, observed } = chat();
    const chip = viewOf(core, observed).chips.find((c) => c.kind === "change" && c.messageId === "a1");
    const said = [chip?.label ?? "", chip?.detail ?? ""].join("\n");
    for (const b of beats) expect(said).not.toContain(b.id);
    expect(said).not.toContain("crouches");
  });

  test("after a switch, lists what reached the character the player switched to, not the world's own", () => {
    const { core, observed } = chat("dev");
    const read = new Map(beatTextHashes(core, observed).map((hash) => [hash, texts.get(hash) ?? ""]));
    const detail = viewOf(core, observed, read).chips.find((c) => c.kind === "change" && c.messageId === "a1")?.detail ?? "";
    expect(detail).toContain("Dev slides the invoice under the bench.");
    expect(detail).not.toContain("A hand moves near the fender");
  });
});
