// The stand-in page's frontend API (STANDALONE-PLAN §4.3 "Frontend", §14 "In the chat"): a Lumiverse page
// of the stand-in (`test/standin/page.ts`) loads RPE's frontend module, the light extension's loader
// (`src/ext/loader.ts`) with a shell, as Lumiverse's loader loads a frontend, and gives it what Lumiverse
// gives: the drawer tab, widgets and decorators under the replies, a float widget and a dock panel where
// `ui_panels` is granted, and a composer action. Each test reads back what the module registered, as the
// rig reads the chat adornments. Every name and message is invented.

import { afterEach, describe, expect, test } from "bun:test";
import type { SpindleDockPanelHandle, SpindleDrawerTabHandle, SpindleFloatWidgetHandle, SpindleFrontendContext, SpindleInputBarActionHandle } from "lumiverse-spindle-types";
import manifest from "../../../spindle.json";
import { EXTENSION_IDENTIFIER } from "../../../src/adapter/lumiverse/pipe-wire";
import { loader, type ShellMount, TAB } from "../../../src/ext/loader";
import { startExtension } from "../../../src/ext/start";
import type { HostUi } from "../../../src/spindle-augment";
import { FakeClock } from "../../standin/clock";
import { StandInDb } from "../../standin/db";
import { LumiverseServer } from "../../standin/http";
import { type Installed, StandIn } from "../../standin/lumiverse";
import { openPage, type StandInPage } from "../../standin/page";
import type { PageElement } from "../../ui/kept/dom";

const ACCOUNT = { id: "user-wren", username: "wren", password: "moss and tallow" };
const CHAT = "chat-lantern";
const ASKED = "msg-ask";
const REPLY = "msg-reply";
const OTHER_PAGE = "0123456789abcdef0123456789abcdef";
/** What RPE's extension tells a page while no RPE has registered with it (`src/ext/pipe.ts:77`). */
const NOT_CONNECTED = "RPE does not belong to your Lumiverse user, or it has not connected to Lumiverse yet.";
/** Everything the light extension asks for (`spindle.json`). */
const ALL = manifest.permissions;
const WITHOUT_PANELS = ALL.filter((permission) => permission !== "ui_panels");

const closing: (() => void)[] = [];
afterEach(() => {
  for (const close of closing.splice(0).reverse()) close();
});

interface Bed {
  clock: FakeClock;
  db: StandInDb;
  server: LumiverseServer;
  installed: Installed;
  page: StandInPage;
}

/** The stand-in Lumiverse with a chat of two messages, RPE's extension installed with `granted` (and its backend running when asked), and a page of the user's open on it. */
async function openBed(granted: readonly string[], options: { backend?: boolean } = {}): Promise<Bed> {
  const clock = new FakeClock();
  const db = new StandInDb();
  closing.push(() => db.close());
  db.write({
    user: [{ id: ACCOUNT.id, name: "Wren", email: "wren@example.invalid", username: ACCOUNT.username }],
    characters: [{ id: "char-mara", name: "Mara", user_id: ACCOUNT.id }],
    chats: [{ id: CHAT, character_id: "char-mara", name: "The lantern road", metadata: JSON.stringify({ active_avatar_id: "img-mara-dusk" }), user_id: ACCOUNT.id }],
    messages: [
      { id: ASKED, chat_id: CHAT, index_in_chat: 0, is_user: 1, name: "Wren", content: "I lift the lantern to the gate.", swipes: JSON.stringify(["I lift the lantern to the gate."]) },
      { id: REPLY, chat_id: CHAT, index_in_chat: 1, is_user: 0, name: "Mara", content: "The iron answers with frost.", swipes: JSON.stringify(["The iron answers with frost."]) },
    ],
    world_books: [],
    world_book_entries: [],
    personas: [],
    presets: [],
    settings: [],
    message_breakdowns: [],
  });
  const server = new LumiverseServer({ clock, db, host: new StandIn(), accounts: [ACCOUNT] });
  closing.push(() => server.stop());
  const installed = server.install(EXTENSION_IDENTIFIER, granted);
  if (options.backend === true) {
    const running = await startExtension(installed);
    closing.push(() => running.stop());
  }
  return { clock, db, server, installed, page: await openOn(server, installed) };
}

