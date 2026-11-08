// The player's edit of a depth reply is his directive (DEPTH-PLAN §1.3, §4.2), through the ledger: the
// author reads the reply as it streamed beside his edit and amends the beats it changes (written whole,
// with a truth-blind point of view where a reach was partial) and strikes those it took out, at the
// reply; whoever lived a replaced beat catches up on the amendment; an unchanged text asks no one, and
// the next edit reads the last one as the reply was, a cosmetic one amending nothing. His edit of his
// own old message the bootstrap made beats from is read as what he now says he did or said, and on a
// played chat it pauses nothing: its catch-ups and truth link run, and every later reply keeps its record.

import { describe, expect, test } from "bun:test";
import { seedCore } from "../../src/backend/character-agent";
import type { ModelPort } from "../../src/backend/depth/port";
import type { AfterRt } from "../../src/backend/depth/scene/after";
import { editUndone, replyEdited } from "../../src/backend/depth/scene/edit";
import { defaultSettings } from "../../src/backend/settings-store";
import { AUTHOR_EDIT } from "../../src/shared/author";
import { exposedBeats, livedCorpus, memoryPath, mindFileWrite, mindLivedEvent, mindPath, mindV2At, personPath } from "../../src/shared/character-engine";
import { hasOwn } from "../../src/shared/json";
import { mindView, recallFor } from "../../src/backend/character-engine";
import type { DepthRole } from "../../src/shared/depth-settings";
import { LEDGER_NAMESPACE } from "../../src/shared/ledger";
import { passageEvent } from "../../src/shared/passage";
import { beatEvent, beatId, type Beat } from "../../src/shared/story";
import { blobHash } from "../../src/shared/stores";
import { layerEntryId } from "../../src/engine/ledger/layer";
import authorPack from "../../src/packs/author/core/index";
import storyPack from "../../src/packs/story/core/index";
import { readKnowledge } from "../../src/packs/minds/core/state";
import type { Generation } from "../support/fake-host";
import { Harness } from "../support/harness";

const REPLY = "Sam tells Dev the pier floods at eight. Dev sets his cup down.";
const EDITED = "Sam tells Dev the pier floods at nine.";
const PIER = "Sam says the pier floods at eight.";
const CUP = "Dev sets his cup down.";
const NINE_WHAT = "Sam warns Dev that the pier floods at nine.";
const HEARD = "Through the cafe's noise: the pier, and nine.";

function rtOf(h: Harness, stored: Map<string, string>): AfterRt {
  const settings = defaultSettings();
  return {
    host: h.host,
    registry: h.registry,
    blobs: { get: async (_u, hash) => stored.get(hash) ?? null, put: async (_u, text) => (stored.set(blobHash(text), text), blobHash(text)) },
    settings: { get: async () => settings },
    ledger: h.service,
  };
}

/** Each role answers in turn from its own list, and every call's text is kept by role. */
function port(answers: Partial<Record<DepthRole, unknown[]>>): ModelPort & { sent: Partial<Record<DepthRole, string[]>> } {
  const sent: Partial<Record<DepthRole, string[]>> = {};
  const fn = (async (role, messages) => {
    (sent[role] ??= []).push(messages.map((m) => m.content).join("\n"));
    return { text: JSON.stringify(answers[role]?.shift() ?? {}), usage: { tokensIn: 1, tokensOut: 1 } };
  }) as ModelPort & { sent: Partial<Record<DepthRole, string[]>> };
  fn.sent = sent;
  return fn;
}

const beat = (id: string, actor: string, text: string, witness: string): Beat => ({
  id,
  at: 600,
  order: 1,
  scene: "s1",
  place: "home",
  actors: [actor],
  act: actor === "sam" ? "said" : "did",
  about: [],
  what: blobHash(text),
  surface: blobHash(text),
  exposure: [{ who: witness, channel: "sight", reach: "whole" }],
  by: { turn: "t1", decided: actor === "sam" ? "player" : "character" },
});

