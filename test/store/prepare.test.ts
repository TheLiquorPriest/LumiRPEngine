// The pass that makes a chat's states ready for the build that runs (`src/store/prepare.ts`): a read that names a chat must wait for
// it from RPE's first moment, whether or not RPE has said yet that it started.

import { expect, test } from "bun:test";
import { Preparer, type PreparerDeps } from "../../src/store/prepare";

/** A store that holds one chat wanting the pass, made ready in `stretches` stretches; `folded` counts the stretches asked for. */
function rig(stretches: number): { preparer: Preparer; folded: () => number } {
  let folded = 0;
  const user = {
    unprepared: () => ["chat"],
    prepareNext: () => {
      folded++;
      return { at: `node-${folded}`, left: stretches - folded, changes: 1, wanted: stretches };
    },
    storeHeld: () => undefined,
  };
  const deps = { store: { user: () => user }, user: () => "owner", write: async (write: () => void) => write(), log: { info: () => undefined, warn: () => undefined } };
  return { preparer: new Preparer(deps as unknown as PreparerDeps), folded: () => folded };
}

test("a read that comes before RPE said it started begins the pass and waits for its chat", async () => {
  const { preparer, folded } = rig(3);
  let answered = false;
  const read = preparer.ready("owner", "chat").then(() => {
    answered = true;
  });
  // The pass is under way with the read's chat, and the read has not gone past it.
  expect(folded()).toBe(1);
  expect(preparer.preparing("owner", "chat")).not.toBeNull();
  await Promise.resolve();
  expect(answered).toBe(false);
  await read;
  expect(folded()).toBe(3);
  // RPE's own call once it listens finds the pass made, and makes none again.
  preparer.start();
  expect(folded()).toBe(3);
  expect(preparer.preparing("owner", "chat")).toBeNull();
});
