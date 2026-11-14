// Items 3, 6, 8, 9, 12 on the harness engine's chat. The player prepares the story (Play → Now →
// Prepare the story, `lre.prepare`), which casts it and has the author write the principals' cores
// and its notebook; two turns follow, each with the jobs the author starts after the reply (the
// principals take in what reached them, writing their own mind files); one change on a review card is
// applied and the rest are left waiting; the GM assistant answers a question in a side session of
// LumiAH's; and a palette tap is left staged for a next message that never comes.

import type { Ctx, Step } from "../lib/context";
import { say } from "../lib/record";
import { askAssistant } from "./assistant";
import { PLAYER, chatOf } from "./chats";
import { answerOneReview } from "./review";

const ABOUT = "A quiet week in Port Alder before Harbor Watch Day. Jordan, the young mechanic, is drawn into the Harbor Watch by Dale Whitcomb and starts to notice Marcus Delgado's money worries. Dale and Marcus matter most; Danny and Priya are around the shop.";

const TURNS = [
  "I walk down to the marina office and ask Dale whether the Harbor Watch still needs a volunteer for tonight's round.",
  "I take the logbook from Dale, walk the docks with him, and ask him quietly whether Marcus has seemed worried lately.",
];
const LAST_TURN = "I sign the logbook at the end of the round, walk Dale back to the office, and head home along Harbor Street.";

/** How long the jobs after a reply may run before the step goes on without waiting further. */
const JOBS_MS = 20 * 60_000;
const PREPARE_MS = 30 * 60_000;

async function settleJobs(ctx: Ctx, chatId: string): Promise<void> {
  const began = Date.now();
  while (Date.now() - began < JOBS_MS) {
    const page = await ctx.socket.lah<{ jobs: { id: string; agent: string; state: string }[] }>("lah.jobs.list", { chatId, cursor: null, limit: 40 });
    const open = page.jobs.filter((j) => j.state === "queued" || j.state === "running");
    if (open.length === 0) {
      say(`  the chat's jobs are settled: ${page.jobs.map((j) => `${j.agent} ${j.state}`).join(", ") || "none"}`);
      return;
    }
    await Bun.sleep(10_000);
  }
  say("  jobs still run; going on without them");
}

export const harness: Step = {
  name: "harness",
  makes: "a prepared story, turns with their jobs, a review card, mind files, a notebook, a side thread and a staged tap on the harness chat",
  async run(ctx) {
    const chatId = await chatOf(ctx, "harness");
    if (chatId === null) throw new Error("the chats step must run first");
    await ctx.player.show(chatId);

    await ctx.log.once("harness:prepare", async () => {
      let view = await ctx.socket.lre<{ state: string; note: string | null }>("lre.prepare", { chatId, op: "get" });
      if (view.state === "none") {
        view = await ctx.socket.lre("lre.prepare", { chatId, op: "start", about: ABOUT });
        ctx.log.log({ step: "harness", action: "created", kind: "prepared start (author/prepare.md, a job of the author's)", id: chatId, detail: { state: view.state } });
      }
      const began = Date.now();
      while (!["done", "failed", "cancelled", "unreachable"].includes(view.state)) {
        if (Date.now() - began > PREPARE_MS) throw new Error(`the preparation is still ${view.state} after ${PREPARE_MS / 60_000} min`);
        if (view.state === "waiting") {
          view = await ctx.socket.lre("lre.prepare", { chatId, op: "approve" });
          say("  approved the preparation's plan");
        }
        await Bun.sleep(10_000);
        view = await ctx.socket.lre("lre.prepare", { chatId, op: "get" });
      }
      say(`  the preparation ended ${view.state}${view.note ? `: ${view.note}` : ""}`);
      if (view.state !== "done") throw new Error(`the preparation ended ${view.state}`);
      await settleJobs(ctx, chatId);
    });

    for (const [n, text] of TURNS.entries()) {
      await ctx.log.once(`harness:t${n + 1}`, async () => {
        await ctx.player.turn(chatId, PLAYER, text);
        await settleJobs(ctx, chatId);
      });
    }

    await ctx.log.once("harness:review", () => answerOneReview(ctx, chatId, "harness"));

    await ctx.log.once("harness:assistant", async () => {
      await askAssistant(ctx, chatId, "Who on the docks would notice if the marina office key went missing tonight?");
    });

    await ctx.log.once("harness:t3", async () => {
      // A last turn whose review card nobody answers: what it asked first waits there for good.
      await ctx.player.turn(chatId, PLAYER, LAST_TURN);
      await settleJobs(ctx, chatId);
      const { cards } = await ctx.socket.lre<{ cards: { turn: string; items: { key: string; status: string; changeType: string }[] }[] }>("lre.review", { chatId, op: "get" });
      for (const card of cards) for (const item of card.items.filter((i) => i.status === "open")) ctx.log.log({ step: "harness", action: "created", kind: "review card change left waiting (chips.json)", id: `review:${card.turn}/${item.key}`, detail: { chatId, changeType: item.changeType } });
    });

    // Staged after the last turn: a message would take it, and none comes.
    await ctx.log.once("harness:staged-last", async () => {
      const staged = await ctx.socket.lre<{ staged?: boolean }>("lre.action", { chatId, action: "go", params: { to: "bluebird_coffee" }, source: "palette" });
      if (staged.staged !== true) throw new Error(`the palette tap wasn't staged: ${JSON.stringify(staged)}`);
      ctx.log.log({ step: "harness", action: "created", kind: "staged action left waiting (runs/<chat>/staged.json)", id: chatId, detail: { action: "go", to: "bluebird_coffee" } });
    });
  },
};
