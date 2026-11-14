// Items 3, 4, 6, 7 on the agents engine's chat: a typed turn, then a panel action that plays at once
// as the next turn (`lre.action {now: true}`); a GM edit and its Undo; the last reply's text edited
// (kept as accepted); the first message edited and the pause it makes answered Keep; files in the
// agents engine's own workspace, learned area and global workspace (GM → Workspace,
// `lre.workspace`); the first reply deleted, with turns after it; a third turn, whose changes that
// ask first wait on its review card, one of them applied.

import type { Step } from "../lib/context";
import { say } from "../lib/record";
import { PLAYER, chatOf } from "./chats";
import { newestFix, replies, userMessages, viewOf } from "./classic";
import { answerOneReview } from "./review";

const FIRST = "I get to Alder Automotive a little early and ask Marcus what's on the board for today.";
const FIRST_EDITED = "I get to Alder Automotive a little early, hang up my jacket and ask Marcus what's on the board for today.";
const THIRD = "I hand Danny the spare relay from my pocket, finish my coffee and walk down to the marina to find Dale before the shop opens.";
const FOURTH = "Dale waves me into the marina office; I follow him in, and he hands me the Harbor Watch logbook to sign.";
const THIRD_EDITED = "I hand Danny the spare relay from my pocket, finish my coffee and take the long way down to the marina to find Dale before the shop opens.";
/** Turns that move the player and hand a thing over, both kinds that ask first; the second is played only when the first asks nothing. */
const LEFT_TURNS = [
  "I leave the marina office, walk up Harbor Street to Alder Automotive and hand Marcus the Harbor Watch logbook to look over.",
  "I take the logbook back from Marcus, walk down to the Rusty Anchor and hand it to Jess behind the bar for safekeeping.",
];

/** Files written through GM → Workspace: one in the chat's workspace, one learned, one global. */
const FILES = [
  { path: "notes/shop-board.md", text: "# The shop board\n\n- The township pickup is waiting on a fuel pump relay.\n- Priya's sedan is due for brakes on Thursday." },
  { path: "learned/shop-voice.md", text: "Marcus talks about money only in round numbers and changes the subject when the bank comes up." },
  { path: "~/notes/port-alder.md", text: "Port Alder gives directions in blocks: Harbor Row, the Lakefront, Market Street and the School blocks." },
];

