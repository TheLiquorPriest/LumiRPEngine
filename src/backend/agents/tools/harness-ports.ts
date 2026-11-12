// What a harness tool reaches beyond the read view and the turn (`ToolEnv.build`, `ToolEnv.files`):
// the world's document as Build edits it, and LumiAH's workspace. Both are ports the bridge
// (`backend/harness/`) fills for a call, so a tool names what it needs of the backend and nothing
// else of it; a tool whose port is absent says so instead of running.
//
// - The world's document. A chat plays one revision of its world; Build edits the world's draft and
//   commits it as the next revision, and an Upgrade moves a chat to a revision. The `world` tools
//   do exactly that, through the store's own path for an editor's writes (`WorldStore.edit`: the
//   schema check, the map compiler, lint, the draft's version), so an agent's edit is the edit Build
//   would make and an open Build page hears of it as it hears of its own.
// - The workspace. On the harness the agents' files are LumiAH's (its DESIGN §11): versioned
//   writes in the chat's area. The engine's tools that keep a file (a lore draft, a mind's own
//   files) write through this port.

import { WRITE_NOTE } from "../../../shared/agent-tools-write";
import { WORLD_NOTE } from "../../../shared/harness-texts-world";
import { hashJson } from "../../../shared/hash";
import type { ChatId, RevisionId, UserId, WorldId } from "../../../shared/ids";
import { isRecord, type JsonValue } from "../../../shared/json";
import { getAt, jsonEqual, pointerOf } from "../../../shared/json-patch";
import type { LedgerEvent, UpgradePicks } from "../../../shared/ledger";
import { type EditorRequest, type JsonPatchOp, type LintIssue, PROTOCOL_VERSION, type ResultBodies, type UpgradePreview, type WorldCollection, type WorldPart } from "../../../shared/protocol";
import { AGENT_CHANGE_LABEL } from "../../../shared/settings";
import type { RevisionNote, WorldDoc } from "../../../shared/world";
import { stamped } from "../../../engine/authoring";
import { validMarkerBody } from "../../../engine/events";
import type { WorldState } from "../../../engine/state";
import { toChain } from "../../ledger-io";
import { renderPrompt } from "../../prompts";
import type { Runtime } from "../../runtime";
import { effectiveMode } from "../../settings-store";
import { previewUpgrade } from "../../upgrade-preview";
import { type DraftNotice, type EditorResult, WorldError } from "../../worlds";

/**
 * One write of the world's draft, as Build's editor makes it: an `EditorRequest` without its
 * envelope. `version`: the draft's version as the caller read it; the store refuses the write once
 * the draft has moved on since, so nothing is written over what the caller hasn't seen.
 */
export type WorldEdit =
  | { op: "get" }
  | ({ version?: number } & (
      | { op: "discard" }
      | { op: "put"; collection: WorldCollection; id: string; value: JsonValue }
      | { op: "remove"; collection: WorldCollection; id: string }
      | { op: "set"; part: WorldPart; value: JsonValue }
      | { op: "patch"; ops: JsonPatchOp[] }
      | { op: "restore"; revision: RevisionId }
    ));

/**
 * The document of the world a chat plays, as an agent edits it. Every member answers as the store
 * does and throws its `WorldError` (`not_found`, `conflict`, `validation` with the lint that
 * refused it, `bad_request`), whose message says what to fix.
 *
 * `sections` rides on this port because it is the one the bridge fills from the runtime: the
 * sections the next reply's writer would be given, which only the runtime's own builder makes.
 */
