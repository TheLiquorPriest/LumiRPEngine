// The agents' workspace (AGENT-LOOP-PLAN §4, §6; INC1-SPEC R3b; DESIGN §4.4): its files at both
// levels, and the workspace family's tools.
//
// A file is a path in the chat's head (`engine/workspace.ts`: the index the `engine.ws.*` events fold
// along the active chain, its pins beside it), its body a blob (`agents/blobs.ts`); a path under
// `learned/`, the learned area, kept with its pin in the chat's metadata (`chat-agent-meta.ts`), so a
// swipe never changes it and a Branch copies it; a path under `~/`, the user's global workspace,
// which every chat of theirs shares (`global-workspace.ts`); or a turn's transcript under
// `transcripts/`, read-only. Every agent and the GM read every file: there is no file a role can't
// read, whatever it was told to keep in mind. Who wrote a file is the record its write landed in: an
// agent's write is a `fix` entry naming the agent (`PostEntry.agent`), a kept file names the role
// that wrote it last. Everything here reads the head without the ledger's queue, as the GM view does.
//
// The tools: list, read and grep read; write, edit, move, delete and pin propose the change
// (`propose`), which lands as one GM edit with its Undo once it is applied (a kept file's at once).

import { WRITE_NOTE } from "../../../shared/agent-tools-write";
import type { ChatId, UserId } from "../../../shared/ids";
import { isRecord, type JsonObject } from "../../../shared/json";
import type { ChatRun, LedgerEvent } from "../../../shared/ledger";
import { isKeptPath, isLearnedPath, isTranscriptPath, type KeptFile } from "../../../shared/stores";
import type { WorldDoc } from "../../../shared/world";
import type { ChainMessage } from "../../../engine/ledger/chain";
import type { LedgerCore } from "../../../engine/ledger/journal";
import { activeRecord } from "../../../engine/ledger/path";
import { own } from "../../../engine/pack-kit";
import type { WorldState } from "../../../engine/state";
import { WS_WRITE, workspaceOf, workspacePins } from "../../../engine/workspace";
import { toChain } from "../../ledger-io";
import type { Runtime } from "../../runtime";
import { appliedEvents } from "../../view";
import type { ToolOutcome } from "../runtime";
import { BOOLEAN, boolArg, missing, propose } from "./propose";
import type { ToolReadView } from "./read-view";
import type { ToolDefinition, ToolEnv } from "./registry";
import { needText, objectSchema, text, textArg } from "./schema";
import { transcriptFiles } from "./transcript-files";

// ---------------------------------------------------------------- the files

/** The chat's head as the workspace and the writer read it: its run, its ledger and messages, and the world and state at its end (a planned turn included). */
export interface ChatHead {
  run: ChatRun;
  core: LedgerCore;
  observed: ChainMessage[];
  world: WorldDoc;
  state: WorldState;
}

/** The chat's head, read without the ledger's queue; null when it plays no world, or its world revision isn't loaded. */
export async function chatHead(rt: Runtime, chatId: ChatId, userId: UserId): Promise<ChatHead | null> {
  const run = await rt.runOf(chatId, userId);
  const core = run ? await rt.ledger.core(chatId, userId) : null;
  if (!run || !core) return null;
  const observed = toChain(await rt.host.chats.messages(chatId, userId));
  const head = core.renderState(observed);
  return head ? { run, core, observed, world: head.world, state: head.state } : null;
}

/** Who wrote a file in the head as it stands: the reply (1-based, along the chain) whose record holds the write, and the agent's role and batch key (none: the turn's own, or one a turn under way planned). */
export interface FileSource {
  turn: number | null;
  role?: string;
  key?: string;
}

