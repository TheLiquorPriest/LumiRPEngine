// The agents' files of the invented lighthouse chat (recorded.ts), as RPE's Files and Storage routes
// would answer for it: the listing at every level, each file's text, how the user's TURN.md differs from
// the shipped one, the agents' open suggestions, and what the tree takes. For the pages' tests and the
// preview. Every name, path, text and size here is made up.

import type { LayerLevel } from "rp-harness/contract";
import type { AgentStack, DiffLine, NoteFiles, TreeFileDiff, TreeFileEntry, TreeStorage, TreeSuggestionView } from "../../src/ui/api";
import { AUTHOR, CHAT, GM, T0 } from "./recorded";

/** What the tree takes: the lighthouse chat and an older one, with the levels apart and the database. */
export const STORAGE: TreeStorage = {
  chats: [
    { chat: CHAT, folder: "moira-calder-point-0f3a9c21", bytes: 3_412_330, areas: { notes: 41_200, turns: 3_190_420, sessions: 176_510, files: 4_200 } },
    { chat: "chat-harbour", folder: "harbour-night-7b21e4d0", bytes: 902_114, areas: { notes: 2_048, turns: 880_066, sessions: 20_000, files: 0 } },
  ],
  global: 18_220,
  shipped: 209_715,
  database: 52_428_800,
};

/** The lighthouse chat's notes: the largest, and those agents rewrote most. */
export const NOTES: NoteFiles = {
  largest: [
    { path: "persistent-workspace/moira.md", bytes: 24_100, writes: 3 },
    { path: "persistent-workspace/ledger.md", bytes: 12_800, writes: 19 },
  ],
  rewritten: [
    { path: "persistent-workspace/ledger.md", bytes: 12_800, writes: 19 },
    { path: "persistent-workspace/moira.md", bytes: 24_100, writes: 3 },
  ],
};

/** When an update changed the shipped TURN.md, after the user's own was last written: 13 Nov 2026, 09:30 UTC. */
export const UPDATED = Date.UTC(2026, 10, 13, 9, 30);

/** Each file's text, by its path in the chat's view. */
export const TEXTS: Readonly<Record<string, string>> = {
  "@shipped/TURN.md": "# The turn\n\nWeigh what the player is after first.\nThen decide how deep the turn goes.\n",
  "@shipped/WORLD.md": "# The world\n\nWrite here what holds in this world whatever the story does.\n",
  "@shipped/WRITING.md": "# Writing\n\nWrite the reply in the story's own voice, close to the player's character.\n",
  "@shipped/rules/perceptions.md": "---\nagents: [author]\nat: run-end\n---\nWrite down what each character on stage took in this turn.\n",
  "@shipped/rules/examples/weather.md": "---\nagents: [gm]\nevery: 5\n---\nSay how the weather has turned.\n",
  "@shipped/.agents/author.md": "---\nname: author\nreads: [ALL-AGENTS, rules, AGENTS, WORLD, SIMULATION, WRITING, TURN]\n---\nYou write the story's replies.\n",
  "@shipped/.agents/gm.md": "---\nname: gm\nreads: [ALL-AGENTS, rules, WORLD, SIMULATION]\n---\nYou rule on what is attempted.\n",
  "@global/TURN.md": "# The turn\n\nWeigh what the player is after first, <em>before</em> anything else.\nThen decide how deep the turn goes.\nKeep the keeper's secrets until the story earns them.\n",
  "@global/RPE-global.yml": "off:\n  - rules/perceptions\n",
  "@character/AGENTS.md": "Moira answers short, and never about the night of the wreck.\n",
  "WORLD.md": "# Calder Point\n\nA lighthouse on a cold coast, a day's walk from the village.\n",
  "persistent-workspace/moira.md": "Moira said the glass was swapped by three. Ash saw the beam gone before midnight.\n",
  "turns/0031-turn-31/world-state.md": "Calder Point, the lamp room: dark. North wind, sleet.\n",
};

const bytes = (path: string): number => new TextEncoder().encode(TEXTS[path] ?? "").length;

function file(path: string, level: LayerLevel, over: Partial<TreeFileEntry> = {}): TreeFileEntry {
  return { path, level, kind: "yours", bytes: bytes(path), item: null, applies: true, replacedBy: null, off: false, offIn: [], editable: level !== "shipped", shipped: null, defaultChanged: null, ...over };
}

/** The chat's view of the tree, as `GET /api/v1/files?chat=` lists it. */
export const FILES: TreeFileEntry[] = [
  file("@shipped/TURN.md", "shipped", { item: "TURN", applies: false, replacedBy: "@global/TURN.md" }),
  file("@shipped/WORLD.md", "shipped", { item: "WORLD", applies: false, replacedBy: "WORLD.md" }),
  file("@shipped/WRITING.md", "shipped", { item: "WRITING" }),
  file("@shipped/rules/perceptions.md", "shipped", { item: "rules/perceptions", applies: false, off: true, offIn: ["global"] }),
  file("@shipped/rules/examples/weather.md", "shipped", { item: "rules/examples/weather", applies: false }),
  file("@shipped/.agents/author.md", "shipped", { item: "agents/author" }),
  file("@shipped/.agents/gm.md", "shipped", { item: "agents/gm" }),
  file("@global/TURN.md", "global", { item: "TURN", shipped: "@shipped/TURN.md", defaultChanged: UPDATED }),
  file("@global/RPE-global.yml", "global"),
  file("@character/AGENTS.md", "character", { item: "AGENTS" }),
  file("WORLD.md", "chat", { item: "WORLD", shipped: "@shipped/WORLD.md" }),
  file("persistent-workspace/moira.md", "chat", { kind: "notes" }),
  file("turns/0031-turn-31/world-state.md", "chat", { kind: "generated", editable: false }),
];