export interface WorldBuild {
  worldId: WorldId;
  /** The world's head: the revision a new chat starts from, and the one an Upgrade brings this chat to. */
  head(): Promise<RevisionId>;
  /** How each of the world's revisions became its head, oldest first: what `restore` names one by. */
  history(): Promise<RevisionNote[]>;
  /** One of the world's revisions, whole: what a write of the document is compared with, to say what it would change. */
  revision(revision: RevisionId): Promise<WorldDoc>;
  /** The revision a commit of `draft` as it stands makes: a revision is named by what it holds, so the one a draft becomes can be named, and an Upgrade to it asked for, before the commit is made. */
  revisionOf(draft: WorldDoc): RevisionId;
  /** One editor operation on the draft, answered with the draft as it stands after it and its lint. */
  edit(edit: WorldEdit): Promise<EditorResult>;
  /** The draft as the world's next revision, with a note for its history (null: none). `version`: the draft's version as the caller read it; the store refuses the commit when the draft has moved on since, so nothing unseen is committed. */
  commit(note: string | null, version?: number): Promise<{ revision: RevisionId; lint: LintIssue[] }>;
  /**
   * Moves the chat to `to`, a revision of its world (an Upgrade). With `merge` the revision's
   * people and things come into the chat as the picks say, each part without one by its default
   * (taken where play never touched it, kept where it did); without, only the revision switches.
   * While a turn runs the move waits for its end (`pending`).
   */
  upgrade(to: RevisionId, merge?: UpgradePicks): Promise<{ pending: boolean }>;
  /** What an Upgrade of the chat to `to` would bring into it, from `state` (the chat as the caller reads it): the Upgrade's own preview. `unmade`: the document `to` names while it is no revision yet (`revisionOf`). */
  preview(state: Readonly<WorldState>, to: RevisionId, unmade?: WorldDoc): Promise<UpgradePreview>;
  /**
   * Why nothing of the world's document may be written now, in the writer's own words: the player
   * set "The world's document" to Never. Read as they have it now, whatever the turn began with, as
   * the writer reads it for an act (`gate`). Null while a write may be made.
   */
  never(): Promise<string | null>;
  /** What the next reply's writer would be given, section by section, from the chat's head as it stands (GM → This chat → Sections' preview): model-free. */
  sections(): Promise<ResultBodies["lre.sections"]>;
}

/** A file of the workspace as a tool reads it: its body and the version a write of it must name. */
export interface HarnessFile {
  path: string;
  text: string;
  version: string;
}

/**
 * The chat's area of LumiAH's workspace (its DESIGN §11), as an engine tool reaches it. Paths are
 * relative to the chat's area and checked there: one that leaves it is refused. A write names the
 * version it was based on (null: the file is new), and a mismatch is refused with the current one,
 * so two agents never overwrite each other unseen.
 */
export interface HarnessFiles {
  /** The files under `folder` (a path ending in `/`), each with its size in characters and its version. */
  list(folder: string): Promise<{ path: string; size: number; version: string }[]>;
  read(path: string): Promise<HarnessFile | null>;
  write(path: string, text: string, base: string | null): Promise<{ version: string } | { refused: { code: string; reason: string; version: string | null } }>;
}

/** What `worldBuild` needs of the backend. */
export type BuildRuntime = Pick<Runtime, "worlds" | "book" | "ledger" | "push" | "host" | "runOf" | "previewSections" | "settings" | "activeConnectionId" | "registry">;

/**
 * Where an agent writes nothing in a world's document, whatever the mode of "The world's
 * document": who the player's character is, and what the engine holds agents to. An agent that
 * could write one could loosen what it is checked by, so each is the user's alone to set, in Build.
 * Everything else, the world's content and its rules, is an agent's to build.
 */
export const CLOSED_PATHS: readonly (readonly string[])[] = [
  // Who the player is: every "is this the player's character" the engine asks is asked of it.
  ["pov"],
  // How many people and places a chat's replies may bring in.
  ["spawnCap"],
  ["placeCap"],
  ["placesPerTurn"],
  // The price past which a thing made for the story asks first, and the most a narrated price may be.
  ["packs", "economy", "config", "claimCap"],
  ["packs", "economy", "config", "unpricedCap"],
  // What a reply may make real of what the player says they have.
  ["realism", "claims"],
  // What the narrator is told: whose knowledge and whether secrets, and how much of a mind.
  ["narrator"],
  ["minds", "secrecy"],
  // Which of the user's own World Info books the world reads.
  ["loreBooks"],
];

/** The closed paths, as JSON Pointers, where `after` holds something else than `before`: what no write of the world's document by an agent may leave. Both are world documents, which are plain JSON. */
export function closedChanges(before: unknown, after: unknown): string[] {
  return CLOSED_PATHS.filter((tokens) => !jsonEqual(getAt(before as JsonValue, tokens), getAt(after as JsonValue, tokens))).map(pointerOf);
}

/**
 * An act on the world's document that changes what was authored for every chat of the world, or
 * can throw away the user's own Build edits: the draft committed, the chat brought to a revision,
 * the draft dropped, the draft made a copy of a revision. It goes through the same gate as every
 * other change (the change type "The world's document"): a `world` tool asks for it as the
 * writer's `world` operation, staged with the turn and decided when the turn commits, by the mode
 * set then. Where it lands, at that commit or on the review card's Apply, it is made here
 * (`makeWorldActs`).
 *
 * What an act names is pinned when it is asked, so what the review card showed is what Apply
 * makes. A commit and a restore name the draft's version, and the store refuses either once the
 * draft has moved on. An Upgrade names its revision: one the world has, or, asked while a draft
 * waits to be committed, the revision that draft's commit makes (`draft`: its version), which the
 * world has only once that commit is made. `merge`: its picks; absent, only the revision switches.
 * An act kept on a card before acts were pinned reads as it was asked: a commit of the draft as it
 * stands (`version: null`), an Upgrade to the head as it is when made (`to: null`).
 */