/** Each file of the head's workspace (not the learned area's) with who wrote it (see the header): an agent turn's own write by the role its record names (`Rec.agents`). */
export function fileSources(head: ChatHead): Map<string, FileSource> {
  const fold = head.core.fold(head.observed);
  const written = new Map<string, { hash: string; source: FileSource }>();
  let turn = 0;
  head.core.chain(head.observed).forEach((m, i) => {
    if (m.isUser) return;
    turn++;
    const rec = activeRecord(m, head.core.journal.tombstones);
    if (!rec) return;
    const applied = appliedEvents(rec, fold, i);
    const isWrite = (e: LedgerEvent): e is LedgerEvent & { data: { path: string; hash: string } } => e.type === WS_WRITE && "data" in e && isRecord(e.data) && typeof e.data.path === "string" && typeof e.data.hash === "string";
    // The writes a role of an agent turn committed into the record's own events, by path and body.
    const roles = new Map<string, FileSource>();
    for (const a of rec.agents ?? []) for (const e of a.seq === undefined ? rec.events.slice(a.from, a.to) : (rec.post.find((p) => p.seq === a.seq)?.events.slice(a.from, a.to) ?? [])) if (isWrite(e)) roles.set(`${e.data.path}\u0000${e.data.hash}`, { turn, role: a.role, key: a.key });
    const note = (events: readonly LedgerEvent[], source: FileSource): void => {
      for (const e of events) if (isWrite(e)) written.set(e.data.path, { hash: e.data.hash, source: roles.get(`${e.data.path}\u0000${e.data.hash}`) ?? source });
    };
    // The turn's own events and its other entries name no agent but the turn's own roles.
    note([...applied.events, ...applied.post], { turn });
    for (const fix of applied.fixes) note(fix.events, fix.agent ? { turn, role: fix.agent.role, key: fix.agent.key } : { turn });
  });
  const out = new Map<string, FileSource>();
  // A body no record on the chain wrote (one a turn under way planned) names no one yet.
  for (const [path, hash] of Object.entries(workspaceOf(head.state))) {
    const found = written.get(path);
    out.set(path, found && found.hash === hash ? found.source : { turn: null });
  }
  return out;
}

/** A workspace file as GM → Workspace and the agents list it: its path and body's hash, its size in characters, its pin, whether it is the learned area's or a turn's transcript (`transcripts/`, read-only), and who wrote it on which turn. A global file's path starts `~/`. */
export interface WorkspaceFile {
  path: string;
  hash: string;
  size: number;
  pinned: boolean;
  learned: boolean;
  transcript?: true;
  provenance: { role?: string; key?: string; turn: number | null };
}

/**
 * A workspace as a turn under way holds it (`stagedWorkspace`): its head, the turn's state with what
 * the turn staged on top, the kept files (the learned area's and the global workspace's) with the
 * turn's changes to them, and who staged each file the turn changed, which is no reply's yet.
 */
export interface WorkspaceAt {
  head: ChatHead;
  kept: Readonly<Record<string, KeptFile>>;
  staged: ReadonlyMap<string, { role: string; key: string }>;
}

/** The files kept apart from the chat's story, by path: its learned area's (`learned/`) and its user's global workspace's (`~/`). */
export async function keptFiles(rt: Pick<Runtime, "chatAgents" | "globalFiles">, chatId: ChatId, userId: UserId): Promise<Record<string, KeptFile>> {
  const [{ learned }, global] = await Promise.all([rt.chatAgents.get(chatId, userId), rt.globalFiles.get(userId)]);
  return { ...learned, ...global };
}

/** Every file of a workspace, the head's, the kept ones, then the turns' transcripts (each with its size), by path; a file `staged` names was staged by the turn under way, so no reply holds it yet. */
function filesOf(head: ChatHead, kept: Readonly<Record<string, KeptFile>>, staged: WorkspaceAt["staged"] = new Map()): Map<string, Omit<WorkspaceFile, "size"> & { size?: number }> {
  const out = new Map<string, Omit<WorkspaceFile, "size"> & { size?: number }>();
  const sources = fileSources(head);
  const pins = workspacePins(head.state);
  for (const [path, hash] of Object.entries(workspaceOf(head.state))) {
    const by = staged.get(path);
    const source = by ? { ...by, turn: null } : sources.get(path);
    out.set(path, { path, hash, pinned: own(pins, path) === true, learned: false, provenance: { ...(source?.role !== undefined ? { role: source.role } : {}), ...(source?.key !== undefined ? { key: source.key } : {}), turn: source?.turn ?? null } });
  }
  for (const [path, file] of Object.entries(kept)) {
    out.set(path, { path, hash: file.hash, pinned: file.pinned === true, learned: isLearnedPath(path), provenance: { ...(file.role !== undefined ? { role: file.role } : {}), turn: null } });
  }
  for (const file of transcriptFiles(head)) out.set(file.path, file);
  return out;
}

