// The engine's side of the LumiRPEngine Studio bridge (DESIGN §15; docs/STUDIO.md "The Studio
// bridge"). A shared RPC read carries no request and no user, so each user gets endpoints of their
// own, which only the Studio may read: the world list, each world's head and revisions, and the
// world chats as their players see them. The other way, the engine reads the world the Studio
// offers; the dispatcher installs it only once the player confirms it in Build.
//
//   userStorage/studio/installed.json   the offers installed, so one offer is installed once

import { hashJson } from "../shared/hash";
import type { ChatId, RevisionId, UserId, WorldId } from "../shared/ids";
import { isRecord } from "../shared/json";
import type { StateView } from "../shared/state-view";
import type { StudioChats, StudioChatSummary, StudioOffer, StudioWorldList, StudioWorldRead } from "../shared/studio-bridge";
import { CHAT_SUMMARY_CAP, chatsChannel, chatSummary, offerEndpoint, readOffer, REVISIONS_LISTED, STUDIO_EXTENSION, worldChannel, worldsChannel } from "../shared/studio-bridge";
import type { WorldIndex } from "../shared/world";
import type { HostPort } from "./host";
import { readStoredJson } from "./stored-json";
import type { WorldStore } from "./worlds";

const INSTALLED_FILE = "studio/installed.json";
/** Installed offers remembered per user; an older one's id is long gone from the Studio. */
const INSTALLED_CAP = 32;
/** A revision id (`hashJson`): a channel segment as it is. */
const REVISION_ID = /^[0-9a-f]{32}$/;

interface InstalledOffer {
  offerId: string;
  worldId: WorldId;
  revision: RevisionId;
}

/** Every endpoint answers the Studio only; any other reader gets an error. */
function guard(requester: string): void {
  if (requester !== STUDIO_EXTENSION) throw new Error(`only ${STUDIO_EXTENSION} may read this endpoint`);
}

function isInstalled(v: unknown): v is InstalledOffer {
  return isRecord(v) && typeof v.offerId === "string" && typeof v.worldId === "string" && typeof v.revision === "string";
}

/** The offer waiting, with its `hashJson`, which an install names back; or why there is none. */
export type OfferRead = { offer: StudioOffer; hash: string } | { offer: null; reason: string };

export class StudioBridge {
  /** Users whose endpoints are published. */
  private readonly served = new Set<UserId>();
  /** The channels published for each `user \0 world`, so a deleted world's are withdrawn. */
  private readonly worldChannels = new Map<string, Set<string>>();
  /** World chat summaries per user, least recently pushed first. */
  private readonly chats = new Map<UserId, Map<ChatId, StudioChatSummary>>();

  constructor(
    private readonly host: HostPort,
    private readonly worlds: WorldStore,
  ) {}

  /** Publishes the user's endpoints the first time the backend serves them; later calls do nothing. Never throws, so no request fails on the bridge. */
  async serve(userId: UserId): Promise<void> {
    if (this.served.has(userId)) return;
    this.served.add(userId);
    try {
      this.host.rpc.handle(worldsChannel(userId), [], async (requester) => {
        guard(requester);
        return this.worldList(userId);
      });
      // The summaries come from chats, so the Studio must hold `chats` to read them.
      this.host.rpc.handle(chatsChannel(userId), ["chats"], async (requester) => {
        guard(requester);
        const list: StudioChats = { v: 1, chats: [...(this.chats.get(userId)?.values() ?? [])].reverse() };
        return list;
      });
      for (const index of await this.worlds.list(userId)) this.publishWorld(userId, index);
    } catch (error) {
      this.host.log("warn", `[LumiRPEngine] the Studio bridge couldn't publish your worlds: ${error instanceof Error ? error.message : String(error)}`, userId);
    }
  }

  /** A world's revisions changed (a commit, an import, a deletion): its endpoints follow. Never throws, so a commit never fails on the bridge. */
  async worldChanged(worldId: WorldId, userId: UserId): Promise<void> {
    try {
      // Serving lists every world, this one included.
      if (!this.served.has(userId)) return await this.serve(userId);
      const index = await this.worlds.index(worldId, userId);
      if (index) this.publishWorld(userId, index);
      else this.withdrawWorld(userId, worldId);
    } catch (error) {
      this.host.log("warn", `[LumiRPEngine] the Studio bridge couldn't publish world ${worldId}: ${error instanceof Error ? error.message : String(error)}`, userId);
    }
  }

