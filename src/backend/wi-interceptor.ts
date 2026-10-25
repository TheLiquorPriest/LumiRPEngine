// The World Info interceptor (DESIGN §6.1). In a world chat's every prompt assembly, before the host
// activates World Info, an entry LRE keeps secret stays off until its gate holds, then comes on for
// the prompt; and an entry an engine section carried this turn (§6.11) goes off for the prompt, so the
// narrator doesn't read its text twice. A secret's twin LRE keeps as its copy is secret as its
// original is. It touches no other entry. It fails closed: when anything can't be read, every secret
// stays off.

import type { ChatId, UserId } from "../shared/ids";
import type { JsonObject } from "../shared/json";
import { bookLoreFieldsOf, loreIsSecret, loreSourceOf } from "../shared/lore";
import type { LoreEntryDef, WorldDoc } from "../shared/world";
import type { Registry } from "../engine/registry-impl";
import type { WorldState } from "../engine/state";
import { loreGateReader } from "../engine/visibility";
import { secretCopyOf } from "./book-lore";
import type { WorldInfoCandidate, WorldInfoInput, WorldInfoVerdict } from "./host";

/** What the interceptor reads of the engine. */
export interface WorldInfoGate {
  registry: Registry;
  /** Whether the chat plays a world, by its metadata. */
  playsWorld(meta: JsonObject): boolean;
  /** The chat's world and state as the narrator sees them now (its turn's planned events included), or null when they can't be read. */
  head(chatId: ChatId, userId: UserId): Promise<{ world: WorldDoc; state: WorldState } | null>;
  /** The World Info entries the sections the guard wrote for this prompt carried, as `bookId/entryId`. */
  carried(chatId: ChatId): ReadonlySet<string>;
  log(message: string, userId: UserId): void;
}

const keyOf = (e: Pick<WorldInfoCandidate, "bookId" | "id">): string => `${e.bookId}/${e.id}`;

/** The entries LRE's own fields keep secret, by id, with their gates: known without the world, so they stay off whatever fails. */
function ownSecrets(entries: readonly WorldInfoCandidate[]): Map<string, string | undefined> {
  const out = new Map<string, string | undefined>();
  for (const e of entries) {
    const fields = bookLoreFieldsOf(e.extensions);
    if (fields !== null && loreIsSecret(fields)) out.set(e.id, fields.gate);
  }
  return out;
}

/** The entries to switch off and on for a world chat's prompt (see the header); nothing for any other chat. */
export async function worldInfoVerdict(gate: WorldInfoGate, input: WorldInfoInput): Promise<WorldInfoVerdict> {
  try {
    return await verdict(gate, input);
  } catch (error) {
    gate.log(`World Info: its secret entries stay off for this prompt (${error instanceof Error ? error.message : String(error)})`, input.userId);
    return { disabled: [...ownSecrets(input.entries).keys()], enabled: [] };
  }
}

async function verdict(gate: WorldInfoGate, input: WorldInfoInput): Promise<WorldInfoVerdict> {
  if (!gate.playsWorld(input.chatMetadata)) return { disabled: [], enabled: [] };
  const carried = gate.carried(input.chatId);
  const disabled = input.entries.filter((e) => carried.has(keyOf(e))).map((e) => e.id);
  const rest = input.entries.filter((e) => !carried.has(keyOf(e)));
  const own = ownSecrets(rest);
  const head = await gate.head(input.chatId, input.userId);
  if (!head) return { disabled: [...disabled, ...own.keys()], enabled: [] };
  // A secret world entry indexed from a book keeps that book entry secret too, under its gate.
  const indexed = new Map<string, string | undefined>();
  for (const entry of Object.values(head.world.lore)) {
    const source = loreSourceOf(entry.source);
    if (source.kind === "book" && loreIsSecret(entry)) indexed.set(`${source.bookId}/${source.entryId}`, typeof entry.gate === "string" ? entry.gate : undefined);
  }
  const open = loreGateReader(gate.registry, head.world, head.state);
  const holds = (key: string, gateText: string | undefined): boolean => open({ id: key, title: "", content: "", keys: [], links: [], secret: true, ...(gateText !== undefined ? { gate: gateText } : {}) });
  const enabled: string[] = [];
  for (const e of rest) {
    const key = keyOf(e);
    // A copy carries its original's own fields; the world entry indexed from its original binds it too.
    const of = secretCopyOf(e.extensions)?.entry;
    const world = indexed.has(key) ? key : of !== undefined && indexed.has(of) ? of : null;
    if (!own.has(e.id) && world === null) continue;
    // Secret on either side is secret: it opens only once every secret side's gate holds (DESIGN §4.2).
    const gates = [...(own.has(e.id) ? [own.get(e.id)] : []), ...(world !== null ? [indexed.get(world)] : [])];
    if (!gates.every((g) => holds(key, g))) disabled.push(e.id);
    else if (e.disabled) enabled.push(e.id);
  }
  return { disabled, enabled };
}
