// Makes the migration's test instance on a test bed by playing today's build (STANDALONE-PLAN §15.5):
// each step makes one part through Lumiverse's API, the engine's own page requests, its CLI or its
// MCP server, logs what it made by id, and finds what an earlier run made before making anything.
//
//   bun make-instance.ts            every step, in order
//   bun make-instance.ts <step> …   only those steps
//
// The environment it needs is in README.md beside this file.

import { openContext, type Step } from "./lib/context";
import { say } from "./lib/record";
import { agents } from "./steps/agents";
import { book } from "./steps/book";
import { chats } from "./steps/chats";
import { checkin } from "./steps/checkin";
import { classic } from "./steps/classic";
import { harness } from "./steps/harness";
import { leftovers } from "./steps/leftovers";
import { own } from "./steps/own";
import { pause } from "./steps/pause";
import { revision } from "./steps/revision";
import { settings } from "./steps/settings";
import { world } from "./steps/world";

// The harness chat plays last: its preparation and turns take the longest, and nothing else waits on them.
const STEPS: Step[] = [checkin, settings, own, book, world, chats, classic, agents, revision, pause, leftovers, harness];

const asked = process.argv.slice(2);
const unknown = asked.filter((name) => !STEPS.some((s) => s.name === name));
if (unknown.length > 0) {
  console.error(`no such step: ${unknown.join(", ")}; the steps are ${STEPS.map((s) => s.name).join(", ")}`);
  process.exit(2);
}

const ctx = await openContext();
say(`signed in as user ${ctx.userId}; the engine is extension ${ctx.extensionId}`);
try {
  for (const step of STEPS) {
    if (asked.length > 0 && !asked.includes(step.name)) continue;
    say(`step ${step.name}: ${step.makes}`);
    await step.run(ctx);
  }
} finally {
  ctx.socket.close();
}
