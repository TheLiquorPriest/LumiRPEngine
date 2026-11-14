// Item 1's history: a further revision of the test world (one more lore entry), the classic chat
// upgraded to it (an Upgrade marker in its ledger), and a draft left standing uncommitted, made by
// saving the chat's latest reply as lore (`lumirpengine lore-save`, Play's "Keep as lore").

import type { Step } from "../lib/context";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { chatOf } from "./chats";
import { worldIdOf } from "./world";
import { secondRevision } from "./world-parts";

export const revision: Step = {
  name: "revision",
  makes: "a further world revision, a chat upgraded to it, and a draft left standing",
  async run(ctx) {
    const worldId = await worldIdOf(ctx, false);
    const chatId = await chatOf(ctx, "classic");
    if (chatId === null) throw new Error("the chats step must run first");

    await ctx.log.once("revision:commit", async () => {
      const head = await ctx.socket.lre<{ world?: { lore?: { [id: string]: unknown } } }>("lre.world", { op: "get", worldId });
      if (head.world?.lore?.lore_watch_whistle !== undefined) return;
      const opsFile = join(ctx.env.instanceDir, "revision-ops.json");
      writeFileSync(opsFile, JSON.stringify(secondRevision()), { mode: 0o600 });
      await ctx.cli.run(["edit", worldId, "--ops", opsFile]);
      const committed = await ctx.cli.run<{ revision?: string }>(["commit", worldId, "--note", "Test instance: the Harbor Watch whistle"]);
      ctx.log.log({ step: "revision", action: "changed", kind: "world revision (commit)", id: worldId, detail: { revision: committed.revision ?? null } });
    });
    await ctx.log.once("revision:upgrade", async () => {
      const head = await ctx.socket.lre<{ revision?: string }>("lre.world", { op: "get", worldId });
      if (head.revision === undefined) throw new Error("the world names no head revision");
      const upgraded = await ctx.cli.run<{ from?: string; revision?: string }>(["upgrade", chatId, "--to", head.revision]);
      ctx.log.log({ step: "revision", action: "changed", kind: "chat upgraded (migrate marker)", id: chatId, detail: { from: upgraded.from ?? null, to: upgraded.revision ?? head.revision } });
    });
    await ctx.log.once("revision:draft", async () => {
      const saved = await ctx.cli.run<{ id?: string; entryId?: string; version?: number }>(["lore-save", chatId]);
      ctx.log.log({ step: "revision", action: "changed", kind: "world draft left uncommitted (lore saved from a chat)", id: worldId, detail: { entry: saved.id ?? saved.entryId ?? null, version: saved.version ?? null, chatId } });
    });
  },
};
