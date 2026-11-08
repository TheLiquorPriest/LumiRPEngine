// The author's and the GM's depth stages with recorded model answers (DEPTH-PLAN §4.4, §4.5, §8.1):
// the notebook's bookkeeping folds and pins the player's edits; the historian's beats anchor at their
// own messages; the truth-link reveals a secret to the player character only through his exposure.

import { describe, expect, test } from "bun:test";
import type { LedgerEvent } from "../../src/shared/ledger";
import { heldSecrets } from "../../src/shared/minds";
import { blobHash } from "../../src/shared/stores";
import { STORY_BEAT, type Beat } from "../../src/shared/story";
import type { WorldDoc } from "../../src/shared/world";
import { notebookEvent, notebookFiles, notebookOf } from "../../src/engine/notebook";
import { createRegistry } from "../../src/engine/registry-impl";
import type { WorldState } from "../../src/engine/state";
import { findLeaks, unrevealedSecrets } from "../../src/engine/visibility";
import { wsWrite } from "../../src/engine/workspace";
import { ALL_PACKS } from "../../src/packs/index";
import { bindNewcomers, historian } from "../../src/backend/depth/historian";
import { authorRead } from "../../src/backend/depth/notebook";
import type { ModelPort } from "../../src/backend/depth/port";
import { truthLink } from "../../src/backend/depth/truth-link";
import { modernUsWorld } from "../packs/riverton";
import { fold, startState } from "../packs/support";
import { Harness } from "../support/harness";
import storyPack from "../../src/packs/story/core/index";
import { claimFactId, type KnowledgeFact } from "../../src/shared/minds";
import { linksOf, TRUTH_EVENTS } from "../../src/shared/truth-links";

const reg = createRegistry(ALL_PACKS);
const TILL = "Maya skims the till";

function world(): WorldDoc {
  const w = modernUsWorld("w", "R");
  w.tracks.s_till = { id: "s_till", kind: "secret", label: "The till", start: "hidden", stages: { hidden: { label: "Hidden", next: [], truth: TILL } }, visibility: "secret" };
  return w;
}

/** A model that answers each call with the next recorded answer. */
function answering(...answers: unknown[]): ModelPort & { asked: string[] } {
  const asked: string[] = [];
  const port = (async (role, messages) => {
    asked.push(`${role}: ${messages.map((m) => m.content).join("\n")}`);
    return { text: JSON.stringify(answers.shift() ?? {}) };
  }) as ModelPort & { asked: string[] };
  port.asked = asked;
  return port;
}

const ROWS = [
  { id: "m1", isUser: true, name: "Sam", text: "I watch Maya at the register.", clock: null, basis: { swipe: "c1" } },
  { id: "m2", isUser: false, name: "Narrator", text: "Maya slips two twenties from the till into her apron while a stranger in a red cap waits.", clock: null, basis: { swipe: "c2" } },
];

describe("the notebook's bookkeeping", () => {
  test("the author's revision folds; the player's edit pins the file; chapters close in order", () => {
    const w = world();
    const a = blobHash("Threads: the till.");
    const s1 = fold(reg, w, startState(w), [wsWrite("notebook/threads.md", a), notebookEvent({ kind: "light", files: { "notebook/threads.md": a }, through: "m2" })]);
    expect(notebookFiles(s1)).toEqual([{ path: "notebook/threads.md", hash: a, pinned: false }]);
    const mine = blobHash("Threads: the till, and Maya's sister.");
    const s2 = fold(reg, w, s1, [wsWrite("notebook/threads.md", mine)]);
    expect(notebookFiles(s2)[0]?.pinned).toBe(true);
    const s3 = fold(reg, w, s2, [notebookEvent({ kind: "chapter", files: {}, through: "m2", chapter: { index: 0, title: "The register" } })]);
    expect(notebookOf(s3).chapters).toEqual([{ index: 0, title: "The register", through: "m2", at: s3.clock }]);
    const ctx = reg.context(w, structuredClone(s3) as WorldState);
    expect(reg.get("engine.notebook")?.validate(notebookEvent({ kind: "chapter", files: {}, through: null, chapter: { index: 3, title: "Skipped" } }) as never, ctx)?.code).toBe("bad_event");
    // A chat that never had a notebook holds no key.
    expect(Object.keys(startState(w).packs.engine ?? {})).not.toContain("notebook");
  });

  test("the author never rewrites a pinned file, and may comment on it", async () => {
    const w = world();
    const s = startState(w);
    const model = answering({ files: [{ path: "notebook/player.md", text: "He wants the till found out." }, { path: "notebook/threads.md", text: "The till; the stranger in the red cap." }, { path: "../escape.md", text: "x" }], comments: [{ path: "notebook/player.md", text: "I read his edit as wanting it slower." }], chapter: { ends: false }, cast: [{ who: "maya", mind: true, why: "She recurs" }, { who: w.pov, mind: true, why: "no" }], reasoning: "The till moved." });
    const out = await authorRead({ world: w, state: s, texts: {}, chunk: ROWS, beats: [], notebook: { files: { "notebook/player.md": "Slow burn, please." }, pinned: [{ path: "notebook/player.md", before: "", after: "Slow burn, please." }] }, chapter: { index: 0, stretches: 0 }, cast: [{ id: w.pov, name: "Sam", card: false, mind: false }, { id: "maya", name: "Maya", card: true, mind: false }] }, model);
    expect(out.events.map((e) => (typeof e.data.path === "string" ? e.data.path : e.type))).toEqual(["notebook/threads.md", "engine.notebook"]);
    expect(out.refused.length).toBe(2);
    expect(out.cast).toEqual([{ who: "maya", mind: true, why: "She recurs" }]);
    expect(model.asked[0]).toContain("pinned: the player's own words");
    const folded = fold(reg, w, s, out.events as LedgerEvent[]);
    expect(notebookFiles(folded).map((f) => f.path)).toEqual(["notebook/threads.md"]);
  });
});

