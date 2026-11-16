// The kinds of file the tree draws (plan §5.1, §5.4) as the "New file" form offers them: where each lives under a
// level, and the levels that hold it. A file the form makes is written through the same route as any other; where
// RPE would refuse a place it says so in words, and the page shows them.

import type { WriteLevel } from "./model";

export interface FileKind {
  id: string;
  /** What the form calls it. */
  words: string;
  /** Whether its name is the user's to give; a fixed one names itself. */
  named: boolean;
  /** The names a fixed kind may take, one to choose. */
  names?: readonly string[];
  /** Its path below a level, from the name given. */
  at(name: string): string;
  /** The levels that hold it, with a chat open and with none. */
  levels(chat: string | null): WriteLevel[];
}

const ALL = (chat: string | null): WriteLevel[] => (chat === null ? ["global"] : ["global", "character", "chat"]);
const GLOBAL_ONLY = (): WriteLevel[] => ["global"];

const INSTRUCTIONS = ["WORLD.md", "SIMULATION.md", "WRITING.md", "TURN.md", "PRESET.md", "SWIPE.md", "DELETE.md"] as const;

export const KINDS: readonly FileKind[] = [
  { id: "agents-md", words: "AGENTS.md, for every agent", named: false, at: () => "AGENTS.md", levels: (chat) => (chat === null ? [] : ["character", "chat"]) },
  { id: "instruction", words: "An instruction file (what the Author and the GM read)", named: true, names: INSTRUCTIONS, at: (name) => name, levels: ALL },
  { id: "own", words: "A file of your own, for an instructions: list", named: true, at: (name) => (name.endsWith(".md") ? name : `${name}.md`), levels: ALL },
  { id: "rule", words: "A rule", named: true, at: (name) => `rules/${name.replace(/\.md$/, "")}.md`, levels: ALL },
  { id: "skill", words: "A skill", named: true, at: (name) => `skills/${name}/SKILL.md`, levels: ALL },
  { id: "agent", words: "An agent's definition", named: true, at: (name) => `agents/${name.replace(/\.md$/, "")}.md`, levels: ALL },
  { id: "hooks", words: "A hook file", named: false, at: (_name) => "hooks/hooks.yml", levels: ALL },
  { id: "prompt", words: "A prompt part", named: true, at: (name) => `.prompts/${name.replace(/\.md$/, "")}.md`, levels: GLOBAL_ONLY },
  { id: "tool-guide", words: "A tool's guide", named: true, at: (name) => `.tools/${name.replace(/\.md$/, "")}.md`, levels: GLOBAL_ONLY },
  { id: "tool-manifest", words: "A tool manifest (mcp.json, an HTTP tool, a command tool)", named: true, at: (name) => `.tools/${name.replace(/\.json$/, "")}.json`, levels: GLOBAL_ONLY },
];

/** A path in the chat's view for a file at a level: the global and character levels are named by their own folder, the chat's is the top. */
export function viewPathAt(level: WriteLevel, below: string): string {
  return level === "chat" ? below : `@${level}/${below}`;
}

/** The shipped file a new file of that place starts from, where the shipped level holds one of its name. */
export function shippedPathFor(below: string): string {
  return `@shipped/${below}`;
}

/** The folders of his under `imported/` that are read from a dot folder at their level: his attached agents and skills. */
const IMPORTED_FOLDERS: Readonly<Record<string, string>> = { agents: ".agents", skills: ".skills" };

/**
 * Where a file of his under `imported/` is read from at its own level: his agents and skills go to the dot folders they are read from,
 * `imported/GUIDANCE.md` to `AGENTS.md`, and the rest keeps its path without the `imported/` step (his texts under `.prompts/` stay as they are).
 * The page offers to move or copy it there; null for a file that is not under `imported/`.
 */
export function importedTarget(path: string): string | null {
  const at = path.indexOf("/imported/");
  const top = path.startsWith("imported/") ? 0 : at < 0 ? -1 : at + 1;
  if (top < 0) return null;
  const rest = path.slice(top + "imported/".length);
  const [first = "", ...below] = rest.split("/");
  const folder = IMPORTED_FOLDERS[first];
  const target = rest === "GUIDANCE.md" ? "AGENTS.md" : folder === undefined || below.length === 0 ? rest : [folder, ...below].join("/");
  return `${path.slice(0, top)}${target}`;
}
