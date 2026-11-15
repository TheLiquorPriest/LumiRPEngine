// The Files and Storage pages' routes in the preview: the invented lighthouse chat's agents' files,
// suggestions and sizes (test/ui/tree-recorded.ts), kept in memory while the preview runs, so a file can
// be written, deleted and switched off, a suggestion accepted or dismissed, and a chat's turn folders
// pruned (each prune takes nine parts in ten of what they still take). Of each name the nearest file is
// in force; a name in the `off:` list is in force nowhere. Every chat is served the same tree, with what
// an invented migration put under `imported/` at the user's level, which RPH loads by no name.

import type { LayerLevel } from "rp-harness/contract";
import type { DiffRow, TreeDiffReply, TreeFileRow, StorageReply, SuggestionShown } from "../../../src/shared/api";
import { FILES, NOTES, STACKS, STORAGE, SUGGESTIONS, TEXTS, TURN_DIFF } from "../../../test/ui/tree-recorded";

const answer = (status: number, body: unknown): Response => Response.json(body, { status, headers: { "cache-control": "no-store" } });

/** What an invented migration attached under `imported/`: an agent of the user's with its original beside it, and their GUIDANCE.md. */
const IMPORTED: Readonly<Record<string, string>> = {
  "@global/imported/.agents/lamplighter.md": "---\nname: lamplighter\ndescription: Keeps the lamp's log.\n---\nWrite down when the lamp was lit and when it went dark.\n",
  "@global/imported/.agents/lamplighter.original.json": '{\n  "id": "lamplighter",\n  "instructions": "Write down when the lamp was lit and when it went dark."\n}\n',
  "@global/imported/GUIDANCE.md": "# My guidance\n\nKeep the keeper's secrets until the story earns them.\n",
};

const texts = new Map([...Object.entries(TEXTS), ...Object.entries(IMPORTED)]);
let storage: StorageReply = structuredClone(STORAGE);
let files: TreeFileRow[] = [
  ...FILES.map((f) => ({ ...f })),
  ...Object.entries(IMPORTED).map(([path, text]): TreeFileRow => ({ path, level: "global", kind: "yours", bytes: new TextEncoder().encode(text).length, item: null, applies: true, replacedBy: null, off: false, offIn: [], editable: true, shipped: null, defaultChanged: null })),
];
/** Each name switched off, with the levels whose `off:` list names it. */
const offNames = new Map<string, LayerLevel[]>(FILES.flatMap((f) => (f.off && f.item !== null ? [[f.item, [...f.offIn]] as const] : [])));
const suggestions: SuggestionShown[] = SUGGESTIONS.map((s) => ({ ...s }));

/** Where a level's files sit in the chat's view; the chat's own sit at its top. */
const PREFIXES: Readonly<Record<LayerLevel, string>> = { shipped: "@shipped/", global: "@global/", character: "@character/", chat: "" };
const NEAREST_FIRST: readonly LayerLevel[] = ["chat", "character", "global", "shipped"];

function placeOf(path: string): { level: LayerLevel; rest: string } {
  const level = NEAREST_FIRST.find((l) => l !== "chat" && path.startsWith(PREFIXES[l])) ?? "chat";
  return { level, rest: path.slice(PREFIXES[level].length) };
}

/** The listing again, after a change: of each name, the nearest file is taken, unless the name is switched off. */
function relist(): void {
  files = files.map((f) => {
    if (f.item === null) return f;
    const nearest = files.filter((g) => g.item === f.item).sort((a, b) => NEAREST_FIRST.indexOf(a.level) - NEAREST_FIRST.indexOf(b.level))[0];
    const offIn = offNames.get(f.item) ?? [];
    const off = offIn.length > 0;
    const shipped = `${PREFIXES.shipped}${placeOf(f.path).rest}`;
    return { ...f, off, offIn, applies: !off && nearest?.path === f.path, replacedBy: nearest === undefined || nearest.path === f.path ? null : nearest.path, shipped: f.level !== "shipped" && texts.has(shipped) ? shipped : null };
  });
}

