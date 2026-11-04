// GM → Workspace's browser (frontend/gm/workspace.tsx), as data: which area of the workspace a file
// is in (the chat's notes, the learned notes under learned/, the turns' transcripts under
// transcripts/ and the pins manifest .pins.json, then, apart from the chat's, the user's global
// workspace under ~/), each area's files as folders and files, folders first, names in natural order
// (reply-9 before reply-10), and the chips that say who wrote a file, at which reply, and how it
// stands: a system file (AGENTS.md, roles/<role>.md) is every agent's or one role's instructions.
// Every agent reads every file. Pure, so the list and its tests share it.

import { AGENT_ROLES } from "../../shared/agent-settings";
import type { WorkspaceFileView } from "../../shared/protocol";
import { GLOBAL_PREFIX, isGlobalPath, isLearnedPath, isSystemPath, isTranscriptPath, LEARNED_DIR, levelPath, PINS_PATH, ROLES_DIR, TRANSCRIPTS_DIR } from "../../shared/stores";
import { humanize } from "../format";

/** An area of the workspace, in the order the browser lists them: the chat's, then the global workspace's. */
export type WorkspaceArea = "notes" | "learned" | "transcripts" | "pins" | "global";

export const WORKSPACE_AREAS: readonly WorkspaceArea[] = ["notes", "learned", "transcripts", "pins", "global"];

/** Each area's heading and what it holds, as the browser says them. */
export const AREA_WORDS: Readonly<Record<WorkspaceArea, { title: string; note: string }>> = {
  notes: { title: "Notes", note: "What the agents and you keep for this chat. They follow the story: a swipe back past a reply takes what it wrote." },
  learned: { title: "Learned", note: "Kept apart from the story: a swipe, a Re-run or an Undo never changes them, and a change lands at once." },
  transcripts: { title: "Transcripts", note: "Everything each turn's agents did, as Live showed it, for the turns Settings → Agents → Retention keeps (every one, by default). Read-only; every agent reads them." },
  pins: { title: "Pins file", note: "Which files each role is shown first, and how much of them." },
  global: { title: "Global (~/)", note: "Your own workspace, which every chat of yours shares: kept apart from the story, and a change lands at once. Its AGENTS.md and roles/ come before this chat's." },
};

/** The area a path is in. */
export function workspaceArea(path: string): WorkspaceArea {
  if (isGlobalPath(path)) return "global";
  if (path === PINS_PATH) return "pins";
  if (isTranscriptPath(path)) return "transcripts";
  if (isLearnedPath(path)) return "learned";
  return "notes";
}

/** Where an area's own folder starts in a path ("learned/"), so its files list under the area and not under that folder again. */
const AREA_ROOT: Readonly<Record<WorkspaceArea, string>> = { notes: "", learned: LEARNED_DIR, transcripts: TRANSCRIPTS_DIR, pins: "", global: GLOBAL_PREFIX };

/** Names in natural order: digits as numbers (reply-9 before reply-10), case aside, then exact order so the sort is total. */
export function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, "en", { numeric: true, sensitivity: "base" }) || (a < b ? -1 : a > b ? 1 : 0);
}

/** A folder in an area's tree: its name, its path with its trailing slash ("notes/people/"), what it holds and how many files in all. */
export interface WorkspaceFolder {
  kind: "folder";
  name: string;
  path: string;
  children: WorkspaceNode[];
  count: number;
}

/** A file in an area's tree, by its last name. */
export interface WorkspaceLeaf {
  kind: "file";
  name: string;
  file: WorkspaceFileView;
}

export type WorkspaceNode = WorkspaceFolder | WorkspaceLeaf;

/** Files as a tree below `root` (a folder's path with its slash, or ""): folders first, then files, each in natural order. */
export function workspaceTree(files: readonly WorkspaceFileView[], root = ""): WorkspaceNode[] {
  const folders = new Map<string, WorkspaceFileView[]>();
  const leaves: WorkspaceLeaf[] = [];
  for (const file of files) {
    if (!file.path.startsWith(root)) continue;
    const rest = file.path.slice(root.length);
    const slash = rest.indexOf("/");
    if (slash < 0) leaves.push({ kind: "file", name: rest, file });
    else {
      const name = rest.slice(0, slash);
      folders.set(name, [...(folders.get(name) ?? []), file]);
    }
  }
  const nested: WorkspaceFolder[] = [...folders].map(([name, held]) => {
    const path = `${root}${name}/`;
    return { kind: "folder", name, path, children: workspaceTree(held, path), count: held.length };
  });
  nested.sort((a, b) => naturalCompare(a.name, b.name));
  leaves.sort((a, b) => naturalCompare(a.name, b.name));
  return [...nested, ...leaves];
}

