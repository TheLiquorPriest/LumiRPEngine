// Recorded answers of the bootstrap routes and of the builds route, for the pages' tests and the preview:
// a chat's six facts and its bootstrap jobs, a batch start, and the builds as RPE says they stand. Every
// name and number here is made up.

import type { JobView } from "rp-harness/contract";
import type { BootstrapBatchReply, BootstrapChatReply, BuildsReply, BuildsStatus } from "../../src/shared/api";
import { CHAT } from "./records-recorded";

const usage = { calls: 4, input: 12_000, output: 900, cacheRead: 0, cacheWrite: 0 };

/** A job as RPH gives its view: the Author's, on the bootstrap skill, in `CHAT`. */
export const job = (id: string, state: JobView["state"], over: Partial<JobView> = {}): JobView => ({ id, agent: "author", brief: "the bootstrap skill", state, scope: { user: "user-1", chat: CHAT, session: "s-1" }, startedBy: "user", started: 1_700_000_000_000, usage, ...over });

export const BOOT: BootstrapChatReply = {
  chat: CHAT,
  facts: {
    lore: { known: true, entries: 12, indexed: 12, stale: 0 },
    history: { known: false, why: "unreadable" },
    cast: { known: true, listed: 3, cast: 2, uncast: ["Tobin Reede"] },
    story: { known: true, premise: 1, chapters: 1, scenes: 2, beats: 5, threads: 2, openThreads: 1, arcs: 0, principals: 1, principalsWithArc: 0, player: 1 },
    horizon: {
      known: true,
      entries: 2,
      named: 1,
      clock: true,
      time: { recorded: true, established: 1, assumed: 0, proposed: 0, none: 0 },
      place: { recorded: true, established: 0, assumed: 1, proposed: 0, none: 2 },
      onStage: { recorded: true, established: 1, assumed: 1, proposed: 1, none: 0 },
      holdings: { recorded: false, established: 0, assumed: 0, proposed: 0, none: 0 },
    },
    principals: { known: true, principals: [{ id: "char-odile", name: "Odile Holt", base: ["seed"], memories: 0, own: 0, ownFromPerceptions: 0 }] },
  },
  start: {
    skill: true,
    relive: ["outline", "key moments", "all"],
    tokenLimit: 200_000,
    cachedWeight: 0.1,
    caps: [
      { key: "bootstrap.run.calls", value: 200 },
      { key: "bootstrap.run.time", value: 3_600 },
      { key: "jobs.run.tokensIn", value: 600_000 },
      { key: "jobs.run.tokensOut", value: 60_000 },
    ],
  },
  underWay: [{ id: "job-2", relive: null, tokenLimit: 200_000, view: job("job-2", "running") }],
  questions: [],
};

export const BATCH: BootstrapBatchReply = { started: [{ chat: "chat-calder", job: job("job-9", "running") }], refused: [{ chat: "chat-harbour", why: "A bootstrap job of this chat is under way." }] };

export const AGREE: BuildsStatus = { running: "a1b2c3d4", disk: "a1b2c3d4", broken: null, extension: "a1b2c3d4", agree: true, restart: "none", update: null, words: "RPE runs build a1b2c3d4, the build of its app file on disk and of the extension." };
export const NEWER: BuildsStatus = { ...AGREE, disk: "e5f6a7b8", agree: false, restart: "off", words: "RPE runs build a1b2c3d4; its app file on disk is build e5f6a7b8. update.restart is off, so RPE stays on a1b2c3d4." };
export const buildsReply = (builds: BuildsStatus): BuildsReply => ({ name: "rpe", version: "a1b2c3d4", started: 1_700_000_000_000, builds });
