// A reminder is in force only while the home it names is (plan §5.4 `needs:`, D.2): `history-leaving`,
// shipped in force, names `TURN.md`, so it reminds at a turn's start while `TURN.md` is in force and
// says nothing once the user switches that file off. RPH's loader and its rule engine run on the shipped
// set as RPE lays it (`test/guidance/set.ts`), with RPE's story facts declared and one of them holding.
// Every name is invented.

import { afterEach, expect, test } from "bun:test";
import type { AgentRef, FactValue } from "rp-harness/contract";
import { STORY_FACT_DEFS } from "../../src/story";
import { openSet, type OpenSet, shippedTexts } from "../guidance/set";

const AUTHOR: AgentRef = { id: "author-1", definition: "author" };

const opened: OpenSet[] = [];
afterEach(async () => {
  for (const set of opened.splice(0)) await set.close();
});

/** What the Author is reminded of at the start of a turn, when two messages are about to leave the prompt uncovered; `config` is the user's own global file. */
async function remindedOf(config: string): Promise<string[]> {
  const set = await openSet(shippedTexts(), { defs: STORY_FACT_DEFS });
  opened.push(set);
  if (config !== "") set.put("global", "config.yml", config);
  const uncovered: FactValue = { count: 2, fields: { range: { ".": [1, 2], from: 1, to: 2 } } };
  set.facts({ "history.leaving.uncovered": uncovered });
  const facts = { defs: () => set.host.facts.defs(), read: (scope: typeof set.scope, _agent: AgentRef, names: readonly string[]) => set.host.facts.read(scope, [...names]) };
  const run = await set.guidance().ruleRun({ facts });
  return (await run.turnStart(AUTHOR)).map((fired) => fired.firing.rule);
}

test("a reminder that needs TURN.md reminds at a turn's start, and says nothing once TURN.md is switched off", async () => {
  expect(await remindedOf("")).toEqual(["history-leaving"]);
  expect(await remindedOf("off: [TURN]\n")).toEqual([]);
});
