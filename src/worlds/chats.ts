// A world's chats, moving a chat on from its next turn, and attaching a world to a chat (plan §14, §6.3, §10.9 l.1313-1318, R-22, R-29;
// PlanChatUI-B4). Everything here reads and writes RPE's store alone: which chats play one of his worlds and at which revision, what
// moving one to a newer revision would bring (`upgrade-preview.ts`), the move itself, and attaching a world to a chat that plays none.
//
// Both are his own changes to the chat, as a tap is: recorded of no turn, kept with the chat and the moment (`UserStore.record`), so the
// store places each just before the first turn of the chat's own path to begin after it. A turn that runs now keeps the state it
// started with, the next turn plays the new revision and is told of it as his own change, and in a branch that has played no turn of its
// own the change sits on the branch's own line. An Upgrade is Undone by recording its reversal, the same way. RPE writes nothing to
// Lumiverse for any of it (plan §4.2). No turn id is asked or answered: the routes take a chat, a world, a revision and his picks.

import type { LiveHub, WriteQueue } from "../app";
import { validMarkerBody } from "../engine/events";
import type { RevisionId, UserId, WorldId } from "../shared/ids";
import type { JsonValue } from "../shared/json";
import { isRecord } from "../shared/json";
import type { EntityUpgradePick, MarkerBody, UpgradePicks } from "../shared/ledger";
import type { UpgradeChange, UpgradePreview } from "../shared/upgrade";
import type { WorldDoc } from "../shared/world";
import { BLANK_REVISION, type ChangeInput, type ChangeRow, type Store } from "../store";
import { STORE_OPS } from "../store/types";
import { previewUpgradeOf } from "./upgrade-preview";
import { WorldError, type WorldStore } from "./worlds";

/** What the chats service stands on. */
export interface WorldChatsDeps {
  store: Pick<Store, "user" | "env">;
  writes: WriteQueue;
  /** His worlds: each one's head and revisions. */
  worlds: Pick<WorldStore, "index" | "hasRevision">;
  live: Pick<LiveHub, "publish">;
  /** Whether a turn of the user's chat runs now. */
  turning(user: UserId, chat: string): boolean;
  /** A chat's name in Lumiverse, through the door; null for one it does not know. */
  name(chat: string): Promise<string | null>;
  /** Whether Lumiverse has the chat among the user's, by the door's read of its chats; null where RPE reaches no Lumiverse to look. */
  has(chat: string): Promise<boolean | null>;
}

/** A chat that plays one of his worlds. */
export interface WorldChat {
  chat: string;
  /** Its name in Lumiverse; its id for one the door does not name. */
  name: string;
  world: WorldId;
  /** The world's name; its id where the world is gone. */
  worldName: string;
  /** The revision the chat plays now: the one in force at its head, which counts a move that waits for its next turn. */
  revision: RevisionId;
  /** The world's head revision; null where the world is gone from his worlds. */
  head: RevisionId | null;
  /** Whether the world has a newer revision than the chat plays. */
  behind: boolean;
  /** Why the chat cannot be moved on, where it cannot. */
  reason?: string;
}

/** What attaching a world to a chat came to. */
export interface Attached {
  /** The chat plays the world's head revision from its next turn (or from its start, a chat the store has not met). */
  attached: boolean;
  /** The revision it plays, or will; for a chat that plays a world already, the one it plays. */
  revision: RevisionId;
  /** For a chat that plays a world already: which one, at which revision, and whether it is behind that world's head. */
  plays?: { world: WorldId; name: string; revision: RevisionId; behind: boolean };
  /** A turn runs now, so the next turn is the first to play it. */
  waiting: boolean;
}

/** What an Upgrade came to. */
export interface Upgraded {
  /** The revision the chat plays from its next turn. */
  revision: RevisionId;
  /** The id its Undo takes; null when the chat plays that revision already and nothing was recorded. */
  edit: string | null;
  /** Whether the change took effect where it was recorded. */
  applied: boolean;
  /** A turn runs now, so the next turn is the first to play it. */
  waiting: boolean;
}

