// The one press that switches one of his attached files on (STANDALONE-PLAN §15.2, R-81): his GUIDANCE.md is written as an
// AGENTS.md at the user's level, an agent as `.agents/<id>.md` and a skill as `.skills/<id>/SKILL.md`, where each kind is read from
// at that level. The attached file and its original stay under `imported/` word for word. A name already in force there, his own
// at that level or one RPE ships, is never written over: it is handed back beside the attached file for him to choose. The migration
// may not import the file tree, so the caller gives its writer (`OwnFiles.writeAsUser`, which records that he wrote the file).

import { join } from "node:path";
import { readText } from "../app/disk";
import { IMPORTED, IMPORTED_AGENTS, IMPORTED_SKILLS } from "./own-files";

/** What switching on needs of the tree: its two folders, the folder names of the kinds, and its writer. */
export interface SwitchOnDeps {
  /** The user's level of the tree: the folder `imported/` is under. */
  root: string;
  /** The shipped level's folder, where a name of his would stand in place of one of RPE's. */
  shipped: string;
  /** The folders agents and skills are read from at a level (`GLOBAL_FOLDERS`). */
  folders: { agents: string; skills: string };
  /** Writes `text` as him at the user's level, at `path` below it; answers the path written. */
  write(path: string, text: string): Promise<string>;
}

/** What a press did: switched the file on at `to`, or left it off because a name is in force there, with both texts. */
export type SwitchedOn = { switched: true; from: string; to: string } | { switched: false; from: string; to: string; inForce: { level: "global" | "shipped"; text: string }; attached: string };

/** The path is not one of his attached agents, skills or GUIDANCE.md, or the attached file is not there. */
export class SwitchOnRefused extends Error {
  constructor(path: string, why: string) {
    super(`${path} cannot be switched on: ${why}`);
    this.name = "SwitchOnRefused";
  }
}

/** Where a path under `imported/` is read from at the user's level, by its kind; null for one that is no agent, skill or GUIDANCE.md. */
function targetOf(path: string, folders: SwitchOnDeps["folders"]): string | null {
  if (path === `${IMPORTED}/GUIDANCE.md`) return "AGENTS.md";
  const agent = new RegExp(`^${IMPORTED}/${IMPORTED_AGENTS}/([^/]+)\\.md$`).exec(path)?.[1];
  if (agent !== undefined) return `${folders.agents}/${agent}.md`;
  const skill = new RegExp(`^${IMPORTED}/${IMPORTED_SKILLS}/([^/]+)/SKILL\\.md$`).exec(path)?.[1];
  return skill === undefined ? null : `${folders.skills}/${skill}/SKILL.md`;
}

/**
 * Switches on the attached file at `path` (below the user's level, `imported/...`): written where its kind is read from, unless a name is
 * in force there. The attached file and its original are never touched.
 */
export async function switchOn(path: string, deps: SwitchOnDeps): Promise<SwitchedOn> {
  const to = targetOf(path, deps.folders);
  if (to === null) throw new SwitchOnRefused(path, `only your GUIDANCE.md and your agents and skills under ${IMPORTED}/ are switched on`);
  const attached = await readText(join(deps.root, path));
  if (attached === null) throw new SwitchOnRefused(path, "the file is not there");
  for (const [level, base] of [["global", deps.root], ["shipped", deps.shipped]] as const) {
    const held = await readText(join(base, to));
    if (held !== null) return { switched: false, from: path, to, inForce: { level, text: held }, attached };
  }
  return { switched: true, from: path, to: await deps.write(to, attached) };
}
