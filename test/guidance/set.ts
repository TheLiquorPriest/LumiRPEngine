// The shipped guidance as RPH's own loader reads it: RPH's `guidance/` first, RPE's over it, RPE's
// `chat-defaults/` at the level's root (`shippedPlaces`, the one rule of the layout), as the shipped level
// of a folder host. The tests of the shipped texts run on this and never on a reading of their own, so
// what they find is what an agent is given. Holds no tests. Every name is invented.

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, relative, sep } from "node:path";
import { type Guidance, loadGuidance, SHIPPED_GUIDANCE } from "rp-harness";
import type { FactDef, FactValue, LayerLevel, Scope } from "rp-harness/contract";
import { createFolderHost, type FolderHost } from "rp-harness/hosts/folder";
import { shippedPlaces } from "../../src/tree/shipped";

/** RPE's own shipped folder. */
export const RPE_FOLDER = resolve(import.meta.dir, "../../guidance");
/** RPH's, as RPE has it at its pin. */
export const RPH_FOLDER = SHIPPED_GUIDANCE;

export const USER = "reader";
export const CHARACTER = "hero";
export const CHAT = "c1";
export const SCOPE: Scope = { user: USER, chat: CHAT, session: "s1" };

/** The text of every file below a folder, by its path below it ("/" between names). */
function below(folder: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (at: string): void => {
    for (const name of readdirSync(join(folder, at))) {
      const path = at === "" ? name : `${at}/${name}`;
      if (statSync(join(folder, path)).isDirectory()) walk(path);
      else out.set(path, readFileSync(join(folder, path), "utf8"));
    }
  };
  walk("");
  return out;
}

/** The shipped level as RPE lays it: every file's place in it, and its text. */
export function shippedTexts(): Map<string, string> {
  const rph = below(RPH_FOLDER);
  const rpe = below(RPE_FOLDER);
  const out = new Map<string, string>();
  for (const place of shippedPlaces([...rph.keys()], [...rpe.keys()])) {
    const text = (place.from === "rph" ? rph : rpe).get(place.source);
    if (text === undefined) throw new Error(`${place.source} is in no shipped folder`);
    out.set(place.path, text);
  }
  return out;
}

/** The place of a file below RPE's folder in the shipped level (its `chat-defaults/` at the root). */
export function placeOf(rpePath: string): string {
  return rpePath.startsWith("chat-defaults/") ? rpePath.slice("chat-defaults/".length) : rpePath;
}

export interface OpenSet {
  host: FolderHost;
  scope: Scope;
  /** The guidance of the chat, as RPH loads it now. */
  guidance(): Guidance;
  /** Puts a file in a level of the tree, over what is there. */
  put(level: LayerLevel, path: string, text: string): void;
  /** The host's facts' values for the chat, from now on. */
  facts(values: Record<string, FactValue>): void;
  close(): Promise<void>;
}

export interface SetOptions {
  /** The facts the host declares (RPE's own, for a rule that tests one). */
  defs?: readonly FactDef[];
}

/** The folder of a level inside a test's directory. */
function levelDir(dir: string, level: LayerLevel): string {
  const files = join(dir, "files");
  if (level === "shipped") return join(files, "defaults");
  if (level === "global") return files;
  if (level === "character") return join(files, "chats", CHARACTER);
  return join(files, "chats", CHARACTER, CHAT);
}

/** A folder host over `texts` as its shipped level, for one chat. */
export async function openSet(texts: ReadonlyMap<string, string>, options: SetOptions = {}): Promise<OpenSet> {
  const dir = mkdtempSync(join(tmpdir(), "rpe-shipped-"));
  const put = (level: LayerLevel, path: string, text: string): void => {
    const at = join(levelDir(dir, level), ...path.split("/"));
    mkdirSync(dirname(at), { recursive: true });
    writeFileSync(at, text, "utf8");
  };
  mkdirSync(levelDir(dir, "chat"), { recursive: true });
  for (const [path, text] of texts) put("shipped", path, text);
  mkdirSync(join(dir, "host", "chats", CHAT), { recursive: true });
  writeFileSync(join(dir, "host", "chats", CHAT, "chat.json"), JSON.stringify({ character: CHARACTER }));
  const facts = (values: Record<string, FactValue>): void => writeFileSync(join(dir, "host", "facts.json"), JSON.stringify({ defs: options.defs ?? [], values: { [CHAT]: values } }));
  facts({});
  const host = await createFolderHost({ dir, user: USER });
  return {
    host,
    scope: SCOPE,
    guidance: () => loadGuidance(host.files, SCOPE),
    put,
    facts,
    close: async () => {
      await host.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** A copy of the shipped texts with changes made: a file given new text, or taken out. */
export function changed(texts: ReadonlyMap<string, string>, changes: Record<string, string | null>): Map<string, string> {
  const out = new Map(texts);
  for (const [path, text] of Object.entries(changes)) {
    if (text === null) out.delete(path);
    else out.set(path, text);
  }
  return out;
}

/** Splits a file's text into its header (as a mapping) and its body, or no header. */
export function split(text: string): { header: Record<string, unknown> | null; body: string } {
  if (!text.startsWith("---\n")) return { header: null, body: text };
  const end = text.indexOf("\n---\n", 4);
  if (end < 0) throw new Error("the header is never closed");
  const header = Bun.YAML.parse(text.slice(4, end));
  if (header === null || typeof header !== "object" || Array.isArray(header)) throw new Error("the header is not a set of fields");
  return { header: header as Record<string, unknown>, body: text.slice(end + 5) };
}

/** A path relative to a folder, with "/" between names. */
export function rel(from: string, to: string): string {
  return relative(from, to).split(sep).join("/");
}