export type WorldAct =
  | { do: "commit"; note: string | null; version: number | null }
  | { do: "upgrade"; to: RevisionId | null; merge?: UpgradePicks; draft?: number }
  | { do: "discard"; version: number }
  | { do: "restore"; revision: RevisionId; version?: number };

/**
 * What an act would change, in lines, as each reader is told it: the agent that asked for it
 * (everything named, a secret marked as one) and the player on the review card (what the document
 * keeps from someone is counted there, never named).
 */
export interface WorldActDetail {
  agent: string[];
  player: string[];
}

/** The event type that words a world act where the writer words an operation by its events; never written to a ledger. */
export const WORLD_ACT_SHOWN = "lre.world.act";

/** The events that word an act: its own line, told to every reader, then what it would change as each reader is told that; null when `detail` isn't one. */
export function worldActShown(line: string, detail: unknown): LedgerEvent[] | null {
  const told = (text: string, reader?: keyof WorldActDetail): LedgerEvent => ({ type: WORLD_ACT_SHOWN, data: { line: text, ...(reader !== undefined ? { reader } : {}) } });
  if (detail === undefined) return [told(line)];
  if (!isRecord(detail)) return null;
  const lines = (v: unknown): v is string[] => Array.isArray(v) && v.every((l) => typeof l === "string");
  const { agent, player } = detail;
  return lines(agent) && lines(player) ? [told(line), ...agent.map((l) => told(l, "agent")), ...player.map((l) => told(l, "player"))] : null;
}

/** An act's lines as the player reads them on the review card (`player`) or as an agent does, from the events that word it. */
export function worldActLines(events: readonly LedgerEvent[], player: boolean): string[] {
  const reader: keyof WorldActDetail = player ? "player" : "agent";
  return events.flatMap((e) => ("data" in e && isRecord(e.data) && typeof e.data.line === "string" && (e.data.reader === undefined || e.data.reader === reader) ? [e.data.line] : []));
}

/** An act read back from an operation as it was kept (a review card keeps one as JSON); null when it isn't one. */
export function worldActOf(raw: unknown): WorldAct | null {
  if (!isRecord(raw)) return null;
  const whole = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;
  switch (raw.do) {
    case "commit":
      return (raw.note === null || typeof raw.note === "string") && (raw.version === null || whole(raw.version)) ? { do: "commit", note: raw.note, version: raw.version } : null;
    case "upgrade": {
      const draft = raw.draft === undefined ? {} : whole(raw.draft) ? { draft: raw.draft } : null;
      if (draft === null) return null;
      if (raw.merge === undefined) return raw.to === null || (typeof raw.to === "string" && raw.to !== "") ? { do: "upgrade", to: raw.to, ...draft } : null;
      // Its picks are read by the engine's own reader of an Upgrade's marker: one it refuses is no act.
      const body = validMarkerBody({ kind: "migrate", to: raw.to, merge: raw.merge });
      return body?.kind === "migrate" && body.merge ? { do: "upgrade", to: body.to, merge: body.merge, ...draft } : null;
    }
    case "discard":
      return whole(raw.version) ? { do: "discard", version: raw.version } : null;
    case "restore":
      return typeof raw.revision === "string" && raw.revision !== "" && (raw.version === undefined || whole(raw.version)) ? { do: "restore", revision: raw.revision, ...(raw.version !== undefined ? { version: raw.version } : {}) } : null;
    default:
      return null;
  }
}

/**
 * What an act came to: what was made, in words for whoever asked for it, or why the world's store
 * refused it. A commit that made a new revision says which, and the world's newest revision before
 * it (`committed`); an Upgrade says the revision it brings the chat to (`moved`).
 */
export type WorldActResult = { made: string; committed?: { from: RevisionId; to: RevisionId }; moved?: RevisionId } | { refused: string };

/**
 * Makes each act in the order asked, as a turn's commit or a review card's Apply lands them, and
 * says what each came to in the user's texts. One the store refuses stops none of the others.
 * `heard`: told of each change an act makes to the draft, as the store makes it (`worldBuild`).
 */