/** Two texts line by line, by their longest run of lines in common. */
function lineDiff(before: string, after: string): DiffRow[] {
  const a = before.split("\n");
  const b = after.split("\n");
  const common: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) common[i]![j] = a[i] === b[j] ? common[i + 1]![j + 1]! + 1 : Math.max(common[i + 1]![j]!, common[i]![j + 1]!);
  const out: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      out.push({ op: "same", text: a[i++]! });
      j++;
    } else if (j < b.length && (i === a.length || common[i]![j + 1]! >= common[i + 1]![j]!)) out.push({ op: "added", text: b[j++]! });
    else out.push({ op: "removed", text: a[i++]! });
  }
  return out;
}

/** Writes `text` as the user's at `level`, for the file at `path`: there, or the user's own file of its name at that level. */
function writeAsUser(path: string, level: LayerLevel, text: string): TreeFileRow | Response {
  const from = files.find((f) => f.path === path);
  if (from === undefined) return answer(404, { error: `The tree has no file ${path} that a page can reach.` });
  if (level === "shipped") return answer(403, { error: "The shipped files are read-only: write your own at the global, character or chat level." });
  if (from.kind === "generated") return answer(403, { error: `${path} is not a file you write: RPE makes it again.` });
  const target = `${PREFIXES[level]}${placeOf(path).rest}`;
  texts.set(target, text);
  const bytes = new TextEncoder().encode(text).length;
  const was = files.find((f) => f.path === target);
  if (was === undefined) files.push({ ...from, path: target, level, bytes, editable: true, applies: true, replacedBy: null, defaultChanged: null });
  else files = files.map((f) => (f.path === target ? { ...f, bytes, defaultChanged: null } : f));
  relist();
  return files.find((f) => f.path === target) as TreeFileRow;
}

/** The path a file route names, after `prefix`. */
const pathAfter = (path: string, prefix: string): string => path.slice(prefix.length).split("/").map(decodeURIComponent).join("/");

