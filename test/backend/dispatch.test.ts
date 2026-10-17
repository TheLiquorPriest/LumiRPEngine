// The protocol surface on the fake host: ✎ fixes, marker previews and writes, Keep/Discard of a
// pause, world export/import and Upgrade, lint, and background-lane jobs (Playtest, Check world).

import { describe, expect, test } from "bun:test";
import { isRecord } from "../../src/shared/json";
import { toChain } from "../../src/backend/ledger-io";
import { Rig } from "../support/rig";
import { POV } from "../support/test-pack";

async function stateOf(rig: Rig, chatId: string) {
  const core = await rig.rt.ledger.core(chatId, rig.host.userId);
  if (!core) throw new Error("no core");
  return core.fold(toChain(await rig.host.chats.messages(chatId, rig.host.userId))).state;
}

describe("dispatch", () => {
  test("a ✎ fix writes a post entry; an invalid fix is refused", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    await rig.turn(chatId, "look around", "Quiet.");
    expect(rig.body(await rig.send({ type: "lre.fix", chatId, entity: POV, field: "mood", value: "calm" })).pending).toBe(false);
    expect(await rig.moodOf(chatId)).toBe("calm");
    const bad = await rig.send({ type: "lre.fix", chatId, entity: "nobody", field: "mood", value: "calm" });
    expect(bad.type).toBe("lre.error");
  });

  test("a marker preview writes nothing; the marker itself lands on the head", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    await rig.turn(chatId, "look around", "Quiet.");
    const core = await rig.rt.ledger.core(chatId, rig.host.userId);
    const head = rig.host.head(chatId);
    if (!core || !head) throw new Error("no chat");
    const markers = (): number => core.journal.messages[head.id]?.ledger.markers.length ?? 0;
    const before = markers();
    const preview = rig.body(await rig.send({ type: "lre.marker", chatId, preview: true, kind: "time", control: "scale", scope: { all: true }, to: 2 }));
    expect(isRecord(preview.preview)).toBe(true);
    expect(markers()).toBe(before);
    rig.body(await rig.send({ type: "lre.marker", chatId, kind: "time", control: "scale", scope: { all: true }, to: 2 }));
    expect(markers()).toBe(before + 1);
  });

  test("an earlier user edit pauses; Keep and Discard resolve the pause", async () => {
    for (const choice of ["keep", "discard"] as const) {
      const rig = new Rig();
      const chatId = await rig.worldChat();
      await rig.turn(chatId, "earn:15", "Paid.");
      await rig.turn(chatId, "look around", "Quiet.");
      const firstUser = rig.host.chat(chatId).messages.find((m) => m.isUser);
      if (!firstUser) throw new Error("no user message");
      rig.host.editMessage(chatId, firstUser.id, "earn:20");
      await rig.host.settle();
      const core = await rig.rt.ledger.core(chatId, rig.host.userId);
      expect(core?.journal.pauses.length).toBe(1);
      expect((await rig.rt.view(chatId, rig.host.userId)).status).toBe("paused");
      rig.body(await rig.send({ type: "lre.keep", chatId, choice, messageId: firstUser.id }));
      expect(core?.journal.pauses.length).toBe(0);
      expect(rig.rt.ledger.errors).toEqual([]);
    }
  });

  test("export then import makes an equal world under a new id; lint runs on demand", async () => {
    const rig = new Rig();
    const worldId = await rig.newWorld("Exported");
    const file = rig.body(await rig.send({ type: "lre.world", op: "export", worldId })).file;
    if (!isRecord(file) || !isRecord(file.world)) throw new Error("no export file");
    expect(file.format).toBe("lre-world-export-v1");
    const imported = rig.body(await rig.send({ type: "lre.world", op: "import", file }));
    if (!isRecord(imported.world)) throw new Error("no imported world");
    expect(imported.world.id).not.toBe(worldId);
    expect(imported.world.entities).toEqual(file.world.entities);
    const lint = rig.body(await rig.send({ type: "lre.world", op: "lint", worldId })).lint;
    expect(Array.isArray(lint)).toBe(true);
    const listed = rig.body(await rig.send({ type: "lre.world", op: "list" })).worlds;
    expect(Array.isArray(listed) ? listed.length : 0).toBe(2);
  });

  test("a committed draft is a new revision; Upgrade moves an open chat onto it", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    await rig.turn(chatId, "look around", "Quiet.");
    const run = await rig.rt.runOf(chatId, rig.host.userId);
    if (!run) throw new Error("no run");
    const draft = rig.body(await rig.send({ type: "lre.editor", op: "get", worldId: run.worldId, base: null }));
    rig.body(await rig.send({ type: "lre.editor", op: "set", worldId: run.worldId, base: draft.base, part: "meta", value: { lenientPricing: true } }));
    const committed = rig.body(await rig.send({ type: "lre.world", op: "commit", worldId: run.worldId, base: draft.base }));
    expect(typeof committed.revision).toBe("string");
    expect(committed.revision).not.toBe(run.revision);
    rig.body(await rig.send({ type: "lre.world", op: "upgrade", chatId, to: committed.revision }));
    expect((await stateOf(rig, chatId)).revision).toBe(String(committed.revision));
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("an open chat pins only the revisions its ledger references, not every revision its world has had", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    await rig.turn(chatId, "look around", "Quiet.");
    const run = await rig.rt.runOf(chatId, rig.host.userId);
    if (!run) throw new Error("no run");
    const committed: string[] = [];
    for (let i = 0; i < 12; i++) {
      const draft = rig.body(await rig.send({ type: "lre.editor", op: "get", worldId: run.worldId, base: null }));
      rig.body(await rig.send({ type: "lre.editor", op: "set", worldId: run.worldId, base: draft.base, part: "meta", value: { name: `Riverton ${i}` } }));
      committed.push(String(rig.body(await rig.send({ type: "lre.world", op: "commit", worldId: run.worldId, base: draft.base })).revision));
    }
    expect((await rig.rt.worlds.index(run.worldId, rig.host.userId))?.revisions.length).toBe(13);
    await rig.turn(chatId, "wait", "Time passes.");
    expect(rig.rt.pinnedRevisions(chatId, rig.host.userId)).toEqual([run.revision]);
    // Upgrade to one of them: it is loaded and pinned, the rest are not.
    const target = committed[4] ?? "";
    rig.body(await rig.send({ type: "lre.world", op: "upgrade", chatId, to: target }));
    await rig.turn(chatId, "wait again", "More time passes.");
    expect((await stateOf(rig, chatId)).revision).toBe(target);
    expect(rig.rt.pinnedRevisions(chatId, rig.host.userId).sort()).toEqual([run.revision, target].sort());
    // Reopened (its slot dropped), it pins what its chain references: the run's and the migrate target.
    rig.rt.ledger.forget(chatId);
    await rig.turn(chatId, "and again", "Still quiet.");
    expect(rig.rt.pinnedRevisions(chatId, rig.host.userId).sort()).toEqual([run.revision, target].sort());
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("Check world and Playtest run on the background lane and report through job updates", async () => {
    const rig = new Rig();
    const worldId = await rig.newWorld();
    for (const [kind, input] of [
      ["check_world", { days: 2 }],
      ["playtest", { turns: ["look around"] }],
    ] as const) {
      const before = new Set(rig.host.processMail.keys());
      const jobId = rig.body(await rig.send({ type: "lre.job", op: "start", kind, worldId, input })).jobId;
      await rig.host.settle();
      const processId = [...rig.host.processMail.keys()].find((k) => !before.has(k));
      if (!processId || typeof jobId !== "string") throw new Error("no lane spawned");
      rig.host.reply(processId, { jobId, progress: 0.5 });
      rig.host.reply(processId, { jobId, done: true, result: { turns: [{ user: "Day 1", reply: "(nothing happened)", notes: [] }], lint: [] } });
      const updates = rig.host.sent.filter((m) => m.type === "lre.job.update" && m.jobId === jobId);
      expect(updates.map((u) => (u.type === "lre.job.update" ? u.status : ""))).toEqual(["running", "running", "done"]);
    }
  });
});
