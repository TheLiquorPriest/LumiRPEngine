// Reads the test instance back as the instance's user (`lib/instance/readback.ts`): the run's
// commits and users, the world part by part with which revision each chat plays, and every row of
// STANDALONE-PLAN §15.2 by today's build's own reads. Writes `report.json` and `report.sha256` into
// the instance folder and prints the checksum. It changes nothing.
//
//   bun report.ts                    read back; exit 1 if a world part holds nothing, a row read nothing back, or a read failed
//   bun report.ts --expect <sha256>  the same, and exit 1 unless the read-back's checksum is the one given
//                                    (after `golden.sh restore`: the checksum kept beside the golden copy)
//   bun report.ts --unnamed          only whether the one file no row names is where the run placed it
//
// The environment it needs is in README.md beside this file.

import { RunLog } from "./lib/record";
import { ownerContext } from "./lib/instance/context";
import { readInstanceEnv } from "./lib/instance/env";
import { unnamedFilePresent } from "./lib/instance/planted";
import { readBack, writeReport } from "./lib/instance/readback";
import { failures, waiting } from "./lib/instance/report-doc";

const args = process.argv.slice(2);
const expectAt = args.indexOf("--expect");
const expected = expectAt >= 0 ? args[expectAt + 1] : undefined;
if (expectAt >= 0 && (expected === undefined || !/^[0-9a-f]{64}$/.test(expected))) {
  console.error("--expect takes the 64-character checksum kept beside the golden copy");
  process.exit(2);
}

const env = readInstanceEnv();
const log = new RunLog(env.instanceDir);
const ctx = await ownerContext(env, log);
let code = 0;
try {
  if (args.includes("--unnamed")) {
    const there = unnamedFilePresent(ctx);
    console.log(there ? "the file no row names is there" : "the file no row names is not there");
    code = there ? 0 : 1;
  } else {
    const doc = await readBack(ctx, env);
    const { checksum: sum } = writeReport(env, doc);
    const failed = failures(doc);
    for (const line of failed) console.error(`FAIL ${line}`);
    for (const line of waiting(doc)) console.log(`WAITS ${line}`);
    console.log(`rows read back: ${Object.keys(doc.rows).length}; world parts: ${Object.keys(doc.world.parts).length}, empty: ${doc.world.empty.length}; revisions: ${doc.world.revisions}`);
    console.log(`checksum ${sum}`);
    if (failed.length > 0) code = 1;
    if (expected !== undefined && sum !== expected) {
      console.error(`FAIL the read-back's checksum is ${sum}, not the kept ${expected}`);
      code = 1;
    }
  }
} finally {
  ctx.socket.close();
}
process.exit(code);
