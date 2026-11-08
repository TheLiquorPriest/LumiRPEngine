// GM → Notebook's poll and predictions, and GM → Minds' efforts, working memory and interviews
// (DEPTH-PLAN §6.4, §7; conformance finding 9), read from the author's records and the minds' events
// on the active chain: every poll newest first with what it considered, the jobs it asked for by name
// and the author's thinking; each prediction with how a later poll scored it (open until one does);
// the effort a character played its latest scene at, and every scene's effort with the author's
// reason, newest first; its takes not yet remembered; and every interview kept, newest first.

import { describe, expect, test } from "bun:test";
import { seedCore } from "../../src/backend/character-agent";
import { mindsView, mindView, type EngineRt } from "../../src/backend/character-engine";
import { mindInterviewEvent, mindTakeEvent } from "../../src/shared/character-engine";
import { notebookView } from "../../src/backend/depth/notebook";
import { BootstrapFiles } from "../../src/backend/bootstrap/files";
import { draftsView } from "../../src/backend/depth/drafts-view";
import { defaultSettings } from "../../src/backend/settings-store";
import { pollEvent, predictEvent, scoreEvent } from "../../src/shared/author";
import { sceneEvent } from "../../src/shared/scene";
import { blobHash } from "../../src/shared/stores";
import authorPack from "../../src/packs/author/core/index";
import storyPack from "../../src/packs/story/core/index";
import { Harness } from "../support/harness";

describe("the Notebook's poll and predictions, and the Minds' efforts", () => {
  test("read from the author's records and the scenes on the chain", async () => {
    const h = new Harness("fresh", { packs: [storyPack, authorPack] });
    const stored = new Map<string, string>();
    const rt: EngineRt = {
      host: h.host,
      registry: h.registry,
      blobs: { get: async (_u, hash) => stored.get(hash) ?? null, put: async (_u, text) => (stored.set(blobHash(text), text), blobHash(text)) },
      settings: { get: async () => defaultSettings() },
      ledger: h.service,
    };
    const userId = h.host.userId;
    const chat = await h.newChat();
    const greeting = await h.service.basisFor(chat, userId);
    if (!greeting) throw new Error("no greeting");
    const core = seedCore({ who: "dev", at: 0, source: "card", text: "Dev runs the cafe." });
    for (const t of Object.values(core.blobs)) stored.set(blobHash(t), t);
    // A scene Dev played as his own agent, the poll after it, and a prediction it scored.
    expect((await h.service.landLayer(chat, userId, { id: "one", basis: greeting, kind: "story.beat", events: [...core.events, sceneEvent({ scene: "s1", place: "home", at: 600, cast: [{ who: "dev", effort: "agent", why: "the warning is his" }], opens: true }), predictEvent({ id: "p1", text: "Dev closes early.", about: ["dev"], from: "scene" })] })).status).toBe("landed");
    await h.send(chat, "See you at eight.");
    const b2 = await h.service.basisFor(chat, userId);
    if (!b2) throw new Error("no basis");
    // His take on the evening (working memory until he remembers it), an interview kept as a probe, and the poll that asked him to catch up, with its thinking kept.
    const take = mindTakeEvent({ who: "dev", at: 620, lived: [], take: "She means it about eight." });
    const asked = mindInterviewEvent({ who: "dev", at: 640, by: "gm", question: "Will you open tomorrow?", answer: "If the boat's still there.", neutral: false });
    const thinking = "Dev heard the warning first; Dale's boat can wait.";
    for (const t of [...Object.values(take.blobs), ...Object.values(asked.blobs), thinking]) stored.set(blobHash(t), t);
    const jobs = [
      { kind: "catchup" as const, who: "dev", why: "he heard the warning" },
      { kind: "episode" as const, episode: "ep-harbour", why: "the harbour at night" },
    ];
    expect((await h.service.landLayer(chat, userId, { id: "two", basis: b2, kind: "story.beat", reasoning: blobHash(thinking), events: [sceneEvent({ scene: "s1", place: "home", at: 620, cast: [{ who: "dev", effort: "agent", why: "still his" }] }), take.event, asked.event, sceneEvent({ scene: "s2", place: "home", at: 700, cast: [{ who: "dev", effort: "author", why: "a quiet evening" }], opens: true }), pollEvent({ through: b2.message, considered: [{ what: "Dale's boat", raised: false, why: "nothing presses yet" }], jobs }), scoreEvent({ prediction: "p1", outcome: "hit", note: "He closed at seven." }), predictEvent({ id: "p2", text: "Sam goes to the pier.", about: ["sam"], from: "scene" })] })).status).toBe("landed");

    const devName = (await mindsView(rt, chat, userId)).characters.find((c) => c.id === "dev")?.name ?? "dev";
    const notebook = await notebookView({ host: h.host, blobs: rt.blobs, ledger: h.service }, chat, userId);
    expect(notebook.on).toBe(true);
    expect(notebook.poll).toEqual([
      {
        at: "after message 2",
        considered: [{ what: "Dale's boat", raised: false, why: "nothing presses yet" }],
        jobs: [
          { kind: "catchup", subject: devName, why: "he heard the warning" },
          { kind: "episode", subject: "An episode not drafted yet", why: "the harbour at night" },
        ],
        note: "",
        reasoning: thinking,
      },
    ]);
    expect(notebook.predictions).toEqual([
      { at: "after message 2", text: "Sam goes to the pier.", outcome: "pending", note: "" },
      { at: "after message 0", text: "Dev closes early.", outcome: "hit", note: "He closed at seven." },
    ]);

    expect((await mindsView(rt, chat, userId)).characters.find((c) => c.id === "dev")?.effort).toBe("author");
    // One row per scene and effort: the second turn of the first scene kept the same effort.
    const mind = await mindView(rt, chat, userId, "dev");
    expect(mind.efforts.map((e) => [e.scene, e.effort, e.why])).toEqual([
      ["Home", "author", "a quiet evening"],
      ["Home", "agent", "the warning is his"],
    ]);
    expect(mind.takes.map((t) => [t.text, t.beat])).toEqual([["She means it about eight.", null]]);
    expect(mind.interviews.map((p) => [p.by, p.question, p.answer, p.neutral])).toEqual([["gm", "Will you open tomorrow?", "If the boat's still there.", false]]);
  });

  test("a chat on depth reads as on before the author has written anything, as Drafts reads it", async () => {
    const h = new Harness("fresh", { packs: [storyPack, authorPack] });
    const userId = h.host.userId;
    const chat = await h.newChat();
    const rt = { host: h.host, blobs: { get: async () => null, put: async (_u: string, text: string) => blobHash(text) }, ledger: h.service };
    expect((await notebookView(rt, chat, userId)).on).toBe(false);
    await new BootstrapFiles(h.host, chat, userId).write("depth.json", { on: true });
    const view = await notebookView(rt, chat, userId);
    expect(view.on).toBe(true);
    expect(view.files).toEqual([]);
    expect((await draftsView({ ...rt, registry: h.registry, settings: { get: async () => defaultSettings() } }, chat, userId)).on).toBe(true);
  });
});