describe("the player's edit of a depth reply", () => {
  test("amends and strikes the beats it changes at the reply, and who lived them catches up; the next edit reads it as the reply was", async () => {
    const h = new Harness("fresh", { packs: [storyPack, authorPack] });
    const stored = new Map<string, string>([REPLY, EDITED, PIER, CUP].map((t) => [blobHash(t), t]));
    const rt = rtOf(h, stored);
    const userId = h.host.userId;
    const chat = await h.newChat();
    const greeting = await h.service.basisFor(chat, userId);
    if (!greeting) throw new Error("no greeting");
    // Dev has a mind; Sam is the player character.
    const core = seedCore({ who: "dev", at: 0, source: "card", text: "Dev runs the cafe." });
    for (const t of Object.values(core.blobs)) stored.set(blobHash(t), t);
    expect((await h.service.landLayer(chat, userId, { id: "core", basis: greeting, kind: "minds.v2.write", events: core.events })).status).toBe("landed");
    await h.send(chat, "The pier floods at eight, Dev.");
    const basis = await h.service.basisFor(chat, userId);
    if (!basis) throw new Error("no basis");
    // The reply's turn: two beats Dev lived, and the passage that streamed them.
    const passage = passageEvent({ moment: 0, index: 0, beats: ["pier", "cup"], pov: "sam", text: blobHash(REPLY), drafts: [{ text: blobHash(REPLY), faithful: true }] });
    expect((await h.service.landLayer(chat, userId, { id: "turn", basis, kind: "story.beat", events: [beatEvent(beat("pier", "sam", PIER, "dev")), beatEvent(beat("cup", "dev", CUP, "sam")), passage, mindLivedEvent({ who: "dev", beats: ["pier", "cup"], at: 600, mode: "play" })] })).status).toBe("landed");

    const amended = beatId(layerEntryId("edit", chat, basis.message, basis.swipe, "0", blobHash(EDITED)), "0");
    const model = port({
      author: [
        { cosmetic: false, amend: [{ replaces: ["b1"], ref: "e1", by: "author", actors: ["sam"], act: "said", what: NINE_WHAT, deed: "Sam tells Dev the pier floods at nine.", surface: "Sam says the pier floods at nine.", quotes: "The pier floods at nine.", exposure: [{ who: "dev", channel: "hearing", reach: "partial" }] }], strike: ["b2"], why: "He moved the flood to nine and took out the cup." },
        { cosmetic: true, why: "punctuation" },
      ],
      pov: [{ povs: { dev: HEARD } }],
      character: [{ memories: [{ lived: [amended], about: ["sam"], text: "Sam said something about the pier at nine." }] }],
      gm: [{ facts: [{ ref: "f1", claim: "The pier floods at nine.", matters: "Dev closes early because of it.", about: ["dev"] }], links: [] }],
    });
    const out = await replyEdited(rt, chat, userId, basis.message, EDITED, { model });
    expect(out).toMatchObject({ cosmetic: false, amended: [amended], struck: ["cup"], caughtUp: ["dev"], refused: [], failed: [] });
    // The author read the reply as it streamed beside his edit; the render never read the truth.
    expect(model.sent.author?.[0]).toContain(REPLY);
    expect(model.sent.author?.[0]).toContain(EDITED);
    expect(model.sent.pov?.[0]).not.toContain(NINE_WHAT);

    const at = await h.service.foldAtBasis(chat, userId, basis);
    if (!at) throw new Error("no fold");
    expect(at.story.beats.filter((p) => p.from.messageId === basis.message).map((p) => p.beat.id)).toEqual([amended]);
    expect(at.story.replaced.map((r) => r.id).sort()).toEqual(["cup", "pier"]);
    const live = at.story.beats.find((p) => p.beat.id === amended)?.beat;
    expect(live).toMatchObject({ at: 600, order: 1, scene: "s1", supersedes: ["pier"], by: { turn: "t1", decided: "author" } });
    // Its deed rides with it, as every live author beat's does (LIVE3 L3a-4): Sam lives his own act as he did it.
    expect(stored.get(live?.deed ?? "")).toBe("Sam tells Dev the pier floods at nine.");
    const dev = live?.exposure.find((x) => x.who === "dev");
    expect(dev).toMatchObject({ reach: "partial", pending: true });
    expect(stored.get(dev?.pov ?? "")).toBe(HEARD);
    // Dev lived the amended beat.
    expect(Object.keys(mindV2At(at.state, "dev").lived)).toContain(amended);
    // The GM linked what the amendment made canon and what Dev's catch-up wrote (conformance finding 6).
    expect(model.sent.gm?.[0]).toContain("Sam says the pier floods at nine.");
    expect(Object.values(readKnowledge(at.state).facts).map((f) => f.claim)).toEqual(["The pier floods at nine."]);

    // The same text again asks no one.
    expect((await replyEdited(rt, chat, userId, basis.message, `${EDITED}  `, { model })).cosmetic).toBeNull();
    expect(model.sent.author).toHaveLength(1);
    // The next edit reads the last as the reply was, beside the amended beat; a cosmetic one amends nothing.
    const again = await replyEdited(rt, chat, userId, basis.message, `${EDITED}!`, { model });
    expect(again).toMatchObject({ cosmetic: true, amended: [], struck: [], caughtUp: [] });
    expect(model.sent.author?.[1]).toContain(`The reply as it was:\n${EDITED}`);
    expect(model.sent.author?.[1]).toContain(NINE_WHAT);
    expect((await h.service.readEvents(chat, userId, [AUTHOR_EDIT])).map((e) => ("data" in e.event ? e.event.data.cosmetic : null))).toEqual([false, true]);
  });

  test("Undo on an amending edit (M-16): what it replaced and struck stands again as a reverse amendment, who lived the amendment catches up, and a second Undo is refused", async () => {
    const h = new Harness("fresh", { packs: [storyPack, authorPack] });
    const stored = new Map<string, string>([REPLY, EDITED, PIER, CUP].map((t) => [blobHash(t), t]));
    const rt = rtOf(h, stored);
    const userId = h.host.userId;
    const chat = await h.newChat();
    const greeting = await h.service.basisFor(chat, userId);
    if (!greeting) throw new Error("no greeting");
    const core = seedCore({ who: "dev", at: 0, source: "card", text: "Dev runs the cafe." });
    for (const t of Object.values(core.blobs)) stored.set(blobHash(t), t);
    expect((await h.service.landLayer(chat, userId, { id: "core", basis: greeting, kind: "minds.v2.write", events: core.events })).status).toBe("landed");
    await h.send(chat, "The pier floods at eight, Dev.");
    const basis = await h.service.basisFor(chat, userId);
    if (!basis) throw new Error("no basis");
    const passage = passageEvent({ moment: 0, index: 0, beats: ["pier", "cup"], pov: "sam", text: blobHash(REPLY), drafts: [{ text: blobHash(REPLY), faithful: true }] });
    expect((await h.service.landLayer(chat, userId, { id: "turn", basis, kind: "story.beat", events: [beatEvent(beat("pier", "sam", PIER, "dev")), beatEvent(beat("cup", "dev", CUP, "sam")), passage, mindLivedEvent({ who: "dev", beats: ["pier", "cup"], at: 600, mode: "play" })] })).status).toBe("landed");
    const amended = beatId(layerEntryId("edit", chat, basis.message, basis.swipe, "0", blobHash(EDITED)), "0");
    const model = port({
      author: [{ cosmetic: false, amend: [{ replaces: ["b1"], ref: "e1", by: "author", actors: ["sam"], act: "said", what: NINE_WHAT, deed: "Sam tells Dev the pier floods at nine.", surface: "Sam says the pier floods at nine.", quotes: "The pier floods at nine.", exposure: [{ who: "dev", channel: "hearing", reach: "partial" }] }], strike: ["b2"], why: "He moved the flood to nine." }],
      pov: [{ povs: { dev: HEARD } }],
      character: [{ memories: [{ lived: [amended], about: ["sam"], text: "Sam said something about the pier at nine." }] }, { memories: [{ lived: [], about: ["sam"], text: "Sam said the pier floods at eight after all." }] }],
    });
    expect(await replyEdited(rt, chat, userId, basis.message, EDITED, { model })).toMatchObject({ cosmetic: false, amended: [amended], struck: ["cup"] });

    const out = await editUndone(rt, chat, userId, basis.message, { amended: [amended], struck: ["cup"] }, { model });
    expect(out.failed).toEqual([]);
    const undo = layerEntryId("edit", chat, basis.message, basis.swipe, "undo", blobHash(JSON.stringify([[amended], ["cup"]])));
    const again = [beatId(undo, "pier"), beatId(undo, "cup")];
    expect(out.amended).toEqual(again);
    expect(out.caughtUp).toEqual(["dev"]);
    const at = await h.service.foldAtBasis(chat, userId, basis);
    if (!at) throw new Error("no fold");
    // The amendment is replaced; the pier and the cup stand again at their own minute, as they were written.
    const here = at.story.beats.filter((p) => p.from.messageId === basis.message).map((p) => p.beat);
    expect(here.map((b) => b.id).sort()).toEqual([...again].sort());
    expect(here.find((b) => b.id === again[0])).toMatchObject({ at: 600, what: blobHash(PIER), supersedes: [amended] });
    expect(here.find((b) => b.id === again[1])).toMatchObject({ what: blobHash(CUP), supersedes: [] });
    expect(at.story.replaced.map((r) => r.id)).toContain(amended);
    // Dev, who lived the amendment, lives the pier again, told how the amendment had reached him.
    expect(model.sent.character?.[1]).toContain(PIER);
    expect(model.sent.character?.[1]).toContain(HEARD);
    // The last edit is now the undo: the chip's Undo again is refused, and lands nothing.
    expect((await editUndone(rt, chat, userId, basis.message, { amended: [amended], struck: ["cup"] }, { model })).said).toContain("nothing was undone");
    expect((await h.service.readEvents(chat, userId, [AUTHOR_EDIT])).map((e) => ("data" in e.event ? e.event.data.amended : null))).toEqual([[amended], again]);
  });

  test("an edit held behind a swipe of the reply it amends waits for that swipe: refused as its window closes, it is said kept by no one, and no one catches up on it (the final correctness review, finding 3)", async () => {
    const h = new Harness("fresh", { packs: [storyPack, authorPack] });
    const stored = new Map<string, string>([REPLY, EDITED, PIER, CUP].map((t) => [blobHash(t), t]));
    const userId = h.host.userId;
    const chat = await h.newChat();
    const greeting = await h.service.basisFor(chat, userId);
    if (!greeting) throw new Error("no greeting");
    const core = seedCore({ who: "dev", at: 0, source: "card", text: "Dev runs the cafe." });
    for (const t of Object.values(core.blobs)) stored.set(blobHash(t), t);
    expect((await h.service.landLayer(chat, userId, { id: "core", basis: greeting, kind: "minds.v2.write", events: core.events })).status).toBe("landed");
    await h.send(chat, "The pier floods at eight, Dev.");
    const basis = await h.service.basisFor(chat, userId);
    if (!basis) throw new Error("no basis");
    const passage = passageEvent({ moment: 0, index: 0, beats: ["pier", "cup"], pov: "sam", text: blobHash(REPLY), drafts: [{ text: blobHash(REPLY), faithful: true }] });
    expect((await h.service.landLayer(chat, userId, { id: "turn", basis, kind: "story.beat", events: [beatEvent(beat("pier", "sam", PIER, "dev")), beatEvent(beat("cup", "dev", CUP, "sam")), passage, mindLivedEvent({ who: "dev", beats: ["pier", "cup"], at: 600, mode: "play" })] })).status).toBe("landed");
    // The amendment's landing is asked for while a swipe of the reply is in flight, started as the author reads the edit.
    const asked = Promise.withResolvers<void>();
    const ledger = new Proxy(h.service, {
      get(target, key) {
        const value = Reflect.get(target, key) as unknown;
        if (key !== "landLayer" || typeof value !== "function") return typeof value === "function" ? value.bind(target) : value;
        return (...args: Parameters<typeof target.landLayer>) => {
          const out = target.landLayer(...args);
          if (args[2].kind === "story.beat" && args[2].by?.role === "author") asked.resolve();
          return out;
        };
      },
    });
    const rt = { ...rtOf(h, stored), ledger };
    const answers = port({
      author: [{ cosmetic: false, amend: [{ replaces: ["b1"], ref: "e1", by: "author", actors: ["sam"], act: "said", what: NINE_WHAT, deed: "Sam tells Dev the pier floods at nine.", surface: "Sam says the pier floods at nine.", quotes: "The pier floods at nine.", exposure: [{ who: "dev", channel: "hearing", reach: "whole" }] }], strike: [], why: "He moved the flood to nine." }],
      character: [{ memories: [{ lived: ["pier"], text: "Sam said the pier floods at nine." }] }],
    });
    let swipe: Generation | undefined;
    const model = (async (role, messages, opts) => {
      if (role === "author" && !swipe) swipe = await h.host.start(chat, { type: "swipe", messageId: basis.message });
      return answers(role, messages, opts);
    }) as ModelPort;
    const editing = replyEdited(rt, chat, userId, basis.message, EDITED, { model });
    await asked.promise;
    // Whatever the chat's queue runs next runs after the amendment was held.
    await h.service.with(chat, userId, () => {});
    if (!swipe) throw new Error("no swipe");
    await h.host.finish(swipe, "Okay, at eight.");
    await h.host.settle();
    const out = await editing;
    // Refused as the swipe's window closed: nothing was amended, and Dev never caught up on an amendment that isn't canon.
    expect(out.said).toBe("The author's reading of the edit couldn't be kept: nothing was amended.");
    expect(out.caughtUp).toEqual([]);
    expect(answers.sent.character).toBeUndefined();
    expect(await h.service.readEvents(chat, userId, [AUTHOR_EDIT])).toEqual([]);
  });

  test("whoever lived a replaced beat rewrites every file that drew on it at the same path, and recall never returns the old version", async () => {
    const h = new Harness("fresh", { packs: [storyPack, authorPack] });
    const stored = new Map<string, string>([REPLY, EDITED, PIER, CUP].map((t) => [blobHash(t), t]));
    const rt = rtOf(h, stored);
    const userId = h.host.userId;
    const chat = await h.newChat();
    const greeting = await h.service.basisFor(chat, userId);
    if (!greeting) throw new Error("no greeting");
    const core = seedCore({ who: "dev", at: 0, source: "card", text: "Dev runs the cafe." });
    for (const t of Object.values(core.blobs)) stored.set(blobHash(t), t);
    expect((await h.service.landLayer(chat, userId, { id: "core", basis: greeting, kind: "minds.v2.write", events: core.events })).status).toBe("landed");
    await h.send(chat, "The pier floods at eight, Dev.");
    const basis = await h.service.basisFor(chat, userId);
    if (!basis) throw new Error("no basis");
    // Dev's mind from the turn: a memory of both beats, beliefs and his file on Sam from the pier and an older beat, plans from the older beat only.
    const files = [
      mindFileWrite({ who: "dev", path: memoryPath("dev", "pier-and-cup"), at: 600, mode: "play", lived: ["pier", "cup"], about: ["sam"] }, "Sam told me the pier floods at eight, and I set my cup down."),
      mindFileWrite({ who: "dev", path: mindPath("dev", "beliefs"), at: 600, mode: "play", lived: ["pier", "kettle"], about: [] }, "- The pier floods at eight. I'd swear to it.\n- The kettle whistles before it boils."),
      mindFileWrite({ who: "dev", path: personPath("dev", "sam"), at: 600, mode: "play", lived: ["kettle", "pier"], about: ["sam"] }, "Sam warned me the pier floods at eight. He fixed my kettle once."),
      mindFileWrite({ who: "dev", path: mindPath("dev", "plans"), at: 600, mode: "play", lived: ["kettle"], about: [] }, "- Fix the kettle."),
    ];
    for (const f of files) for (const t of Object.values(f.blobs)) stored.set(blobHash(t), t);
    const passage = passageEvent({ moment: 0, index: 0, beats: ["pier", "cup"], pov: "sam", text: blobHash(REPLY), drafts: [{ text: blobHash(REPLY), faithful: true }] });
    expect((await h.service.landLayer(chat, userId, { id: "turn", basis, kind: "story.beat", events: [beatEvent(beat("pier", "sam", PIER, "dev")), beatEvent(beat("cup", "dev", CUP, "sam")), passage, mindLivedEvent({ who: "dev", beats: ["pier", "cup"], at: 600, mode: "play" }), ...files.flatMap((f) => f.events)] })).status).toBe("landed");
    const eight = async (): Promise<string[]> => (await recallFor(rt, chat, userId, "dev", "the pier floods at eight", { limit: 100 })).map((hit) => hit.doc.text);
    // Before the edit, recall gives back the beat as it was, from the beat and from the files.
    expect((await eight()).filter((t) => t.includes("eight")).length).toBeGreaterThanOrEqual(4);

    const amended = beatId(layerEntryId("edit", chat, basis.message, basis.swipe, "0", blobHash(EDITED)), "0");
    const model = port({
      author: [{ cosmetic: false, amend: [{ replaces: ["b1"], ref: "e1", by: "author", actors: ["sam"], act: "said", what: NINE_WHAT, surface: "Sam says the pier floods at nine.", quotes: "The pier floods at nine.", exposure: [{ who: "dev", channel: "hearing", reach: "partial" }] }], strike: ["b2"], why: "He moved the flood to nine and took out the cup." }],
      pov: [{ povs: { dev: HEARD } }],
      // He rewrites the memory and the beliefs; his file on Sam he gives no verdict, asked twice.
      character: [
        { memories: [{ lived: [amended], about: ["sam"], text: "Sam said something about the pier at nine." }], rewrites: { "memories/pier-and-cup.md": { verdict: "rewrite", text: "Sam told me something about the pier at nine." }, [mindPath("dev", "beliefs")]: { verdict: "rewrite", text: "- The pier floods at nine, I think.\n- The kettle whistles before it boils." } } },
        { rewrites: {} },
      ],
    });
    const out = await replyEdited(rt, chat, userId, basis.message, EDITED, { model });
    expect(out).toMatchObject({ cosmetic: false, amended: [amended], struck: ["cup"], caughtUp: ["dev"], failed: [] });
    // The catch-up was given each file that drew on a replaced beat, and the old beat as it had reached him; never the plans, which drew on neither.
    const asked = model.sent.character?.[0] ?? "";
    expect(asked).toContain("### memories/pier-and-cup.md\nSam told me the pier floods at eight");
    expect(asked).toContain("### beliefs.md\n- The pier floods at eight");
    expect(asked).toContain("### people/sam.md\nSam warned me");
    expect(asked).not.toContain("### plans.md");
    expect(asked.split("## What went otherwise\n")[1]?.split("\n## ")[0]).toContain(PIER);
    // The file it gave no verdict on was asked about once more, alone.
    expect(model.sent.character).toHaveLength(2);
    const again = model.sent.character?.[1] ?? "";
    expect(again).toContain("### people/sam.md\nSam warned me");
    expect(again).not.toContain("### beliefs.md");
    expect(again).not.toContain("### memories/pier-and-cup.md");

    const at = await h.service.foldAtBasis(chat, userId, basis);
    if (!at) throw new Error("no fold");
    const mind = mindV2At(at.state, "dev");
    // Rewritten at the same path: what they drew on still, and the amendment, never a replaced beat.
    expect(mind.files["memories/pier-and-cup.md"]).toMatchObject({ rev: 2, mode: "catch-up", lived: [amended], about: ["sam"], supersedes: "pier" });
    expect(mind.files["beliefs.md"]).toMatchObject({ rev: 2, lived: ["kettle", amended], supersedes: "pier" });
    expect(stored.get(mind.files["memories/pier-and-cup.md"]?.hash ?? "")).toBe("Sam told me something about the pier at nine.");
    expect(mind.files["plans.md"]?.rev).toBe(1);
    expect(mind.files["people/sam.md"]?.rev).toBe(1);
    // Recall never gives back the old version: the rewrites hold the amendment, and the file left as it was stays out.
    const after = await eight();
    expect(after.filter((t) => t.includes("eight"))).toEqual([]);
    expect(after).toContain("Sam told me something about the pier at nine.");
    const corpus = livedCorpus({ who: "dev", mind, beats: exposedBeats(at.story).beats.filter((b) => hasOwn(mind.lived, b.id)), texts: Object.fromEntries(stored), replaced: exposedBeats(at.story).replaced });
    expect(corpus.map((d) => d.id)).not.toContain("file:people/sam.md");
    expect(corpus.some((d) => d.text.includes("eight"))).toBe(false);
    // Still without a verdict, it is out of his mind, flagged in Minds; the rewritten files aren't.
    const view = await mindView(rt, chat, userId, "dev");
    expect(view.files.filter((f) => f.out).map((f) => f.path)).toEqual(["people/sam.md"]);
  });

  test("a file the catch-up keeps stays in recall after the amendment, and the old beat's text never returns", async () => {
    const h = new Harness("fresh", { packs: [storyPack, authorPack] });
    const stored = new Map<string, string>([REPLY, EDITED, PIER, CUP].map((t) => [blobHash(t), t]));
    const rt = rtOf(h, stored);
    const userId = h.host.userId;
    const chat = await h.newChat();
    const greeting = await h.service.basisFor(chat, userId);
    if (!greeting) throw new Error("no greeting");
    const core = seedCore({ who: "dev", at: 0, source: "card", text: "Dev runs the cafe." });
    for (const t of Object.values(core.blobs)) stored.set(blobHash(t), t);
    expect((await h.service.landLayer(chat, userId, { id: "core", basis: greeting, kind: "minds.v2.write", events: core.events })).status).toBe("landed");
    await h.send(chat, "The pier floods at eight, Dev.");
    const basis = await h.service.basisFor(chat, userId);
    if (!basis) throw new Error("no basis");
    // His beliefs drew on the pier beside an older beat, though nothing in them came from the pier.
    const BELIEFS = "- The kettle whistles before it boils.\n- Sam always knows the tides.";
    const files = [
      mindFileWrite({ who: "dev", path: mindPath("dev", "beliefs"), at: 600, mode: "play", lived: ["kettle", "pier"], about: ["sam"] }, BELIEFS),
      mindFileWrite({ who: "dev", path: memoryPath("dev", "pier"), at: 600, mode: "play", lived: ["pier"], about: ["sam"] }, "Sam said the pier floods at eight."),
    ];
    for (const f of files) for (const t of Object.values(f.blobs)) stored.set(blobHash(t), t);
    const passage = passageEvent({ moment: 0, index: 0, beats: ["pier", "cup"], pov: "sam", text: blobHash(REPLY), drafts: [{ text: blobHash(REPLY), faithful: true }] });
    expect((await h.service.landLayer(chat, userId, { id: "turn", basis, kind: "story.beat", events: [beatEvent(beat("pier", "sam", PIER, "dev")), beatEvent(beat("cup", "dev", CUP, "sam")), passage, mindLivedEvent({ who: "dev", beats: ["pier", "cup"], at: 600, mode: "play" }), ...files.flatMap((f) => f.events)] })).status).toBe("landed");
    const recalled = async (cue: string): Promise<string[]> => (await recallFor(rt, chat, userId, "dev", cue, { limit: 100 })).map((hit) => hit.doc.text);
    expect(await recalled("kettle tides")).toContain(BELIEFS);

    const amended = beatId(layerEntryId("edit", chat, basis.message, basis.swipe, "0", blobHash(EDITED)), "0");
    const model = port({
      author: [{ cosmetic: false, amend: [{ replaces: ["b1"], ref: "e1", by: "author", actors: ["sam"], act: "said", what: NINE_WHAT, surface: "Sam says the pier floods at nine.", quotes: "The pier floods at nine.", exposure: [{ who: "dev", channel: "hearing", reach: "partial" }] }], strike: ["b2"], why: "He moved the flood to nine and took out the cup." }],
      pov: [{ povs: { dev: HEARD } }],
      // He keeps his beliefs as they are and rewrites the memory.
      character: [{ memories: [], rewrites: { "beliefs.md": { verdict: "keep" }, "memories/pier.md": { verdict: "rewrite", text: "Sam said something about the pier and nine." } } }],
    });
    expect(await replyEdited(rt, chat, userId, basis.message, EDITED, { model })).toMatchObject({ cosmetic: false, amended: [amended], caughtUp: ["dev"], failed: [] });
    // Every file had a verdict: nothing was asked again.
    expect(model.sent.character).toHaveLength(1);
    expect(model.sent.character?.[0]).toContain(`### beliefs.md\n${BELIEFS}`);

    const at = await h.service.foldAtBasis(chat, userId, basis);
    if (!at) throw new Error("no fold");
    const mind = mindV2At(at.state, "dev");
    // Kept: a write with the same body at the same path, drawing on what it drew on still, never the replaced beat.
    expect(mind.files["beliefs.md"]).toMatchObject({ rev: 2, mode: "catch-up", hash: blobHash(BELIEFS), lived: ["kettle"], about: ["sam"], supersedes: "pier" });
    // It is back in his mind and his recall; the old beat's text never returns.
    expect(await recalled("kettle tides")).toContain(BELIEFS);
    expect((await recalled("the pier floods at eight")).filter((t) => t.includes("eight"))).toEqual([]);
    const corpus = livedCorpus({ who: "dev", mind, beats: exposedBeats(at.story).beats.filter((b) => hasOwn(mind.lived, b.id)), texts: Object.fromEntries(stored), replaced: exposedBeats(at.story).replaced });
    expect(corpus.map((d) => d.id)).toContain("file:beliefs.md");
    expect(corpus.some((d) => d.text.includes(PIER) || d.text.includes("eight"))).toBe(false);
    expect((await mindView(rt, chat, userId, "dev")).files.filter((f) => f.out)).toEqual([]);
  });

  test("his edit of his own old message reads what he now says he did or said, amends the beats made from it at the message, and who lived them catches up", async () => {
    const h = new Harness("fresh", { packs: [storyPack, authorPack] });
    const SAID = "I tell Dev the pier floods at eight.";
    const NOW = "I tell Dev the pier floods at nine.";
    const stored = new Map<string, string>([SAID, NOW, PIER].map((t) => [blobHash(t), t]));
    const rt = rtOf(h, stored);
    const userId = h.host.userId;
    // A chat's history, never played: the bootstrap made beats from the player's own message too.
    const chat = h.host.createChat("Morning, Sam.");
    h.host.append(h.host.chat(chat), { id: "h1", isUser: true, name: "User", swipes: [SAID], swipeId: 0, bag: {} });
    h.host.append(h.host.chat(chat), { id: "h2", isUser: false, name: "Narrator", swipes: ["Dev nods."], swipeId: 0, bag: {} });
    await h.host.chats.mergeChatMetadata(chat, { [LEDGER_NAMESPACE]: { v: 1, worldId: "world-test", revision: h.revision, runSeed: `run-${chat}`, startedAt: 0 } }, userId);
    await h.service.open(chat, userId);
    const [greeting, said] = await h.service.chainBases(chat, userId);
    if (!greeting || said?.message !== "h1") throw new Error("no history");
    const core = seedCore({ who: "dev", at: 0, source: "card", text: "Dev runs the cafe." });
    for (const t of Object.values(core.blobs)) stored.set(blobHash(t), t);
    expect((await h.service.landLayer(chat, userId, { id: "core", basis: greeting, kind: "minds.v2.write", events: core.events })).status).toBe("landed");
    expect((await h.service.landLayer(chat, userId, { id: "boot-h1", basis: said, kind: "story.beat", events: [beatEvent({ ...beat("pier", "sam", PIER, "dev"), by: { bootstrap: { message: "h1", swipe: said.swipe } } }), mindLivedEvent({ who: "dev", beats: ["pier"], at: 600, mode: "play" })] })).status).toBe("landed");
    // He changes what he said; the message keeps what was made from it.
    h.host.editMessage(chat, "h1", NOW);
    await h.host.settle();
    expect((await h.service.basisFor(chat, userId, "h1"))?.swipe).toBe(said.swipe);

    const amended = beatId(layerEntryId("edit", chat, "h1", said.swipe, "0", blobHash(NOW)), "0");
    const model = port({
      author: [{ cosmetic: false, amend: [{ replaces: ["b1"], ref: "e1", by: "author", actors: ["sam"], act: "said", what: NINE_WHAT, deed: "Sam tells Dev the pier floods at nine.", surface: "Sam says the pier floods at nine.", quotes: "The pier floods at nine.", exposure: [{ who: "dev", channel: "hearing", reach: "whole" }] }], strike: [], why: "He now says he told Dev nine." }],
      character: [{ memories: [{ lived: [amended], about: ["sam"], text: "Sam told me the pier floods at nine." }] }],
    });
    const out = await replyEdited(rt, chat, userId, "h1", NOW, { model });
    expect(out).toMatchObject({ cosmetic: false, amended: [amended], struck: [], caughtUp: ["dev"], failed: [] });
    // The author read it as his own message: what he now says he did or said, beside the beats made from it, never as a reply.
    const asked = model.sent.author?.[0] ?? "";
    expect(asked).toContain("The player edited his own message");
    expect(asked).toContain(`The beats made from his message:\n- (b1)`);
    expect(asked).toContain("His message as it was:\n(LumiRPEngine doesn't keep his message as it was; the beats above are what was made from it.)");
    expect(asked).toContain(`His message as he now made it, what he now says he did or said:\n${NOW}`);
    expect(asked).not.toContain("reply");

    // The amendment lands at his message; Dev's catch-up, at the chat's head.
    const head = await h.service.basisFor(chat, userId);
    const at = head ? await h.service.foldAtBasis(chat, userId, head) : null;
    if (!at) throw new Error("no fold");
    expect(at.story.beats.filter((p) => p.from.messageId === "h1").map((p) => p.beat.id)).toEqual([amended]);
    expect(at.story.replaced.map((r) => r.id)).toEqual(["pier"]);
    expect(Object.keys(mindV2At(at.state, "dev").lived)).toContain(amended);
    // His next edit reads this one as his message was.
    await replyEdited(rt, chat, userId, "h1", `${NOW}!`, { model });
    expect(model.sent.author?.[1]).toContain(`His message as it was:\n${NOW}`);
  });

  test("his edit of his own old message on a played chat pauses nothing: who lived the beat it replaced catches up and rewrites what drew on it, the GM links the amendment, and every later reply keeps its record", async () => {
    const h = new Harness("fresh", { packs: [storyPack, authorPack] });
    const SAID = "I tell Dev the pier floods at eight.";
    const NOW = "I tell Dev the pier floods at nine.";
    const stored = new Map<string, string>([SAID, NOW, PIER].map((t) => [blobHash(t), t]));
    const rt = rtOf(h, stored);
    const userId = h.host.userId;
    const chat = h.host.createChat("Morning, Sam.");
    h.host.append(h.host.chat(chat), { id: "h1", isUser: true, name: "User", swipes: [SAID], swipeId: 0, bag: {} });
    h.host.append(h.host.chat(chat), { id: "h2", isUser: false, name: "Narrator", swipes: ["Dev nods."], swipeId: 0, bag: {} });
    await h.host.chats.mergeChatMetadata(chat, { [LEDGER_NAMESPACE]: { v: 1, worldId: "world-test", revision: h.revision, runSeed: `run-${chat}`, startedAt: 0 } }, userId);
    await h.service.open(chat, userId);
    const [greeting, said] = await h.service.chainBases(chat, userId);
    if (!greeting || said?.message !== "h1") throw new Error("no history");
    const core = seedCore({ who: "dev", at: 0, source: "card", text: "Dev runs the cafe." });
    for (const t of Object.values(core.blobs)) stored.set(blobHash(t), t);
    expect((await h.service.landLayer(chat, userId, { id: "core", basis: greeting, kind: "minds.v2.write", events: core.events })).status).toBe("landed");
    // The bootstrap's beat of what he said, which Dev lived and remembers.
    expect((await h.service.landLayer(chat, userId, { id: "boot-h1", basis: said, kind: "story.beat", events: [beatEvent({ ...beat("pier", "sam", PIER, "dev"), by: { bootstrap: { message: "h1", swipe: said.swipe } } }), mindLivedEvent({ who: "dev", beats: ["pier"], at: 600, mode: "play" })] })).status).toBe("landed");
    const memory = mindFileWrite({ who: "dev", path: memoryPath("dev", "pier"), at: 600, mode: "catch-up", lived: ["pier"], about: ["sam"] }, "Sam told me the pier floods at eight.");
    for (const t of Object.values(memory.blobs)) stored.set(blobHash(t), t);
    expect((await h.service.landLayer(chat, userId, { id: "boot-memory", basis: said, kind: "minds.v2.write", events: memory.events })).status).toBe("landed");
    // Play went on after the history: a turn with its record.
    await h.send(chat, "I walk on to the pier.", "The boards creak.");
    const reply = (await h.chain(chat)).at(-1);
    const seq = reply ? (await h.core(chat)).journal.messages[reply.id]?.ledger.swipes[String(reply.swipeId)]?.seq : undefined;
    if (!reply || seq === undefined) throw new Error("no record after the history");

    // He changes what he said there: his directive, so nothing pauses and nothing is offered to discard.
    h.host.editMessage(chat, "h1", NOW);
    await h.host.settle();
    expect((await h.core(chat)).journal.pauses).toEqual([]);
    const amended = beatId(layerEntryId("edit", chat, "h1", said.swipe, "0", blobHash(NOW)), "0");
    const model = port({
      author: [{ cosmetic: false, amend: [{ replaces: ["b1"], ref: "e1", by: "author", actors: ["sam"], act: "said", what: NINE_WHAT, deed: "Sam tells Dev the pier floods at nine.", surface: "Sam says the pier floods at nine.", quotes: "The pier floods at nine.", exposure: [{ who: "dev", channel: "hearing", reach: "whole" }] }], strike: [], why: "He now says he told Dev nine." }],
      character: [{ memories: [], rewrites: { "memories/pier.md": { verdict: "rewrite", text: "Sam told me the pier floods at nine." } } }],
    });
    const out = await replyEdited(rt, chat, userId, "h1", NOW, { model });
    // Dev caught up at the chat's head, and the GM linked what the amendment made canon there.
    expect(out).toMatchObject({ cosmetic: false, amended: [amended], struck: [], caughtUp: ["dev"], failed: [] });
    expect(model.sent.character?.[0]).toContain("### memories/pier.md\nSam told me the pier floods at eight.");
    expect(model.sent.gm?.[0]).toContain("the pier floods at nine");
    // His memory of the old beat is rewritten at its path, never left out of his mind.
    const head = await h.service.basisFor(chat, userId);
    const at = head ? await h.service.foldAtBasis(chat, userId, head) : null;
    if (!at) throw new Error("no fold");
    expect(stored.get(mindV2At(at.state, "dev").files["memories/pier.md"]?.hash ?? "")).toBe("Sam told me the pier floods at nine.");
    expect((await mindView(rt, chat, userId, "dev")).files.filter((f) => f.out)).toEqual([]);
    // The reply played after it keeps its record.
    const after = await h.core(chat);
    expect(after.journal.tombstones).toEqual([]);
    expect(after.journal.messages[reply.id]?.ledger.swipes[String(reply.swipeId)]?.seq).toBe(seq);
  });

  test("the author orders who catches up after an amendment (S9): one it leaves out waits for its poll, out of mind", async () => {
    const h = new Harness("fresh", { packs: [storyPack, authorPack] });
    const stored = new Map<string, string>([REPLY, EDITED, PIER, CUP].map((t) => [blobHash(t), t]));
    const rt = rtOf(h, stored);
    const userId = h.host.userId;
    const chat = await h.newChat();
    const greeting = await h.service.basisFor(chat, userId);
    if (!greeting) throw new Error("no greeting");
    const core = seedCore({ who: "dev", at: 0, source: "card", text: "Dev runs the cafe." });
    for (const t of Object.values(core.blobs)) stored.set(blobHash(t), t);
    expect((await h.service.landLayer(chat, userId, { id: "core", basis: greeting, kind: "minds.v2.write", events: core.events })).status).toBe("landed");
    await h.send(chat, "The pier floods at eight, Dev.");
    const basis = await h.service.basisFor(chat, userId);
    if (!basis) throw new Error("no basis");
    const passage = passageEvent({ moment: 0, index: 0, beats: ["pier", "cup"], pov: "sam", text: blobHash(REPLY), drafts: [{ text: blobHash(REPLY), faithful: true }] });
    expect((await h.service.landLayer(chat, userId, { id: "turn", basis, kind: "story.beat", events: [beatEvent(beat("pier", "sam", PIER, "dev")), beatEvent(beat("cup", "dev", CUP, "sam")), passage, mindLivedEvent({ who: "dev", beats: ["pier", "cup"], at: 600, mode: "play" })] })).status).toBe("landed");
    const model = port({
      author: [{ cosmetic: false, amend: [], strike: ["b2"], catchup: [], why: "He took out the cup; Dev can catch up when the poll says so." }],
      character: [{ memories: [{ lived: ["pier"], about: [], text: "Never asked." }] }],
    });
    const out = await replyEdited(rt, chat, userId, basis.message, EDITED, { model });
    expect(out).toMatchObject({ cosmetic: false, struck: ["cup"], caughtUp: [], failed: [] });
    // The author was told who lived the beats; no one it left out was asked anything.
    expect(model.sent.author?.[0]).toContain("Who lived these beats with a mind of their own:");
    expect(model.sent.author?.[0]).toContain("dev");
    expect(model.sent.character).toBeUndefined();
  });
});
