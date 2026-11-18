// The Settings page, read from its view as drawn and from the calls behind it: every setting with its
// value, its default and the level and file it comes from; those set per connection under their
// connection; a setting changed at a level by what it takes, set to `~`, or removed from the file that
// decides it so the level above shows through; and RPE's refusal under the setting, in its words.

import { describe, expect, test } from "bun:test";
import { h } from "preact";
import type { SettingsReply, SettingView } from "../../../src/shared/api";
import { NO_SETTINGS, settingsCalls, settingsControl, type SettingsShown, SettingsView, type SettingsViewProps } from "../../../src/ui/pages/settings";
import { sectionsOf } from "../../../src/ui/pages/settings/model";
import { UI_CSS } from "../../../src/ui/styles";
import { hashOf, routeOfHash } from "../../../src/ui/web";
import { askingClient, settle } from "../asking";
import { CHAT } from "../recorded";
import { SETTINGS } from "../settings-recorded";
import { banners, elements, expand, press, textOf } from "../vnodes";

function view(shown: Partial<SettingsShown> = {}) {
  const asked: unknown[] = [];
  const props: SettingsViewProps = {
    chat: CHAT,
    shown: { ...NO_SETTINGS, reply: SETTINGS, loading: false, ...shown },
    onEdit: (key) => asked.push({ edit: key }),
    onDraft: (draft) => asked.push({ draft }),
    onSave: () => asked.push("save"),
    onNone: () => asked.push("none"),
    onTakeAway: (key, level) => asked.push({ takeAway: key, level }),
  };
  const tree = expand(h(SettingsView, props));
  return { tree, text: textOf(tree), asked };
}

function rowOf(tree: unknown, key: string) {
  const found = elements(tree).find((e) => e.props["data-setting"] === key);
  if (found === undefined) throw new Error(`no setting ${key}`);
  return found;
}

const said = (tree: unknown, key: string): string => textOf(rowOf(tree, key).props.children);
const buttonsOf = (node: unknown): string[] => elements(node).filter((e) => e.type === "button").map((e) => textOf(e.props.children));

