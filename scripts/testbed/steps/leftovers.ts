// Items 14 and 15. A chat given the test world and a staged palette tap (so the engine keeps run data
// for it: its journal and its staged action), then deleted in Lumiverse: today's build purges
// nothing of `runs/<chat>/` when a chat goes. And one file placed by hand in the engine's storage
// that no row of the migration's inventory names, so the migration's report must catch it; it is
// the only file the scripts write into the engine's storage themselves.

import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Step } from "../lib/context";
import { userStorage } from "../lib/env";
import { say } from "../lib/record";
import { newWorldChat } from "./chats";

const DELETED_NAME = "Port Alder test · deleted";
/** The hand-placed file, at the top of the engine's per-user storage. */
export const UNNAMED_FILE = "testbed-unclassified.txt";

export const leftovers: Step = {
  name: "leftovers",
  makes: "run data of a chat since deleted, and one file no inventory row names",
  async run(ctx) {
    await ctx.log.once("leftovers:deleted-chat", async () => {
      const chatId = await newWorldChat(ctx, "deleted", DELETED_NAME);
      const staged = await ctx.socket.lre<{ staged?: boolean }>("lre.action", { chatId, action: "go", params: { to: "alder_harbor_marina" }, source: "palette" });
      ctx.log.log({ step: "leftovers", action: "created", kind: "staged action (runs/<chat>/staged.json)", id: chatId, detail: { staged: staged.staged ?? null } });
      await ctx.host.deleteChat(chatId);
      ctx.log.log({ step: "leftovers", action: "deleted", kind: "chat (deleted in Lumiverse; its run data stays)", id: chatId, name: DELETED_NAME });
      const runs = join(userStorage(ctx.env, ctx.userId), "runs", chatId);
      say(`  left behind in runs/${chatId}: ${existsSync(runs) ? readdirSync(runs).join(", ") : "nothing"}`);
    });
    await ctx.log.once("leftovers:unnamed-file", async () => {
      const path = join(userStorage(ctx.env, ctx.userId), UNNAMED_FILE);
      if (!existsSync(path)) writeFileSync(path, "Harbor Watch rota, kept here by hand for the migration's test: Mon Dale, Wed Jordan, Fri Danny.\n");
      ctx.log.log({ step: "leftovers", action: "placed", kind: "file no inventory row names (by hand)", id: path });
    });
  },
};