  /** A chat's state as it was pushed to its view: a world chat's summary is kept, any other chat's dropped. */
  seen(userId: UserId, view: StateView): void {
    const summary = chatSummary(view, Date.now());
    let chats = this.chats.get(userId);
    if (!summary) {
      chats?.delete(view.chatId);
      return;
    }
    if (!chats) {
      chats = new Map();
      this.chats.set(userId, chats);
    }
    chats.delete(view.chatId);
    chats.set(view.chatId, summary);
    while (chats.size > CHAT_SUMMARY_CAP) {
      const oldest = chats.keys().next();
      if (oldest.done) break;
      chats.delete(oldest.value);
    }
  }

  /** The world the Studio offers the user, or why there is none. */
  async offer(userId: UserId): Promise<OfferRead> {
    let raw: unknown;
    try {
      raw = await this.host.rpc.read(offerEndpoint(userId));
    } catch {
      return { offer: null, reason: "LumiRPEngine Studio has no world waiting for you, or isn't running." };
    }
    if (raw === null || raw === undefined) return { offer: null, reason: "LumiRPEngine Studio has no world waiting for you." };
    const offer = readOffer(raw);
    return offer ? { offer, hash: hashJson(offer) } : { offer: null, reason: "LumiRPEngine Studio sent an offer this engine can't read." };
  }

  /** The world revision an offer became, if it was installed. */
  async installedAs(userId: UserId, offerId: string): Promise<InstalledOffer | null> {
    return (await this.installed(userId)).find((i) => i.offerId === offerId) ?? null;
  }

  async markInstalled(userId: UserId, entry: InstalledOffer): Promise<void> {
    const kept = [...(await this.installed(userId)).filter((i) => i.offerId !== entry.offerId), entry].slice(-INSTALLED_CAP);
    await this.host.storage.write(`${INSTALLED_FILE}.tmp`, JSON.stringify({ v: 1, offers: kept }), userId);
    await this.host.storage.move(`${INSTALLED_FILE}.tmp`, INSTALLED_FILE, userId);
  }

  /** Installs under way per user. */
  private readonly installs = new Map<UserId, Promise<void>>();

  /** Runs `work` once the user's earlier installs have settled, so one offer can't be installed twice at once. */
  async installing<T>(userId: UserId, work: () => Promise<T>): Promise<T> {
    const run = (this.installs.get(userId) ?? Promise.resolve()).then(work);
    const settled = run.then(
      () => undefined,
      () => undefined,
    );
    this.installs.set(userId, settled);
    try {
      return await run;
    } finally {
      if (this.installs.get(userId) === settled) this.installs.delete(userId);
    }
  }

  private async installed(userId: UserId): Promise<InstalledOffer[]> {
    const raw = await readStoredJson(this.host, INSTALLED_FILE, userId, "Studio installs", (v) => isRecord(v) && Array.isArray(v.offers));
    return isRecord(raw) && Array.isArray(raw.offers) ? raw.offers.filter(isInstalled) : [];
  }

  private async worldList(userId: UserId): Promise<StudioWorldList> {
    const worlds = (await this.worlds.list(userId)).map((index) => ({ id: index.id, name: index.name, head: index.head, revisions: index.revisions.slice(-REVISIONS_LISTED), revisionCount: index.revisions.length }));
    return { v: 1, worlds };
  }

  /** The world's head endpoint and one per revision; the head's reads whatever the head is when it's read. */
  private publishWorld(userId: UserId, index: WorldIndex): void {
    const key = `${userId}\u0000${index.id}`;
    let have = this.worldChannels.get(key);
    if (!have) {
      have = new Set();
      this.worldChannels.set(key, have);
    }
    for (const revision of [undefined, ...index.revisions]) {
      if (revision !== undefined && !REVISION_ID.test(revision)) continue;
      const channel = worldChannel(userId, index.id, revision);
      if (have.has(channel)) continue;
      have.add(channel);
      this.host.rpc.handle(channel, [], async (requester) => {
        guard(requester);
        return this.readWorld(userId, index.id, revision);
      });
    }
  }

  private withdrawWorld(userId: UserId, worldId: WorldId): void {
    const key = `${userId}\u0000${worldId}`;
    for (const channel of this.worldChannels.get(key) ?? []) this.host.rpc.unregister(channel);
    this.worldChannels.delete(key);
  }

  private async readWorld(userId: UserId, worldId: WorldId, revision: RevisionId | undefined): Promise<StudioWorldRead> {
    const index = await this.worlds.index(worldId, userId);
    if (!index) throw new Error(`world ${worldId} not found`);
    const read = await this.worlds.get(worldId, userId, revision);
    return { v: 1, worldId, name: index.name, head: index.head, revision: read.revision, world: read.world };
  }
}