export async function makeWorldActs(rt: BuildRuntime, who: { chatId: ChatId; userId: UserId }, acts: readonly WorldAct[], heard?: DraftNotice): Promise<WorldActResult[]> {
  const { texts } = (await rt.settings.get(who.userId)).prompts;
  const say = (id: string, vars: Record<string, string> = {}): string => renderPrompt(id, texts, vars);
  const build = await worldBuild(rt, who.chatId, who.userId, heard);
  /** The revision the chat plays now: a move that waits for the turn's end hasn't changed it. */
  const playing = async (): Promise<string | null> => {
    const core = await rt.ledger.core(who.chatId, who.userId);
    return core?.renderState(toChain(await rt.host.chats.messages(who.chatId, who.userId)))?.state.revision ?? null;
  };
  const make = async (port: WorldBuild, act: WorldAct): Promise<Extract<WorldActResult, { made: string }>> => {
    switch (act.do) {
      case "commit": {
        // The draft may have moved since the commit was asked, and an act kept on a card before acts were pinned names no version: what is closed to agents is held to as it stands now.
        const head = await port.head();
        const closed = closedChanges(await port.revision(head), (await port.edit({ op: "get" })).draft);
        if (closed.length > 0) throw new WorldError("conflict", say(WORLD_NOTE.closedCommit, { paths: closed.join(", ") }));
        // The store refuses a draft begun on another head, so a commit it makes was made on the head read here.
        const { revision } = await port.commit(act.note, act.version ?? undefined);
        const at = await playing();
        const made = at !== null && at !== revision ? `${say(WORLD_NOTE.committed, { revision })} ${say(WORLD_NOTE.upgradeNext, { playing: at })}` : say(WORLD_NOTE.committed, { revision });
        return { made, ...(revision !== head ? { committed: { from: head, to: revision } } : {}) };
      }
      case "upgrade": {
        const to = act.to ?? (await port.head());
        const at = await playing();
        if (to === at) throw new WorldError("conflict", say(WORLD_NOTE.alreadyPlays, { revision: to }));
        // Asked to follow a draft's commit: where that commit wasn't made, the world has no such revision to play.
        if (act.draft !== undefined && !(await port.history()).some((n) => n.revision === to)) throw new WorldError("not_found", say(WORLD_NOTE.notCommitted, { revision: to, version: String(act.draft) }));
        // The head may be another than the one the move was asked for: what is closed to agents is held to for the revision the chat is in fact brought to.
        const closed = at === null ? [] : closedChanges(await port.revision(at), await port.revision(to));
        if (closed.length > 0) throw new WorldError("conflict", say(WORLD_NOTE.closedUpgrade, { revision: to, paths: closed.join(", ") }));
        const { pending } = await port.upgrade(to, act.merge);
        return { made: say(pending ? WORLD_NOTE.upgradePending : WORLD_NOTE.upgradeLanded, { revision: to }), moved: to };
      }
      case "discard":
        await port.edit({ op: "discard", version: act.version });
        return { made: say(WORLD_NOTE.discarded) };
      case "restore": {
        // The draft may have moved since the restore was asked: what is closed to agents is held to as it stands now.
        const closed = closedChanges((await port.edit({ op: "get" })).draft, await port.revision(act.revision));
        if (closed.length > 0) throw new WorldError("conflict", say(WORLD_NOTE.closedRestore, { revision: act.revision, paths: closed.join(", ") }));
        await port.edit({ op: "restore", revision: act.revision, ...(act.version !== undefined ? { version: act.version } : {}) });
        return { made: say(WORLD_NOTE.restored, { revision: act.revision }) };
      }
    }
  };
  const out: WorldActResult[] = [];
  for (const act of acts) {
    try {
      if (!build) throw new WorldError("not_found", say(WRITE_NOTE.noWorld));
      out.push(await make(build, act));
    } catch (error) {
      if (!(error instanceof WorldError)) throw error;
      out.push({ refused: error.message });
    }
  }
  return out;
}

let writes = 0;

/** Tells the user's open Build pages of a change to a world's draft, as they are told of their own (`lre.draft.changed`). */
export function draftNotice(rt: Pick<Runtime, "host">, userId: UserId): DraftNotice {
  return (id, draft) => rt.host.frontend.send({ lre: PROTOCOL_VERSION, type: "lre.draft.changed", worldId: id, version: draft.version, stored: draft.stored, base: draft.base }, userId);
}