/** An area of the browser: its files and its tree. */
export interface WorkspaceGroup {
  area: WorkspaceArea;
  files: WorkspaceFileView[];
  nodes: WorkspaceNode[];
}

/** The workspace's areas that hold a file, in the browser's order, each as its tree. */
export function workspaceGroups(files: readonly WorkspaceFileView[]): WorkspaceGroup[] {
  return WORKSPACE_AREAS.flatMap((area) => {
    const held = files.filter((f) => workspaceArea(f.path) === area);
    return held.length === 0 ? [] : [{ area, files: held, nodes: workspaceTree(held, AREA_ROOT[area]) }];
  });
}

/** Every file of a tree in the order it lists them. */
export function treeFiles(nodes: readonly WorkspaceNode[]): WorkspaceFileView[] {
  return nodes.flatMap((n) => (n.kind === "file" ? [n.file] : treeFiles(n.children)));
}

/** The folder a path is in, with its slash ("notes/"), or "" at the top. */
export function folderOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash + 1);
}

/** A chip of a file's row and page: what it says, what it means in full (its tooltip and accessible name), and its kind for its style. */
export interface FileChip {
  /** A file's: who wrote it, at which reply, and how it stands; `info` and `warn` for what else a row says. */
  kind: "who" | "reply" | "pinned" | "learned" | "global" | "system" | "read-only" | "info" | "warn";
  text: string;
  title: string;
}

/** Who wrote a file, short: "You (GM)", the agent's name in Settings → Agents, or the turn's own. */
export function writerWords(file: WorkspaceFileView): string {
  const { role } = file.provenance;
  if (file.transcript || role === undefined) return "The turn";
  if (role === "gm") return "You (GM)";
  return AGENT_ROLES.find((r) => r.id === role)?.label ?? humanize(role);
}

/**
 * Whose instructions a system file is (`isSystemPath`), in words: AGENTS.md every agent's,
 * roles/<role>.md that role's alone; null for any other file.
 */
export function systemWords(path: string): string | null {
  if (!isSystemPath(path)) return null;
  const at = levelPath(path);
  const where = isGlobalPath(path) ? "in every chat of yours" : "in this chat";
  if (!at.startsWith(ROLES_DIR)) return `System instructions for every agent, ${where}`;
  const role = at.slice(ROLES_DIR.length, -".md".length);
  return `System instructions for ${AGENT_ROLES.find((r) => r.id === role)?.label ?? humanize(role)} alone, ${where}`;
}

/**
 * A file's chips: who wrote it, at which reply (a global file is no reply's), then System, Global,
 * Pinned, Learned and Read-only as they apply. A file no reply holds yet is the turn under way's,
 * or, one of yours, from before the first reply.
 */
export function fileChips(file: WorkspaceFileView): FileChip[] {
  const { turn, role } = file.provenance;
  const who = writerWords(file);
  const global = isGlobalPath(file.path);
  const reply = turn !== null ? `Reply ${turn}` : role === undefined ? "This turn" : "Before reply 1";
  const replyTitle = turn !== null ? `Written at reply ${turn}` : role === undefined ? "Written by the turn under way" : "Written before the first reply";
  const system = systemWords(file.path);
  return [
    { kind: "who", text: who, title: `Written by ${who === "You (GM)" ? "you, the GM" : who === "The turn" ? "the turn itself" : who}` },
    ...(global ? [] : [{ kind: "reply" as const, text: reply, title: replyTitle }]),
    ...(system !== null ? [{ kind: "system" as const, text: "System", title: system }] : []),
    ...(global ? [{ kind: "global" as const, text: "Global", title: "Global: every chat of yours shares it, and a swipe never changes it" }] : []),
    ...(file.pinned ? [{ kind: "pinned" as const, text: "Pinned", title: "Pinned: it goes with every agent turn" }] : []),
    ...(file.learned ? [{ kind: "learned" as const, text: "Learned", title: "Learned: a swipe never changes it" }] : []),
    ...(file.transcript ? [{ kind: "read-only" as const, text: "Read-only", title: "Read-only: kept as its turn left it" }] : []),
  ];
}