/** An Undo of an Upgrade. */
export interface UpgradeUndone {
  /** Whether anything was recorded: not for an Upgrade undone already, or one that left nothing to take back. */
  undone: boolean;
  /** Why nothing was, in words. */
  words: string;
}

/** The picks that make `choose` the pick of every change of `preview`: only those that differ from the default travel, written at every target (both sides of a relation pair). */
function picksOf(preview: UpgradePreview, choose: (change: UpgradeChange) => EntityUpgradePick): UpgradePicks {
  const merge: UpgradePicks = {};
  for (const row of preview.entities) {
    for (const change of row.changes) {
      const choice = choose(change);
      if (choice === change.pick) continue;
      for (const t of change.targets) {
        const picks = (merge[t.entity] ??= {});
        if (t.part === "entity") picks.entity = choice;
        else if (choice === "remove") continue;
        else if (t.part === "field") (picks.fields ??= {})[t.field] = choice;
        else if (t.part === "relation") ((picks.relations ??= {})[t.rel] ??= {})[t.to] = choice;
        else picks[t.part] = choice;
      }
    }
  }
  return merge;
}

/** The change a marker's cite records: which revision it moved from and to, so its Undo knows where to go back to. */
interface Moved {
  from: RevisionId;
  to: RevisionId;
}

function movedBy(change: ChangeRow): Moved | null {
  const cite = isRecord(change.cite) ? change.cite : {};
  const request = isRecord(cite.request) ? cite.request : {};
  return change.op === STORE_OPS.marker && request.kind === "migrate" && typeof request.from === "string" && typeof request.to === "string" ? { from: request.from, to: request.to } : null;
}

export class WorldChats {
  constructor(private readonly deps: WorldChatsDeps) {}

  /** The chat's head as an Upgrade reads it, with the world it plays; a chat that plays no world is refused. */
  private head(user: UserId, chat: string) {
    const s = this.deps.store.user(user);
    const row = s.chat(chat);
    if (row === null || row.world === null) throw new WorldError("not_found", `chat ${chat} plays no world of yours`);
    return { s, world: row.world, state: s.headState(chat).state.world };
  }

  private told(chat: string): void {
    this.deps.live.publish(chat, { kind: "state", data: {} });
  }

  /** Tells the pages of chats that played a world its deletion let go of: they play no world from now. */
  released(chats: readonly string[]): void {
    for (const chat of chats) this.told(chat);
  }