async function openOn(server: LumiverseServer, installed: Bed["installed"], session?: string): Promise<StandInPage> {
  const page = await openPage({ server, signIn: { username: ACCOUNT.username, password: ACCOUNT.password }, extension: installed, manifest, ...(session !== undefined ? { session } : {}) });
  closing.push(() => page.close());
  return page;
}

/** Moves the test's clock until `check` gives something. */
async function until<T>(clock: FakeClock, what: string, check: () => T | null | undefined | false): Promise<T> {
  for (let step = 0; step < 200; step++) {
    const got = check();
    if (got) return got;
    await clock.advance(5);
  }
  throw new Error(`the page never had ${what}`);
}

/** What a promise came to, once it has. */
function settled<T>(promise: Promise<T>): () => { value: T } | null {
  let result: { value: T } | null = null;
  void promise.then((value) => {
    result = { value };
  });
  return () => result;
}

/** RPE's frontend module with a shell that does `use` with what the loader hands it; the shell's cleanup is counted. */
function rpeModule(use: (mount: ShellMount) => void = () => undefined): { module: { setup: (ctx: SpindleFrontendContext) => () => void }; mounts: ShellMount[]; unmounted: () => number } {
  const mounts: ShellMount[] = [];
  let unmounted = 0;
  const setup = loader((mount) => {
    mounts.push(mount);
    use(mount);
    return () => {
      unmounted++;
    };
  });
  return { module: { setup }, mounts, unmounted: () => unmounted };
}

const footerOf = (page: StandInPage, messageId: string) => page.message(messageId)?.querySelector('[data-spindle-mount="message_footer"]') ?? null;

