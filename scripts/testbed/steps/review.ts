// Item 6's review cards: what an agents or harness turn asked first sits on a review card under its
// reply (`runs/<chat>/chips.json`). The page's Apply on one change answers it; the rest stay waiting
// for a press that never comes.

import type { Ctx } from "../lib/context";
import { say } from "../lib/record";

interface ReviewCard {
  turn: string;
  messageId: string;
  items: { key: string; status: string; changeType: string; lines: string[] }[];
}

export async function answerOneReview(ctx: Ctx, chatId: string, step: string): Promise<void> {
  const { cards } = await ctx.socket.lre<{ cards: ReviewCard[] }>("lre.review", { chatId, op: "get" });
  const open = cards.flatMap((card) => card.items.filter((i) => i.status === "open").map((item) => ({ card, item })));
  say(`  review cards: ${cards.length}, open changes: ${open.length}`);
  const first = open[0];
  if (first === undefined) {
    say("  no change waits on a review card: the agents asked for none of the kinds that ask first");
    return;
  }
  await ctx.socket.lre("lre.review", { chatId, op: "apply", turn: first.card.turn, keys: [first.item.key] });
  ctx.log.log({ step, action: "changed", kind: "review card change applied (chips.json)", id: `review:${first.card.turn}/${first.item.key}`, detail: { chatId, changeType: first.item.changeType } });
  for (const rest of open.slice(1)) ctx.log.log({ step, action: "created", kind: "review card change left waiting (chips.json)", id: `review:${rest.card.turn}/${rest.item.key}`, detail: { chatId, changeType: rest.item.changeType } });
}