/** The world's lore book follows its head, as after Build's own commit and Upgrade. */
export async function syncWorldBook(rt: Pick<Runtime, "worlds" | "book">, worldId: WorldId, userId: UserId): Promise<void> {
  const index = await rt.worlds.index(worldId, userId);
  if (index) await rt.book.ensure((await rt.worlds.get(worldId, userId)).world, index, userId);
}

/**
 * The world's document for a call on `chatId`; null for a chat that plays no world. A write is the
 * store's, in turn with the world's other writes; the user's open Build page is told of each as it
 * is of its own (`lre.draft.changed`), and so is `heard`, in the store's own turn of that write.
 * What the port refuses by itself it says in the user's texts.
 */
export async function worldBuild(rt: BuildRuntime, chatId: ChatId, userId: UserId, heard?: DraftNotice): Promise<WorldBuild | null> {
  const run = await rt.runOf(chatId, userId);
  if (!run) return null;
  const worldId = run.worldId;
  const say = async (id: string, vars: Record<string, string> = {}): Promise<string> => renderPrompt(id, (await rt.settings.get(userId)).prompts.texts, vars);
  const told = draftNotice(rt, userId);
  const changed: DraftNotice = (id, draft) => {
    told(id, draft);
    heard?.(id, draft);
  };
  return {
    worldId,
    head: async () => {
      const index = await rt.worlds.index(worldId, userId);
      if (!index) throw new WorldError("not_found", await say(WRITE_NOTE.noWorld));
      return index.head;
    },
    history: () => rt.worlds.history(worldId, userId),
    revision: async (revision) => (await rt.worlds.get(worldId, userId, revision)).world,
    revisionOf: (draft) => {
      // As the store names a revision it commits (`WorldStore.commitDoc`): the hash of the document, stamped.
      try {
        return hashJson(stamped(draft));
      } catch (error) {
        // A document stored before writes were held to a depth can nest past what hashing takes: the store refuses its commit the same way.
        throw new WorldError("validation", error instanceof Error ? error.message : String(error));
      }
    },
    edit: (edit) => rt.worlds.edit({ lre: PROTOCOL_VERSION, type: "lre.editor", reqId: "harness", worldId, base: null, ...edit } as EditorRequest, userId, changed),
    commit: async (note, version) => {
      const committed = await rt.worlds.commit(worldId, null, userId, { source: "agent", ...(note !== null ? { note } : {}), ...(version !== undefined ? { version } : {}) }, changed);
      await syncWorldBook(rt, worldId, userId);
      return committed;
    },
    upgrade: async (to, merge) => {
      if (!(await rt.worlds.hasRevision(worldId, to, userId))) throw new WorldError("not_found", await say(WORLD_NOTE.noRevision, { revision: to }));
      // The marker as the engine's own reader of one takes it: picks it refuses make no Upgrade.
      const body = validMarkerBody({ kind: "migrate", to, ...(merge !== undefined ? { merge } : {}) });
      if (!body) throw new WorldError("bad_request", await say(WORLD_NOTE.badMerge));
      const result = await rt.ledger.write(chatId, userId, { kind: "marker", id: `h${Date.now().toString(36)}${(++writes).toString(36)}`, target: "head", body }, { answerQueued: true });
      if (!result.applied && !result.pending) throw new WorldError("conflict", result.reason === "paused" ? await say(WRITE_NOTE.paused) : (result.reason ?? (await say(WRITE_NOTE.stale))));
      rt.push.changed(chatId, userId);
      await syncWorldBook(rt, worldId, userId);
      return { pending: result.pending };
    },
    preview: async (state, to, unmade) => {
      const preview = await previewUpgrade(rt, chatId, userId, state, to, unmade);
      if (!preview) throw new WorldError("not_found", await say(WRITE_NOTE.noWorld));
      return preview;
    },
    never: async () => {
      const settings = rt.settings.latest(userId) ?? (await rt.settings.get(userId));
      // Never is only ever the player's own setting of the type, so whose change it would be doesn't enter; on the harness a type the player didn't set lands.
      const { mode } = effectiveMode(settings, await rt.settings.learningOf(userId), await rt.activeConnectionId(userId), "world_document", undefined, "harness");
      return mode === "never" ? renderPrompt(WRITE_NOTE.never, settings.prompts.texts, { type: AGENT_CHANGE_LABEL.world_document }) : null;
    },
    sections: async () => {
      const core = await rt.ledger.core(chatId, userId);
      if (!core) throw new WorldError("not_found", await say(WRITE_NOTE.noWorld));
      return rt.previewSections(chatId, userId, core, toChain(await rt.host.chats.messages(chatId, userId)));
    },
  };
}
