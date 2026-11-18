// The Settings page's calls and what its control keeps: a change goes to its route with the chat, as the
// value the setting takes, as `~`, or as none to take it away from a level; RPE's refusal is kept under
// the setting; the page keeps its chat in the address; and a setting no section names is shown under Other.

import { describe, expect, test } from "bun:test";
import type { SettingView } from "../../../src/shared/api";
import { settingsCalls, settingsControl, type SettingsShown } from "../../../src/ui/pages/settings";
import { sectionsOf } from "../../../src/ui/pages/settings/model";
import { hashOf, routeOfHash } from "../../../src/ui/web";
import { askingClient, settle } from "../asking";
import { CHAT } from "../recorded";

describe("the Settings page", () => {
  test("a change goes to its route with the chat: the value as the setting takes it, ~, or none to take it away; RPE's refusal is kept under the setting", async () => {
    const { client, asked } = askingClient();
    const states: SettingsShown[] = [];
    const control = settingsControl(settingsCalls(client, CHAT), (s) => states.push(s));
    expect(asked[0]).toMatchObject({ key: "GET /api/v1/settings", query: { chat: CHAT } });
    asked[0]?.answer({ chat: CHAT, sections: [], files: [], settings: [], facts: [] });
    await settle();
    control.onWrite("limits.turn.calls", "chat", 75, false);
    expect(asked[1]).toMatchObject({ key: "PUT /api/v1/settings", body: { level: "chat", chat: CHAT, key: "limits.turn.calls", value: 75, none: false } });
    asked[1]?.fail(new Error("limits.turn.calls takes a whole number, 0 or more."));
    await settle();
    expect(states.at(-1)).toMatchObject({ busy: null, refusal: { key: "limits.turn.calls", words: "limits.turn.calls takes a whole number, 0 or more." } });
    control.onWrite("limits.turn.calls", "chat", null, true);
    expect(asked[2]?.body).toEqual({ level: "chat", chat: CHAT, key: "limits.turn.calls", value: null, none: true });
    control.onTakeAway("reply.streamAnyway", "chat");
    expect(asked[3]?.body).toEqual({ level: "chat", chat: CHAT, key: "reply.streamAnyway", value: null, none: false });
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

  test("a setting whose section the route does not list is shown under Other, which says no section names it yet, so none is left off the page", () => {
    const stray = { key: "stray.key", section: "A section nobody listed", group: "Strays", from: null, set: [], levels: ["global"] } as unknown as SettingView;
    const listed = [{ title: "Agents", about: "What each agent thinks at." }, { title: "Other", about: "Settings no section names yet." }];
    expect(sectionsOf(listed, [stray]).map((s) => [s.title, s.about, s.count])).toEqual([["Other", "Settings no section names yet.", 1]]);
    expect(sectionsOf(listed.slice(0, 1), [stray]).map((s) => [s.title, s.about, s.count])).toEqual([["Other", "Settings no section names yet.", 1]]);
  });
});
