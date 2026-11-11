// The harness turn as a tool reaches it (HARNESS-SLICE3: "One turn on the harness engine"). On the
// harness engine no code of the engine's runs a turn's steps: the author and the agents it starts
// call tools, and what a tool needs of the turn beyond the read view comes through `ToolEnv.turn`:
// whose mind the calling agent is, what the turn answers, the seeds its dice and its tick are drawn
// from, and where what an engine validator made of a call is staged. The bridge
// (`backend/harness/`) builds one for each call; the old engines give none, so a harness tool
// refuses there.
//
// Staging (`stage`): the events are the engine's own, made by the validator the step they stand in
// for uses (`mindData`, `memoryData`, `checkKnowledge`, `applyTimeAdvance`), on the state the call
// read. They land when the author commits, in staging order, each checked again by its reducer on
// the state as it stands then; in a job's run, after the reply, they are written at once through the
// ledger's path for writes outside a turn.

import type { RoleTier } from "../../../shared/agent-roles";
import type { EntityId, MessageId } from "../../../shared/ids";
import type { JsonObject } from "../../../shared/json";
import type { LedgerEvent } from "../../../shared/ledger";
import type { ChangeType, UserSettings } from "../../../shared/settings";
import type { WorldState } from "../../../engine/state";
import type { HostPort } from "../../host";
import type { OpRefusal } from "./writer";

/** One change a harness tool stages: the events an engine validator made of the call. */
export interface HarnessChange {
  /** The same change staged again is the one staged, and stages nothing more. */
  key: string;
  /**
   * Its change type, whose mode the user set (Settings → Changes from the reply): Never refuses it,
   * Confirm sends it to the review card. Null for what the engine records under no mode: a mind, a
   * memory, the turn's own time.
   */
  changeType: ChangeType | null;
  events: LedgerEvent[];
  /** The change in plain words, for the review card, the live view and `commit`'s answer. */
  lines: string[];
  /**
   * The change says how much time the turn takes, in minutes (0: none passes, and it has no
   * events). A turn that commits one adds no tick of its own.
   */
  time?: number;
  /** The proposal the change type's channel takes, for one the review card may have to apply (`learn`, `reveal`, `time_advance`). */
  proposal?: JsonObject;
}

/** What a commit made of everything staged, each change in plain words: landed, waiting on the review card, or refused with why. */
export interface HarnessCommit {
  landed: string[][];
  review: string[][];
  refused: { lines: string[]; reason: string }[];
}

export interface HarnessTurn {
  /** The calling agent is the run's main agent, the author: it alone commits, grants and says how much time the turn takes. False for every agent of a job's run. */
  main: boolean;
  /** The calling agent's writer tier now, the author's grants included: what a tool that writes outside the writer (the world's document) is gated by. Absent, it is read as the game master's for the author and none for anyone else. */
  tier?: RoleTier;
  /** The person the calling agent thinks for, once it has said so (`bind`); null until then. */
  character: EntityId | null;
  /** Makes the calling agent that person's mind for the rest of the run; false when it is someone else's already. */
  bind(entity: EntityId): boolean;
  /**
   * Raises the writer tier of an agent (by its id, a delegate's handle) or of every agent of a
   * definition (by its id) for the rest of the run. False when there is no such agent; a refusal,
   * with why, when a grant can't open that tier to it: above the granter's own, an agent started
   * by one that holds less, a person's own mind.
   */
  grant(to: string, tier: RoleTier): boolean | OpRefusal;
  /** Whether the chat tracks who knows what in this run (`knowledgeOn`). */
  knowing: boolean;
  /** The user's settings as the turn's frame froze them. */
  settings: UserSettings;
  /** The chat's messages and the World Info books: a mind's recall, the recent chat and pinned lore are read through them. */
  host: Pick<HostPort, "chats" | "books" | "log">;
  /** The seed this turn's dice are drawn from: the same turn rolls the same dice. */
  seed: string;
  /** The chat's run seed, which the world's own processes are seeded from whatever turn steps them, so time passed in pieces passes as it would whole. */
  runSeed: string;
  /** The state the turn started from, before anything of it landed. */
  start: Readonly<WorldState>;
  /** The events the turn has landed so far, in order: what the people present saw happen. */
  landed(): readonly LedgerEvent[];
  /**
   * The turn's landed state with what every agent has staged on top, in staging order: what a
   * limit that holds across the whole turn is counted on, where a tool's own view shows only what
   * landed and what its caller staged itself. Absent after the reply, where nothing is staged.
   */
  whole?(): Readonly<WorldState>;
  /**
   * The events staged in the turn and not yet landed, by any agent, in staging order. With
   * `landed()` they are everything the turn has recorded so far: what a count that must not start
   * again at each commit is taken on (an actor's rolls this turn). Absent after the reply, where a
   * change is written as it is made.
   */
  staged?(): readonly LedgerEvent[];
  /** What the turn answers: the player's message (its id null for a reply sent after a reply) and the reply before it. */
  said: { messageId: MessageId | null; user: string; before: string };
  /** The turn's own reply once it is written; null until then, so only a job's run has one. */
  reply: { messageId: MessageId; text: string } | null;
  /** Stages one change; answers its mode, or why it can't be staged. */
  stage(change: HarnessChange): Promise<{ mode: "auto" | "confirm" } | OpRefusal>;
  /** Makes everything staged so far definitive, with the author's note of why now (null: none); a refusal in a job's run, where nothing waits. */
  commit(note: string | null): Promise<HarnessCommit | OpRefusal>;
}
