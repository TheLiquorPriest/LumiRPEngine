// Items 3, 4, 6, 7, 9 on the classic pipeline's chat: real turns, a second swipe of the first reply,
// a palette tap staged for the next message and taken by it, the earlier reply's swipe flipped back
// with a turn after it, ✎ fixes and GM edits with one undone, confirm chips answered and left, a
// money action done at once off screen, a player-claims marker, and a thread with the GM assistant.

import type { Ctx, Step } from "../lib/context";
import type { Message } from "../lib/lumiverse";
import { say } from "../lib/record";
import { askAssistant } from "./assistant";
import { chatOf, PLAYER } from "./chats";

export const CLASSIC_TURNS = [
  "I pull on my jacket, lock up 2B and walk down Harbor Street to the Bluebird for a coffee before my shift.",
  "Coffee in hand, I head down to the marina to see whether Dale needs a hand before work.",
];

export interface Chip {
  id: string;
  kind: string;
  label: string;
  actions?: { id: string; label: string }[];
}

export interface ViewParts {
  status: string;
  chips: Chip[];
  staged?: { action: string; label: string } | null;
  hud: { clock?: string; fixes?: { id?: string; label?: string; entity?: string; field?: string; value?: unknown }[] } | null;
}

export async function viewOf(ctx: Ctx, chatId: string): Promise<ViewParts> {
  return (await ctx.player.state(chatId)).view as unknown as ViewParts;
}

/** The chat's assistant messages, oldest first. */
export async function replies(ctx: Ctx, chatId: string): Promise<Message[]> {
  return (await ctx.host.messages(chatId)).filter((m) => !m.is_user);
}

/** The chat's player messages, oldest first. */
export async function userMessages(ctx: Ctx, chatId: string): Promise<Message[]> {
  return (await ctx.host.messages(chatId)).filter((m) => m.is_user);
}

