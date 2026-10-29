// The chat's workspace for the agents (AGENT-LOOP-PLAN §4, §6; INC1-SPEC R3b): its files as an
// agent's knowledge may read them, and the workspace family's tools.
//
// A file is a path in the chat's head (`engine/workspace.ts`: the index the `engine.ws.*` events fold
// along the active chain, its pins and readers beside it), its body a blob (`agents/blobs.ts`); or a
// path under `learned/`, the learned area, kept with its pin and readers in the chat's metadata
// (`chat-agent-meta.ts`), so a swipe never changes it and a Branch copies it. Each file says whose
// knowledge may read it, its readers: the player character's (every agent's), everyone's, or the
// GM's alone; it is read under that knowledge or a wider one. An agent's write is read with the
// knowledge it wrote under (an assistant proposal's, the wider of the one it was proposed under and
// the one it is applied under), so a note an agent wrote with the GM's knowledge never reaches one
// that reads as the player character. The GM's own files (GM → Workspace) are the GM's alone until
// the GM shares them; a move keeps a file's readers; a file no write named readers for (a turn's
// own) is the GM's alone. Who wrote a file is the record its write landed in: an agent's write is a
// `fix` entry naming the agent (`PostEntry.agent`). Everything here reads the head without the
// ledger's queue, as the GM view does.
//
// The tools: list, read and grep read; write, edit, move, delete and pin propose the change
// (`propose`), which lands as one GM edit with its Undo once it is applied (a learned file's at once,
// in the chat's metadata).

import { WRITE_NOTE } from "../../../shared/agent-tools-write";
import { type AgentKnowledge, knowledgeWithin } from "../../../shared/agent-tools";
import type { ChatId, UserId } from "../../../shared/ids";
import { isRecord, type JsonObject } from "../../../shared/json";
import type { ChatRun, LedgerEvent } from "../../../shared/ledger";
import type { WorldDoc } from "../../../shared/world";
import type { ChainMessage } from "../../../engine/ledger/chain";
import type { LedgerCore } from "../../../engine/ledger/journal";
import { activeRecord } from "../../../engine/ledger/path";
import { own } from "../../../engine/pack-kit";
import type { WorldState } from "../../../engine/state";
import { readersOf, WS_WRITE, workspaceOf, workspacePins } from "../../../engine/workspace";
import { toChain } from "../../ledger-io";
import type { Runtime } from "../../runtime";
import { appliedEvents } from "../../view";
import type { ToolOutcome } from "../runtime";
import { BOOLEAN, boolArg, missing, propose } from "./propose";
import type { ToolReadView } from "./read-view";
import type { ToolDefinition, ToolEnv } from "./registry";
import { needText, objectSchema, text, textArg } from "./schema";

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

/** Each file of the head's workspace (not the learned area's) with who wrote it (see the header). */
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
    const note = (events: readonly LedgerEvent[], source: FileSource): void => {
      for (const e of events) if (e.type === WS_WRITE && "data" in e && isRecord(e.data) && typeof e.data.path === "string" && typeof e.data.hash === "string") written.set(e.data.path, { hash: e.data.hash, source });
    };
    // The turn's own events and its other entries name no agent.
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

/** A workspace file as GM → Workspace and the agents list it: its path and body's hash, its size in characters, its pin, whose knowledge may read it, whether it is the learned area's, and who wrote it on which turn. */
export interface WorkspaceFile {
  path: string;
  hash: string;
  size: number;
  pinned: boolean;
  readers: AgentKnowledge;
  learned: boolean;
  provenance: { role?: string; key?: string; turn: number | null };
}

/** Every file of the chat's workspace, the head's then the learned area's, by path; none for a chat that plays no world. */
async function allFiles(rt: Runtime, env: Pick<ToolEnv, "userId" | "chatId">): Promise<Map<string, Omit<WorkspaceFile, "size">>> {
  const out = new Map<string, Omit<WorkspaceFile, "size">>();
  const head = await chatHead(rt, env.chatId, env.userId);
  if (!head) return out;
  const sources = fileSources(head);
  const pins = workspacePins(head.state);
  for (const [path, hash] of Object.entries(workspaceOf(head.state))) {
    const source = sources.get(path);
    out.set(path, { path, hash, pinned: own(pins, path) === true, readers: readersOf(head.state, path), learned: false, provenance: { ...(source?.role !== undefined ? { role: source.role } : {}), ...(source?.key !== undefined ? { key: source.key } : {}), turn: source?.turn ?? null } });
  }
  for (const [path, file] of Object.entries((await rt.chatAgents.get(env.chatId, env.userId)).learned)) {
    out.set(path, { path, hash: file.hash, pinned: file.pinned === true, readers: file.readers, learned: true, provenance: { ...(file.role !== undefined ? { role: file.role } : {}), turn: null } });
  }
  return out;
}

/** The workspace's files the knowledge may read, by path; none for a chat that plays no world. */
export async function listWorkspace(rt: Runtime, env: Pick<ToolEnv, "userId" | "chatId" | "knowledge">): Promise<WorkspaceFile[]> {
  const files = [...(await allFiles(rt, env)).values()].filter((f) => knowledgeWithin(f.readers, env.knowledge)).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return Promise.all(files.map(async (f): Promise<WorkspaceFile> => ({ ...f, size: (await rt.blobs.get(env.userId, f.hash))?.length ?? 0 })));
}

/** A file's text as the knowledge may read it; null when there is no such file, the knowledge may not read it, or its body is gone. */
export async function readWorkspaceFile(rt: Runtime, env: Pick<ToolEnv, "userId" | "chatId" | "knowledge">, path: string): Promise<string | null> {
  const file = (await allFiles(rt, env)).get(path);
  if (!file || !knowledgeWithin(file.readers, env.knowledge)) return null;
  return rt.blobs.get(env.userId, file.hash);
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
