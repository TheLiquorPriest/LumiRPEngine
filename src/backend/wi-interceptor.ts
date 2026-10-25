// The World Info interceptor (DESIGN §6.1). In a world chat's every prompt assembly, before the host
// activates World Info, an entry LRE keeps secret stays off until its gate holds, then comes on for
// the prompt; and an entry an engine section carried this turn (§6.11) goes off for the prompt, so the
// narrator doesn't read its text twice. An entry is as secret as its text is (`secrecyParts`): a
// secret's twin in any book, one the host builds from a character's card for the prompt included,
// stays off as the secret does. It touches no other entry, and nothing in a chat that plays no world.
// It fails closed: when anything can't be read, every secret stays off, and while some book of the
// user's was never read, every entry of the user's books does.

import type { ChatId, UserId } from "../shared/ids";
import type { JsonObject } from "../shared/json";
import { bookLoreFieldsOf, engineWroteEntry, loreIsSecret } from "../shared/lore";
import type { WorldDoc } from "../shared/world";
import type { Registry } from "../engine/registry-impl";
import type { WorldState } from "../engine/state";
import { loreGateReader } from "../engine/visibility";
import { bookSecrecy, secretCopyOf, secretTexts, type LoreIndex, type SecretTexts } from "./lore-secrets";
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
  /** What LRE knows of the secrets in the user's books, read now (`loreIndex`). */
  secrets(userId: UserId): Promise<LoreIndex>;
  /** The same as last read, for a failure that can't wait for a read (`lastLoreIndex`). */
  lastSecrets(userId: UserId): LoreIndex;
  log(message: string, userId: UserId): void;
}

const keyOf = (e: Pick<WorldInfoCandidate, "bookId" | "id">): string => `${e.bookId}/${e.id}`;

/** The entries of the user's books among a prompt's: the engine's own sections are no secret's. */
function usersOwn(entries: readonly WorldInfoCandidate[]): WorldInfoCandidate[] {
  return entries.filter((e) => !engineWroteEntry(e.extensions));
}

/** The entries `texts` hold secret, by id: off for the prompt whatever their gates, when the gates can't be read. */
function secretsOf(entries: readonly WorldInfoCandidate[], texts: SecretTexts): string[] {
  return entries.filter((e) => loreIsSecret(bookSecrecy(e, texts) ?? {})).map((e) => e.id);
}

/** Whether LRE switched an entry off for its secrecy: a secret of its own, or a copy that was on before it was kept secret. One a secret's text alone holds back was switched off by its author, and stays so. */
function switchedOffForSecrecy(e: WorldInfoCandidate): boolean {
  const copy = secretCopyOf(e.extensions);
  if (copy) return !copy.off;
  return loreIsSecret(bookLoreFieldsOf(e.extensions) ?? {});
}

/** The entries to switch off and on for a world chat's prompt (see the header); nothing for any other chat. */
export async function worldInfoVerdict(gate: WorldInfoGate, input: WorldInfoInput): Promise<WorldInfoVerdict> {
  try {
    return await verdict(gate, input);
  } catch (error) {
    gate.log(`World Info: its secret entries stay off for this prompt (${error instanceof Error ? error.message : String(error)})`, input.userId);
    // What is known without a read: the entries' own fields and the secrets as last read.
    const entries = usersOwn(input.entries);
    return { disabled: secretsOf(entries, secretTexts(gate.lastSecrets(input.userId), { entries })), enabled: [] };
  }
}

async function verdict(gate: WorldInfoGate, input: WorldInfoInput): Promise<WorldInfoVerdict> {
  if (!gate.playsWorld(input.chatMetadata)) return { disabled: [], enabled: [] };
  const carried = gate.carried(input.chatId);
  const disabled = input.entries.filter((e) => carried.has(keyOf(e))).map((e) => e.id);
  const rest = usersOwn(input.entries.filter((e) => !carried.has(keyOf(e))));
  // A state that can't be read leaves every secret off; the books' secrets are read all the same.
  const reading = gate.head(input.chatId, input.userId).catch((error: unknown) => {
    gate.log(`World Info: the chat's state wasn't read, so its secret entries stay off for this prompt (${error instanceof Error ? error.message : String(error)})`, input.userId);
    return null;
  });
  const [index, head] = await Promise.all([gate.secrets(input.userId), reading]);
  const texts = secretTexts(index, { world: head?.world ?? null, entries: rest });
  if (!head) return { disabled: [...disabled, ...secretsOf(rest, texts)], enabled: [] };
  const open = loreGateReader(gate.registry, head.world, head.state);
  const enabled: string[] = [];
  for (const e of rest) {
    const secrecy = bookSecrecy(e, texts);
    if (!secrecy || !loreIsSecret(secrecy)) continue;
    // Secret on any side is secret: it opens only once every secret side's gate holds (DESIGN §4.2).
    if (!open({ id: keyOf(e), title: "", content: "", keys: [], links: [], secret: true, gate: secrecy.gate ?? "" })) disabled.push(e.id);
    else if (e.disabled && switchedOffForSecrecy(e)) enabled.push(e.id);
  }
  return { disabled, enabled };
}