export const classic: Step = {
  name: "classic",
  makes: "turns, swipes, a staged tap, a flipped swipe, fixes, chips, an off-screen action and an assistant thread on the classic chat",
  async run(ctx) {
    const chatId = await chatOf(ctx, "classic");
    if (chatId === null) throw new Error("the chats step must run first");
    await ctx.player.show(chatId);

    await ctx.log.once("classic:t1", async () => {
      await ctx.player.turn(chatId, PLAYER, CLASSIC_TURNS[0] as string);
    });
    await ctx.log.once("classic:swipe", async () => {
      await ctx.player.swipe(chatId);
    });
    await ctx.log.once("classic:staged", async () => {
      const staged = await ctx.socket.lre<{ staged?: boolean }>("lre.action", { chatId, action: "go", params: { to: "alder_harbor_marina" }, source: "palette" });
      if (staged.staged !== true) throw new Error(`the palette tap wasn't staged: ${JSON.stringify(staged)}`);
      ctx.log.log({ step: "classic", action: "changed", kind: "staged action (runs/<chat>/staged.json)", id: chatId, detail: { action: "go", to: "alder_harbor_marina" } });
    });
    await ctx.log.once("classic:t2", async () => {
      const { user } = await ctx.player.turn(chatId, PLAYER, CLASSIC_TURNS[1] as string);
      const taken = (await ctx.host.messages(chatId)).find((m) => m.id === user.id);
      say(`  the second message carries ${JSON.stringify((taken?.extra as { spindle_metadata?: unknown } | undefined)?.spindle_metadata ?? null).slice(0, 200)}`);
    });
    await ctx.log.once("classic:fixes", async () => {
      const hud = ((await ctx.player.state(chatId)).view.hud ?? null) as { fixes?: { weather?: { value: unknown; options?: { value: unknown }[] }; time?: { value: string } } } | null;
      const weather = hud?.fixes?.weather;
      const other = weather?.options?.find((o) => JSON.stringify(o.value) !== JSON.stringify(weather.value));
      if (other !== undefined) {
        await ctx.cli.run(["fix", chatId, "--fix", "weather", "--value", JSON.stringify(other.value)]);
        ctx.log.log({ step: "classic", action: "created", kind: "✎ fix (post entry, kind fix)", id: await newestFix(ctx, chatId), detail: { chatId, weather: other.value as string } });
      }
      const clock = hud?.fixes?.time?.value;
      if (clock !== undefined) {
        const at = new Date(`${clock.replace(" ", "T")}:00Z`);
        at.setUTCMinutes(at.getUTCMinutes() + 10);
        const time = at.toISOString().slice(0, 16).replace("T", " ");
        await ctx.cli.run(["fix", chatId, "--time", time]);
        ctx.log.log({ step: "classic", action: "created", kind: "✎ fix of the clock (post entry, kind fix)", id: await newestFix(ctx, chatId), detail: { chatId, time } });
      }
      await ctx.cli.run(["gm-edit", chatId, "--spoilers", "--ops", JSON.stringify([{ op: "adjust", account: "acct_pov_cash", cents: 2000 }])]);
      ctx.log.log({ step: "classic", action: "created", kind: "GM edit (post entry, kind fix, gm)", id: await newestFix(ctx, chatId), detail: { chatId, ops: "adjust acct_pov_cash +2000" } });
    });
    await ctx.log.once("classic:chips", async () => {
      const chips = (await viewOf(ctx, chatId)).chips.filter((c) => c.kind === "confirm" || c.id.startsWith("confirm:"));
      say(`  confirm chips: ${chips.map((c) => `${c.id} (${c.label})`).join("; ") || "none"}`);
      const first = chips[0];
      const yes = first?.actions?.find((a) => !/reject|dismiss|undo|no/i.test(a.id));
      if (first === undefined || yes === undefined) return;
      await ctx.cli.run(["chip", chatId, first.id, yes.id]);
      ctx.log.log({ step: "classic", action: "changed", kind: "confirm chip answered (post entry, kind confirm)", id: first.id, detail: { chatId, choice: yes.id } });
      for (const left of chips.slice(1)) ctx.log.log({ step: "classic", action: "created", kind: "confirm chip left waiting", id: left.id, detail: { chatId } });
    });
    await ctx.log.once("classic:offstage", async () => {
      const done = await ctx.socket.lre<{ applied?: boolean; undo?: string | null }>("lre.action", { chatId, action: "move_money", params: { from: "acct_pov_checking", to: "acct_pov_savings", amount: 5000 }, source: "palette" });
      if (done.applied !== true) throw new Error(`the money move wasn't done at once: ${JSON.stringify(done)}`);
      ctx.log.log({ step: "classic", action: "created", kind: "panel action done at once, off screen (post entry, kind fix)", id: done.undo ?? "move_money", detail: { chatId, action: "move_money", cents: 5000 } });
    });
    await ctx.log.once("classic:marker", async () => {
      await ctx.cli.run(["marker", chatId, "--kind", "claims", "--to", JSON.stringify({ mode: "ask", capped: true })]);
      ctx.log.log({ step: "classic", action: "created", kind: "marker (claims)", id: chatId, detail: { mode: "ask", capped: true } });
    });
    await ctx.log.once("classic:secret", async () => {
      const bookId = ctx.log.get<string>("bookId");
      const entryId = ctx.log.get<string>("entryId");
      const fact = `wi:${bookId}:${entryId}:0`;
      const holding = { how: "told", by: "dale_whitcomb", evidence: [], since: { msg: null, at: 0 }, belief: "true", confidence: 1 };
      await ctx.cli.run(["mind-edit", chatId, "--spoilers", "--ops", JSON.stringify([{ op: "mind_knowledge", entity: "pov", fact, holding }])]);
      ctx.log.log({ step: "classic", action: "created", kind: "holding of a book secret (minds knowledge, GM edit)", id: fact, detail: { chatId, holder: "pov", told: "dale_whitcomb" } });
    });
    await ctx.log.once("classic:assistant", async () => {
      await askAssistant(ctx, chatId, "Where would Jordan most likely run into Dale Whitcomb this morning, and why?");
    });
    await ctx.log.once("classic:flip", async () => {
      const first = (await replies(ctx, chatId))[1];
      if (first === undefined || first.swipes.length < 2) throw new Error("the first reply has no second swipe to flip from");
      const flipped = await ctx.host.cycleSwipe(chatId, first.id, "left");
      ctx.log.log({ step: "classic", action: "changed", kind: "swipe shown on an earlier reply", id: first.id, detail: { chatId, swipe: flipped.swipe_id } });
      await ctx.player.quiet(chatId);
    });
  },
};

/** The chat's newest ✎ fix or GM edit, by its chip (`fix:<message>:<swipe>:<seq>`): the entry a write just made. */
export async function newestFix(ctx: Ctx, chatId: string): Promise<string> {
  const seq = (id: string): number => Number(id.split(":").at(-1));
  const fixes = (await viewOf(ctx, chatId)).chips.filter((c) => c.id.startsWith("fix:")).sort((a, b) => seq(a.id) - seq(b.id));
  return fixes.at(-1)?.id ?? "?";
}
