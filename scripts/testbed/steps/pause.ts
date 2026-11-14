// Items 4 and 5: a branch of the classic chat (Lumiverse's Branch, which copies the messages and
// their records), whose first message is then edited and, where that pauses it, the later turns
// discarded (tombstones in its journal); and the classic chat itself paused on the same
// keep-or-discard question, left unanswered, with a ✎ fix sent while it waits.

import type { Step } from "../lib/context";
import { guard } from "../lib/env";
import { say } from "../lib/record";
import { PLAYER, chatOf } from "./chats";
import { replies, userMessages, viewOf } from "./classic";

const BRANCH_NAME = "Port Alder test · classic, branched";
const EDITED_FIRST = "I pull on my jacket, lock up 2B and walk down Harbor Street to the Bluebird, meaning to be quick about the coffee.";
const BRANCH_TURN = "I leave the marina, walk back up Harbor Street to Alder Automotive and hand Marcus the clipboard from the festival committee.";
/** How long an edit is given to reach the engine and pause the chat. */
const PAUSE_MS = 15_000;

type WeatherFix = { entity: string; field: string; value: unknown; options?: { value: unknown }[] };

async function pausedWithin(read: () => Promise<string>): Promise<string> {
  const began = Date.now();
  let status = await read();
  while (status !== "paused" && Date.now() - began < PAUSE_MS) {
    await Bun.sleep(1500);
    status = await read();
  }
  return status;
}

export const pause: Step = {
  name: "pause",
  makes: "a branch with an edited first message, and the classic chat paused on a keep-or-discard question",
  async run(ctx) {
    const chatId = await chatOf(ctx, "classic");
    if (chatId === null) throw new Error("the chats step must run first");

    await ctx.log.once("pause:branch", async () => {
      const last = (await replies(ctx, chatId)).at(-1);
      if (last === undefined) throw new Error("the classic chat has no reply to branch at");
      const branch = await ctx.host.branch(chatId, last.id, BRANCH_NAME);
      ctx.log.set("chat:branch", guard(ctx.env, branch.id));
      ctx.log.log({ step: "pause", action: "created", kind: "chat (branch)", id: branch.id, name: BRANCH_NAME, detail: { from: chatId, at: last.id } });
    });
    await ctx.log.once("pause:discard", async () => {
      const branchId = await chatOf(ctx, "branch");
      if (branchId === null) throw new Error("the branch is gone");
      await ctx.player.show(branchId);
      const first = (await userMessages(ctx, branchId))[0];
      if (first === undefined) throw new Error("the branch has no message of the player's");
      if (first.content !== EDITED_FIRST) {
        await ctx.host.edit(branchId, first.id, EDITED_FIRST);
        ctx.log.log({ step: "pause", action: "changed", kind: "earlier message edited", id: first.id, detail: { chatId: branchId } });
      }
      const status = await pausedWithin(async () => (await viewOf(ctx, branchId)).status);
      if (status !== "paused") {
        say(`  the branch stands ${status} after its first message's edit: nothing to discard there`);
        return;
      }
      await ctx.cli.run(["keep", branchId, "discard", first.id]);
      ctx.log.log({ step: "pause", action: "changed", kind: "pause answered Discard (tombstones in the journal)", id: first.id, detail: { chatId: branchId } });
      await ctx.player.quiet(branchId);
    });
    await ctx.log.once("pause:branch-turn", async () => {
      // A turn on the branch, which the classic engine plays: what its reply's read asks first waits on confirm chips nobody answers.
      const branchId = await chatOf(ctx, "branch");
      if (branchId === null) throw new Error("the branch is gone");
      await ctx.player.turn(branchId, PLAYER, BRANCH_TURN);
      for (const chip of (await viewOf(ctx, branchId)).chips.filter((c) => c.id.startsWith("confirm:"))) ctx.log.log({ step: "pause", action: "created", kind: "confirm chip left waiting", id: chip.id, detail: { chatId: branchId, label: chip.label } });
    });
    await ctx.log.once("pause:classic", async () => {
      await ctx.player.show(chatId);
      const first = (await userMessages(ctx, chatId))[0];
      if (first === undefined) throw new Error("the classic chat has no message of the player's");
      if (first.content !== EDITED_FIRST) await ctx.host.edit(chatId, first.id, EDITED_FIRST);
      const status = await pausedWithin(async () => (await viewOf(ctx, chatId)).status);
      if (status !== "paused") throw new Error(`the classic chat didn't pause (status ${status})`);
      const question = (await viewOf(ctx, chatId)).chips.find((c) => c.id.startsWith("pause:"));
      ctx.log.log({ step: "pause", action: "changed", kind: "chat paused on keep-or-discard, left unanswered", id: question?.id ?? first.id, detail: { chatId, edited: first.id } });
    });
    await ctx.log.once("pause:held", async () => {
      const hud = ((await ctx.player.state(chatId)).view.hud ?? null) as { fixes?: { weather?: WeatherFix } } | null;
      const weather = hud?.fixes?.weather;
      const other = weather?.options?.find((o) => JSON.stringify(o.value) !== JSON.stringify(weather.value));
      if (weather === undefined || other === undefined) {
        say("  the paused chat offers no weather fix to send");
        return;
      }
      try {
        const answer = await ctx.socket.lre("lre.fix", { chatId, entity: weather.entity, field: weather.field, value: other.value });
        ctx.log.log({ step: "pause", action: "created", kind: "✎ fix sent while paused", id: chatId, detail: { answer: JSON.stringify(answer) } });
      } catch (error) {
        const why = error instanceof Error ? error.message : String(error);
        ctx.log.log({ step: "pause", action: "created", kind: "✎ fix sent while paused (refused)", id: chatId, detail: { refusal: why } });
      }
    });
  },
};