/** The stand-in's answer to the Files page's routes; null for a path that is not one of them. */
export async function treeAnswer(request: Request, url: URL): Promise<Response | null> {
  const path = url.pathname;
  const method = request.method;
  if (path === "/api/v1/files" && method === "GET") return answer(200, { files: url.searchParams.get("chat") ? files : files.filter((f) => f.level === "shipped" || f.level === "global") });
  if (path === "/api/v1/storage" && method === "GET") return answer(200, storage);
  if (path === "/api/v1/storage/notes" && method === "GET") return url.searchParams.get("chat") ? answer(200, NOTES) : answer(400, { error: "Name the chat whose notes are listed, as `chat`." });
  if (path === "/api/v1/files-stack" && method === "GET") {
    const agent = url.searchParams.get("agent") ?? "";
    const stack = STACKS[agent];
    if (!url.searchParams.get("chat") || agent === "") return answer(400, { error: "Name the chat as `chat` and the agent's definition as `agent`." });
    return stack === undefined ? answer(404, { error: `No definition of an agent ${agent} is in this chat's view.` }) : answer(200, stack);
  }
  if (path === "/api/v1/files-prune" && method === "POST") {
    const body = (await request.json().catch(() => null)) as { chat?: unknown } | null;
    const chat = storage.chats.find((c) => c.chat === body?.chat);
    if (chat === undefined) return answer(400, { error: "Name the chat whose turn folders are pruned, as `chat`." });
    // The stand-in takes nine parts in ten of what the turn folders take, as dropping old snapshots would.
    const bytes = Math.round(chat.areas.turns * 0.9);
    storage = { ...storage, chats: storage.chats.map((c) => (c === chat ? { ...c, bytes: c.bytes - bytes, areas: { ...c.areas, turns: c.areas.turns - bytes } } : c)) };
    return answer(200, { pruned: bytes === 0 ? { folders: 0, files: 0, bytes: 0 } : { folders: 30, files: 270, bytes } });
  }
  if (path.startsWith("/api/v1/files-diff/") && method === "GET") {
    const at = pathAfter(path, "/api/v1/files-diff/");
    const entry = files.find((f) => f.path === at);
    if (entry === undefined) return answer(404, { error: `The tree has no file ${at}.` });
    const diff: TreeDiffReply = {
      path: at,
      shipped: entry.shipped,
      lines: entry.shipped === null ? [] : lineDiff(texts.get(entry.shipped) ?? "", texts.get(at) ?? ""),
      update: at === TURN_DIFF.path && entry.defaultChanged !== null ? TURN_DIFF.update : null,
    };
    return answer(200, diff);
  }
  if (path.startsWith("/api/v1/files-off/") && method === "PUT") {
    const at = pathAfter(path, "/api/v1/files-off/");
    const body = (await request.json().catch(() => null)) as { off?: unknown; level?: unknown } | null;
    const entry = files.find((f) => f.path === at);
    if (entry === undefined) return answer(404, { error: `The tree has no file ${at}.` });
    if (typeof body?.off !== "boolean") return answer(400, { error: "`off` is true to switch the file off, false to switch it on again." });
    if (entry.item === null) return answer(400, { error: `${at} is not a file RPH takes by its name, so no \`off:\` list can name it.` });
    const level = body.level === "chat" ? "chat" : "global";
    // As RPE's route: the level's own list gains or loses the name; another level's list is left as it is.
    const lists = (offNames.get(entry.item) ?? []).filter((l) => l !== level);
    offNames.set(entry.item, body.off ? [...lists, level] : lists);
    relist();
    return answer(200, { file: files.find((f) => f.path === at) ?? null });
  }
  if (path.startsWith("/api/v1/files/")) {
    const at = pathAfter(path, "/api/v1/files/");
    const entry = files.find((f) => f.path === at);
    if (method === "GET") {
      const text = texts.get(at);
      return entry === undefined || text === undefined ? answer(404, { error: `The tree has no file ${at}.` }) : answer(200, { path: at, level: entry.level, kind: entry.kind, bytes: entry.bytes, editable: entry.editable, text });
    }
    if (method === "PUT") {
      const body = (await request.json().catch(() => null)) as { level?: LayerLevel; text?: unknown } | null;
      if (typeof body?.text !== "string") return answer(400, { error: "`text` is the file's whole text." });
      const written = writeAsUser(at, body.level ?? "shipped", body.text);
      return written instanceof Response ? written : answer(200, { file: written });
    }
    if (method === "DELETE") {
      if (entry === undefined) return answer(404, { error: `The tree has no file ${at}.` });
      if (!entry.editable) return answer(403, { error: entry.level === "shipped" ? "A shipped file is not removed: switch it off instead." : `${at} is not a file you remove: RPE makes it again.` });
      texts.delete(at);
      files = files.filter((f) => f.path !== at);
      relist();
      return answer(200, { removed: at });
    }
  }
  if (path === "/api/v1/suggestions" && method === "GET") {
    const state = url.searchParams.get("state");
    return answer(200, { suggestions: suggestions.filter((s) => state === null || s.state === state) });
  }
  const decided = /^\/api\/v1\/suggestions\/(\d+)\/(accept|dismiss)$/.exec(path);
  if (decided !== null && method === "POST") {
    const s = suggestions.find((one) => one.id === Number(decided[1]));
    if (s === undefined) return answer(404, { error: `There is no suggestion ${decided[1]}.` });
    if (s.state !== "open") return answer(409, { error: `Suggestion ${s.id} was ${s.state} already.` });
    if (decided[2] === "dismiss") {
      Object.assign(s, { state: "dismissed", decided: Date.now() });
      return answer(200, { suggestion: s });
    }
    const body = (await request.json().catch(() => ({}))) as { text?: string; level?: LayerLevel };
    const written = writeAsUser(s.path, body.level ?? placeOf(s.path).level, body.text ?? s.text);
    if (written instanceof Response) return written;
    Object.assign(s, { state: "accepted", decided: Date.now() });
    return answer(200, { suggestion: s, file: written });
  }
  return null;
}
