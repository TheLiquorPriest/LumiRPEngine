// The World Info interceptor (DESIGN §6.1). In a world chat's every prompt assembly, before the host
// activates World Info, it reads the user's entries as the narrator's view of the chat has them
// (`narratorView`: the chat's own, else its world's, else the user's settings) and changes them for
// that one prompt. It writes nothing, in any book.
// - Secret marks in an entry's text (`shared/secret-marks.ts`): the host strips them from every
//   prompt by itself, so with no interceptor, or one that fails or runs out of the host's time, a mark
//   fails closed. Here each goes back in, worded as a secret and who holds it (`renderMark`,
//   `mutated.content`), unless the view leaves it out: a mark kept from the player character, while
//   the view is the player character's or leaves secrets out. A "kept from" name that names no one,
//   or more than one person, may be theirs: such a mark is kept from them too (fail closed), told so
//   or left out as the view says, unless it names them among its holders. A mark
//   the player character holds by now (`heldSecrets`: told, found out, revealed) is theirs: it goes in
//   with them among its holders, whatever it says. A whole-entry secret left out is switched off for
//   the prompt. What starts like a mark but can't be read stays out.
// - An entry whose whole text is a mark's text, a twin of it, reads as that mark.
// - An earlier build's secrecy fields on an entry with no marks are voted per prompt as before: off
//   until every gate holds, then on, if that build stored the entry off. So is an entry the chat's
//   world's secret entries were indexed from, and one whose text is the text of any of these.
// When the chat's state can't be read, or the interceptor throws, every secret stays out. It touches
// no other entry, nothing in a chat that plays no world, and none of the engine's own entries.

import type { ChatId, EntityId, UserId } from "../shared/ids";
import { hasOwn, type JsonObject } from "../shared/json";
import { engineWroteEntry, loreIsSecret } from "../shared/lore";
import { heldSecrets } from "../shared/minds";
import { hasSecretMarks, publicText, renderMark, renderSecretMarks, resolveMarkNames, unreadableMarks, wholeEntrySecret, type ResolvedMarkNames, type SecretMarkWording } from "../shared/secret-marks";
import type { UserSettings } from "../shared/settings";
import type { WorldDoc } from "../shared/world";
import type { Registry } from "../engine/registry-impl";
import type { WorldState } from "../engine/state";
import { loreGateReader } from "../engine/visibility";
import { bookLoreId, bookMarkLoreId } from "./book-lore";
import { chatKnowledgePrefsOf, narratorView } from "./chat-knowledge-prefs";
import { bookSecrecy, secretTexts, switchedOffForSecrecy, textOf, type MarkAt } from "./lore-secrets";
import type { WorldInfoCandidate, WorldInfoInput, WorldInfoVerdict } from "./host";

/** What the interceptor reads of the engine. */
export interface WorldInfoGate {
  registry: Registry;
  /** Whether the chat plays a world, by its metadata. */
  playsWorld(meta: JsonObject): boolean;
  /** The chat's world and state as the narrator sees them now (its turn's planned events included), or null when they can't be read. */
  head(chatId: ChatId, userId: UserId): Promise<{ world: WorldDoc; state: WorldState } | null>;
  /** The user's settings: the narrator's view. */
  settings(userId: UserId): Promise<UserSettings>;
  /** The wording of a secret's mark for this prompt (DESIGN §6.12): its turn's, as its sections and narrator rules have it, else the user's texts. */
  wording(chatId: ChatId, userId: UserId): Promise<SecretMarkWording>;
  log(message: string, userId: UserId): void;
}

/** The entries of the user's books among a prompt's: the engine's own sections are no secret's. */
function usersOwn(entries: readonly WorldInfoCandidate[]): WorldInfoCandidate[] {
  return entries.filter((e) => !engineWroteEntry(e.extensions));
}

/**
 * What is known without the chat's state (it can't be read, or the interceptor threw): every
 * earlier-build secret and whole-entry secret off, every other entry's marks out, read or not, and a
 * mark's twin off, for this prompt.
 */
function blind(entries: readonly WorldInfoCandidate[]): WorldInfoVerdict {
  const texts = secretTexts({ entries });
  const out: Required<WorldInfoVerdict> = { disabled: [], enabled: [], mutated: [] };
  for (const e of entries) {
    if (hasSecretMarks(e.content) || unreadableMarks(e.content).length > 0) {
      if (wholeEntrySecret(e.content)) out.disabled.push(e.id);
      else out.mutated.push({ id: e.id, content: publicText(e.content) });
    } else if (texts.marks.has(textOf(e.content)) || loreIsSecret(bookSecrecy(e, texts) ?? {})) out.disabled.push(e.id);
  }
  return out;
}

