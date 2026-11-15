// Carried unchanged from LumiAH (MIT; notice in THIRD-PARTY-NOTICES.md), src/shared/timeouts.ts at commit 6a38779a5e33fe563f0c8c617640343473617569.

// Every wait a user can meet, in one place (PI-BUILD-PLAN §4.9): the Timeouts page lists each as a
// row with the same controls Settings gives it (its name, what it guards, its default, a field, back
// to the default), grouped by what waits. Each is a setting of its own section (the core's, or the
// transport's), named here by its place from the settings' root; the page finds it in the schema
// the backend gives, so a setting this list names that a build doesn't have is left out. A timeout's
// message names its setting and this page (`timeoutPlace`), so the words and the page agree.

/** The groups the Timeouts page shows, in its order. */
export type TimeoutGroupId = "runtime" | "link" | "tools" | "model" | "store";

export interface TimeoutGroup {
  id: TimeoutGroupId;
  /** The group's heading, in plain words. */
  label: string;
  /** What its waits are, in a line. */
  about: string;
  /** Its settings, each by its place from the settings' root. */
  rows: readonly (readonly string[])[];
}

const AGENT_TIMES = ["main", "writer", "summarizer"].flatMap((agent) => [
  ["core", "agents", agent, "budget", "callMs"],
  ["core", "agents", agent, "budget", "wallMs"],
]);

export const TIMEOUT_GROUPS: readonly TimeoutGroup[] = [
  {
    id: "runtime",
    label: "Waiting for the runtime",
    about: "How long a page, a reply or a key waits for your runtime to do something, and how long a new build of the runtime has to start before it updates to it.",
    rows: [
      ["transport", "pages", "askMs"],
      ["transport", "pages", "proxyMs"],
      ["transport", "link", "connectionMs"],
      ["transport", "tags", "checkMs"],
      ["transport", "runtime", "turnWaitMs"],
      ["transport", "runtime", "drainMs"],
      ["transport", "live", "lostMs"],
      ["transport", "link", "quietMs"],
      ["transport", "runtime", "buildStartMs"],
    ],
  },
  {
    id: "link",
    label: "The link",
    about: "How long the runtime and this extension wait for each other over the link, and how the runtime reaches Lumiverse.",
    rows: [
      ["transport", "runtime", "requestMs"],
      ["transport", "runtime", "lumiverseMs"],
      ["transport", "runtime", "lostMs"],
      ["transport", "runtime", "silentMs"],
      ["transport", "runtime", "crashMs"],
      ["transport", "runtime", "stallMs"],
      ["transport", "runtime", "modelsWaitMs"],
      ["transport", "runtime", "reconnectMs"],
      ["transport", "runtime", "reconnectMaxMs"],
      ["transport", "runtime", "partStaleMs"],
      ["transport", "link", "partStaleMs"],
      ["transport", "runtime", "stopAskMs"],
      ["transport", "runtime", "stopGraceMs"],
    ],
  },
  {
    id: "tools",
    label: "Tools and approvals",
    about: "How long a tool call, your word on one, or something an agent started may take.",
    rows: [
      ["transport", "mcp", "callMs"],
      ["core", "approval", "waitMs"],
      ["core", "extension", "waitMs"],
      ["core", "jobs", "dueWaitMs"],
    ],
  },
  {
    id: "model",
    label: "A model call",
    about: "How long an agent's calls, the agent, a turn or a job may take, how long a model's answer may go silent, how long a connection's test waits for its provider, how long a sign-in stays open, and the wait before a failed call is made again.",
    rows: [...AGENT_TIMES, ["core", "turn", "wallMs"], ["core", "jobs", "budget", "wallMs"], ["core", "loop", "retryWaitMs"], ["transport", "runtime", "answerSilentMs"], ["transport", "runtime", "providerMs"], ["transport", "runtime", "signInMs"]],
  },
  {
    id: "store",
    label: "The copy and the store",
    about: "How long the runtime's copy of your chats and lore waits for Lumiverse, and how long what the runtime saved, and the records of replies, wait to reach this extension's storage and Lumiverse.",
    rows: [
      ["transport", "runtime", "copyReadMs"],
      ["transport", "runtime", "storeWaitMs"],
      ["transport", "pages", "settleMs"],
      ["transport", "anchors", "waitMs"],
      ["core", "jobs", "recordWaitMs"],
    ],
  },
];

/** The group a setting is in on the Timeouts page; null for one the page doesn't list. */
export function timeoutGroupOf(path: readonly string[]): TimeoutGroup | null {
  return TIMEOUT_GROUPS.find((group) => group.rows.some((row) => row.length === path.length && row.every((key, i) => key === path[i]))) ?? null;
}

/**
 * Whose Settings hold the Timeouts page, as a timeout's words name them: the extension by the name
 * the user knows it by, and, for an extension LumiAH is built into whose own Settings are not where
 * LumiAH's are shown, where they are (`settingsAt`, e.g. "LumiRPEngine's Harness tab → System →
 * Settings"), said in place of "<name>'s Settings".
 */
export interface SettingsOwner {
  name: string;
  settingsAt?: string;
}

/** Where a wait is changed, for its message: `<its name> (<owner's Settings> → Timeouts → <its group>)`, the owner's Settings being `settingsAt` where it says, else `<name>'s Settings`. `title` is the setting's own, from its schema. */
export function timeoutPlace(path: readonly string[], title: string, owner: SettingsOwner): string {
  const group = timeoutGroupOf(path);
  const settings = owner.settingsAt ?? `${owner.name}'s Settings`;
  return `${title} (${settings} → Timeouts${group !== null ? ` → ${group.label}` : ""})`;
}

/**
 * Where any setting is changed, for the words of a limit or a wait that name it: a wait the Timeouts
 * page lists as `timeoutPlace` says it, any other as `<its name> (<owner's Settings> → <trail>)`,
 * `trail` being the groups that lead to it on the Settings page ("The agent loop"; "Agents → Main
 * agent → Budget"). `path` is its place from the settings' root. An agent's own wait ends with that
 * agent (`trail`'s second group), as its Timeouts row says whose it is: every agent's has the same name.
 */
export function settingPlace(path: readonly string[], title: string, trail: readonly string[], owner: SettingsOwner): string {
  const settings = owner.settingsAt ?? `${owner.name}'s Settings`;
  const group = timeoutGroupOf(path);
  if (group === null) return `${title} (${[settings, ...trail].join(" → ")})`;
  const whose = path[1] === "agents" && trail[1] !== undefined ? [trail[1]] : [];
  return `${title} (${[settings, "Timeouts", group.label, ...whose].join(" → ")})`;
}
