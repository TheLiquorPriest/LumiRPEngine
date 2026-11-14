// The user's own files (STANDALONE-PLAN §15.2: "Your own agents and skills", "Your edited prompts and
// texts", "Your GUIDANCE.md", "The Author's notebook…" and "learned/ and your own ~/ files"), written
// into the user's level of RPE's file tree under `imported/`, where nothing is in force until the user
// switches it on: they were written for agents that are gone or changed. Inside it, agents, skills,
// texts and notes go to the folders the tree's layout names for them (`src/tree/layout.ts`). The
// migration may not import the tree (`test/standalone-boundaries.test.ts`), so the caller gives those
// names (`TreePlaces`).
//
// What is read: the user's own definitions and texts in LumiAH's `harness/settings.json`, the
// engine's edited texts in `settings.json` (`prompts.texts`), and LumiAH's areas (`~/`, each chat's
// `learned/` and its area, turn by turn), each a head naming an index blob that names each file's body
// (`H/core/workspace.ts:41-53`). A chat's area is read at its latest turn; its mind files are the
// characters' (their own row), not the Author's.

import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { YAML } from "bun";
import { writeWhole } from "../app/disk";
import { isRecord } from "../shared/json";
import { areaFiles, areaHead, MIND_FILE } from "./inside";
import type { Item } from "./report";
import type { Today } from "./today";

/** The folder of the user's level everything here is written under, as the plan names it. */
export const IMPORTED = "imported";

/** Where the user's own files go, as the file tree's layout names it. */
export interface TreePlaces {
  /** The user's level: the file tree's root folder (`DataPaths.files`). */
  root: string;
  /** The folder names of a level's agents, skills and texts (`GLOBAL_FOLDERS`), and of a chat's notes (`NOTES_FOLDER`). */
  agents: string;
  skills: string;
  prompts: string;
  notes: string;
}

export interface OwnFilesCarried {
  agents: number;
  skills: number;
  texts: number;
  guidance: number;
  home: number;
  notes: number;
  learned: number;
  /** Files whose names would leave the folder they go in: not written, in the backup only. */
  leftOut: number;
}