describe("the historian", () => {
  test("beats anchor at their own messages, newcomers come back as refs to bind, and an unclocked chat's times are approximate", async () => {
    const w = world();
    const s = startState(w);
    const model = answering({
      beats: [
        { message: "m2", place: "cafe", actors: ["maya"], act: "did", about: ["maya"], what: "Maya pockets two twenties from the till.", surface: "Maya's hand moves from the till to her apron.", exposure: [{ who: "Sam", channel: "sight", reach: "whole" }, { who: "new:red_cap", channel: "sight", reach: "partial" }] },
        { message: "m9", what: "Not in the stretch." },
      ],
      staging: [{ who: "maya", where: "behind the register", doing: "ringing up a sale" }],
      newcomers: [{ ref: "new:red_cap", name: "Stranger in a red cap", note: "waiting in line" }],
    });
    const cast = [{ id: w.pov, name: "Sam" }, { id: "maya", name: "Maya" }];
    const out = await historian({ world: w, state: s, texts: {}, chunk: ROWS, before: { beats: [], staging: [] }, cast }, model);
    expect(out.beats.length).toBe(1);
    const beat = out.beats[0]!.beat;
    expect(beat.by).toEqual({ bootstrap: { message: "m2", swipe: "c2" } });
    expect(beat.approx).toBe(true);
    // Maya, who acted, perceives her own act though the answer left her out; she lives it later.
    expect(beat.exposure.map((x) => [x.who, x.pending ?? false])).toEqual([[w.pov, false], ["new:red_cap", true], ["maya", true]]);
    expect(out.blobs[beat.what]).toBe("Maya pockets two twenties from the till.");
    expect(out.byMessage.m1).toEqual([]);
    expect(out.byMessage.m2?.map((e) => e.type)).toEqual([STORY_BEAT, "story.staging"]);
    expect(out.uncertain.length).toBe(1);
    const bound = bindNewcomers(out, { "new:red_cap": "bs_red_cap" }, ROWS);
    expect(bound.beats[0]!.beat.exposure[1]?.who).toBe("bs_red_cap");
    expect(bound.newcomers).toEqual([]);
    expect((bound.byMessage.m2?.[0] as unknown as { data: Beat } | undefined)?.data.exposure[1]?.who).toBe("bs_red_cap");
    // The same answer for the same stretch makes the same beat: a resumed run never duplicates one.
    const again = await historian({ world: w, state: s, texts: {}, chunk: ROWS, before: { beats: [], staging: [] }, cast }, answering({ beats: [{ message: "m2", what: "Maya pockets two twenties from the till.", surface: "x", exposure: [] }] }));
    expect(again.beats[0]?.beat.id).toBe(beat.id);
  });
});

