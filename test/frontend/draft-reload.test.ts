// Build's reload on `lre.draft.changed` (DESIGN §23), through the real protocol client and a fake
// backend: a draft changed elsewhere reloads with a toast; Build's own write, another world, a
// malformed push and a load already under way that read the change reload nothing.

import { describe, expect, test } from "bun:test";
import type { Draft } from "../../src/frontend/app";
import { makeRequest } from "../../src/frontend/app";
import { loadDraft, trackDraft } from "../../src/frontend/build/draft";
import { ProtocolClient } from "../../src/frontend/protocol-client";
import { createStore } from "../../src/frontend/store";
import type { FrontendToBackend } from "../../src/shared/protocol";
import { PROTOCOL_VERSION } from "../../src/shared/protocol";
import { testWorld } from "../support/test-pack";

const RELOADED = "This world's draft changed in another window, or an outside agent changed it; Build reloaded it.";

/** A Build app over a fake backend whose stored draft of each world is at `backend.version`; replies wait until `answer`. */
function harness() {
  const sent: FrontendToBackend[] = [];
  const replies: (() => void)[] = [];
  let deliver: (payload: unknown) => void = () => undefined;
  const backend = { version: 1, name: "Testville" };
  const client = new ProtocolClient({
    send(payload) {
      sent.push(payload);
      // The answer is what the backend holds when the request is handled, as on the host.
      const doc = { ...testWorld(), name: backend.name };
      const body = payload.type === "lre.editor" ? { draft: doc, lint: [], base: "r1", stored: backend.version > 0, version: backend.version } : { world: doc, revision: "r1" };
      replies.push(() => deliver({ lre: PROTOCOL_VERSION, type: "lre.result", reqId: payload.reqId, request: payload.type, body }));
    },
    subscribe(handler) {
      deliver = handler;
      return () => undefined;
    },
  });
  const toasts: string[] = [];
  const toast = (text: string): void => {
    toasts.push(text);
  };
  const app = { client, drafts: createStore<Draft | null>(null), toast, request: makeRequest(client.send, toast) };
  trackDraft(app);
  /** Delivers every reply sent so far, and the ones they lead to, until nothing is left to do. */
  const answer = async (): Promise<void> => {
    for (let round = 0; round < 50; round++) {
      while (replies.length > 0) replies.shift()?.();
      await Promise.resolve();
    }
  };
  return {
    app,
    backend,
    answer,
    /** A draft load as Build starts one, answered. */
    loaded: async (worldId: string): Promise<void> => {
      const load = loadDraft(app, worldId);
      await answer();
      await load;
    },
    raw: (payload: Record<string, unknown>): void => deliver({ lre: PROTOCOL_VERSION, type: "lre.draft.changed", ...payload }),
    push: (worldId: string, version: number): void => deliver({ lre: PROTOCOL_VERSION, type: "lre.draft.changed", worldId, version, stored: version > 0 }),
    gets: (): number => sent.filter((m) => m.type === "lre.editor").length,
    toasts,
  };
}

describe("Build's reload on a changed draft", () => {
  test("another version reloads the draft and says so; Build's own version, or another world's, does nothing", async () => {
    const h = harness();
    await h.loaded("w1");
    expect([h.app.drafts.get()?.version, h.gets()]).toEqual([1, 1]);
    // Build's own write answered with version 1 before its push came.
    h.push("w1", 1);
    h.push("w2", 7);
    await h.answer();
    expect([h.gets(), h.toasts]).toEqual([1, []]);
    h.backend.version = 2;
    h.backend.name = "Renamed by an agent";
    h.push("w1", 2);
    await h.answer();
    expect([h.gets(), h.app.drafts.get()?.version, h.app.drafts.get()?.doc.name, h.toasts]).toEqual([2, 2, "Renamed by an agent", [RELOADED]]);
    // A discard elsewhere (no stored draft, version 0) is a change too.
    h.backend.version = 0;
    h.push("w1", 0);
    await h.answer();
    expect([h.gets(), h.app.drafts.get()?.version, h.app.drafts.get()?.dirty, h.toasts.length]).toEqual([3, 0, false, 2]);
  });

  test("a push during a load waits for it: a load that read the change reloads nothing more, one that didn't reloads", async () => {
    const h = harness();
    await h.loaded("w1");
    // Saving to lore from Play: the save's own load is under way, already reading version 2, when its push comes.
    h.backend.version = 2;
    const own = loadDraft(h.app, "w1");
    h.push("w1", 2);
    await h.answer();
    await own;
    expect([h.gets(), h.app.drafts.get()?.version, h.toasts]).toEqual([2, 2, []]);
    // A load whose read went out before the change: the push reloads once that load is in.
    const stale = loadDraft(h.app, "w1");
    h.backend.version = 3;
    h.push("w1", 3);
    await h.answer();
    await stale;
    await h.answer();
    expect([h.gets(), h.app.drafts.get()?.version, h.toasts]).toEqual([4, 3, [RELOADED]]);
  });

  test("a push missing or mistyping a field is ignored", async () => {
    const h = harness();
    await h.loaded("w1");
    for (const bad of [{ worldId: "w1", version: "5", stored: true }, { worldId: 1, version: 5, stored: true }, { worldId: "w1", version: 5 }]) h.raw(bad);
    await h.answer();
    expect([h.gets(), h.toasts]).toEqual([1, []]);
  });
});