function json(text: string | null): unknown {
  if (text === null) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

const blob = (hash: string): string => `harness/blobs/${hash.slice(0, 2)}/${hash}`;

/** An area as its head holds it: when it was written and each file's text; null where it doesn't read, or names an index or a body today's clean-up removed. */
async function areaOf(today: Today, doc: string): Promise<{ at: number; files: { path: string; text: string }[] } | null> {
  const text = await today.userView.read(doc);
  const head = areaHead(text);
  if (head === undefined) return null;
  const raw = json(text);
  const at = isRecord(raw) && typeof raw.at === "number" ? raw.at : 0;
  if (head === null) return { at, files: [] };
  const index = areaFiles(await today.userView.read(blob(head)));
  if (index === null) return null;
  const files: { path: string; text: string }[] = [];
  for (const f of index) {
    const body = await today.userView.read(blob(f.hash));
    if (body !== null) files.push({ path: f.path, text: body });
  }
  return { at, files };
}

/** A definition's header in the new format (`name`, `description`, `tools`), and its body. */
function headed(header: Record<string, unknown>, body: string): string {
  const fields = Object.fromEntries(Object.entries(header).filter(([, v]) => v !== undefined));
  return `---\n${YAML.stringify(fields, null, 2).replace(/\n+$/, "")}\n---\n${body}${body.endsWith("\n") ? "" : "\n"}`;
}

const text = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

/** A path that stays inside the folder it is written under: no part of it empty, "." or "..". */
const staysInside = (path: string): boolean => path.split("/").every((part) => part !== "" && part !== "." && part !== ".." && !part.includes("\0"));

/**
 * Writes the user's own files under `imported/` at the user's level. `items` are the report's: only
 * what it classifies as carried or attached is read, so a chat gone from Lumiverse or one LumiAH was
 * told to forget is left in the backup.
 */
export async function carryOwnFiles(today: Today, items: readonly Item[], places: TreePlaces): Promise<OwnFilesCarried> {
  const out: OwnFilesCarried = { agents: 0, skills: 0, texts: 0, guidance: 0, home: 0, notes: 0, learned: 0, leftOut: 0 };
  const base = join(places.root, IMPORTED);
  /** Writes one file; a name that would leave the folder is counted as left out, and stays in the backup. */
  const put = async (path: string, body: string): Promise<boolean> => {
    if (!staysInside(path)) {
      out.leftOut++;
      return false;
    }
    await mkdir(dirname(join(base, path)), { recursive: true });
    await writeWhole(join(base, path), body);
    return true;
  };

  // The user's own agents and skills, in the new header format with the original beside each; and their edited texts.
  const harness = json(await today.userView.read("harness/settings.json"));
  const definitions = isRecord(harness) && isRecord(harness.definitions) ? harness.definitions : {};
  for (const [id, def] of Object.entries(isRecord(definitions.agents) ? definitions.agents : {})) {
    if (!isRecord(def)) continue;
    const tools = Array.isArray(def.tools) ? def.tools.filter((t): t is string => typeof t === "string") : undefined;
    if (await put(`${places.agents}/${id}.md`, headed({ name: id, description: text(def.description), tools }, text(def.instructions) ?? ""))) out.agents++;
    await put(`${places.agents}/${id}.original.json`, `${JSON.stringify(def, null, 2)}\n`);
  }
  for (const [id, def] of Object.entries(isRecord(definitions.skills) ? definitions.skills : {})) {
    if (!isRecord(def)) continue;
    if (await put(`${places.skills}/${id}/SKILL.md`, headed({ name: id, description: text(def.description) }, text(def.body) ?? ""))) out.skills++;
    await put(`${places.skills}/${id}/original.json`, `${JSON.stringify(def, null, 2)}\n`);
  }
  const engine = json(await today.userView.read("settings.json"));
  const texts = { ...(isRecord(engine) && isRecord(engine.prompts) && isRecord(engine.prompts.texts) ? engine.prompts.texts : {}), ...(isRecord(harness) && isRecord(harness.texts) ? harness.texts : {}) };
  for (const [id, body] of Object.entries(texts)) if (typeof body === "string" && (await put(`${places.prompts}/${id}.md`, body))) out.texts++;

  // LumiAH's areas: `~/` (GUIDANCE.md apart), each chat's learned/, and each chat's area at its latest turn.
  const latest = new Map<string, { at: number; doc: string }>();
  for (const item of items) {
    if (item.where !== "user storage" || (item.fate !== "carried" && item.fate !== "attached")) continue;
    if (item.path === "harness/docs/workspace/user.json") {
      for (const f of (await areaOf(today, item.path))?.files ?? []) {
        if (f.path === "GUIDANCE.md") {
          if (await put("GUIDANCE.md", f.text)) out.guidance++;
        } else if (await put(`home/${f.path}`, f.text)) out.home++;
      }
      continue;
    }
    const chat = /^harness\/docs\/chats\/([^/]+)\/(learned|area\/[^/]+)\.json$/.exec(item.path);
    if (!chat) continue;
    if (chat[2] === "learned") {
      for (const f of (await areaOf(today, item.path))?.files ?? []) if (await put(`chats/${chat[1]}/learned/${f.path}`, f.text)) out.learned++;
      continue;
    }
    const raw = json(await today.userView.read(item.path));
    const at = isRecord(raw) && typeof raw.at === "number" ? raw.at : 0;
    const was = latest.get(chat[1] ?? "");
    if (was === undefined || at > was.at || (at === was.at && item.path > was.doc)) latest.set(chat[1] ?? "", { at, doc: item.path });
  }
  for (const [chat, { doc }] of latest) {
    for (const f of (await areaOf(today, doc))?.files ?? []) if (!MIND_FILE.test(f.path) && (await put(`chats/${chat}/${places.notes}/${f.path}`, f.text))) out.notes++;
  }
  return out;
}