describe("the stand-in page's frontend API", () => {
  test("RPE's frontend module mounts", async () => {
    const b = await openBed(ALL, { backend: true });
    // A second page of the same user, to show the backend's answer goes to the page that asked alone.
    const other = await openOn(b.server, b.installed, OTHER_PAGE);
    const heardElsewhere: unknown[] = [];
    await other.load({ setup: (ctx) => void ctx.onBackendMessage((payload) => heardElsewhere.push(payload)) });

    const rpe = rpeModule();
    await b.page.load(rpe.module);
    const [mount] = rpe.mounts;
    const [tab] = b.page.drawerTabs();
    if (mount === undefined || tab === undefined) throw new Error("RPE's frontend module did not mount in a drawer tab");
    expect(rpe.mounts).toHaveLength(1);
    expect(mount.root).toBe(tab.root as unknown as HTMLElement);
    expect(mount.ctx.frontendSessionId).toBe(b.page.session);

    // The loader's road reaches RPE's extension over the page's socket; the answer comes back to this page.
    const sent = b.page.socket.stats.framesIn;
    const answer = await until(b.clock, "RPE's answer to its start", settled(mount.road.start()));
    expect(answer.value).toEqual({ facts: null, error: NOT_CONNECTED, missing: [] });
    expect(b.page.socket.stats.framesIn).toBe(sent + 1);
    expect(heardElsewhere).toEqual([]);

    // Unloaded: the cleanup the module returned runs, its tab goes, and its context is dead.
    b.page.unload();
    expect(rpe.unmounted()).toBe(1);
    expect(b.page.drawerTabs()).toEqual([]);
    expect(tab.root.isConnected).toBe(false);
    expect(() => mount.road.start()).toThrow("SPINDLE_FRONTEND_INACTIVE");
  });

  test("what the backend says before the frontend is ready waits for it", async () => {
    const b = await openBed(ALL, { backend: true });
    const heard: unknown[] = [];
    let ready = (): void => undefined;
    const holding = (ctx: SpindleFrontendContext): void => {
      ctx.deferReady();
      ctx.onBackendMessage((payload) => heard.push(payload));
      ctx.sendToBackend({ rpe: "start" });
      ready = () => ctx.ready();
    };
    await b.page.load({ setup: holding });
    await until(b.clock, "RPE's answer on its socket", () => b.page.socket.stats.framesOut > 0);
    await b.clock.advance(50);
    expect(heard).toEqual([]);
    ready();
    expect(heard).toEqual([{ rpe: "start", facts: null, error: NOT_CONNECTED, missing: [] }]);

    // Left unready, what came is let through once the frontend has had ten seconds (`loader.ts:441`).
    heard.length = 0;
    const framesOut = b.page.socket.stats.framesOut;
    await b.page.load({ setup: holding });
    await until(b.clock, "RPE's second answer on its socket", () => b.page.socket.stats.framesOut > framesOut);
    await b.clock.advance(9_000);
    expect(heard).toEqual([]);
    await b.clock.advance(1_000);
    expect(heard).toEqual([{ rpe: "start", facts: null, error: NOT_CONNECTED, missing: [] }]);
    expect(b.page.logs).toContain("[Spindle] Frontend ready() timeout for lumi_rp_engine; auto-releasing queued startup events");
  });

  test("the drawer tab", async () => {
    const b = await openBed([]);
    // RPE's loader registers its tab with no permission granted at all.
    const rpe = rpeModule();
    await b.page.load(rpe.module);
    expect(b.page.drawerTabs().map(({ root: _root, ...tab }) => tab)).toEqual([{ tabId: `spindle:${b.installed.id}:tab:${TAB.id}:1`, contributionId: TAB.id, title: TAB.title, shortName: TAB.shortName, description: TAB.description, badge: null }]);
    const [tab] = b.page.drawerTabs();
    expect(tab?.root.isConnected).toBe(true);
    expect(tab?.root.getAttribute("data-spindle-extension-root")).toBe(b.installed.id);
    b.page.unload();
    expect(b.page.drawerTabs()).toEqual([]);

    // The handle: a badge and a title the drawer shows, the user opening it, and destroy.
    let handle: SpindleDrawerTabHandle | null = null;
    const opened: string[] = [];
    await b.page.load({
      setup: (ctx) => {
        handle = ctx.ui.registerDrawerTab({ id: "atlas", title: "Atlas", shortName: "Map", description: "Where everyone stands" });
        handle.onActivate(() => opened.push("atlas"));
      },
    });
    const atlas = handle as SpindleDrawerTabHandle | null;
    if (atlas === null) throw new Error("no drawer tab handle");
    atlas.setBadge("3");
    atlas.setTitle("Atlas of the road");
    expect(b.page.drawerTabs()).toMatchObject([{ contributionId: "atlas", title: "Atlas of the road", shortName: "Map", badge: "3" }]);
    b.page.openTab(atlas.tabId);
    b.page.openTab(atlas.tabId);
    expect(opened).toEqual(["atlas"]);
    expect(b.page.openTabId).toBe(atlas.tabId);
    atlas.destroy();
    expect(b.page.drawerTabs()).toEqual([]);
    expect(() => atlas.setBadge("4")).toThrow("PLACEMENT_DESTROYED");
  });

  test("a widget under a reply, and a decorator", async () => {
    const b = await openBed([]);
    await b.page.openChat(CHAT);
    const posted: unknown[] = [];
    const rpe = rpeModule(({ ctx }) => {
      const reply = ctx.messages.getLatestMessageId();
      if (reply === null) throw new Error("no reply in the open chat");
      ctx.messages.renderWidget({ messageId: reply, widgetId: "turn-line", html: "<p>Dusk · the north gate · story 2 · engine 1</p>", maxHeight: 120 }, (payload) => posted.push(payload));
      (ctx.ui as unknown as HostUi).registerDomDecorator({ mount: "message_footer", render: (root, at) => void (root.textContent = `chips for ${at.scope}`) });
    });
    await b.page.load(rpe.module);
    const [mount] = rpe.mounts;
    if (mount === undefined) throw new Error("RPE's frontend module did not mount");
    // Nothing stands under a message before the next frame.
    expect(b.page.widgets(REPLY)).toEqual([]);
    expect(footerOf(b.page, REPLY)?.textContent).toBe("");
    b.page.frame();

    const [widget] = b.page.widgets(REPLY);
    expect(b.page.widgets(REPLY).map(({ frame: _frame, ...w }) => w)).toEqual([{ widgetId: "turn-line", html: "<p>Dusk · the north gate · story 2 · engine 1</p>", minHeight: 40, maxHeight: 120 }]);
    expect(b.page.message(REPLY)?.contains(widget?.frame ?? null)).toBe(true);
    expect(widget?.frame.getAttribute("sandbox")).toBe("allow-scripts");
    expect(widget?.frame.getAttribute("srcdoc")).toBe("<p>Dusk · the north gate · story 2 · engine 1</p>");
    expect(b.page.widgets(ASKED)).toEqual([]);
    expect(footerOf(b.page, ASKED)?.textContent).toBe(`chips for message:${ASKED}:bubble:footer`);
    expect(footerOf(b.page, REPLY)?.textContent).toBe(`chips for message:${REPLY}:bubble:footer`);

    // The widget's script posts; the handler hears it.
    b.page.widgetSays(REPLY, "turn-line", { open: "turn", at: REPLY });
    expect(posted).toEqual([{ open: "turn", at: REPLY }]);

    // ctx.dom finds the replies the page shows and puts markup in them, with no permission granted.
    const bubble = mount.ctx.dom.findMessageElement(REPLY);
    expect(bubble).toBe(b.page.message(REPLY) as unknown as Element);
    expect(mount.ctx.dom.listMessageElements().map((m) => m.messageId)).toEqual([ASKED, REPLY]);
    const marker = mount.ctx.dom.inject(bubble as Element, "<span>still working</span>");
    expect(b.page.message(REPLY)?.querySelector("[data-spindle-inj-id]")?.innerHTML).toBe("<span>still working</span>");

    // A reply that arrives later gets the decorator too.
    b.db.run("INSERT INTO messages (id, chat_id, index_in_chat, is_user, name, content, swipes) VALUES (?, ?, ?, ?, ?, ?, ?)", "msg-later", CHAT, 2, 0, "Mara", "Frost creeps along the lantern's handle.", JSON.stringify(["Frost creeps along the lantern's handle."]));
    await b.page.refreshChat();
    b.page.frame();
    expect(footerOf(b.page, "msg-later")?.textContent).toBe("chips for message:msg-later:bubble:footer");
    expect(b.page.message(REPLY)?.contains(marker as unknown as PageElement)).toBe(true);

    mount.ctx.messages.removeWidget(REPLY, "turn-line");
    b.page.frame();
    expect(b.page.widgets(REPLY)).toEqual([]);

    // Unloaded: the decorators go at once, the injected markup with them; the widgets at the next frame.
    mount.ctx.messages.renderWidget({ messageId: REPLY, widgetId: "turn-line", html: "<p>Night</p>" });
    b.page.frame();
    b.page.unload();
    expect(footerOf(b.page, REPLY)?.textContent).toBe("");
    expect(b.page.message(REPLY)?.querySelector("[data-spindle-inj-id]")).toBeNull();
    b.page.frame();
    expect(b.page.widgets(REPLY)).toEqual([]);
  });

  test("a float widget and a dock panel need ui_panels", async () => {
    const without = await openBed(WITHOUT_PANELS);
    const refused: string[] = [];
    await without.page.load(
      rpeModule(({ ctx }) => {
        for (const make of [() => ctx.ui.createFloatWidget({ tooltip: "World status" }), () => ctx.ui.requestDockPanel({ edge: "right", title: "World", size: 320 })]) {
          try {
            make();
          } catch (error) {
            refused.push(error instanceof Error ? error.message : String(error));
          }
        }
      }).module,
    );
    expect(refused).toEqual(["PERMISSION_DENIED:ui_panels — ctx.ui.createFloatWidget requires the ui_panels permission", "PERMISSION_DENIED:ui_panels — ctx.ui.requestDockPanel requires the ui_panels permission"]);
    expect(without.page.floatWidgets()).toEqual([]);
    expect(without.page.dockPanels()).toEqual([]);

    const granted = await openBed(ALL);
    let hud: SpindleFloatWidgetHandle | null = null;
    let dock: SpindleDockPanelHandle | null = null;
    await granted.page.load(
      rpeModule(({ ctx }) => {
        hud = ctx.ui.createFloatWidget({ tooltip: "World status", chromeless: true });
        dock = ctx.ui.requestDockPanel({ edge: "right", title: "World", size: 900 });
      }).module,
    );
    const pill = hud as SpindleFloatWidgetHandle | null;
    const sheet = dock as SpindleDockPanelHandle | null;
    if (pill === null || sheet === null) throw new Error("no float widget or dock panel");
    // Lumiverse's defaults: 48 by 48, 16 in from the bottom right of the 1280 by 800 page; the dock's size kept within 200 to 600.
    expect(granted.page.floatWidgets()).toMatchObject([{ widgetId: pill.widgetId, tooltip: "World status", chromeless: true, x: 1216, y: 736, width: 48, height: 48, visible: true }]);
    expect(granted.page.dockPanels()).toMatchObject([{ panelId: sheet.panelId, edge: "right", title: "World", size: 600, minSize: 200, maxSize: 600, collapsed: false }]);
    expect(granted.page.floatWidgets()[0]?.root.isConnected).toBe(true);

    // At a phone's width (R-40) a widget asked wider than the page is kept inside it.
    granted.page.window.innerWidth = 390;
    pill.setSize(600, 200);
    expect(granted.page.floatWidgets()).toMatchObject([{ x: 0, y: 600, width: 390, height: 200 }]);
    const landed: { x: number; y: number }[] = [];
    pill.onDragEnd((pos) => landed.push(pos));
    granted.page.dragFloatWidget(pill.widgetId, -50, 100);
    expect(landed).toEqual([{ x: 0, y: 100 }]);
    const shown: boolean[] = [];
    sheet.onVisibilityChange((visible) => shown.push(visible));
    sheet.collapse();
    expect(shown).toEqual([false]);
    expect(granted.page.dockPanels()).toMatchObject([{ collapsed: true }]);

    granted.page.unload();
    expect(granted.page.floatWidgets()).toEqual([]);
    expect(granted.page.dockPanels()).toEqual([]);
    expect(() => pill.moveTo(10, 10)).toThrow("PLACEMENT_DESTROYED");
  });

  test("an input bar action", async () => {
    const b = await openBed([]);
    const pressed: unknown[][] = [];
    let swipe: SpindleInputBarActionHandle | null = null;
    await b.page.load(
      rpeModule(({ ctx }) => {
        ctx.ui.registerInputBarAction({ id: "depth", label: "Depth for this message", subtitle: "Ask the Author for a depth" }).onClick((...args: unknown[]) => pressed.push(args));
        swipe = ctx.ui.registerInputBarAction({ id: "swipe-mode", label: "Swipe mode", enabled: false });
      }).module,
    );
    const mode = swipe as SpindleInputBarActionHandle | null;
    if (mode === null) throw new Error("no input bar action");
    // The composer's menu lists the enabled one under the extension's name; a press calls its handler with nothing.
    expect(b.page.inputBarActions().map(({ actionId: _id, ...action }) => action)).toEqual([{ contributionId: "depth", extensionName: "LumiRPEngine", label: "Depth for this message", subtitle: "Ask the Author for a depth" }]);
    b.page.pressInputBarAction("Depth for this message");
    expect(pressed).toEqual([[]]);
    expect(() => b.page.pressInputBarAction("Swipe mode")).toThrow(`0 actions in the composer's menu say "Swipe mode"`);

    mode.setEnabled(true);
    mode.setLabel("Swipe mode: write again");
    expect(b.page.inputBarActions().map((action) => action.label)).toEqual(["Depth for this message", "Swipe mode: write again"]);
    mode.destroy();
    expect(b.page.inputBarActions().map((action) => action.label)).toEqual(["Depth for this message"]);
    b.page.unload();
    expect(b.page.inputBarActions()).toEqual([]);
  });

  test("every surface RPE's frontend module registers, read back and taken away", async () => {
    const b = await openBed(ALL);
    await b.page.openChat(CHAT);
    await b.page.load(
      rpeModule(({ ctx }) => {
        const ui = ctx.ui as unknown as HostUi;
        ctx.messages.renderWidget({ messageId: REPLY, widgetId: "turn-line", html: "<p>Dusk</p>" });
        ui.registerDomDecorator({ mount: "message_header", kind: "html", html: "<b>12</b>" });
        ui.createFloatWidget({ tooltip: "World status" });
        ui.requestDockPanel({ edge: "bottom", title: "Map", size: 300 });
        ui.registerInputBarAction({ id: "depth", label: "Depth for this message" });
      }).module,
    );
    b.page.frame();
    expect(b.page.drawerTabs().map((tab) => tab.contributionId)).toEqual([TAB.id]);
    expect(b.page.widgets(REPLY).map((w) => w.widgetId)).toEqual(["turn-line"]);
    const marked = b.page.message(REPLY)?.querySelector('[data-spindle-mount="message_header"] [data-spindle-decorator-kind="html"]');
    expect(marked?.innerHTML).toBe("<b>12</b>");
    expect(b.page.floatWidgets().map((w) => w.tooltip)).toEqual(["World status"]);
    expect(b.page.dockPanels().map((p) => p.title)).toEqual(["Map"]);
    expect(b.page.inputBarActions().map((a) => a.label)).toEqual(["Depth for this message"]);

    b.page.unload();
    b.page.frame();
    expect(b.page.drawerTabs()).toEqual([]);
    expect(b.page.widgets(REPLY)).toEqual([]);
    expect(b.page.message(REPLY)?.querySelector("[data-spindle-decorator-kind]")).toBeNull();
    expect(b.page.floatWidgets()).toEqual([]);
    expect(b.page.dockPanels()).toEqual([]);
    expect(b.page.inputBarActions()).toEqual([]);
  });

  test("the chat Lumiverse has open, as the drawer's shell follows it", async () => {
    const b = await openBed([]);
    const active: unknown[] = [];
    let ctxOf: SpindleFrontendContext | null = null;
    await b.page.load(
      rpeModule(({ ctx }) => {
        ctxOf = ctx;
        ctx.state?.subscribe("chat.active", (value) => active.push(value));
        ctx.dom.addStyle(".rpe-drawer { display: flex; }");
      }).module,
    );
    const ctx = ctxOf as SpindleFrontendContext | null;
    if (ctx === null) throw new Error("RPE's frontend module did not mount");
    expect(ctx.getActiveChat()).toEqual({ chatId: null, characterId: null });
    expect(b.page.document.head.querySelector("style")?.textContent).toBe(".rpe-drawer { display: flex; }");

    await b.page.openChat(CHAT);
    expect(active).toEqual([{ chatId: CHAT, characterId: "char-mara", avatarImageId: "img-mara-dusk" }]);
    expect(ctx.getActiveChat()).toEqual({ chatId: CHAT, characterId: "char-mara" });
    expect(ctx.messages.listMessageIds()).toEqual([ASKED, REPLY]);
    expect(ctx.messages.getMessageIdAtIndex(-2)).toBe(ASKED);
    await b.page.refreshChat();
    expect(active).toHaveLength(1);
    b.page.closeChat();
    expect(active).toEqual([
      { chatId: CHAT, characterId: "char-mara", avatarImageId: "img-mara-dusk" },
      { chatId: null, characterId: null, avatarImageId: null },
    ]);

    b.page.unload();
    expect(b.page.document.head.querySelector("style")).toBeNull();
    expect(() => ctx.getActiveChat()).toThrow("SPINDLE_FRONTEND_INACTIVE");
  });
});
