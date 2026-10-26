// A page's view and its reply across what Lumiverse does to a page's connection (DESIGN §5.1, §23):
// the engine's real protocol client on the fake host, carried as Lumiverse carries it (`Pages`):
// dropped while the socket is down or not yet authenticated, and lost when sent to a page that isn't
// connected. A page that reconnects, comes back into view, or whose engine starts again asks again
// and is answered at once, even while a turn holds the chat; two pages on one chat never knock each
// other out of sync.

import { describe, expect, test } from "bun:test";
import { watchReconnects, type HostEvents } from "../../src/frontend/reconnect";
import { startPreparedReplies } from "../../src/frontend/restart";
import type { Generation } from "../support/fake-host";
import { type Page, Pages, tick } from "../support/pages";
import { Rig } from "../support/rig";
import { POV } from "../support/test-pack";

/** The engine's installation id, as `ctx.host.extensionInstallationId` names it. */
const INSTALL = "install-lre";

/** The host events a page listens to (`ctx.events`), played by the test. */
class Events implements HostEvents {
  private readonly handlers = new Map<string, Set<(payload: unknown) => void>>();
  on(event: string, handler: (payload: unknown) => void): () => void {
    const set = this.handlers.get(event) ?? new Set();
    set.add(handler);
    this.handlers.set(event, set);
    return () => set.delete(handler);
  }
  emit(event: string, payload: unknown): void {
    for (const handler of this.handlers.get(event) ?? []) handler(payload);
  }
}

interface Lumiverse {
  page: Page;
  events: Events;
  /** The generations the page started for the engine's prepared replies. */
  replies: Promise<Generation>[];
}

/** A page as `setup.tsx` composes it: it asks again on Lumiverse's reconnect signals and starts the replies it is asked to. */
function lumiversePage(pages: Pages, session: string, chatId: string): Lumiverse {
  const page = pages.open(session);
  const events = new Events();
  const replies: Promise<Generation>[] = [];
  watchReconnects(events, INSTALL, () => page.client.retry());
  startPreparedReplies(page.client, {
    activeChat: () => chatId,
    generate: async (as) => {
      replies.push(pages.rig.host.begin(chatId, { type: as === "continue" ? "continue" : "regenerate", session }));
      return true;
    },
    toast: () => undefined,
  });
  void page.client.open(chatId);
  return { page, events, replies };
}

/** The activity lines sent to every page, or to `session`, from `from` on. */
function labels(rig: Rig, from: number, session?: string): (string | null)[] {
  return rig.host.sent.flatMap((m, i) => {
    const to = rig.host.sentTo[i]?.session;
    return i >= from && (to === undefined || to === session) && m.type === "lre.activity" ? [m.activity?.label ?? null] : [];
  });
}