export const agents: Step = {
  name: "agents",
  makes: "turns, a panel action played at once, a review card, an undone GM edit, an edited reply, a kept edit, workspace files and a deleted reply on the agents chat",
  async run(ctx) {
    const chatId = await chatOf(ctx, "agents");
    if (chatId === null) throw new Error("the chats step must run first");
    await ctx.player.show(chatId);

    await ctx.log.once("agents:t1", async () => {
      await ctx.player.turn(chatId, PLAYER, FIRST);
    });
    await ctx.log.once("agents:now", async () => {
      // The palette's Send now: the engine appends the player's message with the action and starts the reply.
      let messageId = "";
      await ctx.player.reply(
        chatId,
        async () => {
          const posted = await ctx.socket.lre<{ messageId?: string }>("lre.action", { chatId, action: "go", params: { to: "bluebird_coffee" }, source: "palette", now: true });
          messageId = posted.messageId ?? "";
        },
        "a palette action played at once",
      );
      ctx.log.log({ step: "agents", action: "created", kind: "message with a panel action (lumi_rp_engine intent)", id: messageId, detail: { chatId, action: "go", to: "bluebird_coffee", now: true } });
    });
    await ctx.log.once("agents:undo", async () => {
      // A GM edit and its Undo: the edit's post entry stands in the ledger with an undo entry after it.
      await ctx.cli.run(["gm-edit", chatId, "--spoilers", "--ops", JSON.stringify([{ op: "set", entity: "pov", field: "mechanics", value: 14 }])]);
      const chip = await newestFix(ctx, chatId);
      ctx.log.log({ step: "agents", action: "created", kind: "GM edit (post entry, kind fix, gm)", id: chip, detail: { chatId, ops: "set pov.mechanics 14" } });
      await ctx.cli.run(["chip", chatId, chip, "undo"]);
      ctx.log.log({ step: "agents", action: "changed", kind: "GM edit undone (undo entry)", id: chip, detail: { chatId } });
    });
    await ctx.log.once("agents:edit-reply", async () => {
      const last = (await replies(ctx, chatId)).at(-1);
      if (last === undefined) throw new Error("no reply to edit");
      await ctx.host.edit(chatId, last.id, `${last.content}\n\nThe bell over the Bluebird's door rings twice behind you.`);
      ctx.log.log({ step: "agents", action: "changed", kind: "reply text edited (record keeps it as accepted)", id: last.id, detail: { chatId } });
      await ctx.player.quiet(chatId);
    });
    await ctx.log.once("agents:keep", async () => {
      const first = (await userMessages(ctx, chatId))[0];
      if (first === undefined) throw new Error("no first message to edit");
      await ctx.host.edit(chatId, first.id, FIRST_EDITED);
      ctx.log.log({ step: "agents", action: "changed", kind: "earlier message edited (pauses the chat)", id: first.id, detail: { chatId } });
      await Bun.sleep(3000);
      const view = await viewOf(ctx, chatId);
      if (view.status !== "paused") throw new Error(`the edit didn't pause the chat (status ${view.status})`);
      await ctx.cli.run(["keep", chatId, "keep", first.id]);
      ctx.log.log({ step: "agents", action: "changed", kind: "pause answered Keep (journal)", id: first.id, detail: { chatId } });
      await ctx.player.quiet(chatId);
    });
    await ctx.log.once("agents:workspace", async () => {
      for (const file of FILES) {
        const written = await ctx.socket.lre<{ undo?: string | null }>("lre.workspace", { chatId, op: "write", path: file.path, text: file.text });
        ctx.log.log({ step: "agents", action: "created", kind: "agents engine workspace file", id: file.path, detail: { chatId, undo: written.undo ?? null } });
      }
    });
    await ctx.log.once("agents:delete", async () => {
      // The first turn's reply goes, with its record; the turn played after it stays.
      const first = (await replies(ctx, chatId))[1];
      if (first === undefined) throw new Error("no first reply to delete");
      await ctx.host.deleteMessage(chatId, first.id);
      ctx.log.log({ step: "agents", action: "deleted", kind: "reply (with its record), a turn after it", id: first.id, detail: { chatId } });
      await ctx.player.quiet(chatId);
      say(`  the chat has ${(await ctx.host.messages(chatId)).length} messages`);
    });
    await ctx.log.once("agents:t3", async () => {
      await ctx.player.turn(chatId, PLAYER, THIRD);
    });
    await ctx.log.once("agents:review-last", () => answerOneReview(ctx, chatId, "agents"));
    await ctx.log.once("agents:t4", async () => {
      // A last turn whose review card nobody answers: its changes wait there for good.
      await ctx.player.turn(chatId, PLAYER, FOURTH);
      const { cards } = await ctx.socket.lre<{ cards: { turn: string; items: { key: string; status: string; changeType: string }[] }[] }>("lre.review", { chatId, op: "get" });
      for (const card of cards) for (const item of card.items.filter((i) => i.status === "open")) ctx.log.log({ step: "agents", action: "created", kind: "review card change left waiting (chips.json)", id: `review:${card.turn}/${item.key}`, detail: { chatId, changeType: item.changeType } });
    });
    await ctx.log.once("agents:discard", async () => {
      // The third turn's message edited, and this time Discard: the turns after it leave the journal as tombstones.
      const third = (await userMessages(ctx, chatId)).find((m) => m.content === THIRD);
      if (third === undefined) throw new Error("the third turn's message isn't there to edit");
      await ctx.host.edit(chatId, third.id, THIRD_EDITED);
      ctx.log.log({ step: "agents", action: "changed", kind: "earlier message edited (pauses the chat)", id: third.id, detail: { chatId } });
      let status = "";
      for (let i = 0; i < 10 && status !== "paused"; i++) {
        await Bun.sleep(1500);
        status = (await viewOf(ctx, chatId)).status;
      }
      if (status !== "paused") throw new Error(`the edit didn't pause the chat (status ${status})`);
      await ctx.cli.run(["keep", chatId, "discard", third.id]);
      ctx.log.log({ step: "agents", action: "changed", kind: "pause answered Discard (tombstones in the journal)", id: third.id, detail: { chatId } });
      await ctx.player.quiet(chatId);
    });
    await ctx.log.once("agents:card-left", async () => {
      // A turn whose changes ask first, its review card left unanswered; a second try only if the first asks nothing.
      for (const text of LEFT_TURNS) {
        await ctx.player.turn(chatId, PLAYER, text);
        const { cards } = await ctx.socket.lre<{ cards: { turn: string; items: { key: string; status: string; changeType: string }[] }[] }>("lre.review", { chatId, op: "get" });
        const open = cards.flatMap((card) => card.items.filter((i) => i.status === "open").map((item) => ({ card, item })));
        for (const { card, item } of open) ctx.log.log({ step: "agents", action: "created", kind: "review card change left waiting (chips.json)", id: `review:${card.turn}/${item.key}`, detail: { chatId, changeType: item.changeType } });
        if (open.length > 0) return;
      }
      say("  two turns asked nothing first: no review card is left waiting");
    });
  },
};
