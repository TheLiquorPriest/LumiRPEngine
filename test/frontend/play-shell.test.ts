import { describe, expect, test } from "bun:test";
import type { PanelHome } from "../../src/frontend/app";
import { initialUi, openAt, orgRoute, orgRouteOf, playAt, popSheet, pushSheet, showPanel, switchChat } from "../../src/frontend/app";
import type { Overlays } from "../../src/frontend/app";
import { ProtocolClient } from "../../src/frontend/protocol-client";
import { createStore } from "../../src/frontend/store";
import { needsYou } from "../../src/frontend/play/now";
import { destinations } from "../../src/frontend/play/play";
import type { PanelDef } from "../../src/frontend/registry";
import type { UiCatalog } from "../../src/frontend/ui-registry";
import type { Chip, StateView } from "../../src/shared/state-view";

const Empty = () => null;
const panel = (id: string, order: number, home: PanelHome): PanelDef => ({ id, label: id, order, home, component: Empty });
const catalog: UiCatalog = {
  panels: [panel("combat.encounter", 5, "now"), panel("core.scene", 10, "now"), panel("sheets.you", 20, "me"), panel("economy.money", 30, "me"), panel("castlife.cast", 60, "people"), panel("orgs.list", 10, "orgs"), panel("space.map", 10, "places"), panel("core.journal", 90, "story"), panel("core.gm", 100, "gm")],
  editors: new Map(),
  configs: new Map(),
  chips: new Map(),
  previews: new Map(),
  gmSections: [],
  fields: [],
  placeFields: [],
  sheets: new Map(),
  glances: [],
  orgTabs: [],
  placeParts: [],
  packs: [],
};
const state = (panels: Record<string, unknown>, pending: { panel: string; entity: string | null }[] = []) => ({ panels, pending }) as unknown as StateView;

describe("Play destinations", () => {
  test("Now and Story always show; a pack's destination shows once one of its panels has a view; GM panels make none", () => {
    expect(destinations(catalog, state({})).map((d) => d.id)).toEqual(["now", "story"]);
    const shown = destinations(catalog, state({ "economy.money": { level: 1 }, "combat.encounter": null }));
    expect(shown.map((d) => [d.id, d.panels.map((p) => p.id)])).toEqual([
      ["now", ["core.scene"]],
      ["me", ["economy.money"]],
      ["story", ["core.journal"]],
    ]);
  });

  test("a fight leads Now; a pending mark dots its destination", () => {
    const shown = destinations(catalog, state({ "combat.encounter": { round: 1 }, "castlife.cast": {} }, [{ panel: "castlife.cast", entity: "rosie" }]));
    expect(shown.find((d) => d.id === "now")?.panels.map((p) => p.id)).toEqual(["combat.encounter", "core.scene"]);
    expect(shown.map((d) => [d.id, d.dot])).toEqual([
      ["now", false],
      ["people", true],
      ["story", false],
    ]);
  });

  test("Orgs, the sixth destination, sits between People and Places with the briefcase (ORG-SPEC §4.1)", () => {
    const shown = destinations(catalog, state({ "economy.money": { level: 1 }, "castlife.cast": {}, "orgs.list": { party: { id: "party_pov" } }, "space.map": {} }));
    expect(shown.map((d) => [d.id, d.label, d.icon])).toEqual([
      ["now", "Now", "compass"],
      ["me", "Me", "user"],
      ["people", "People", "users"],
      ["orgs", "Orgs", "briefcase"],
      ["places", "Places", "map"],
      ["story", "Story", "book"],
    ]);
  });
});

describe("Needs you on Now", () => {
  const chip = (id: string, kind: Chip["kind"], expires: Chip["expires"], actions: Chip["actions"] = []): Chip => ({ id, kind, messageId: "m1", label: id, actions, expires });
  test("the Keep report leads, then the decisions that lapse at the next send in chat order; offers, records and lasting decisions stay under their replies", () => {
    const chips = [
      chip("confirm", "confirm", "next_send", [{ id: "confirm", label: "Yes" }]),
      chip("offer", "timelapse_offer", "next_send", [{ id: "start", label: "Timelapse" }]),
      chip("overdue", "overdue", "never", [{ id: "retrieve", label: "Ask for it" }]),
      chip("declined", "decline", "never"),
      chip("unread", "read_failed", "next_send", [{ id: "rerun", label: "Retry" }]),
      chip("undo", "undo", "next_send", [{ id: "undo", label: "Undo" }]),
      chip("keep", "keep_report", "never", [{ id: "keep", label: "Keep later turns" }]),
      chip("retry", "retry", "next_send", [{ id: "regenerate", label: "Retry" }]),
    ];
    expect(needsYou(chips).map((c) => c.id)).toEqual(["keep", "confirm", "unread", "retry"]);
  });
});

