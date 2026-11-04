// GM → Things (ITEMS-SPEC §10.2, §7.5, §6.2) beyond what Build's pages read (`shared/thing-view`):
// why someone has a thing, where it rests and what Put it away does, its history in this chat, the
// Tidy up findings each with the one GM edit that fixes it, and what this chat made in play that the
// GM may keep in the world. `engine/thing-gm.ts` and `engine/thing-tidy.ts` build them from the
// chat's head and the events on its path; the backend answers them to `lre.things` in GM scope,
// behind the GM gate as `lre.gm` is. A GM's view: every thing shows, a secret one marked.

import type { EntityId, PlaceId } from "./ids";
import type { EditOp } from "./protocol";
import type { WhereStep } from "./thing-view";
import type { Spot } from "./things";

// ---------------------------------------------------------------- a thing's page

/** Where a thing rests (ITEMS-SPEC §4.3), as the page says it: on its owner, a spot (its path), or nowhere; and what says so. */
export interface RestView {
  owner: boolean;
  where: WhereStep[];
  /** Its own `home`, where the world document puts it, or what play infers (everyday carry, what keeps its kind at its owner's home, a fixture, a purchase, where it was made). */
  from: "home" | "authored" | "carry" | "stored" | "fixture" | "bought" | "made";
}

/** Who changed a thing in one entry of its history: the turn before its reply (an action, the engine's processes), the reply's read (the story), the GM, a ✎ fix, or an agent. */
export type HistorySource = "turn" | "story" | "gm" | "fix" | "agent";

/** One entry of a thing's History strip: what changed about it, at which turn (the player's messages before it; 0 before the first), and by whom. */
export interface ThingHistoryEntry {
  turn: number;
  source: HistorySource;
  lines: string[];
}

/** A loan's end as Hand to… offers it: its words and the minute of the world's clock it ends at. */
export interface LoanChoice {
  label: string;
  until: number;
}

/** What GM → Things adds to a thing's page. */
export interface GmThingExtras {
  /** Where it rests, its own or inferred; null when nothing says. */
  rest: RestView | null;
  /** Where Put it away takes it (its rest; on its owner, into them); null when it is there already, or rests nowhere a move can reach. */
  putAway: Spot | null;
  /** Why the one who has it has it ("Holding it for Danny Okafor: to move the truck"); null when nobody has it. */
  why: string | null;
  /** Made in play: not in the world document. */
  made: boolean;
  /** Its latest changes in this chat, newest first. */
  history: ThingHistoryEntry[];
  /** Tidy up's findings on it. */
  findings: TidyFinding[];
  /** The loans Hand to… offers, ending a day, three days and a week from now. */
  loans: LoanChoice[];
  /** The player character, by id: Reveal to them. */
  pov: EntityId;
  /** A thing hidden until searched that the player character has found. */
  found: boolean;
}

/** What GM → Things' list adds to Build's: where the player character is (Here), and why each thing someone has is theirs to have. */
export interface GmThingsList {
  here: PlaceId | null;
  why: Record<EntityId, string>;
}

// ---------------------------------------------------------------- Tidy up

/** The kinds of finding Tidy up looks for (ITEMS-SPEC §7.5), in the order it lists them. */
export const TIDY_KINDS = ["too_big", "two_places", "worn_elsewhere", "handover_owner", "duplicate", "size_unknown", "final_dropped"] as const;
export type TidyKind = (typeof TIDY_KINDS)[number];

/** One way to fix a finding: its button's words, the GM edit's operations, and the sentence the edit's notice says. */
export interface TidyFix {
  label: string;
  ops: EditOp[];
  done: string;
}

/**
 * One finding: a key that stays the same while the finding does (what Leave it keeps), its kind, the
 * things it is about, a sentence saying it, the one-tap Fix (null when there is no one answer) and
 * the other fixes it offers (each size for a thing whose size nothing gives; keeping a thing in its
 * holder); `secret` when one of its things is hidden or secret.
 */
export interface TidyFinding {
  key: string;
  kind: TidyKind;
  things: EntityId[];
  text: string;
  fix: TidyFix | null;
  choices: TidyFix[];
  secret: boolean;
}

/**
 * A Tidy up run: the findings shown (at most `limit`, none left), how many there are in all, how
 * many are left, the cap (the user's setting), and the left ones (at most `limit`), which Show N
 * left lists, each to bring back.
 */
export interface TidyRun {
  findings: TidyFinding[];
  total: number;
  left: number;
  limit: number;
  leftOut: TidyFinding[];
}

// ---------------------------------------------------------------- Keep in the world

/** A thing made in play, as Keep in the world lists it: where it is, and whether the world's draft has it already. */
export interface MadeThingView {
  id: EntityId;
  name: string;
  where: WhereStep[];
  inDraft: boolean;
}

/** A place made in play (a room, a spot or a venue, ITEMS-SPEC §6.2), as Keep in the world lists it. */
export interface MadePlaceView {
  id: PlaceId;
  name: string;
  /** The places around it, outermost first. */
  path: WhereStep[];
  as: "room" | "spot" | "venue";
  inDraft: boolean;
}

/** What this chat made in play that the world doesn't have: its things and its places. */
export interface MadeInPlay {
  things: MadeThingView[];
  places: MadePlaceView[];
}

/** What Keep in the world copied into the world's draft, and what it couldn't, each with why; `notes` say what a kept thing lost on the way. */
export interface KeepResult {
  things: EntityId[];
  places: PlaceId[];
  skipped: { id: string; reason: string }[];
  notes: string[];
}