/** With no chat open: the shipped level and the user's own. */
export const FILES_NO_CHAT: TreeFileEntry[] = FILES.filter((f) => f.level === "shipped" || f.level === "global");

/** The stacks of the two agents the tree defines, as `GET /api/v1/files-stack?chat=&agent=` gives them. */
export const STACKS: Readonly<Record<string, AgentStack>> = {
  author: {
    agent: "author",
    parts: [
      { kind: "instruction", part: "ALL-AGENTS", path: "@shipped/ALL-AGENTS.md", level: "shipped", hash: "0a1b", where: "opening" },
      { kind: "rule", part: "rules/perceptions", path: "@shipped/rules/perceptions.md", level: "shipped", where: "opening", left: "off" },
      { kind: "instruction", part: "AGENTS", path: "@character/AGENTS.md", level: "character", hash: "2c3d", where: "opening" },
      { kind: "instruction", part: "WORLD", path: "WORLD.md", level: "chat", hash: "4e5f", where: "opening" },
      { kind: "instruction", part: "SIMULATION", path: "SIMULATION.md", level: "chat", where: "opening", left: "missing" },
      { kind: "instruction", part: "WRITING", path: "@shipped/WRITING.md", level: "shipped", hash: "6a7b", where: "opening" },
      { kind: "definition", part: "author", path: "@shipped/.agents/author.md", level: "shipped", hash: "8c9d", where: "opening" },
      { kind: "instruction", part: "TURN", path: "@global/TURN.md", level: "global", hash: "0e1f", where: "opening" },
      { kind: "instruction", part: "SWIPE", path: "@shipped/SWIPE.md", level: "shipped", hash: "2a3b", where: "briefing" },
    ],
  },
  gm: {
    agent: "gm",
    parts: [
      { kind: "instruction", part: "ALL-AGENTS", path: "@shipped/ALL-AGENTS.md", level: "shipped", hash: "0a1b", where: "opening" },
      { kind: "instruction", part: "WORLD", path: "WORLD.md", level: "chat", hash: "4e5f", where: "opening" },
      { kind: "instruction", part: "SIMULATION", path: "SIMULATION.md", level: "chat", where: "opening", left: "missing" },
      { kind: "definition", part: "gm", path: "@shipped/.agents/gm.md", level: "shipped", hash: "4c5d", where: "opening" },
    ],
  },
};

/** The lines of a difference, each written as its kind and its text. */
function lines(...parts: [DiffLine["op"], string][]): DiffLine[] {
  return parts.map(([op, text]) => ({ op, text }));
}

/** How the user's TURN.md differs from the shipped one, and what the update changed of the shipped one under it. */
export const TURN_DIFF: TreeFileDiff = {
  path: "@global/TURN.md",
  shipped: "@shipped/TURN.md",
  lines: lines(
    ["same", "# The turn"],
    ["same", ""],
    ["removed", "Weigh what the player is after first."],
    ["added", "Weigh what the player is after first, <em>before</em> anything else."],
    ["same", "Then decide how deep the turn goes."],
    ["added", "Keep the keeper's secrets until the story earns them."],
    ["same", ""],
  ),
  update: {
    at: UPDATED,
    lines: lines(["same", "# The turn"], ["same", ""], ["removed", "Weigh intent first."], ["added", "Weigh what the player is after first."], ["same", "Then decide how deep the turn goes."], ["same", ""]),
  },
};

/** The agents' open suggestions in the chat, newest first. */
export const SUGGESTIONS: TreeSuggestionView[] = [
  {
    id: 7,
    chat: CHAT,
    turn: "turn-31",
    agent: AUTHOR,
    path: "WORLD.md",
    text: "# Calder Point\n\nA lighthouse on a cold coast, a day's walk from the village.\nThe lamp is lit at dusk and kept until dawn; the keeper logs each hour.\n",
    reason: "The story leans on the keeper's log; <b>saying</b> how the lamp is kept stops it being made up each turn.",
    at: T0 + 60_000,
    state: "open",
    decided: null,
    lines: lines(["same", "# Calder Point"], ["same", ""], ["same", "A lighthouse on a cold coast, a day's walk from the village."], ["added", "The lamp is lit at dusk and kept until dawn; the keeper logs each hour."], ["same", ""]),
  },
  {
    id: 6,
    chat: CHAT,
    turn: "turn-30",
    agent: GM,
    path: "@shipped/WRITING.md",
    text: "# Writing\n\nWrite the reply in the story's own voice, close to the player's character.\nKeep the sea in every scene at the point.\n",
    reason: "Every scene at the point has had the sea in it so far.",
    at: T0 - 600_000,
    state: "open",
    decided: null,
    lines: lines(["same", "# Writing"], ["same", ""], ["same", "Write the reply in the story's own voice, close to the player's character."], ["added", "Keep the sea in every scene at the point."], ["same", ""]),
  },
];
