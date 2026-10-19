// Build's draft over a world others change too (DESIGN §23), through the real protocol client and a
// fake backend: a newer push reloads once a burst stops, older pushes and Build's own are ignored,
// a commit reads the world again, a discard and every write name the version Build holds, a save
// over a change a form keeps its edits over asks first, and a reconnect reads the draft again.

import { describe, expect, test } from "bun:test";
import type { App, Draft } from "../../src/frontend/app";
import { makeRequest } from "../../src/frontend/app";
import type { Timers } from "../../src/frontend/build/draft";
import { commitDraft, discardDraft, draftSend, loadDraft, QUIET_MS, recheckDraft, trackDraft } from "../../src/frontend/build/draft";
import { heldForms } from "../../src/frontend/build/held";
import { ProtocolClient } from "../../src/frontend/protocol-client";
import { createStore } from "../../src/frontend/store";
import type { FrontendToBackend } from "../../src/shared/protocol";
import { PROTOCOL_VERSION } from "../../src/shared/protocol";
import { testWorld } from "../support/test-pack";

const RELOADED = "This world's draft changed in another window, or an outside agent changed it; Build reloaded it.";

/** A Build app over a fake backend whose working copy of each world is at `backend.version`; replies wait until `answer`, timers until `fire`. */
function harness() {
  const sent: FrontendToBackend[] = [];
  const replies: (() => void)[] = [];
  let deliver: (payload: unknown) => void = () => undefined;
  const backend = { version: 1, stored: true, name: "Testville", refuse: null as string | null };
  const client = new ProtocolClient({
    send(payload) {
      sent.push(payload);
      // The answer is what the backend holds when the request is handled, as on the host.
      const doc = { ...testWorld(), name: backend.name };
      // A refusal answers one request: the reload it leads to reads what the backend holds.
      const refused = backend.refuse !== null && payload.type === backend.refuse;
      if (refused) backend.refuse = null;
      const body = payload.type === "lre.editor" ? { draft: doc, lint: [], base: "r1", stored: backend.stored, version: backend.version } : payload.type === "lre.world" && payload.op === "commit" ? { revision: "r2", lint: [] } : { world: doc, revision: "r1" };
      replies.push(() => deliver(refused ? { lre: PROTOCOL_VERSION, type: "lre.error", reqId: payload.reqId, code: "conflict", message: "stale" } : { lre: PROTOCOL_VERSION, type: "lre.result", reqId: payload.reqId, request: payload.type, body }));
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
  const pending: (() => void)[] = [];
  const timers: Timers = {
    set: (fn) => {
      const entry = { fn, live: true };
      pending.push(() => entry.live && entry.fn());
      return entry;
    },
    clear: (handle) => {
      if (typeof handle === "object" && handle !== null && "live" in handle) handle.live = false;
    },
  };
  const confirms: string[] = [];
  const answers = { confirm: true };
  // Build's draft code reads only these members of the app.
  const app = { client, send: client.send, drafts: createStore<Draft | null>(null), toast, request: makeRequest(client.send, toast), host: { confirm: async (title: string) => (confirms.push(title), answers.confirm) } } as unknown as App;
  trackDraft(app, timers);
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
    answers,
    confirms,
    /** Fires the timers set so far, as QUIET_MS passing would. */
    fire: async (): Promise<void> => {
      for (const run of pending.splice(0)) run();
      await answer();
    },
    loaded: async (worldId: string): Promise<void> => {
      const load = loadDraft(app, worldId);
      await answer();
      await load;
    },
    push: (worldId: string, version: number, base: string | null = "r1"): void => deliver({ lre: PROTOCOL_VERSION, type: "lre.draft.changed", worldId, version, stored: version > 0, base }),
    raw: (payload: Record<string, unknown>): void => deliver({ lre: PROTOCOL_VERSION, type: "lre.draft.changed", ...payload }),
    gets: (): number => sent.filter((m) => m.type === "lre.editor" && m.op === "get").length,
    sent,
    toasts,
  };
}

describe("Build's reload on a changed draft", () => {
  test("a newer version reloads once the burst stops, with one toast; older pushes, Build's own and other worlds' do nothing", async () => {
    expect(QUIET_MS).toBeGreaterThan(0);
    const h = harness();
    await h.loaded("w1");
    expect([h.app.drafts.get()?.version, h.gets()]).toEqual([1, 1]);
    h.push("w1", 1);
    h.push("w1", 0);
    h.push("w2", 7);
    await h.fire();
    expect([h.gets(), h.toasts]).toEqual([1, []]);
    // An agent's quick writes: five pushes, one reload of what they left.
    for (let v = 2; v <= 6; v++) {
      h.backend.version = v;
      h.push("w1", v);
    }
    h.backend.name = "Renamed by an agent";
    await h.fire();
    expect([h.gets(), h.app.drafts.get()?.version, h.app.drafts.get()?.doc.name, h.toasts]).toEqual([2, 6, "Renamed by an agent", [RELOADED]]);
    // A stale push after the reload is older than what Build holds now.
    h.push("w1", 4);
    await h.fire();
    expect([h.gets(), h.toasts.length]).toEqual([2, 1]);
  });

  test("a push during a load waits for it: a load that read the change reloads nothing more, one that didn't reloads once", async () => {
    const h = harness();
    await h.loaded("w1");
    h.backend.version = 2;
    const own = loadDraft(h.app, "w1");
    h.push("w1", 2);
    await h.answer();
    await own;
    await h.fire();
    expect([h.gets(), h.app.drafts.get()?.version, h.toasts]).toEqual([2, 2, []]);
    const stale = loadDraft(h.app, "w1");
    h.backend.version = 3;
    h.push("w1", 3);
    await h.answer();
    await stale;
    await h.fire();
    expect([h.gets(), h.app.drafts.get()?.version, h.toasts]).toEqual([4, 3, [RELOADED]]);
  });

  test("a push missing or mistyping a field is ignored", async () => {
    const h = harness();
    await h.loaded("w1");
    for (const bad of [{ worldId: "w1", version: "5", stored: true, base: "r1" }, { worldId: 1, version: 5, stored: true, base: "r1" }, { worldId: "w1", version: 5, stored: true }]) h.raw(bad);
    await h.fire();
    expect([h.gets(), h.toasts]).toEqual([1, []]);
  });

  test("a reconnect reads the draft again, and says so only when it changed", async () => {
    const h = harness();
    await h.loaded("w1");
    const same = recheckDraft(h.app);
    await h.answer();
    await same;
    h.backend.version = 4;
    const changed = recheckDraft(h.app);
    await h.answer();
    await changed;
    expect([h.gets(), h.app.drafts.get()?.version, h.toasts]).toEqual([3, 4, [RELOADED]]);
  });
});

describe("Build's writes, commits and discards", () => {
  test("every write names the version Build holds, and a refused one reloads", async () => {
    const h = harness();
    await h.loaded("w1");
    const send = draftSend(h.app);
    const put = send({ type: "lre.editor", worldId: "w1", base: null, op: "put", collection: "places", id: "pier", value: { id: "pier", name: "Pier", fields: {} } });
    await h.answer();
    await put;
    expect(h.sent.at(-1)).toMatchObject({ type: "lre.editor", op: "put", version: 1 });
    // An agent wrote meanwhile, so the version Build names is stale.
    h.backend.refuse = "lre.editor";
    h.backend.version = 5;
    const refused = send({ type: "lre.editor", worldId: "w1", base: null, op: "remove", collection: "places", id: "pier" });
    await h.answer();
    expect((await refused).type).toBe("lre.error");
    await h.answer();
    expect(h.app.drafts.get()?.version).toBe(5);
  });

  test("a save over a change a form keeps its edits over asks first; declined, nothing is sent", async () => {
    const h = harness();
    await h.loaded("w1");
    const kept: string[] = [];
    const form = { loadTheirs: () => kept.push("theirs"), keepMine: () => kept.push("mine") };
    heldForms.set([form]);
    try {
      const send = draftSend(h.app);
      const body = { type: "lre.editor", worldId: "w1", base: null, op: "set", part: "meta", value: { name: "Mine" } } as const;
      h.answers.confirm = false;
      const before = h.sent.length;
      expect((await send(body)).type).toBe("lre.error");
      expect([h.sent.length - before, h.confirms.length, kept]).toEqual([0, 1, []]);
      h.answers.confirm = true;
      const saved = send(body);
      for (let i = 0; i < 5; i++) await Promise.resolve();
      await h.answer();
      expect((await saved).type).toBe("lre.result");
      expect([h.sent.length - before, h.confirms.length, kept]).toEqual([1, 2, ["mine"]]);
    } finally {
      heldForms.set([]);
    }
  });

  test("a commit names the version Build reviewed, then reads the world again rather than keeping what it held", async () => {
    const h = harness();
    await h.loaded("w1");
    const committing = commitDraft(h.app);
    // An agent writes a new draft between the commit and its answer.
    h.backend.version = 3;
    h.backend.name = "Changed by the agent";
    for (let i = 0; i < 5; i++) await h.answer();
    expect(await committing).toBe(true);
    expect(h.sent.find((m) => m.type === "lre.world" && m.op === "commit")).toMatchObject({ version: 1 });
    expect([h.app.drafts.get()?.version, h.app.drafts.get()?.dirty, h.app.drafts.get()?.doc.name]).toEqual([3, true, "Changed by the agent"]);
  });

  test("a discard names the version shown when Build asked; refused, it reloads instead", async () => {
    const h = harness();
    await h.loaded("w1");
    h.backend.refuse = "lre.editor";
    const discarding = discardDraft(h.app);
    for (let i = 0; i < 5; i++) await Promise.resolve();
    h.backend.refuse = null;
    h.backend.version = 2;
    await h.answer();
    await discarding;
    await h.answer();
    expect(h.sent.find((m) => m.type === "lre.editor" && m.op === "discard")).toMatchObject({ version: 1 });
    expect([h.app.drafts.get()?.version, h.toasts.at(-1)]).toEqual([2, "Nothing was discarded: the draft changed while you were asked. Build reloaded it."]);
  });
});