describe("UI navigation", () => {
  test("changing destination keeps each destination's tab and closes every sheet", () => {
    const opened = pushSheet(pushSheet(playAt(initialUi(false), "me", "economy.money"), { kind: "account", id: "cash" }), { kind: "item", id: "keys" });
    expect(opened.play.stack).toHaveLength(2);
    const moved = playAt(opened, "story");
    expect(moved.play).toEqual({ dest: "story", tab: { me: "economy.money" }, stack: [] });
  });

  test("Back closes the top sheet only, and does nothing with none open", () => {
    const opened = pushSheet(pushSheet(initialUi(false), { kind: "person", id: "rosie" }), { kind: "place", id: "diner" });
    expect(popSheet(opened).play.stack).toEqual([{ kind: "person", id: "rosie" }]);
    const none = initialUi(false);
    expect(popSheet(none)).toBe(none);
  });

  test("a link into another destination opens its page there, alone, so Back returns to that destination's home", () => {
    const fromCast = pushSheet(playAt(initialUi(false), "people", "castlife.cast"), { kind: "person", id: "danny_okafor" });
    const opened = openAt(fromCast, "orgs", orgRoute("alder_automotive_co"));
    expect(opened.play).toEqual({ dest: "orgs", tab: { people: "castlife.cast" }, stack: [{ kind: "org", id: "alder_automotive_co" }] });
    expect(popSheet(opened).play).toEqual({ dest: "orgs", tab: { people: "castlife.cast" }, stack: [] });
  });

  test("an organization's route names its page and the tab it opens on, whatever its id holds", () => {
    expect(orgRoute("alder_automotive_co")).toEqual({ kind: "org", id: "alder_automotive_co" });
    expect(orgRouteOf(orgRoute("alder_automotive_co").id)).toEqual({ org: "alder_automotive_co", tab: null });
    // Money → Assets opens a stake's Ownership (ORG-SPEC §5.1).
    expect(orgRoute("alder_automotive_co", "economy.ownership")).toEqual({ kind: "org", id: "alder_automotive_co#economy.ownership" });
    expect(orgRouteOf("alder_automotive_co#economy.ownership")).toEqual({ org: "alder_automotive_co", tab: "economy.ownership" });
    // An author's id may hold anything: a `#` or a `%` in it is never a tab.
    for (const org of ["club#2", "100%_club", "a/b c"]) {
      expect(orgRouteOf(orgRoute(org).id)).toEqual({ org, tab: null });
      expect(orgRouteOf(orgRoute(org, "people").id)).toEqual({ org, tab: "people" });
    }
    // A hand-written id that doesn't decode reads as written; an empty tab names none.
    expect(orgRouteOf("100%_club")).toEqual({ org: "100%_club", tab: null });
    expect(orgRouteOf("party_pov#")).toEqual({ org: "party_pov", tab: null });
  });

  test("a panel opens where it lives: its destination and tab, or GM mode; an unknown panel changes nothing", () => {
    const ui = { ...initialUi(false), mode: "build" as const };
    expect(showPanel(ui, catalog, "castlife.cast")).toMatchObject({ mode: "play", play: { dest: "people", tab: { people: "castlife.cast" } } });
    expect(showPanel(ui, catalog, "core.gm").mode).toBe("gm");
    expect(showPanel(ui, catalog, "nope.nope")).toBe(ui);
  });

  test("switching chats closes every sheet and overlay before the new chat opens; the same chat keeps them", () => {
    const sent: { type?: string; chatId?: unknown }[] = [];
    const client = new ProtocolClient({ send: (payload) => void sent.push(payload as { type?: string; chatId?: unknown }), subscribe: () => () => undefined }, { timers: { set: () => 0, clear: () => undefined } });
    const closed: string[] = [];
    const overlays = { closeMap: () => closed.push("map"), closePalette: () => closed.push("palette"), closeWorld: () => closed.push("world") } as unknown as Overlays;
    const ui = createStore(pushSheet(pushSheet(playAt(initialUi(false), "people"), { kind: "person", id: "npc_rosie" }), { kind: "item", id: "backpack" }));
    // A sheet stays open across chats only if nothing closes it: it would then ask the new chat for its entity.
    ui.subscribe((state) => {
      if (state.play.stack.length > 0 && client.getState().chatId === "chat-2") throw new Error("a sheet over chat-2");
    });
    switchChat({ client, ui, overlays }, "chat-1");
    expect(ui.get().play.stack).toEqual([]);
    const reopened = pushSheet(ui.get(), { kind: "person", id: "npc_rosie" });
    ui.set(reopened);
    switchChat({ client, ui, overlays }, "chat-1");
    expect(ui.get()).toBe(reopened);
    switchChat({ client, ui, overlays }, "chat-2");
    expect(ui.get().play).toEqual({ dest: "people", tab: {}, stack: [] });
    expect(closed).toEqual(["map", "palette", "world", "map", "palette", "world"]);
    expect(sent.map((m) => m.chatId)).toEqual(["chat-1", "chat-2"]);
  });
});