describe("the Settings page", () => {
  test("each setting shows its value, its default, and the level and file it comes from; a value a file sets that is not taken says why; those set per connection stand under their connection", () => {
    const { tree, text } = view();
    expect(text).not.toContain("Not available yet");
    expect(text).toContain("Read from @shipped/RPE-global.yml (Shipped), @global/RPE-global.yml (Yours), RPE.yml (This chat's).");
    expect(elements(tree).filter((e) => e.type === "summary").map((e) => textOf(e.props.children))).toEqual(["limits (2)", "reply (2)", "update (1)", "off (1)", "added (1)", "pins (1)", "Connection: Flash (2)", "Names no connection there is now (1)", "Limits", "The install (4)"]);
    // The install's facts are listed, each saying where it was given, and none has a control: the command line sets them.
    const facts = elements(tree).filter((e) => e.props["data-fact"] !== undefined);
    expect(facts.map((e) => textOf(e.props.children))).toEqual([
      "Lumiverse's address: http://lumiverse.test:7860 (config.json)",
      "Your Lumiverse user: user-invented (given by the environment, over config.json)",
      "RPE's port, on loopback, that its connection in Lumiverse points at: 7871 (config.json)",
      "RPE's data folder: /srv/rpe-data (where the install put it)",
    ]);
    expect(facts.flatMap((e) => elements(e).filter((c) => c.type === "button" || c.type === "input"))).toEqual([]);
    expect(said(tree, "limits.turn.calls")).toContain(
      "Calls in a turnchanged60Model calls all the agents of one turn may make between them.limits.turn.calls · set in @global/RPE-global.yml (Yours) · default: 40 · takes a whole number, 1 or more · a change holds from the next turn · Appendix D.1: Calls in a turn across all agents",
    );
    expect(said(tree, "limits.turn.seconds")).toContain("limits.turn.secondsno limitWhat limits.turn.seconds does.limits.turn.seconds · no file sets it · default: no limit");
    expect(said(tree, "reply.form")).toContain("A file sets it to markdown, which is not taken: reply.form takes one of tags, tools, text.");
    expect(said(tree, "reply.streamAnyway")).toContain("reply.streamAnyway · set in RPE.yml (This chat's) · default: none listed");
    expect(said(tree, "update.restart")).toContain("update.restart · set in @global/RPE-global.yml (Yours) · default: yes · takes yes or no · a change holds at its next use · beyond Appendix D.1, for the owner's approval");
    expect(said(tree, "connections.c-flash.reply.form")).toContain("connections.c-flash.reply.formchangedtoolsWhat connections.c-flash.reply.form does.connections.c-flash.reply.form · set in RPE.yml (This chat's) · default: the reply's form");
    // A file that cannot be read is said, in RPE's words.
    const broken: SettingsReply = { ...SETTINGS, files: SETTINGS.files.map((f) => (f.level === "chat" ? { ...f, problem: "RPE.yml: a mapping was expected at line 3." } : f)) };
    expect(banners(view({ reply: broken }).tree)).toEqual([{ title: "RPE.yml could not be read", text: "RPE.yml could not be readRPE.yml: a mapping was expected at line 3." }]);
  });

  test("a setting is changed at a level in a field fit for what it takes, set to ~ where it may be, or removed from the file that decides it; a refusal shows under it", () => {
    const listed = view();
    expect(buttonsOf(rowOf(listed.tree, "limits.turn.calls"))).toEqual(["Change", "Remove it from @global/RPE-global.yml"]);
    // No file sets it: there is nothing to remove.
    expect(buttonsOf(rowOf(listed.tree, "limits.turn.seconds"))).toEqual(["Change"]);
    press(rowOf(listed.tree, "limits.turn.calls"), "Change");
    press(rowOf(listed.tree, "limits.turn.calls"), "Remove it from @global/RPE-global.yml");
    expect(listed.asked).toEqual([{ edit: "limits.turn.calls" }, { takeAway: "limits.turn.calls", level: "global" }]);

    const editing = view({ editing: { key: "limits.turn.calls", level: "global", text: "60" }, refusal: { key: "limits.turn.calls", words: "limits.turn.calls takes a whole number, 1 or more." } });
    const row = rowOf(editing.tree, "limits.turn.calls");
    expect(elements(row).filter((e) => e.type === "option").map((o) => [textOf(o.props.children), o.props.selected])).toEqual([
      ["Yours", true],
      ["This chat's", false],
    ]);
    const field = elements(row).find((e) => e.type === "input");
    expect(field?.props.value).toBe("60");
    (field?.props.onInput as (event: { currentTarget: { value: string } }) => void)({ currentTarget: { value: "75" } });
    expect(buttonsOf(row)).toEqual(["Save", "Set it to ~ (no limit)", "Cancel"]);
    press(row, "Save");
    press(row, "Set it to ~ (no limit)");
    press(row, "Cancel");
    expect(editing.asked).toEqual([{ draft: { key: "limits.turn.calls", level: "global", text: "75" } }, "save", "none", { edit: null }]);
    expect(banners(row)).toEqual([{ title: "RPE did not make that change", text: "RPE did not make that changelimits.turn.calls takes a whole number, 1 or more." }]);

    // One of a few is picked from them, yes or no likewise, and a list is typed a name to a line; none of these takes ~.
    const options = (key: string, text: string) => elements(rowOf(view({ editing: { key, level: "global", text } }).tree, key)).filter((e) => e.type === "option").map((o) => o.props.value);
    expect(options("reply.form", "tags")).toEqual(["global", "chat", "tags", "tools", "text"]);
    expect(options("update.restart", "no")).toEqual(["global", "yes", "no"]);
    const list = rowOf(view({ editing: { key: "reply.streamAnyway", level: "chat", text: "moira\nash" } }).tree, "reply.streamAnyway");
    expect(elements(list).find((e) => e.type === "textarea")?.props.value).toBe("moira\nash");
    expect(buttonsOf(list)).toEqual(["Save", "Cancel"]);
  });

  test("each control calls its route with the chat: the value as the setting takes it, ~, or none to take it away; RPE's answer is shown whole, its refusal under the setting", async () => {
    const { client, asked } = askingClient();
    const states: SettingsShown[] = [];
    const control = settingsControl(settingsCalls(client, CHAT), (s) => states.push(s));
    expect(asked[0]).toMatchObject({ key: "GET /api/v1/settings", query: { chat: CHAT } });
    asked[0]?.answer(SETTINGS);
    await settle();
    // Changed where it is decided, starting from the value in force.
    control.edit("limits.turn.calls");
    expect(states.at(-1)?.editing).toEqual({ key: "limits.turn.calls", level: "global", text: "60" });
    control.draft({ key: "limits.turn.calls", level: "chat", text: " 75 " });
    control.save();
    expect(asked[1]).toMatchObject({ key: "PUT /api/v1/settings", body: { level: "chat", chat: CHAT, key: "limits.turn.calls", value: 75, none: false } });
    const after: SettingsReply = { ...SETTINGS, settings: SETTINGS.settings.map((s) => (s.key === "limits.turn.calls" ? { ...s, value: 75, from: "chat", file: "RPE.yml" } : s)) };
    asked[1]?.answer(after);
    await settle();
    expect(states.at(-1)).toMatchObject({ reply: after, editing: null, busy: false });

    // What is not a number goes as typed, and RPE refuses it in its words, under the setting.
    control.edit("limits.turn.calls");
    control.draft({ key: "limits.turn.calls", level: "chat", text: "lots" });
    control.save();
    expect(asked[2]?.body).toMatchObject({ value: "lots" });
    asked[2]?.fail(new Error("limits.turn.calls takes a whole number, 1 or more."));
    await settle();
    expect(states.at(-1)).toMatchObject({ busy: false, refusal: { key: "limits.turn.calls", words: "limits.turn.calls takes a whole number, 1 or more." }, editing: { key: "limits.turn.calls" } });

    control.none();
    expect(asked[3]?.body).toEqual({ level: "chat", chat: CHAT, key: "limits.turn.calls", value: null, none: true });
    control.takeAway("reply.streamAnyway", "chat");
    expect(asked[4]?.body).toEqual({ level: "chat", chat: CHAT, key: "reply.streamAnyway", value: null, none: false });
    control.edit("reply.streamAnyway");
    expect(states.at(-1)?.editing).toEqual({ key: "reply.streamAnyway", level: "chat", text: "moira\nash" });
    control.draft({ key: "reply.streamAnyway", level: "global", text: "moira\n\n keeper \n" });
    control.save();
    expect(asked[5]?.body).toMatchObject({ level: "global", value: ["moira", "keeper"] });
    control.edit("update.restart");
    control.draft({ key: "update.restart", level: "global", text: "yes" });
    control.save();
    expect(asked[6]?.body).toMatchObject({ key: "update.restart", value: true });
    // A setting no file sets is changed at the user's own level.
    control.edit("limits.turn.seconds");
    expect(states.at(-1)?.editing).toEqual({ key: "limits.turn.seconds", level: "global", text: "" });
  });

  test("the page keeps its chat in the address, and with no chat it reads the levels every chat shares", () => {
    expect(routeOfHash(hashOf({ page: "settings", chat: CHAT }))).toEqual({ page: "settings", chat: CHAT });
    expect(routeOfHash(hashOf({ page: "settings", chat: null }))).toEqual({ page: "settings", chat: null });
    const { client, asked } = askingClient();
    settingsCalls(client, null).read();
    settingsCalls(client, null).write("global", "update.restart", false, false);
    expect(asked.map((a) => [a.key, a.query ?? null, a.body ?? null])).toEqual([
      ["GET /api/v1/settings", {}, null],
      ["PUT /api/v1/settings", null, { level: "global", chat: null, key: "update.restart", value: false, none: false }],
    ]);
  });

  test("the row shows the line, at 390 and at 1440 pixels", () => {
    // One layout serves both widths: the line is its own paragraph of a class that wraps anywhere, and nothing in a row holds it to a width
    // wider than the row. The browser rounds lay the page out at both widths (plan scenario 52).
    const { tree } = view();
    for (const s of SETTINGS.settings) {
      const row = rowOf(tree, s.key);
      const line = elements(row).find((e) => e.type === "p" && String(e.props.class).split(" ").includes("rpe-about"));
      expect([s.key, textOf(line?.props.children)]).toEqual([s.key, s.about]);
      expect(String(line?.props.class).split(" ")).toContain("rpe-line");
      const widths = elements(row).flatMap((e) => (typeof e.props.style === "object" && e.props.style !== null && "width" in e.props.style ? [String((e.props.style as { width: unknown }).width)] : []));
      expect(widths.filter((w) => w !== "100%")).toEqual([]);
    }
    expect(UI_CSS).toContain(".rpe-line{margin:0;overflow-wrap:anywhere}");
    expect(UI_CSS).toContain(".rpe-meta{font-size:var(--lre-fs-sm);color:var(--lre-muted);overflow-wrap:anywhere}");
  });

  test("the files switched off at each level are listed under it, and changed from that level's own list", async () => {
    const { tree } = view();
    const levels = elements(rowOf(tree, "off")).filter((e) => e.type === "li" && e.props["data-level"] !== undefined);
    expect(levels.map((e) => textOf(e.props.children))).toEqual(["@global/RPE-global.yml (Yours) WORLD", "RPE.yml (This chat's) rules/consent"]);

    const { client, asked } = askingClient();
    const states: SettingsShown[] = [];
    const control = settingsControl(settingsCalls(client, CHAT), (s) => states.push(s));
    asked[0]?.answer(SETTINGS);
    await settle();
    control.edit("off");
    // The chat's own list, not every level's together: switched on again there by leaving it out.
    expect(states.at(-1)?.editing).toEqual({ key: "off", level: "chat", text: "rules/consent" });
    control.draft({ key: "off", level: "chat", text: "" });
    control.save();
    expect(asked[1]?.body).toEqual({ level: "chat", chat: CHAT, key: "off", value: [], none: false });
  });

  test("a table of situations is shown and typed entry by entry, and a list of records as a table, written whole", async () => {
    const { tree } = view();
    expect(said(tree, "added")).toContain("Files added for a kind of turn");
    expect(said(tree, "added")).toContain("swipe: SWIPE; delete: DELETE");
    const table = elements(rowOf(tree, "pins")).find((e) => e.type === "table");
    expect(elements(table).filter((e) => e.type === "th").map((e) => textOf(e.props.children))).toEqual(["file", "agent"]);
    expect(elements(table).filter((e) => e.type === "td").map((e) => textOf(e.props.children))).toEqual(["persistent-workspace/keeper-log.md", "keeper"]);

    const { client, asked } = askingClient();
    const states: SettingsShown[] = [];
    const control = settingsControl(settingsCalls(client, CHAT), (s) => states.push(s));
    asked[0]?.answer(SETTINGS);
    await settle();
    control.edit("added");
    expect(states.at(-1)?.editing).toEqual({ key: "added", level: "global", text: "swipe: SWIPE\ndelete: DELETE" });
    control.draft({ key: "added", level: "global", text: "swipe: SWIPE, RECAP\nregenerate: SWIPE\ndelete:" });
    control.save();
    expect(asked[1]?.body).toMatchObject({ key: "added", value: { swipe: ["SWIPE", "RECAP"], regenerate: ["SWIPE"], delete: [] } });

    control.edit("pins");
    expect(states.at(-1)?.editing).toEqual({ key: "pins", level: "chat", text: "persistent-workspace/keeper-log.md | keeper" });
    control.draft({ key: "pins", level: "chat", text: "persistent-workspace/tide-table.md | author\n" });
    control.save();
    expect(asked[2]?.body).toMatchObject({ key: "pins", value: [{ file: "persistent-workspace/tide-table.md", agent: "author" }] });
  });
});

