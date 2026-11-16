// What an invented migration run left, as RPE's Migration route would answer for it: the report as the
// run printed it, three chats (one clean, one that differed and is marked, one not imported), the backup,
// what is waiting on the user, and the steps of going back in the application's own words. For the
// Migration page's tests and the preview. Every chat, path and count here is made up.

import { goingBack, PREVIOUS_PERMISSIONS } from "../../src/migrate/going-back";
import type { MigrationReply, MigrationReportShown } from "../../src/shared/api";

/** The steps of going back as the route gives them: after its opening line, each trimmed. */
const STEPS = goingBack({ identifier: "lumi_rp_engine", runtime: { name: "lamp-house", source: null }, downRun: false })
  .slice(1)
  .map((step) => step.trim());

export const NOT_RUN: MigrationReply = { report: null, text: null, chats: [], backup: null, waiting: [], goingBack: { steps: STEPS, permissions: [...PREVIOUS_PERMISSIONS] }, lumiverse: null };

/** The report's own document is carried as JSON. */
export const REPORT: MigrationReportShown = { format: 1, at: null, mode: null, layout: null, database: null, rows: null, items: null, notClassified: null, chats: null, unreadable: null, unsent: null, standIn: null, lumiverse: null, disk: null, underWay: null, imports: null, backup: null, landed: null, carried: null, worldsInStore: null, changes: null, refusals: null };

export const MIGRATED: MigrationReply = {
  report: REPORT,
  text: [
    "Migration report: the real run of 13 Nov 2026, 21:04.",
    "Chats:",
    "  chat-calder: imported, 31 turns (31 on their own path, 0 where they show); matched at the head yes, at 12 of 12 swipes",
    "  chat-harbour: imported, 8 turns (7 on their own path, 1 where they show); shares 4 message(s) with chat-calder; matched at the head no, at 3 of 4 swipes; MARKED: today's state is kept as the start where they differ",
    "    differs at the head: place:harbour.boats",
    "    going back differs (not kept) at message msg-h5, swipe 1: entity:ash.coins",
    "  chat-old: not imported (it plays no world)",
    "Backup: /srv/rpe/backups/before-migration.tar.gz, 46.1 MB",
  ].join("\n"),
  chats: [
    { chat: "chat-calder", outcome: "imported", why: null, turns: 31, shares: null, check: { matched: { head: true, swipes: 12, of: 12 }, differences: [], placed: { own: 31, shown: 0, lost: 0 } }, carried: null },
    {
      chat: "chat-harbour",
      outcome: "imported",
      why: null,
      turns: 8,
      shares: { chat: "chat-calder", messages: 4 },
      check: {
        matched: { head: false, swipes: 3, of: 4 },
        differences: [
          { at: "head", turn: "turn-h8", values: ["place:harbour.boats"], kept: true },
          { at: { message: "msg-h5", swipe: 1 }, turn: "turn-h5b", values: ["entity:ash.coins"], kept: false },
        ],
        placed: { own: 7, shown: 1, lost: 0 },
      },
      carried: null,
    },
    { chat: "chat-old", outcome: "not imported", why: "it plays no world", turns: 0, shares: null, check: { matched: { head: false, swipes: 0, of: 0 }, differences: [], placed: { own: 0, shown: 0, lost: 0 } }, carried: null },
  ],
  backup: { path: "/srv/rpe/backups/before-migration.tar.gz", bytes: 48_340_992, sha256: "4f1d2c9a8b7e6d5c4b3a29180f7e6d5c4b3a29180f7e6d5c4b3a29180f7e6d5c", present: true },
  waiting: [
    { kind: "guidance", path: "imported/GUIDANCE.md" },
    { kind: "connection", setting: "jobs.connections.Harbour Flash.atOnce", connection: "Harbour Flash" },
    { kind: "chat", chat: "chat-harbour", questions: 1, staged: 2, chips: 0, reviewCards: 1, rollback: true },
    { kind: "own", agents: 2, skills: 1, texts: 3 },
    { kind: "filing", chat: "chat-calder", characters: 2, notes: true },
  ],
  goingBack: { steps: STEPS, permissions: [...PREVIOUS_PERMISSIONS] },
  lumiverse: null,
};