describe("pages across reconnects", () => {
  test("a page whose socket dropped while its reply was prepared starts it once Lumiverse acknowledges the reconnect", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    const pages = new Pages(rig);
    const desk = lumiversePage(pages, "desk", chatId);
    await pages.settle();
    expect(desk.page.client.getState().status).toBe("live");
    rig.host.sendUser(chatId, "I look around.");
    await pages.settle();
    // The socket drops as Send's generation is stopped for the engine run; Lumiverse says the page closed,
    // and the ask to start the reply, sent to the page, is lost.
    desk.page.drop();
    const from = rig.host.sent.length;
    expect((await rig.host.begin(chatId, { type: "normal", session: "desk" })).halted).toBe("cancelled");
    await pages.settle();
    expect(labels(rig, from).at(-1)).toBe("Ready; reopen the chat to continue");
    // The socket opens: the CONNECTED it emits comes before Lumiverse authenticated it, so anything sent then is dropped.
    desk.events.emit("CONNECTED", {});
    await pages.settle();
    // Lumiverse authenticates it and says so.
    desk.page.connected = true;
    desk.events.emit("CONNECTED", { message: "Connected to Lumiverse event bus", userId: rig.host.userId, role: "owner" });
    await pages.settle();
    expect(desk.replies).toHaveLength(1);
    const reply = await desk.replies[0];
    expect(reply?.halted).toBeUndefined();
    expect(desk.page.client.getState()).toMatchObject({ status: "live", chatId });
  });

  test("a page out of view when its reply is ready starts it once it is back in view, and only then", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    const pages = new Pages(rig);
    const desk = lumiversePage(pages, "desk", chatId);
    await pages.settle();
    // The phone locks, or another window covers the tab: the page says it is out of view (setup's `visibilitychange`).
    desk.page.visible = false;
    desk.page.client.page();
    await pages.settle();
    rig.host.sendUser(chatId, "I look around.");
    await pages.settle();
    const from = rig.host.sent.length;
    expect((await rig.host.begin(chatId, { type: "normal", session: "desk" })).halted).toBe("cancelled");
    await pages.settle();
    expect(desk.replies).toHaveLength(0);
    expect(labels(rig, from).at(-1)).toBe("Ready; reopen the chat to continue");
    // Back in view: setup asks again (`recheck`), saying the page shows the chat on screen.
    desk.page.visible = true;
    desk.page.client.retry();
    await pages.settle();
    expect(desk.page.sent.filter((m) => m.type === "lre.state.resync").at(-1)).toMatchObject({ chatId, viewing: true });
    expect(desk.replies).toHaveLength(1);
    expect((await desk.replies[0])?.halted).toBeUndefined();
  });

  test("a resync answers while a turn's step holds the chat: the page is live at once, not after the step", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    const pages = new Pages(rig);
    const desk = lumiversePage(pages, "desk", chatId);
    await pages.settle();
    // A turn's read runs on the chat's queue (on lumi-dev a resync waited 11.3 s behind one, ending as it did).
    // The step here lasts a hundred turns of the event loop, while the page resyncs.
    const from = rig.host.sent.length;
    let duringStep = false;
    await rig.rt.ledger.with(chatId, rig.host.userId, async () => {
      desk.page.client.retry();
      for (let turn = 0; turn < 100 && !duringStep; turn++) {
        duringStep = rig.host.sent.slice(from).some((m) => m.type === "lre.state.snapshot" && m.chatId === chatId);
        if (!duringStep) await tick();
      }
    });
    await pages.settle();
    expect(duringStep).toBe(true);
    expect(desk.page.client.getState().status).toBe("live");
  });

  test("two pages on one chat stay live through each other's resyncs: a change reaches both as a delta", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    const pages = new Pages(rig);
    const desk = lumiversePage(pages, "desk", chatId);
    const phone = lumiversePage(pages, "phone", chatId);
    await pages.settle();
    // The phone comes back into view and resyncs; an outside client opening the chat does the same.
    phone.page.client.retry();
    await pages.settle();
    const deskAsked = desk.page.sent.length;
    rig.body(await rig.send({ type: "lre.fix", chatId, entity: POV, field: "mood", value: "calm" }));
    await pages.settle();
    expect(desk.page.sent.slice(deskAsked).filter((m) => m.type === "lre.state.resync")).toEqual([]);
    for (const page of [desk.page, phone.page]) {
      expect(page.client.getState().status).toBe("live");
      expect(JSON.stringify(page.client.getState().view)).toContain("calm");
    }
  });

  test("a page whose engine started again asks again: a running line from before the restart clears", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    const pages = new Pages(rig);
    const desk = lumiversePage(pages, "desk", chatId);
    await pages.settle();
    // The old engine said a turn was running, then its worker stopped mid-turn (an update or a restart).
    rig.host.frontend.send({ lre: 1, type: "lre.activity", chatId, activity: { chatId, turn: "t1", state: "running", label: "Reading the reply…", since: 1 } }, rig.host.userId);
    await pages.settle();
    expect(desk.page.client.getState().activity?.state).toBe("running");
    pages.rig = rig.restart();
    // Another extension starting says nothing to this page.
    desk.events.emit("SPINDLE_EXTENSION_LOADED", { extensionId: "install-other", identifier: "other", name: "Other" });
    await pages.settle();
    expect(desk.page.client.getState().activity?.state).toBe("running");
    desk.events.emit("SPINDLE_EXTENSION_LOADED", { extensionId: INSTALL, identifier: "lumi_rp_engine", name: "LumiRPEngine" });
    await pages.settle();
    expect(desk.page.client.getState()).toMatchObject({ status: "live", activity: null });
  });
});
