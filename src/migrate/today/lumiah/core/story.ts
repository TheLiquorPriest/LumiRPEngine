// Carried unchanged from LumiAH (MIT; notice in THIRD-PARTY-NOTICES.md), src/core/story.ts at commit 6a38779a5e33fe563f0c8c617640343473617569.

// What counts as a chat's story (DESIGN §24.4): which of its messages the agents read as the story.
// The reply is not the source of truth, and neither is every message: the user says what the story
// is made of, and the agents read that and nothing else.
//
// Three choices, each the user's (in Settings, and for one chat), or the extension's that answers
// a chat where it says so:
// - `hidden`: a message the user hid from the prompt in Lumiverse is left out, or read like any other;
// - `from`: whose messages are the story: everyone's, or only the model's replies, the user's being
//   directions from outside the story (Lumiverse's Sovereign Hand). `lumiverse` follows Lumiverse's
//   own switch, where Lumiverse says how it stands;
// - `newest`: with only the replies, the user's newest message is given to the main agent as the
//   direction for the reply, or left out too (the preset carries it).
//
// Each member resolves on its own, strongest word first: the claiming extension's, the chat's own
// choice, the user's setting. A message left out is never listed, searched, matched, returned or
// embedded, and an answer says how many were and why; its number stays the chat's own, and a
// citation of it still checks, since citations hash against the whole chat.

import type { ChatRole } from "./ports";
import { isRecord } from "./ports";

/** What of a chat is the story the agents read. */
export interface StorySource {
  /** Messages the user hid from the prompt in Lumiverse: left out of what agents read, or read like any other. */
  hidden: "leave_out" | "include";
  /** Whose messages are story. "replies": only the model's; the user's messages are directions from outside the story. */
  from: "everyone" | "replies";
  /** With from "replies": the newest user message is given to the main agent as the direction for this reply, or left out as well (the preset carries it). */
  newest: "directive" | "leave_out";
}

/** As a user or an extension sets it: `from` may follow Lumiverse's own Sovereign Hand switch. */
export interface StorySetting {
  hidden: StorySource["hidden"];
  from: "lumiverse" | StorySource["from"];
  newest: StorySource["newest"];
}

/** What a user has before they choose: hidden messages left out, whose messages are the story as Lumiverse's Sovereign Hand says, and the newest direction given to the main agent. */
export const STORY_DEFAULTS: Readonly<StorySetting> = { hidden: "leave_out", from: "lumiverse", newest: "directive" };

/** The members of a setting, in the order the pages show them. */
export const STORY_MEMBERS: readonly (keyof StorySetting)[] = ["hidden", "from", "newest"];

/** Each member's values. Stored values (a user's setting, a chat's choice), so fixed. */
const VALUES: { readonly [K in keyof StorySetting]: readonly StorySetting[K][] } = {
  hidden: ["leave_out", "include"],
  from: ["lumiverse", "everyone", "replies"],
  newest: ["directive", "leave_out"],
};

/** Whether `value` is one of a member's values. */
export function storyValue<K extends keyof StorySetting>(member: K, value: unknown): value is StorySetting[K] {
  return (VALUES[member] as readonly unknown[]).includes(value);
}

/** A word on the story from outside the core (a claim, a chat's stored choice), read: each member that holds one of its values; anything else is left out. */
export function storyWordOf(raw: unknown): Partial<StorySetting> {
  if (!isRecord(raw)) return {};
  const out: Partial<StorySetting> = {};
  if (storyValue("hidden", raw.hidden)) out.hidden = raw.hidden;
  if (storyValue("from", raw.from)) out.from = raw.from;
  if (storyValue("newest", raw.newest)) out.newest = raw.newest;
  return out;
}

/** Whose word settled a member of what holds: the extension that answers the chat, the chat's own choice, or the user's setting. */
export type StoryWord = "claim" | "chat" | "user";

/**
 * What holds in a chat, member by member, and whose word settled each. `sovereignHand`: the word
 * that settled `from` follows Lumiverse's Sovereign Hand, and this is what Lumiverse said of it (on,
 * off, or null where it doesn't tell extensions); absent where that word named `from` outright.
 */
export interface StoryHolds {
  source: StorySource;
  by: Readonly<Record<keyof StorySource, StoryWord>>;
  sovereignHand?: boolean | null;
}

/**
 * What holds once the words are put over each other, member by member, strongest first: the
 * extension's that answers the chat, the chat's own, the user's. Following Lumiverse, only the
 * model's replies are the story while its Sovereign Hand is on; while it is off, and where Lumiverse
 * doesn't say, everyone's are, as they were before there was a choice. Nothing is guessed.
 */
export function storyHolds(words: { claim?: Partial<StorySetting> | null; chat?: Partial<StorySetting> | null; user: StorySetting; sovereignHand: boolean | null }): StoryHolds {
  const { claim, chat, user } = words;
  const settle = <K extends keyof StorySetting>(member: K): { value: StorySetting[K]; by: StoryWord } => {
    const claimed = claim?.[member];
    if (claimed !== undefined) return { value: claimed, by: "claim" };
    const chosen = chat?.[member];
    return chosen !== undefined ? { value: chosen, by: "chat" } : { value: user[member], by: "user" };
  };
  const hidden = settle("hidden");
  const from = settle("from");
  const newest = settle("newest");
  const follows = from.value === "lumiverse";
  const whose: StorySource["from"] = from.value === "lumiverse" ? (words.sovereignHand === true ? "replies" : "everyone") : from.value;
  return {
    source: { hidden: hidden.value, from: whose, newest: newest.value },
    by: { hidden: hidden.by, from: from.by, newest: newest.by },
    ...(follows ? { sovereignHand: words.sovereignHand } : {}),
  };
}

/** Why a message is left out of the story: the user hid it from the prompt, or it is the user's own, a direction from outside the story. */
export type LeftOutWhy = "hidden" | "direction";

/** Why the story leaves a message out; null for a message that is part of it. A hidden message of the user's is told as hidden: that is what the user did to it. */
export function leftOutWhy(message: { role: ChatRole; hidden?: boolean }, source: StorySource): LeftOutWhy | null {
  if (source.hidden === "leave_out" && message.hidden === true) return "hidden";
  if (source.from === "replies" && message.role === "user") return "direction";
  return null;
}