  /**
   * The chats that play one of his worlds (one world's with `world`, one chat with `chat`), each with its name, the revision it plays and
   * whether that is behind the world's head. A chat whose state cannot be read (the revision it started from is gone) is left out, and the
   * rest are listed: one such chat never fails the list.
   */
  async chatsOf(user: UserId, of: { world?: WorldId; chat?: string } = {}): Promise<WorldChat[]> {
    const s = this.deps.store.user(user);
    const rows = of.chat !== undefined ? [s.chat(of.chat)] : s.chats();
    const out: WorldChat[] = [];
    for (const row of rows) {
      if (row === null || row.deleted !== null || row.world === null || (of.world !== undefined && row.world !== of.world)) continue;
      let revision: RevisionId;
      try {
        revision = s.headState(row.id).state.world.revision;
      } catch {
        continue;
      }
      if (revision === BLANK_REVISION) continue;
      const index = await this.deps.worlds.index(row.world, user);
      out.push({
        chat: row.id,
        name: (await this.deps.name(row.id)) ?? row.id,
        world: row.world,
        worldName: index?.name ?? row.world,
        revision,
        head: index?.head ?? null,
        behind: index !== null && index.head !== revision,
        ...(index === null ? { reason: "The world is gone from your worlds, so there is nothing to move this chat to." } : {}),
      });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * What moving the chat to `to` would bring in, entity by entity and part by part, each with the pick it defaults to and why (a secret row
   * marked behind the spoiler gate). `unmade` is the document `to` names while it is no revision yet (a draft), to show what a commit and
   * the Upgrade after it bring before either is made.
   */
  async preview(user: UserId, chat: string, to: RevisionId, unmade?: WorldDoc): Promise<UpgradePreview> {
    const { world, state } = this.head(user, chat);
    if (unmade === undefined && !(await this.deps.worlds.hasRevision(world, to, user))) throw new WorldError("not_found", `revision ${to} of the world is not one of its revisions`);
    return previewUpgradeOf({ registry: this.deps.store.env.registry, worlds: this.deps.store.env.worlds }, state, to, unmade);
  }

  /**
   * Moves the chat to `to` from its next turn, with his picks (a change not named takes its default): recorded as his own change, placed
   * after the newest reply while a run goes on (R-22) and on the branch's own path in a branch with no turn (R-29). The turn that runs now
   * keeps the revision it started with; the next plays the new one and tells the Author. Its Undo takes `edit`.
   */
  async upgrade(user: UserId, chat: string, to: RevisionId, picks: UpgradePicks = {}): Promise<Upgraded> {
    const { world, state } = this.head(user, chat);
    if (!(await this.deps.worlds.hasRevision(world, to, user))) throw new WorldError("not_found", `revision ${to} of the world is not one of its revisions`);
    const marker = validMarkerBody({ kind: "migrate", to, merge: picks });
    if (marker === null) throw new WorldError("bad_request", "your picks are not picks of an Upgrade");
    const waiting = this.deps.turning(user, chat);
    if (state.revision === to && Object.keys(picks).length === 0) return { revision: to, edit: null, applied: true, waiting };
    return { revision: to, ...(await this.record(user, chat, marker, { from: state.revision, to })), waiting };
  }

  /** Records a marker as his own change, citing the edit it is and the revisions it moves between. */
  private async record(user: UserId, chat: string, marker: MarkerBody, moved: Moved): Promise<{ edit: string; applied: boolean }> {
    const s = this.deps.store.user(user);
    const edit = crypto.randomUUID();
    const input: ChangeInput = { lane: "engine", op: STORE_OPS.marker, value: marker as unknown as JsonValue, by: "player", source: "player", cite: { tap: edit, request: { kind: "migrate", ...moved } } };
    const applied = await this.deps.writes.run(() => s.record(s.writeTarget({ chat }), [input]).changes.every((c) => c.applied), "moving a chat to another revision of its world");
    this.told(chat);
    return { edit, applied };
  }

  /**
   * Takes an Upgrade back: the chat goes to the revision it came from, each part taken as the Upgrade's preview from there defaults to
   * (what play changed since stays as played), and what the Upgrade added and play never touched goes. Recorded as his own change that
   * cites the one it undoes, from the next turn like the Upgrade; an Upgrade undone already is not undone twice.
   */
  async undoUpgrade(user: UserId, chat: string, edit: string): Promise<UpgradeUndone> {
    const { s, state } = this.head(user, chat);
    const own = s.ownerChanges(chat);
    const change = own.find((c) => isRecord(c.cite) && c.cite.tap === edit && movedBy(c) !== null);
    const moved = change === undefined ? null : movedBy(change);
    if (change === undefined || moved === null) throw new WorldError("not_found", `no Upgrade of this chat has the id ${edit}`);
    if (own.some((c) => isRecord(c.cite) && c.cite.undoes === change.id)) return { undone: false, words: "That Upgrade was taken back already." };
    if (!change.applied) return { undone: false, words: "That Upgrade changed nothing, so there is nothing to take back." };
    if (state.revision === moved.from) return { undone: false, words: "The chat plays the revision it came from already." };
    const back = previewUpgradeOf({ registry: this.deps.store.env.registry, worlds: this.deps.store.env.worlds }, state, moved.from);
    // What the Upgrade added goes; every other part takes what its preview defaults to: the old text where play did not touch it since.
    const merge = picksOf(back, (c) => (c.why === "removed" ? "remove" : c.pick));
    const marker = validMarkerBody({ kind: "migrate", to: moved.from, merge });
    if (marker === null) throw new WorldError("bad_request", "the Upgrade cannot be taken back: its reversal is no Upgrade");
    const input: ChangeInput = { lane: "engine", op: STORE_OPS.marker, value: marker as unknown as JsonValue, by: "player", source: "player", cite: { undoes: change.id } };
    await this.deps.writes.run(() => s.record(s.writeTarget({ chat }), [input]), "taking an Upgrade back");
    this.told(chat);
    return { undone: true, words: "" };
  }

  /** Refuses a chat Lumiverse does not have among the user's: a world is attached to chats the user has, and nothing is written for one that is not. */
  private async known(chat: string): Promise<void> {
    const there = await this.deps.has(chat);
    if (there === null) throw new WorldError("bad_request", "RPE is not connected to your Lumiverse just now, so it cannot tell whether that chat is one of yours: try again once it is.");
    if (!there) throw new WorldError("not_found", "That chat is not one of your chats in Lumiverse, so no world was attached to it.");
  }

  /**
   * Attaches the world to the chat. A chat that plays no world takes its head revision from its next turn (a marker of his own that takes
   * in everything the world has, as an Upgrade from nothing does), and a chat the store has not met starts on it. One that plays an older
   * revision of this world is offered the Upgrade instead of a refusal, and one that plays another world is told so; neither is written.
   * A chat whose world was deleted plays none (its record and the revision it played stay): the world is taken from that revision on, as for
   * a chat that plays none. A chat that is not one of the user's in Lumiverse is refused, whatever the store holds of it.
   */
  async attach(user: UserId, world: WorldId, chat: string): Promise<Attached> {
    const index = await this.deps.worlds.index(world, user);
    if (index === null) throw new WorldError("not_found", `world ${world} not found`);
    const s = this.deps.store.user(user);
    const waiting = this.deps.turning(user, chat);
    const row = s.chat(chat);
    // A deletion lets go of the chats that played the world; one made before that did not, so a world that is gone counts as none here too.
    const gone = row !== null && row.world !== null && row.world !== world && (await this.deps.worlds.index(row.world, user)) === null ? row.world : null;
    if (row === null || row.world === null || gone !== null) await this.known(chat);
    if (row === null) {
      await this.deps.writes.run(() => s.attachWorld({ id: chat, world, revision: index.head }), "attaching a world to a chat");
      return { attached: true, revision: index.head, waiting };
    }
    if (row.world !== null && gone === null) {
      const revision = s.headState(chat).state.world.revision;
      const other = row.world === world ? index : await this.deps.worlds.index(row.world, user);
      return { attached: false, revision, plays: { world: row.world, name: other?.name ?? row.world, revision, behind: other !== null && other.head !== revision }, waiting };
    }
    if (this.deps.store.env.worlds(index.head) === undefined) throw new WorldError("not_found", `the head revision ${index.head} of ${world} is not kept`);
    // The revision the chat plays now is where the new world comes in from; one deleted along with its world, before a deletion kept what chats play, leaves nothing to come in from.
    const was = s.headState(chat).state.world.revision;
    if (was !== BLANK_REVISION && this.deps.store.env.worlds(was) === undefined) throw new WorldError("conflict", "The world this chat played was deleted before RPE kept the revisions chats play, so nothing is left to move the chat to another world from: start the story again in a new chat.");
    const marker = validMarkerBody({ kind: "migrate", to: index.head, merge: {} });
    if (marker === null) throw new WorldError("bad_request", "the world's head is no revision to attach");
    const input: ChangeInput = { lane: "engine", op: STORE_OPS.marker, value: marker as unknown as JsonValue, by: "player", source: "player", cite: { tap: crypto.randomUUID(), request: { kind: "attach", world, from: was, to: index.head } } };
    await this.deps.writes.run(() => {
      s.record(s.writeTarget({ chat }), [input]);
      if (gone !== null) s.forgetWorld(gone);
      s.playsWorld(chat, world);
    }, "attaching a world to a chat");
    this.told(chat);
    return { attached: true, revision: index.head, waiting };
  }
}
