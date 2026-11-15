// The second invented user's part of the instance (PlanScenarios-4 item 1; READINGS R-19): enough of
// its own beside the instance user's that the migration's boundary has something to keep out: a world
// of its own, a character card and a chat with that world attached and a palette tap staged (so
// today's build keeps run data for the chat in that user's storage, `runs/<chat>/`), an outside
// harness's check-in made with that user's command line (`agents.json`), and a setting of its own
// changed (`settings.json`). Its runtime, under its own name, is the set-up's (`setup.ts`). Nothing
// of it plays a turn, so it calls no model. Every road is the one the instance user's steps take.

import { checkInAs } from "../../steps/checkin";
import { say } from "../record";
import type { UserCtx } from "./context";

export interface OtherStep {
  name: string;
  makes: string;
  run(ctx: UserCtx): Promise<void>;
}

const WORLD_NAME = "Second user's world (invented)";
const TEMPLATE = "modern_slice_of_life";
const CARD = {
  name: "Second user's narrator (invented)",
  description: "The narrator of a quiet lake town, for a second user of the same Lumiverse.",
  personality: "Plain.",
  scenario: "A Tuesday morning in late September.",
  first_mes: "The ferry horn sounds twice across the lake, and the bakery on the corner rolls up its shutter.",
};
const CHAT_NAME = "Second user's chat (invented)";
const HARNESS = "testbed-harness-second-user";

async function worldOf(ctx: UserCtx): Promise<string> {
  const listed = (await ctx.socket.lre<{ worlds?: { id: string; name: string }[] }>("lre.world", { op: "list" })).worlds ?? [];
  const known = listed.find((w) => w.id === ctx.log.get<string>("other:worldId")) ?? listed.find((w) => w.name === WORLD_NAME);
  if (known !== undefined) {
    ctx.log.set("other:worldId", known.id);
    return known.id;
  }
  const made = await ctx.cli.run<{ worldId?: string; world?: { id?: string } } | string>(["create", WORLD_NAME, "--template", TEMPLATE]);
  const id = typeof made === "string" ? /w_[0-9a-f]{16}/.exec(made)?.[0] : (made.worldId ?? made.world?.id);
  if (id === undefined) throw new Error(`the second user's create named no world: ${JSON.stringify(made).slice(0, 300)}`);
  ctx.log.set("other:worldId", id);
  ctx.log.log({ step: "other", action: "created", kind: "world (the second user's)", id, name: WORLD_NAME, detail: { template: TEMPLATE } });
  return id;
}

export const otherWorld: OtherStep = {
  name: "other-world",
  makes: "the second user's own world",
  async run(ctx) {
    await worldOf(ctx);
  },
};

export const otherChat: OtherStep = {
  name: "other-chat",
  makes: "the second user's card and chat, with its world attached and a palette tap staged",
  async run(ctx) {
    const worldId = await worldOf(ctx);
    await ctx.log.once("other:chat", async () => {
      const cards = await ctx.host.characters();
      let cardId = cards.find((c) => c.id === ctx.log.get<string>("other:cardId"))?.id ?? cards.find((c) => c.name === CARD.name)?.id;
      if (cardId === undefined) {
        cardId = (await ctx.host.createCharacter(CARD)).id;
        ctx.log.log({ step: "other", action: "created", kind: "character card (the second user's)", id: cardId, name: CARD.name });
      }
      ctx.log.set("other:cardId", cardId);
      const chat = await ctx.host.createChat(cardId, CHAT_NAME);
      ctx.log.set("other:chat", chat.id);
      ctx.log.log({ step: "other", action: "created", kind: "chat (the second user's)", id: chat.id, name: CHAT_NAME, detail: { cardId } });
      await ctx.cli.run(["attach", worldId, chat.id]);
      ctx.log.log({ step: "other", action: "changed", kind: "chat run (world attached; the second user's)", id: chat.id, detail: { worldId } });
    });
    await ctx.log.once("other:staged", async () => {
      const chatId = ctx.log.get<string>("other:chat");
      if (chatId === undefined) throw new Error("the second user's chat is not recorded");
      const staged = await ctx.socket.lre<{ staged?: boolean }>("lre.action", { chatId, action: "go", params: { to: "alder_harbor_marina" }, source: "palette" });
      if (staged.staged !== true) throw new Error(`the second user's palette tap wasn't staged: ${JSON.stringify(staged)}`);
      ctx.log.log({ step: "other", action: "created", kind: "staged action (runs/<chat>/staged.json; the second user's)", id: chatId, detail: { action: "go" } });
    });
  },
};

export const otherCheckin: OtherStep = {
  name: "other-checkin",
  makes: "an outside harness's check-in made with the second user's command line",
  run: (ctx) => checkInAs(ctx, HARNESS, "other", "other:checkin"),
};

export const otherSettings: OtherStep = {
  name: "other-settings",
  makes: "a setting of the second user's own",
  async run(ctx) {
    const read = async (): Promise<string | undefined> => (await ctx.socket.lre<{ settings: { extraction?: { location?: { mode?: string } } } }>("lre.settings.get")).settings.extraction?.location?.mode;
    if ((await read()) === "confirm") {
      say("the second user's setting stands");
      return;
    }
    await ctx.cli.run(["settings-set", "--patch", JSON.stringify({ extraction: { location: { mode: "confirm" } } })]);
    const mode = await read();
    if (mode !== "confirm") throw new Error(`the second user's setting didn't take (${mode ?? "unset"})`);
    ctx.log.log({ step: "other", action: "changed", kind: "settings (settings.json; the second user's)", id: "extraction.location.mode", detail: { mode } });
  },
};

export const OTHER_STEPS: OtherStep[] = [otherWorld, otherChat, otherCheckin, otherSettings];
