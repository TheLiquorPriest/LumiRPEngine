// Item 10: what a user makes of their own in the harness pages and Settings: an agent and a skill
// (Harness → Agents and Skills, `lah.agent.save`, `lah.skill.save`), an edited text of the harness's
// own (`lah.text.set`) and of the engine's (Settings → Prompts, `prompts.texts`), and the user's
// `~/GUIDANCE.md` (Harness → Guidance, `lah.guidance.set`). Each is the page's own request.

import type { Ctx, Step } from "../lib/context";

export const OWN_AGENT = {
  id: "tide_reader",
  name: "Tide reader",
  description: "Reads Port Alder's tide and wind notes and says whether a small boat can go out.",
  instructions: "You read the harbor's tide and wind notes you are given and answer in two plain sentences: whether a small boat can go out now, and when it can if not.",
  given: "task",
};

export const OWN_SKILL = {
  id: "harbor_round",
  name: "Harbor round",
  description: "How the Harbor Watch walks its evening round of the docks.",
  body: "1. Start at the marina office and sign the logbook.\n2. Walk every dock to its end and back.\n3. Note any boat riding low or a line chafing.\n4. Sign out with the time.",
};

export const GUIDANCE = "This is a test instance. Keep each reply to a few short paragraphs, and keep people's names exactly as the world spells them.";

/** The engine's own text the step edits (the name the world's guidance goes by), and what it says instead. */
export const ENGINE_TEXT = { id: "harness.guidance.name", text: "this town's" };
/** The harness's text the step edits: its main agent's instructions, with one line added at the end. */
const HARNESS_TEXT = "main.system";
const HARNESS_ADDED = "\n\nKeep your own notes short.";

interface Defs {
  agents: { id: string; own?: boolean; source?: string }[];
  skills: { id: string; own?: boolean; source?: string }[];
}

export const own: Step = {
  name: "own",
  makes: "an agent, a skill, edited texts and a GUIDANCE.md of the user's own",
  async run(ctx: Ctx) {
    const defs = await ctx.socket.lah<Defs>("lah.defs.get", {});
    if (!defs.agents.some((a) => a.id === OWN_AGENT.id)) {
      await ctx.socket.lah("lah.agent.save", { agent: OWN_AGENT });
      ctx.log.log({ step: "own", action: "created", kind: "agent of the user's own (harness/settings.json)", id: OWN_AGENT.id, name: OWN_AGENT.name });
    }
    if (!defs.skills.some((s) => s.id === OWN_SKILL.id)) {
      await ctx.socket.lah("lah.skill.save", { skill: OWN_SKILL });
      ctx.log.log({ step: "own", action: "created", kind: "skill of the user's own (harness/settings.json)", id: OWN_SKILL.id, name: OWN_SKILL.name });
    }

    const hello = await ctx.socket.lah<{ texts: { defs: { id: string; text: string }[]; own: { [id: string]: string } } }>("lah.hello", {});
    if (hello.texts.own[HARNESS_TEXT] === undefined) {
      const shipped = hello.texts.defs.find((d) => d.id === HARNESS_TEXT);
      if (shipped === undefined) throw new Error(`the harness has no text ${HARNESS_TEXT}`);
      await ctx.socket.lah("lah.text.set", { id: HARNESS_TEXT, text: `${shipped.text}${HARNESS_ADDED}` });
      ctx.log.log({ step: "own", action: "changed", kind: "harness text (harness/settings.json texts)", id: HARNESS_TEXT });
    }

    const settings = await ctx.socket.lre<{ settings: { prompts: { texts: { [id: string]: string } } } }>("lre.settings.get");
    if (settings.settings.prompts.texts[ENGINE_TEXT.id] !== ENGINE_TEXT.text) {
      await ctx.cli.run(["settings-set", "--patch", JSON.stringify({ prompts: { texts: { [ENGINE_TEXT.id]: ENGINE_TEXT.text } } })]);
      ctx.log.log({ step: "own", action: "changed", kind: "engine text (settings.json prompts.texts)", id: ENGINE_TEXT.id, detail: { text: ENGINE_TEXT.text } });
    }

    const guidance = await ctx.socket.lah<{ levels: { id: string; text: string; hash: string | null }[] }>("lah.guidance.get", { chatId: null });
    const user = guidance.levels.find((l) => l.id === "user");
    if (user?.text !== GUIDANCE) {
      const written = await ctx.socket.lah<{ levels: { id: string; hash: string | null }[] }>("lah.guidance.set", { chatId: null, level: "user", text: GUIDANCE, base: user?.hash ?? null });
      ctx.log.log({ step: "own", action: "changed", kind: "~/GUIDANCE.md (harness/docs/workspace)", id: written.levels.find((l) => l.id === "user")?.hash ?? "GUIDANCE.md" });
    }
  },
};
