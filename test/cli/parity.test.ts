// Parity (INC3-SPEC U2, INC3-REEVAL §5): every chat and lore tool LumiRPEngine serves outside clients
// answers, through the command line's tools and through `lre.tools call` alike, as the command line's
// own implementation answered before the tools moved into the backend. parity.golden.json holds what
// the old modules (src/cli/tools-play.ts, tools-lore.ts) answered the same script, run with them,
// plus the depth offer (`backend/bootstrap/depth-offer.ts`), a chip added since: both paths read it
// from the one backend view, under the script's played world chat that never chose depth.

import { expect, setSystemTime, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cliRig } from "../support/cli-rig";
import { type ParityCall, PARITY_CLOCK, parityRun } from "../support/parity-script";

const GOLDEN: ParityCall[] = JSON.parse(readFileSync(join(import.meta.dir, "parity.golden.json"), "utf8")) as ParityCall[];

test("every served chat and lore tool answers as the command line's own did, the GM edit's item, place and org ops included", async () => {
  expect(new Set(GOLDEN.map((c) => c.name)).size).toBe(28);
  try {
    setSystemTime(PARITY_CLOCK);
    const cli = await cliRig({ shipped: true });
    expect(await parityRun(cli, (name, args) => cli.raw(name, args))).toEqual(GOLDEN);
    setSystemTime(PARITY_CLOCK);
    const served = await cliRig({ shipped: true });
    expect(await parityRun(served, async (name, args) => (await served.conn.request("lre.tools", { op: "call", name, args: args as never })).result ?? { text: "unanswered", isError: true })).toEqual(GOLDEN);
  } finally {
    setSystemTime();
  }
}, 120_000);