describe("finding a setting, the books choice and what waits for the server", () => {
  const props = (over: Partial<SettingsViewProps>): SettingsViewProps => ({ chat: CHAT, shown: { ...NO_SETTINGS, reply: SETTINGS, loading: false }, onEdit: () => undefined, onDraft: () => undefined, onSave: () => undefined, onNone: () => undefined, onTakeAway: () => undefined, ...over });

  test("typing 'calls' finds limits.turn.calls with its sentence and opens only its group; one changed from its default is marked", () => {
    const tree = expand(h(SettingsView, props({ query: "calls" })));
    expect(elements(tree).filter((e) => e.props["data-setting"] !== undefined).map((e) => e.props["data-setting"])).toEqual(["limits.turn.calls"]);
    expect(said(tree, "limits.turn.calls")).toContain("Model calls all the agents of one turn may make between them.");
    expect(said(tree, "limits.turn.calls")).toContain("changed");
    expect(elements(tree).filter((e) => e.type === "summary").map((e) => textOf(e.props.children))).toContain("limits (1)");
  });

  test("the groups are closed until one is opened by its address or a search", () => {
    const closed = expand(h(SettingsView, props({})));
    expect(elements(closed).filter((e) => e.type === "details").every((e) => e.props.open !== true)).toBe(true);
    const opened = expand(h(SettingsView, props({ openKey: "update.restart" })));
    const open = elements(opened).filter((e) => e.type === "details" && e.props.open === true);
    expect(open.map((e) => textOf(elements(e).find((c) => c.type === "summary")?.props.children))).toEqual(["update (1)"]);
  });

  test("what waits for the server is listed with what it runs and the line to run there; a page offers no switch", () => {
    const tree = expand(h(SettingsView, props({ switches: [{ user: "u1", name: "tide-tools", kind: "mcp", what: "tide-mcp --serve", state: "waiting", listed: 1_800_000_000_000, changed: null }, { user: "u1", name: "notes-hook", kind: "hook", what: "notes.sh", state: "on", listed: 1_800_000_000_000, changed: null }] })));
    const text = textOf(tree);
    expect(text).toContain("tide-mcp --serve");
    expect(text).toContain("rpe allow tide-tools");
    expect(text).toContain("rpe deny notes-hook");
    expect(buttonsOf(tree).some((b) => /allow|switch/i.test(b))).toBe(false);
  });

  test("a setting whose section the route does not list is shown under Other, which says no section names it yet, so none is left off the page", () => {
    const stray = { key: "stray.key", section: "A section nobody listed", group: "Strays", from: null, set: [], levels: ["global"] } as unknown as SettingView;
    const listed = [{ title: "Agents", about: "What each agent thinks at." }, { title: "Other", about: "Settings no section names yet." }];
    expect(sectionsOf(listed, [stray]).map((s) => [s.title, s.about, s.count])).toEqual([["Other", "Settings no section names yet.", 1]]);
    expect(sectionsOf(listed.slice(0, 1), [stray]).map((s) => [s.title, s.about, s.count])).toEqual([["Other", "Settings no section names yet.", 1]]);
  });
});
