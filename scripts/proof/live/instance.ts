// Invented data only (PlanScenarios-3 item 5; READINGS R-19): the bed's host works only in the instance's own
// Lumiverse, as the instance's user (or, where a scenario says so, the second invented user), and acts only on
// chats the instance's scripts or the driver made. Before any step the host checks that the address is the
// instance's, that the user the session is signed in as is the one the step names, and that the chat is in the
// instance's record; any other step stops the run, naming what it was aimed at. Nothing here opens another Lumiverse.
//
// The instance's record of chats is what its scripts and this driver kept in the instance's folder
// (`LRE_INSTANCE_DIR`): `state.json` (the ids the instance's set-up and play made, whatever the key), the floor's
// fixture record (`floor-fixture.json`) and the driver's own list (`proof-chats.json`). A chat the driver makes,
// or a chat file it imports, is added to the driver's list before anything is done in it.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { isRecord } from "../../../src/shared/json";
import { Lumiverse } from "../../testbed/lib/lumiverse";
import type { Chat } from "../../testbed/lib/lumiverse";
import { RECORD_FILE } from "../../testbed/floor-fixture";

/** The driver's own list of the chats it made, in the instance's folder. */
export const CHATS_FILE = "proof-chats.json";

/** A step that was aimed outside the instance: the run stops, and says what it was aimed at. */
export class OutOfBounds extends Error {}

/** What a step is aimed at, as the host knows it before it acts. */
export interface Aim {
  /** The Lumiverse the step's page or request goes to. */
  address: string;
  /** The user the session is signed in as. */
  user: string;
  /** The user the step names: the instance's user, or the second invented user where a scenario says so. */
  named: string;
  /** The chat the step acts in or on, when it has one. */
  chat?: string | null;
}

const trimAddress = (address: string): string => address.replace(/\/+$/, "").toLowerCase();

/** Every string below a JSON value: the instance's record names a chat by its id, whatever key it is kept under. */
function strings(value: unknown, into: Set<string>): void {
  if (typeof value === "string") into.add(value);
  else if (Array.isArray(value)) for (const item of value) strings(item, into);
  else if (isRecord(value)) for (const item of Object.values(value)) strings(item, into);
}

function readJson(path: string): unknown {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
}

/** The instance: its Lumiverse's address, its users, and its record of chats. */
export class Instance {
  constructor(
    /** The instance's Lumiverse, as a browser opens it. */
    readonly address: string,
    /** The instance's user and, apart, the second invented user. */
    readonly owner: string,
    /** The instance's folder: its record is kept there. */
    readonly dir: string,
    /** Whether a scenario has said it plays as the second invented user. */
    private readonly second: string | null = null,
  ) {}

  /** The ids the instance's record holds: the instance's own state, the floor's fixture and the driver's list. */
  chats(): ReadonlySet<string> {
    const held = new Set<string>();
    strings(readJson(join(this.dir, "state.json")), held);
    const fixture = readJson(join(this.dir, RECORD_FILE));
    if (isRecord(fixture)) strings(fixture.chats, held);
    strings(readJson(join(this.dir, CHATS_FILE)), held);
    return held;
  }

  /** Adds a chat the driver made, or imported, to the driver's list, before anything is done in it. */
  recordChat(id: string): void {
    const path = join(this.dir, CHATS_FILE);
    const held = readJson(path);
    const list = Array.isArray(held) ? held.filter((item): item is string => typeof item === "string") : [];
    if (list.includes(id)) return;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify([...list, id], null, 2)}\n`);
  }

  /** Refuses a step aimed outside the instance, naming what it was aimed at. */
  check(aim: Aim): void {
    if (trimAddress(aim.address) !== trimAddress(this.address)) throw new OutOfBounds(`the step is aimed at ${aim.address}, which is not the instance's Lumiverse; the run stops`);
    const allowed = this.second === null ? [this.owner] : [this.owner, this.second];
    if (!allowed.includes(aim.named)) throw new OutOfBounds(`the step names the user ${aim.named}, who is not the instance's user${this.second === null ? "" : " nor the second invented user"}; the run stops`);
    if (aim.user !== aim.named) throw new OutOfBounds(`the session is signed in as ${aim.user}, and the step names ${aim.named}; the run stops`);
    if (aim.chat !== undefined && aim.chat !== null && !this.chats().has(aim.chat)) throw new OutOfBounds(`the step is aimed at the chat ${aim.chat}, which the instance's record does not hold; the run stops`);
  }
}

/** The chat a request is for: the one its path names, or its body. */
export function chatOf(path: string, body?: unknown): string | null {
  const named = /^\/api\/v1\/(?:chats|generate\/status)\/([^/?#]+)/.exec(path)?.[1];
  if (named !== undefined) return decodeURIComponent(named);
  if (isRecord(body)) {
    const id = body.chat_id ?? body.chatId;
    if (typeof id === "string") return id;
  }
  return null;
}

/**
 * Lumiverse's REST, as the instance's user, with every call checked against the instance first. A chat it makes
 * is recorded as the instance's before the call returns.
 */
export class InstanceLumiverse extends Lumiverse {
  constructor(
    base: string,
    token: string,
    private readonly instance: Instance,
    /** The user the session is signed in as, from Lumiverse's own account of it. */
    private readonly signedInAs: string,
    /** The user the host plays as now. */
    private readonly named: string,
  ) {
    super(base, token);
  }

  override call<T>(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<T> {
    try {
      this.instance.check({ address: this.base, user: this.signedInAs, named: this.named, chat: chatOf(path, body) });
    } catch (error) {
      return Promise.reject(error);
    }
    return super.call<T>(method, path, body);
  }

  override async createChat(characterId: string, name: string): Promise<Chat> {
    const chat = await super.createChat(characterId, name);
    this.instance.recordChat(chat.id);
    return chat;
  }
}
