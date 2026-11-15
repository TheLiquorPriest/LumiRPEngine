// The settings of the invented lighthouse chat (recorded.ts), as RPE's Settings route would answer for it:
// a few of RPH's and RPE's settings, at each level, with one set per connection for the one connection
// there is and for a name no connection has. For the Settings page's tests and the preview. Every value
// here is made up.

import type { SettingsReply, SettingView } from "../../src/shared/api";
import { CHAT } from "./recorded";

const GLOBAL_FILE = "@global/RPE-global.yml";
const CHAT_FILE = "RPE.yml";

function setting(key: string, over: Partial<SettingView>): SettingView {
  return {
    key,
    name: key,
    about: `What ${key} does.`,
    effect: "turn",
    effectWords: "from the next turn",
    row: null,
    value: null,
    default: null,
    from: null,
    file: null,
    set: [],
    joined: false,
    takes: { type: "text" },
    takesWords: "a line of text",
    none: null,
    orNone: false,
    levels: ["global", "chat"],
    passed: null,
    ...over,
  };
}

const PIN_FIELDS = [
  { name: "file", takes: { type: "text" }, about: "The file, by its path in the chat's view." },
  { name: "agent", takes: { type: "text" }, about: "The agent it is pinned for." },
] as const;

export const SETTINGS: SettingsReply = {
  chat: CHAT,
  files: [
    { level: "shipped", file: "@shipped/RPE-global.yml", problem: null },
    { level: "global", file: GLOBAL_FILE, problem: null },
    { level: "chat", file: CHAT_FILE, problem: null },
  ],
  settings: [
    setting("limits.turn.calls", { name: "Calls in a turn", about: "Model calls all the agents of one turn may make between them.", row: "Calls in a turn across all agents", value: 60, default: 40, from: "global", file: GLOBAL_FILE, set: [{ level: "global", file: GLOBAL_FILE, value: 60 }], takes: { type: "whole", least: 1 }, takesWords: "a whole number, 1 or more", none: "no limit", orNone: true }),
    setting("limits.turn.time", { takes: { type: "whole", least: 1 }, takesWords: "a whole number, 1 or more", none: "no limit", orNone: true }),
    setting("reply.form", { value: "tags", default: "tags", takes: { type: "oneOf", values: ["tags", "tools", "text"] }, takesWords: "one of tags, tools, text", passed: { value: "markdown", why: "reply.form takes one of tags, tools, text." } }),
    setting("reply.streamAnyway", { value: ["moira", "ash"], default: [], from: "chat", file: CHAT_FILE, takes: { type: "texts" }, takesWords: "a list of names" }),
    setting("update.restart", { value: false, default: true, from: "global", file: GLOBAL_FILE, takes: { type: "yesNo" }, takesWords: "yes or no", levels: ["global"], effect: "use", effectWords: "at its next use" }),
    setting("off", {
      name: "Files switched off",
      value: ["WORLD", "rules/consent"],
      default: [],
      from: "chat",
      file: CHAT_FILE,
      set: [
        { level: "global", file: GLOBAL_FILE, value: ["WORLD"] },
        { level: "chat", file: CHAT_FILE, value: ["rules/consent"] },
      ],
      joined: true,
      takes: { type: "texts" },
      takesWords: "a list of names",
    }),
    setting("added", { name: "Files added for a kind of turn", value: { swipe: ["SWIPE"], delete: ["DELETE"] }, default: {}, from: "global", file: GLOBAL_FILE, set: [{ level: "global", file: GLOBAL_FILE, value: { swipe: ["SWIPE"], delete: ["DELETE"] } }], takes: { type: "table", of: { type: "texts" } }, takesWords: "a table of names, each to a list of names" }),
    setting("pins", {
      name: "Pinned files",
      value: [{ file: "persistent-workspace/keeper-log.md", agent: "keeper" }],
      default: [],
      from: "chat",
      file: CHAT_FILE,
      set: [{ level: "chat", file: CHAT_FILE, value: [{ file: "persistent-workspace/keeper-log.md", agent: "keeper" }] }],
      joined: true,
      takes: { type: "records", fields: PIN_FIELDS },
      takesWords: "a list of records, each with file (a line of text) and agent (a line of text)",
    }),
    setting("reply.forms.c-flash", { value: "tools", from: "chat", file: CHAT_FILE, takes: { type: "oneOf", values: ["tags", "tools", "text"] }, takesWords: "one of tags, tools, text", none: "the reply's form", connection: { id: "c-flash", name: "Flash" } }),
    setting("effort.connections.c-flash", { takes: { type: "oneOf", values: ["low", "medium", "high"] }, takesWords: "one of low, medium, high", none: "the connection's own", connection: { id: "c-flash", name: "Flash" } }),
    setting("effort.connections.Studio", { value: "high", from: "global", file: GLOBAL_FILE, takes: { type: "oneOf", values: ["low", "medium", "high"] }, takesWords: "one of low, medium, high", none: "the connection's own", connection: null }),
  ],
  facts: [
    { key: "lumiverse.url", name: "Lumiverse's address", value: "http://lumiverse.test:7860", from: "config.json" },
    { key: "lumiverse.user", name: "Your Lumiverse user", value: "user-invented", from: "environment" },
    { key: "port", name: "RPE's port, on loopback, that its connection in Lumiverse points at", value: 7871, from: "config.json" },
    { key: "data", name: "RPE's data folder", value: "/srv/rpe-data", from: "install" },
  ],
};