describe("the GM's truth-link", () => {
  test("the player character's exposure reveals a secret through the projection; a link resting on nothing that reached him is refused", async () => {
    const w = world();
    const s = startState(w);
    const what = "Maya pockets two twenties from the till.";
    const beat: Beat = { id: "b1", at: s.clock, order: 0, place: "cafe", actors: ["maya"], act: "did", about: [{ entity: "maya" }], what: blobHash(what), surface: blobHash("x"), exposure: [{ who: w.pov, channel: "sight", reach: "whole" }], by: { bootstrap: { message: "m2", swipe: "c2" } } };
    const unseen: Beat = { ...beat, id: "b2", exposure: [{ who: "maya", channel: "sight", reach: "whole" }] };
    const model = answering({
      facts: [{ ref: "f1", claim: "Maya keeps a second apron pocket for cash", about: ["maya"], truth: "true", matters: "Anyone who sees it could tell her boss" }],
      links: [
        // Written back by first name rather than id: it still finds its one person.
        { who: (s.entities[w.pov]?.name ?? w.pov).split(" ")[0], fact: "[track:s_till:hidden]", from: { beat: "id: b1" }, words: "saw her hand go from the till to her apron", belief: "true", confidence: 0.95, how: "witnessed", why: "He watched the register as it happened" },
        { who: w.pov, fact: "f1", from: { beat: "b2" }, words: "", belief: "true", confidence: 0.9, why: "It reached Maya, not him" },
        { who: "maya", fact: "f1", from: { mind: "minds/maya/beliefs.md" }, words: "- I'd swear no one saw the apron", belief: "true", confidence: 0.9, why: "Her own belief" },
      ],
    });
    expect(findLeaks(TILL, unrevealedSecrets(reg, w, s)).length).toBeGreaterThan(0);
    const out = await truthLink({ registry: reg, world: w, state: s, texts: {}, beats: [{ beat, what, surface: "x" }, { beat: unseen, what, surface: "x" }], beliefs: [{ who: "maya", path: "minds/maya/beliefs.md", text: "- I'd swear no one saw the apron" }], msg: "m2" }, model);
    expect(out.events.map((e) => e.type)).toEqual(["minds.fact", "minds.fact", "minds.link", "minds.link"]);
    expect(out.refused.length).toBe(1);
    const after = fold(reg, w, s, out.events as LedgerEvent[]);
    expect(heldSecrets(after.packs.minds, w.pov).stages).toEqual({ s_till: ["hidden"] });
    expect(findLeaks(TILL, unrevealedSecrets(reg, w, after))).toEqual([]);
  });
});

describe("through the ledger", () => {
  test("a truth link and a notebook revision anchored at a reply survive a swipe of a later reply; one anchored at the swiped reply goes inert and comes back", async () => {
    const h = new Harness("fresh", { packs: [storyPack] });
    const userId = h.host.userId;
    const chat = await h.newChat();
    await h.send(chat, "hello");
    const first = h.host.head(chat);
    const b1 = first ? await h.service.basisFor(chat, userId, first.id) : null;
    if (!b1) throw new Error("no basis");
    const at1 = await h.service.foldAtBasis(chat, userId, b1);
    if (!at1) throw new Error("off chain");
    const pov = at1.world.pov;
    const fact = (claim: string): KnowledgeFact => ({ id: claimFactId(claim, b1.message), kind: "claim", claim, about: [], truth: "true", source: { msg: b1.message, at: 0 }, matters: "Who knows it can act on it" });
    const link = (f: KnowledgeFact) => ({ type: TRUTH_EVENTS.link, data: { who: pov, fact: f.id, from: { beat: "pier" }, words: "saw it", why: "It reached him whole", how: "witnessed", by: null, evidence: [], belief: "true", confidence: 0.9, msg: b1.message, at: 0 } });
    const pier = fact("The pier floods at eight");
    const notes = blobHash("Threads: the pier.");
    const landed = await h.service.landLayer(chat, userId, { id: "gm", basis: b1, kind: "truthlink", events: [{ type: "minds.fact", data: { fact: pier } }, link(pier), wsWrite("notebook/threads.md", notes), notebookEvent({ kind: "light", files: { "notebook/threads.md": notes }, through: b1.message })] as never });
    expect(landed.status).toBe("landed");

    await h.send(chat, "again");
    const head = h.host.head(chat);
    const b2 = await h.service.basisFor(chat, userId);
    if (!head || !b2) throw new Error("no head");
    const boat = fact("The boat was sold on Tuesday");
    expect((await h.service.landLayer(chat, userId, { id: "gm2", basis: b2, kind: "truthlink", events: [{ type: "minds.fact", data: { fact: boat } }, link(boat)] as never })).status).toBe("landed");
    const atHead = async () => {
      const basis = await h.service.basisFor(chat, userId);
      const s = basis ? await h.service.foldAtBasis(chat, userId, basis) : null;
      if (!s) throw new Error("off chain");
      return s.state;
    };
    expect(Object.keys(linksOf((await atHead()).packs.minds, pov)).sort()).toEqual([boat.id, pier.id].sort());

    await h.host.finish(await h.host.start(chat, { type: "swipe", messageId: head.id }), "Okay, again.");
    const swiped = await atHead();
    expect(Object.keys(linksOf(swiped.packs.minds, pov))).toEqual([pier.id]);
    expect(notebookFiles(swiped).map((f) => [f.path, f.pinned])).toEqual([["notebook/threads.md", false]]);
    h.host.navigate(chat, head.id, 0);
    await h.host.settle();
    expect(Object.keys(linksOf((await atHead()).packs.minds, pov)).sort()).toEqual([boat.id, pier.id].sort());
    // Landing the same entry again lands nothing twice.
    expect((await h.service.landLayer(chat, userId, { id: "gm", basis: b1, kind: "truthlink", events: [link(pier)] as never })).status).toBe("landed");
    expect(Object.keys(linksOf((await atHead()).packs.minds, pov)).length).toBe(2);
  });
});
