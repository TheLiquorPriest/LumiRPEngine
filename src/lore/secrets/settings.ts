// The three choices of today's build about secrets, as settings again at the levels he set them (plan §9.6, §15.2; R-189): what
// the narrator knows of them, whether a chat tracks who knows what, and how sure a holding must be to count. The narrator's
// view is read where it is asked: the chat's own, else its world's at that point of the path, else the global one, else the
// shipped default. The other two reach the chat's state as today's did (`knowledgeSwitch`): each new turn records the value in
// force at its start when it differs from what is recorded there, and every reader takes what is recorded at its own point of
// the path, so a swipe or a branch judges a secret by what held there.

import type { ConfigRead } from "../../app/config-read";
import type { WorldState } from "../../engine/state";
import { knowledgeSwitch } from "../../secrecy/knowledge-switch";
import { readSlice } from "../../packs/minds/core/state";
import type { JsonValue } from "../../shared/json";
import { knowledgeThreshold, knowledgeTracked } from "../../shared/minds";
import { type NarratorView, narratorViewOf } from "../../shared/settings";
import type { WorldDoc } from "../../shared/world";
import type { ChangeInput, Lane, Store } from "../../store";
import type { LoreScope } from "../chat-settings";
import { SECRETS_NARRATOR_KNOWLEDGE_DEF, SECRETS_NARRATOR_SECRETS_DEF, SECRETS_THRESHOLD_DEF, SECRETS_TRACKED_DEF } from "../settings";

/** What the settings set for a chat: the narrator's view, whether it tracks knowledge, and the threshold a holding must reach. */
export interface SecretSettings {
  narrator: NarratorView;
  tracked: boolean;
  threshold: number;
}

/** The levels a chat's settings are read from, and the world the chat plays on there (null for a chat with none). */
export interface SecretsFor extends LoreScope {
  world: Pick<WorldDoc, "narrator"> | null;
}

/** The secrets' settings for one chat, read when asked. */
export type SecretSettingsFor = (at: SecretsFor) => Promise<SecretSettings>;

/**
 * The narrator's view from the levels of one read: each part is the chat's own where the chat's file sets it, else the world's own
 * `narrator` where it names a whole view, else what the global level and the shipped default give.
 */
export function narratorOf(read: ConfigRead, world: Pick<WorldDoc, "narrator"> | null): NarratorView {
  const theirs = narratorViewOf(world?.narrator);
  const chats = (def: typeof SECRETS_NARRATOR_KNOWLEDGE_DEF | typeof SECRETS_NARRATOR_SECRETS_DEF): boolean => theirs === null || read.deciding(def)?.level === "chat";
  const view = {
    knowledge: chats(SECRETS_NARRATOR_KNOWLEDGE_DEF) ? read.value(SECRETS_NARRATOR_KNOWLEDGE_DEF) : theirs?.knowledge,
    secrets: chats(SECRETS_NARRATOR_SECRETS_DEF) ? read.value(SECRETS_NARRATOR_SECRETS_DEF) : theirs?.secrets,
  };
  return narratorViewOf(view) ?? { knowledge: SECRETS_NARRATOR_KNOWLEDGE_DEF.default, secrets: SECRETS_NARRATOR_SECRETS_DEF.default };
}

/** `SecretSettings` from the levels of one read, with the world the chat plays on. */
export function secretSettings(read: ConfigRead, world: Pick<WorldDoc, "narrator"> | null): SecretSettings {
  return { narrator: narratorOf(read, world), tracked: read.value(SECRETS_TRACKED_DEF) === true, threshold: read.numbers({ threshold: SECRETS_THRESHOLD_DEF }).threshold };
}

/** `SecretSettingsFor` over the host's reader of a chat's config levels. */
export function secretSettingsFor(config: (at: LoreScope) => Promise<ConfigRead>): SecretSettingsFor {
  return async (at) => secretSettings(await config(at), at.world);
}

/** The tracking switch and the threshold a state records: a chat that never recorded either tracks, at the default threshold (today's `knowledgeTracked`, `knowledgeThreshold`). */
export function knowledgeRecorded(state: Readonly<WorldState>): { tracked: boolean; threshold: number } {
  const slice = readSlice(state);
  return { tracked: knowledgeTracked(slice), threshold: knowledgeThreshold(slice) };
}

/** The lane the record is made in: what the story holds. */
export const KNOWLEDGE_LANE: Lane = "story";

/** Who the record is made by. */
export const KNOWLEDGE_BY = "rpe";

/**
 * The change that records the switch and the threshold in force at a turn's start, where they differ from what the state at that point
 * records (today's `knowledgeSwitch`, unchanged: only in a chat that holds knowledge); none where the state already says so.
 */
export function knowledgeChange(state: Readonly<WorldState>, set: Pick<SecretSettings, "tracked" | "threshold">): ChangeInput[] {
  const event = knowledgeSwitch(state, set.tracked, set.threshold);
  return event === null ? [] : [{ lane: KNOWLEDGE_LANE, op: event.type, value: { type: event.type, data: event.data }, by: KNOWLEDGE_BY }];
}

/**
 * What holds at a turn of the path: the narrator's view as it follows there (the world the chat plays at that point), and the tracking
 * switch and the threshold as recorded there (R-189), not as they are set now.
 */
export async function secretsHeld(store: Store, settingsFor: SecretSettingsFor, at: LoreScope & { turn: string }): Promise<SecretSettings> {
  const state = store.user(at.user).stateFor(at.turn, null).state.world;
  const set = await settingsFor({ user: at.user, chat: at.chat, world: store.env.worlds(state.revision) ?? null });
  return { narrator: set.narrator, ...knowledgeRecorded(state) };
}
