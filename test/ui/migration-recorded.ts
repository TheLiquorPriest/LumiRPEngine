// What an invented migration left, as RPE's Migration route would answer for it: before any run, and after a real run
// (its report in brief, the backup, what is waiting on the user, the swap's steps and going back's in the application's own
// words). For the Migration page's tests and the preview. Every path, chat and count here is made up.

import { goingBack, PREVIOUS_PERMISSIONS, swapSteps } from "../../src/migrate/going-back";
import type { MigrationReply } from "../../src/shared/api";

/** The steps of going back as the route gives them: after its opening line, each trimmed. */
const STEPS = goingBack({ identifier: "lumi_rp_engine", runtime: { name: "lamp-house", source: null }, downRun: false })
  .slice(1)
  .map((step) => step.trim());
const SWAP = swapSteps({ identifier: "lumi_rp_engine" }).map((step) => step.trim());

const SOURCES: MigrationReply["sources"] = { lumiverse: "/srv/lumiverse/data", runtime: { configDir: "/srv/home/.config/lumiah", dataDir: "/srv/home/.local/share/lumiah" } };

export const NOT_RUN: MigrationReply = { run: null, rehearsal: { state: "none" }, sources: SOURCES, backup: null, offRpe: [], waiting: [], given: [], swap: SWAP, goingBack: { steps: STEPS, permissions: [...PREVIOUS_PERMISSIONS] }, lumiverse: null };

export const MIGRATED: MigrationReply = {
  run: {
    mode: "real run",
    at: "2026-11-13T21:04:00.000Z",
    refusals: [],
    counts: { rows: 46, chats: 3, items: 214, notClassified: 0, unreadable: 1, differences: 2, offRpe: 1 },
    disk: { backup: 48_340_992, import: 31_000_000, total: 79_340_992, free: null },
    backup: { path: "/srv/rpe/backups/before-migration.tar", bytes: 48_340_992, sha256: "4f1d2c9a8b7e6d5c4b3a29180f7e6d5c4b3a29180f7e6d5c4b3a29180f7e6d5c" },
  },
  rehearsal: { state: "none" },
  sources: SOURCES,
  backup: { path: "/srv/rpe/backups/before-migration.tar", bytes: 48_340_992, sha256: "4f1d2c9a8b7e6d5c4b3a29180f7e6d5c4b3a29180f7e6d5c4b3a29180f7e6d5c", present: true },
  offRpe: [{ chat: "chat-calder", pinned: "conn-own", done: false }],
  waiting: [
    { kind: "guidance", path: "imported/GUIDANCE.md", done: false },
    { kind: "agent", id: "scout", path: "imported/agents/scout.md", done: true, pins: [], deadTools: [] },
    { kind: "connection", where: "agent scout of your own", connection: "Harbour Flash", agent: "scout", path: "imported/agents/scout.md", done: false },
    { kind: "paused", chat: "chat-harbour", questions: 1, answered: null, done: false },
    { kind: "chat", chat: "chat-harbour", chips: 0, reviewCards: 1, rollback: true, done: false },
    { kind: "filing", chat: "chat-calder", characters: 2, notes: true, done: false },
  ],
  given: [],
  swap: SWAP,
  goingBack: { steps: STEPS, permissions: [...PREVIOUS_PERMISSIONS] },
  lumiverse: null,
};