/** The entries to switch off, on and change for a world chat's prompt (see the header); nothing for any other chat. */
export async function worldInfoVerdict(gate: WorldInfoGate, input: WorldInfoInput): Promise<WorldInfoVerdict> {
  try {
    return await verdict(gate, input);
  } catch (error) {
    gate.log(`World Info: its secret entries stay out of this prompt (${error instanceof Error ? error.message : String(error)})`, input.userId);
    return blind(usersOwn(input.entries));
  }
}

async function verdict(gate: WorldInfoGate, input: WorldInfoInput): Promise<WorldInfoVerdict> {
  const out: Required<WorldInfoVerdict> = { disabled: [], enabled: [], mutated: [] };
  if (!gate.playsWorld(input.chatMetadata)) return out;
  const entries = usersOwn(input.entries);
  if (entries.length === 0) return out;
  const head = await gate.head(input.chatId, input.userId).catch((error: unknown) => {
    gate.log(`World Info: the chat's state wasn't read, so its secrets stay out of this prompt (${error instanceof Error ? error.message : String(error)})`, input.userId);
    return null;
  });
  if (!head) return blind(entries);
  const settings = await gate.settings(input.userId);
  const view = narratorView(chatKnowledgePrefsOf(input.chatMetadata), head.world, settings);
  const wording = await gate.wording(input.chatId, input.userId);
  const { world, state } = head;
  const texts = secretTexts({ world, entries });
  const open = loreGateReader(gate.registry, world, state);
  const nameOf = (id: EntityId): string => (hasOwn(state.entities, id) ? state.entities[id]?.name : undefined) ?? (hasOwn(world.entities, id) ? world.entities[id]?.name : undefined) ?? id;
  const leavesOut = view.knowledge === "pov" || view.secrets === "omit";
  // The secrets the player character holds by now, by their live lore ids (DESIGN §24.11).
  const povHolds = new Set(heldSecrets(state.packs.minds, world.pov).lore);
  // A mark as this prompt has it: marked, or "" when the view leaves out what may be kept from the player character.
  const shown = (at: MarkAt): string => {
    const { mark } = at;
    const resolved = resolveMarkNames(world, state, mark);
    if (povHolds.has(at.n === null ? bookLoreId(at.bookId, at.entryId) : bookMarkLoreId(at.bookId, at.entryId, at.n))) {
      const theirs: ResolvedMarkNames = { ...resolved, knownTo: resolved.knownTo.includes(world.pov) ? resolved.knownTo : [...resolved.knownTo, world.pov], keptFrom: resolved.keptFrom === "everyone" ? "everyone" : resolved.keptFrom.filter((id) => id !== world.pov) };
      return renderMark(mark, theirs, nameOf, "marked", wording);
    }
    // A "kept from" name that names no one, or more than one person, may be the player character's: kept from them too (fail closed), unless the mark names them among its holders.
    const unsure = !resolved.knownTo.includes(world.pov) && mark.keptFrom !== "everyone" && mark.keptFrom.some((name) => resolved.unresolved.includes(name));
    const told: ResolvedMarkNames = unsure && resolved.keptFrom !== "everyone" && !resolved.keptFrom.includes(world.pov) ? { ...resolved, keptFrom: [...resolved.keptFrom, world.pov] } : resolved;
    const keptFromPov = told.keptFrom === "everyone" ? !told.knownTo.includes(world.pov) : told.keptFrom.includes(world.pov);
    return keptFromPov && leavesOut ? "" : renderMark(mark, told, nameOf, "marked", wording);
  };
  // A whole entry that is one secret: in as the mark has it, or off for this prompt.
  const asMark = (e: WorldInfoCandidate, at: MarkAt): void => {
    const text = shown(at);
    if (text === "") out.disabled.push(e.id);
    else out.mutated.push({ id: e.id, content: text });
  };
  for (const e of entries) {
    const held = bookSecrecy(e, texts);
    // Secret on any side is secret: it opens only once every secret side's gate holds (DESIGN §4.2).
    const shut = held !== null && loreIsSecret(held) && !open({ id: `${e.bookId}/${e.id}`, title: "", content: "", keys: [], links: [], secret: true, gate: held.gate ?? "" });
    if (hasSecretMarks(e.content) || unreadableMarks(e.content).length > 0) {
      const whole = wholeEntrySecret(e.content);
      if (shut) out.disabled.push(e.id);
      else if (whole) asMark(e, { mark: whole, bookId: e.bookId, entryId: e.id, n: null });
      else out.mutated.push({ id: e.id, content: renderSecretMarks(e.content, (mark, n) => shown({ mark, bookId: e.bookId, entryId: e.id, n })) });
      continue;
    }
    const twin = texts.marks.get(textOf(e.content));
    if (twin) asMark(e, twin);
    else if (shut) out.disabled.push(e.id);
    else if (held !== null && loreIsSecret(held) && e.disabled && switchedOffForSecrecy(e)) out.enabled.push(e.id);
  }
  return out;
}