/** Every file of the chat's workspace, as `at` holds it (a turn under way), else as the chat's head and kept files stand; none for a chat that plays no world. */
async function allFiles(rt: Runtime, env: Pick<ToolEnv, "userId" | "chatId">, at?: WorkspaceAt): Promise<Map<string, Omit<WorkspaceFile, "size"> & { size?: number }>> {
  if (at) return filesOf(at.head, at.kept, at.staged);
  const head = await chatHead(rt, env.chatId, env.userId);
  return head ? filesOf(head, await keptFiles(rt, env.chatId, env.userId)) : new Map();
}

/** The workspace's files, by path, as `at` holds them (a turn under way) or the chat's stand, each with its size (`BlobStore.size`, which reads a body once); none for a chat that plays no world. */
export async function listWorkspace(rt: Runtime, env: Pick<ToolEnv, "userId" | "chatId">, at?: WorkspaceAt): Promise<WorkspaceFile[]> {
  const files = [...(await allFiles(rt, env, at)).values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return Promise.all(files.map(async (f): Promise<WorkspaceFile> => ({ ...f, size: f.size ?? (await rt.blobs.size(env.userId, f.hash)) ?? 0 })));
}

/** A file's text; null when there is no such file, its body is gone, or the chat plays no world. Only the file's own index is read, never who wrote what. */
export async function readWorkspaceFile(rt: Runtime, env: Pick<ToolEnv, "userId" | "chatId">, path: string): Promise<string | null> {
  const head = await chatHead(rt, env.chatId, env.userId);
  if (!head) return null;
  const hash = isKeptPath(path) ? own(await keptFiles(rt, env.chatId, env.userId), path)?.hash : isTranscriptPath(path) ? transcriptFiles(head).find((f) => f.path === path)?.hash : own(workspaceOf(head.state), path);
  return hash === undefined ? null : rt.blobs.get(env.userId, hash);
}

// ---------------------------------------------------------------- the tools

/** A file the view lists, with its text; the note that there is none at `path` when it isn't there or its body is gone. */
async function fileText(view: ToolReadView, path: string): Promise<{ text: string } | { refused: ToolOutcome }> {
  const file = (await view.workspace()).find((f) => f.path === path);
  const body = file ? await view.blob(file.hash) : null;
  return body === null ? { refused: view.refuse(WRITE_NOTE.noFile, { path }) } : { text: body };
}

export const WORKSPACE_TOOLS: readonly ToolDefinition[] = [
  {
    name: "workspace_list",
    family: "workspace",
    tier: "read",
    parameters: () => objectSchema({ under: text() }),
    async run(args, env) {
      const view = await env.reader.view();
      const under = textArg(args, "under");
      const prefix = under === null || under.endsWith("/") ? under : `${under}/`;
      const files = (await view.workspace()).filter((f) => prefix === null || f.path.startsWith(prefix));
      return view.answer({ files: files.map((f) => ({ path: f.path, size: f.size, pinned: f.pinned, turn: f.provenance.turn, ...(f.provenance.role !== undefined ? { by: f.provenance.role } : {}) })) });
    },
  },
  {
    name: "workspace_read",
    family: "workspace",
    tier: "read",
    parameters: () => objectSchema({ path: text() }, ["path"]),
    async run(args, env) {
      const view = await env.reader.view();
      const path = needText(view, "workspace_read", args, "path");
      if (typeof path !== "string") return path;
      const file = await fileText(view, path);
      return "refused" in file ? file.refused : view.answer({ path, text: file.text });
    },
  },
  {
    name: "workspace_grep",
    family: "workspace",
    tier: "read",
    parameters: () => objectSchema({ text: text(), under: text() }, ["text"]),
    async run(args, env) {
      const view = await env.reader.view();
      const needle = needText(view, "workspace_grep", args, "text");
      if (typeof needle !== "string") return needle;
      const under = textArg(args, "under");
      const prefix = under === null || under.endsWith("/") ? under : `${under}/`;
      const lower = needle.toLowerCase();
      const matches: JsonObject[] = [];
      for (const f of await view.workspace()) {
        if (prefix !== null && !f.path.startsWith(prefix)) continue;
        const body = await view.blob(f.hash);
        if (body === null) continue;
        body.split("\n").forEach((line, i) => {
          if (line.toLowerCase().includes(lower)) matches.push({ path: f.path, line: i + 1, text: line });
        });
      }
      return view.answer({ matches });
    },
  },
  {
    name: "workspace_write",
    family: "workspace",
    tier: "gm",
    parameters: () => objectSchema({ path: text(), text: text() }, ["path", "text"]),
    async run(args, env) {
      const view = await env.reader.view();
      const path = needText(view, "workspace_write", args, "path");
      if (typeof path !== "string") return path;
      if (typeof args.text !== "string") return missing(view, "workspace_write", "text");
      return propose(view, env.writer, { kind: "ws_write", path, text: args.text });
    },
  },
  {
    name: "workspace_edit",
    family: "workspace",
    tier: "gm",
    parameters: () => objectSchema({ path: text(), find: text(), replace: text(), all: BOOLEAN }, ["path", "find", "replace"]),
    async run(args, env) {
      const view = await env.reader.view();
      const path = needText(view, "workspace_edit", args, "path");
      if (typeof path !== "string") return path;
      const find = args.find;
      const replace = args.replace;
      if (typeof find !== "string" || find === "") return missing(view, "workspace_edit", "find");
      if (typeof replace !== "string") return missing(view, "workspace_edit", "replace");
      const file = await fileText(view, path);
      if ("refused" in file) return file.refused;
      const parts = file.text.split(find);
      const count = parts.length - 1;
      if (count === 0) return view.refuse(WRITE_NOTE.editMissing, { path });
      const all = boolArg(args, "all") === true;
      if (count > 1 && !all) return view.refuse(WRITE_NOTE.editSeveral, { path, count: String(count) });
      // A function as the replacement, so a "$" in it is taken as written.
      const edited = all ? parts.join(replace) : file.text.replace(find, () => replace);
      return propose(view, env.writer, { kind: "ws_write", path, text: edited });
    },
  },
  {
    name: "workspace_move",
    family: "workspace",
    tier: "gm",
    parameters: () => objectSchema({ from: text(), to: text() }, ["from", "to"]),
    async run(args, env) {
      const view = await env.reader.view();
      const from = needText(view, "workspace_move", args, "from");
      if (typeof from !== "string") return from;
      const to = needText(view, "workspace_move", args, "to");
      if (typeof to !== "string") return to;
      return propose(view, env.writer, { kind: "ws_move", from, to });
    },
  },
  {
    name: "workspace_delete",
    family: "workspace",
    tier: "gm",
    parameters: () => objectSchema({ path: text() }, ["path"]),
    async run(args, env) {
      const view = await env.reader.view();
      const path = needText(view, "workspace_delete", args, "path");
      if (typeof path !== "string") return path;
      return propose(view, env.writer, { kind: "ws_delete", path });
    },
  },
  {
    name: "workspace_pin",
    family: "workspace",
    tier: "gm",
    parameters: () => objectSchema({ path: text(), pinned: BOOLEAN }, ["path", "pinned"]),
    async run(args, env) {
      const view = await env.reader.view();
      const path = needText(view, "workspace_pin", args, "path");
      if (typeof path !== "string") return path;
      const pinned = boolArg(args, "pinned");
      if (pinned === null) return missing(view, "workspace_pin", "pinned");
      return propose(view, env.writer, { kind: "ws_pin", path, pinned });
    },
  },
];
