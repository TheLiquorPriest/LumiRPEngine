// Item 1: one world, filled. It starts from the engine's modern starter (the one with the most
// money, vehicles, groups and quests), takes the `modern` ruleset profile (a ruleset with its sheet
// layout, checks and progression), and gets the invented parts in `world-parts.ts`, all through the
// engine's own CLI; then it is committed. Build's own requests then build the lore index entry into
// the player's book, and a Build job (Check world, no model) leaves its run in the world's jobs. The
// `revision` step later makes a second revision, then, after the classic chat's turns, the one that
// fills the parts this one leaves empty (`thirdRevision`), and leaves a draft standing.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Ctx, Step } from "../lib/context";
import { say } from "../lib/record";
import { worldParts } from "./world-parts";

export const WORLD_NAME = "Port Alder test instance";
const TEMPLATE = "modern_slice_of_life";

interface WorldIndex {
  id: string;
  name: string;
  head: string;
}

/** The test world's id: the one this run made before, else the one by its name, else a new one. */
export async function worldIdOf(ctx: Ctx, create: boolean): Promise<string> {
  const listed = ((await ctx.socket.lre<{ worlds?: WorldIndex[] }>("lre.world", { op: "list" })).worlds ?? []).map((w) => ({ id: w.id, name: w.name }));
  const remembered = ctx.log.get<string>("worldId");
  const found = listed.find((w) => w.id === remembered) ?? listed.find((w) => w.name === WORLD_NAME);
  if (found) {
    ctx.log.set("worldId", found.id);
    return found.id;
  }
  if (!create) throw new Error("the test world isn't there yet: run the world step first");
  const made = await ctx.cli.run<{ worldId?: string; world?: { id?: string } } | string>(["create", WORLD_NAME, "--template", TEMPLATE]);
  const id = typeof made === "string" ? /w_[0-9a-f]{16}/.exec(made)?.[0] : (made.worldId ?? made.world?.id);
  if (id === undefined) throw new Error(`the CLI's create named no world: ${JSON.stringify(made).slice(0, 300)}`);
  ctx.log.set("worldId", id);
  ctx.log.log({ step: "world", action: "created", kind: "world", id, name: WORLD_NAME, detail: { template: TEMPLATE } });
  return id;
}

export const world: Step = {
  name: "world",
  makes: "a world with every part filled, its lore index entry and a Build job",
  async run(ctx) {
    const bookId = ctx.log.get<string>("bookId");
    const entryId = ctx.log.get<string>("entryId");
    if (bookId === undefined || entryId === undefined) throw new Error("the book step must run first");
    const worldId = await worldIdOf(ctx, true);
    const head = await ctx.socket.lre<{ world?: { maps?: { [id: string]: unknown } } }>("lre.world", { op: "get", worldId });
    if (head.world?.maps?.harbor_blocks === undefined) {
      const draft = await ctx.socket.lre<{ draft: { maps?: { [id: string]: unknown } }; stored: boolean; version: number }>("lre.editor", { op: "get", worldId, base: null });
      if (draft.draft.maps?.harbor_blocks === undefined) {
        const profile = await ctx.cli.run<{ version?: number }>(["profile", worldId, "modern"]);
        ctx.log.log({ step: "world", action: "changed", kind: "world draft (ruleset profile modern)", id: worldId, detail: { version: profile.version ?? null } });
        const opsFile = join(ctx.env.instanceDir, "world-ops.json");
        writeFileSync(opsFile, JSON.stringify(worldParts({ bookId, entryId }), null, 1), { mode: 0o600 });
        const edited = await ctx.cli.run<{ version?: number; introduced?: unknown[] }>(["edit", worldId, "--ops", opsFile]);
        ctx.log.log({ step: "world", action: "changed", kind: "world draft (invented parts)", id: worldId, detail: { version: edited.version ?? null } });
      }
      const lint = await ctx.cli.run<{ issues?: { severity: string; path: string; code: string; message: string }[] }>(["lint", worldId, "--source", "draft", "--severity", "error"]);
      const errors = lint.issues ?? [];
      if (errors.length > 0) throw new Error(`the draft has lint errors; not committed:\n${errors.map((i) => `  ${i.code} at ${i.path}: ${i.message}`).join("\n")}`);
      const committed = await ctx.cli.run<{ revision?: string; head?: string }>(["commit", worldId, "--note", "Test instance: the starter with every part filled"]);
      ctx.log.log({ step: "world", action: "changed", kind: "world revision (commit)", id: worldId, detail: { revision: committed.revision ?? committed.head ?? null } });
    } else say("the test world's parts are in its head already");

    // Build → Lore: the lore index as an entry of the player's book, kept in sync by the engine.
    const index = await ctx.socket.lre<{ index?: { built: { entry?: string } | null } }>("lre.lore", { op: "index", worldId });
    if (index.index?.built == null) {
      const built = await ctx.socket.lre<{ index?: { built: { entry?: string; entryId?: string } | null } }>("lre.lore", { op: "build", worldId, bookId });
      ctx.log.log({ step: "world", action: "created", kind: "lore index entry (in the player's book)", id: built.index?.built?.entryId ?? built.index?.built?.entry ?? bookId, detail: { bookId } });
    }

    // A Build job that needs no model: Check world over one simulated day.
    const jobs = await ctx.cli.run<{ jobs?: { jobId?: string; id?: string }[] }>(["jobs", worldId]);
    if ((jobs.jobs ?? []).length === 0) {
      const started = await ctx.cli.run<{ jobId?: string }>(["job-start", worldId, "check_world", "--days", "1"]);
      ctx.log.log({ step: "world", action: "created", kind: "build job (check_world)", id: started.jobId ?? "?", detail: { worldId } });
    }
  },
};
