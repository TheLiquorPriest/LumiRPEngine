// The player's edit of a mind file lands as a GM edit with Undo (DEPTH-PLAN §7): GM → Minds' edit
// answers the chip that undoes it, GM → This chat's edits list it with that chip, and its Undo lands
// an entry superseding the edit's while it stands at the chat's head, so the file reads as it did
// before. Once a later reply is kept, its Undo lands a new GM edit at the head restoring the text as
// it was before the edit. Each edit reaches the author's next context as a directive: whose mind,
// which file, a short diff.

import { describe, expect, test } from "bun:test";
import type { DepthMindView } from "../../src/shared/depth-views";
import type { GmView } from "../../src/shared/state-view";
import { foldAt } from "../../src/backend/character-engine";
import { readNotebook } from "../../src/backend/depth/notebook";
import { notebookText } from "../../src/backend/depth/scene/author";
import { alderChat, DANNY, PRIYA } from "../support/mind-chat";
import { Rig } from "../support/rig";

const BELIEF = "- Priya owes me for the brake job.";
const EARLIER = "- Priya is square with me.";

describe("the player's edit of a mind file", () => {
  test("comes with an Undo that lands an entry superseding it, while it stands at the chat's head", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await alderChat(rig, async () => {}, [DANNY, PRIYA]);
    const file = async (path: string): Promise<DepthMindView["files"][number] | undefined> => ((rig.body(await rig.send({ type: "lre.depth", op: "mind", chatId, who: DANNY })).mind as DepthMindView).files ?? []).find((f) => f.path === path);
    const edits = async (): Promise<GmView["edits"]> => rig.body(await rig.send({ type: "lre.gm.part", chatId, part: "edits" })).value as GmView["edits"];
    const edit = async (text: string): Promise<string> => {
      const done = rig.body(await rig.send({ type: "lre.depth", op: "mind_edit", chatId, who: DANNY, path: "beliefs.md", text }));
      expect(done.pending).toBeUndefined();
      if (typeof done.undo !== "string") throw new Error(`no Undo: ${JSON.stringify(done)}`);
      return done.undo;
    };

    const undo = await edit(BELIEF);
    expect(undo).toMatch(/^mind_edit:l[0-9a-f]{31}$/);
    expect(await file("beliefs.md")).toMatchObject({ text: BELIEF, pinned: true });
    // GM → This chat lists it among the edits in force with that chip, so the edit's notice keeps its Undo (`noticeStands`).
    expect((await edits()).filter((e) => e.entry !== undefined)).toEqual([{ messageId: expect.any(String), entry: undo.slice("mind_edit:".length), lines: ["Danny Okafor's mind: beliefs.md, as you wrote it"], undo }]);

    expect(rig.body(await rig.send({ type: "lre.chip", chatId, chip: undo, choice: "undo" }))).toMatchObject({ applied: true, pending: false });
    expect(await file("beliefs.md")).toBeUndefined();
    expect((await edits()).filter((e) => e.entry !== undefined)).toEqual([]);
    // Undone, it no longer stands: a second Undo finds nothing to take back.
    expect((await rig.send({ type: "lre.chip", chatId, chip: undo, choice: "undo" })).type).toBe("lre.error");

    // The author reads each edit standing as a directive: whose mind, which file, and what changed.
    const told = async (): Promise<string> => notebookText(await readNotebook(rig.rt, rig.host.userId, (await foldAt(rig.rt, chatId, rig.host.userId)).state));
    await edit(EARLIER);
    const kept = await edit(BELIEF);
    const directive = await told();
    expect(directive).toContain("The player edited characters' minds (each a directive):");
    expect(directive).toContain(`### ${DANNY}: beliefs.md\n- ${EARLIER}\n+ ${BELIEF}`);

    // An edit kept past a later reply stays, and its Undo lands a new GM edit at the head restoring the text before it.
    rig.host.sendUser(chatId, "I open up the shop.");
    await rig.host.settle();
    await rig.host.finish(await rig.host.start(chatId, { type: "normal" }), "The shop opens.");
    await rig.host.settle();
    expect((await edits()).filter((e) => e.entry !== undefined).map((e) => e.undo)).toEqual([kept, expect.stringMatching(/^mind_edit:/)]);
    expect(rig.body(await rig.send({ type: "lre.chip", chatId, chip: kept, choice: "undo" }))).toMatchObject({ applied: true, pending: false });
    expect(await file("beliefs.md")).toMatchObject({ text: EARLIER, pinned: true });
    expect(await told()).toContain(`### ${DANNY}: beliefs.md\n- ${BELIEF}\n+ ${EARLIER}`);
    // Undone past the head, the edit has no Undo left; a second press lands nothing and says it is already undone.
    const listed = (await edits()).filter((e) => e.entry !== undefined);
    expect(listed).toHaveLength(3);
    expect(listed.find((e) => e.undo === null)?.entry).toBe(kept.slice("mind_edit:".length));
    const again = await rig.send({ type: "lre.chip", chatId, chip: kept, choice: "undo" });
    expect(again.type).toBe("lre.error");
    expect(JSON.stringify(again)).toContain("That edit is already undone");
    expect(await file("beliefs.md")).toMatchObject({ text: EARLIER, pinned: true, revisions: 3 });
    expect((await edits()).filter((e) => e.entry !== undefined)).toHaveLength(3);
  });
});
