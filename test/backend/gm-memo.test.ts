// The GM view's shared reads (backend/gm-memo.ts): one render per head, each part built once under
// the head's key, nothing built for a read naming the key it holds, and the fold's shared state left
// as it was by every part built from it.

import { describe, expect, test } from "bun:test";
import { readGmPart, type GmReadSteps } from "../../src/backend/gm-memo";
import { toChain } from "../../src/backend/ledger-io";
import { GM_PARTS, GM_ROSTER } from "../../src/shared/gm-parts";
import { deepFreeze } from "../../src/shared/json";
import { MINDS_DEFAULTS } from "../../src/shared/minds";
import { Rig } from "../support/rig";

async function chat(): Promise<{ rig: Rig; chatId: string }> {
  const rig = new Rig({ shipped: true });
  const worldId = await rig.newWorld("Port Alder", "modern_slice_of_life");
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  await rig.turn(chatId, "Hello.", "A quiet morning on Harbor Street.");
  return { rig, chatId };
}

const steps = (): GmReadSteps => ({ render: 0, build: 0, built: [] });

describe("GM reads share one render per head", () => {
  test("a second read at an equal key builds nothing; a read naming its key is answered same", async () => {
    const { rig, chatId } = await chat();
    const core = await rig.rt.ledger.core(chatId, rig.host.userId);
    if (!core) throw new Error("no core");
    const observed = toChain(await rig.host.chats.messages(chatId, rig.host.userId));
    const read = { core, observed, registry: rig.rt.registry, minds: MINDS_DEFAULTS, waitsOn: null, reuse: true };
    const once = steps();
    const first = readGmPart(read, { part: "tiers" }, once);
    expect(once.built).toEqual(["tiers"]);
    const again = steps();
    expect(readGmPart(read, { part: "tiers" }, again)).toEqual(first);
    expect(again.built).toEqual([]);
    const key = first && "key" in first ? first.key : "";
    const same = steps();
    expect(readGmPart(read, { part: "tiers", since: key }, same)).toEqual({ part: "tiers", id: null, key, same: true });
    expect(same.render + same.build).toBe(0);
    // Without reuse, each read builds its own.
    const fresh = steps();
    readGmPart({ ...read, reuse: false }, { part: "tiers" }, fresh);
    expect(fresh.built).toEqual(["tiers"]);
  });

  test("the fold's shared state is left as it was by every part built from it", async () => {
    const { rig, chatId } = await chat();
    const core = await rig.rt.ledger.core(chatId, rig.host.userId);
    if (!core) throw new Error("no core");
    const observed = toChain(await rig.host.chats.messages(chatId, rig.host.userId));
    const shared = core.readState(observed);
    if (!shared) throw new Error("no state");
    const before = JSON.stringify(shared.state);
    // A builder that changed it would throw on the frozen state.
    deepFreeze(shared.state);
    const read = { core, observed, registry: rig.rt.registry, minds: MINDS_DEFAULTS, waitsOn: null, reuse: true };
    for (const part of [...GM_PARTS, GM_ROSTER]) expect(readGmPart(read, { part })).not.toBeNull();
    expect(core.readState(observed)?.state).toBe(shared.state);
    expect(JSON.stringify(shared.state)).toBe(before);
  });
});
