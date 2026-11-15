// Makes the migration's test instance from nothing, the same way each time (STANDALONE-PLAN §15.5,
// §18.1 row 0.8; PlanScenarios-4): from an empty Lumiverse with its owner, the set-up the owner
// would do (`lib/instance/setup.ts`), the second user's own (`lib/instance/other.ts`), the instance
// user's play on today's build in one fixed order (`steps/`, `lib/instance/stores.ts`), what today's
// build cannot make by play, planted (`lib/instance/planted.ts`), and the read-back (`report.ts`).
// Every step finds what an earlier run made before making anything, so a run cut short is run again.
//
//   bun make-instance.ts            every step, in order, then the read-back
//   bun make-instance.ts <step> …   only those steps (no read-back)
//
// The environment it needs is in README.md beside this file.

import type { Ctx, Step } from "./lib/context";
import { RunLog, say } from "./lib/record";
import { otherContext, ownerContext } from "./lib/instance/context";
import { readInstanceEnv } from "./lib/instance/env";
import { OTHER_STEPS } from "./lib/instance/other";
import { PLANTED_STEPS, unnamedFilePresent } from "./lib/instance/planted";
import { readBack, writeReport } from "./lib/instance/readback";
import { failures } from "./lib/instance/report-doc";
import { SETUP_STEPS, setupContext } from "./lib/instance/setup";
import { STORE_STEP_AFTER, STORE_STEPS } from "./lib/instance/stores";
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

/**
 * The instance user's play steps, in their one order. The store steps come after `harness`, the
 * last play step, each after the one before it (`STORE_STEP_AFTER`): each makes chats of its own,
 * so no play step's stores are disturbed, and the last restarts the extension.
 */
const order: Step[] = [checkin, settings, own, book, world, chats, classic, agents, revision, pause, leftovers, harness, ...STORE_STEPS];
const misplaced = STORE_STEPS.filter((s, i) => STORE_STEP_AFTER[s.name] !== (i === 0 ? harness.name : STORE_STEPS[i - 1]?.name));
if (misplaced.length > 0) throw new Error(`store steps out of their order: ${misplaced.map((s) => s.name).join(", ")}`);

const names = [...SETUP_STEPS.map((s) => s.name), ...OTHER_STEPS.map((s) => s.name), ...order.map((s) => s.name), ...PLANTED_STEPS.map((s) => s.name)];
const asked = process.argv.slice(2);
const unknown = asked.filter((name) => !names.includes(name));
if (unknown.length > 0) {
  console.error(`no such step: ${unknown.join(", ")}; the steps, in order, are ${names.join(", ")}`);
  process.exit(2);
}
const wanted = (name: string): boolean => asked.length === 0 || asked.includes(name);

const env = readInstanceEnv();
const log = new RunLog(env.instanceDir);

const setup = setupContext(env, log);
for (const step of SETUP_STEPS) {
  if (!wanted(step.name)) continue;
  say(`step ${step.name}: ${step.makes}`);
  await step.run(setup);
}

if (OTHER_STEPS.some((s) => wanted(s.name))) {
  const other = await otherContext(env, log);
  try {
    for (const step of OTHER_STEPS) {
      if (!wanted(step.name)) continue;
      say(`step ${step.name} (as the second user): ${step.makes}`);
      await step.run(other);
    }
  } finally {
    other.socket.close();
  }
}

/** Item 5: once the `leftovers` step has placed it, the file no row names is there after every step. */
function unnamedStillThere(ctx: Ctx, after: string): void {
  if (ctx.log.get("planted:unnamed") === undefined) return;
  if (!unnamedFilePresent(ctx)) throw new Error(`the file no row names is gone after the step ${after}`);
  say(`  the file no row names is there after ${after}`);
}

const ownerSteps = [...order, ...PLANTED_STEPS];
let code = 0;
if (ownerSteps.some((s) => wanted(s.name)) || asked.length === 0) {
  const ctx = await ownerContext(env, log);
  say(`signed in as the instance's user ${ctx.userId}; the engine is extension ${ctx.extensionId}`);
  try {
    for (const step of ownerSteps) {
      if (!wanted(step.name)) continue;
      say(`step ${step.name}: ${step.makes}`);
      await step.run(ctx);
      unnamedStillThere(ctx, step.name);
    }
    if (asked.length === 0) {
      say("the read-back");
      const doc = await readBack(ctx, env);
      const sum = writeReport(env, doc);
      const failed = failures(doc);
      for (const line of failed) console.error(`FAIL ${line}`);
      say(`read back ${Object.keys(doc.rows).length} rows; checksum ${sum}`);
      if (failed.length > 0) code = 1;
    }
  } finally {
    ctx.socket.close();
  }
}
process.exit(code);
