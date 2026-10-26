// What someone is doing, as words that follow "is" in a sentence the narrator or the player reads.
// An activity is free text: the engine's own kinds ("work", "sleep", "lunch"), a routine block's
// words ("getting ready for the bus", "village duty"), or an agenda's step. Each reads as a correct
// predicate ("at work", "asleep", "getting ready for the bus", "busy with village duty"), never
// "is work".

/** The engine's own activity kinds, as the predicate after "is"; `at` names where, when known. */
const KIND_PHRASE: Record<string, (at: string | null) => string> = {
  work: (at) => (at ? `working at ${at}` : "at work"),
  sleep: () => "asleep",
  breakfast: (at) => `having breakfast${at ? ` at ${at}` : ""}`,
  lunch: (at) => `having lunch${at ? ` at ${at}` : ""}`,
  dinner: (at) => `having dinner${at ? ` at ${at}` : ""}`,
  socialize: (at) => `spending time with people${at ? ` at ${at}` : ""}`,
  leisure: (at) => `taking some free time${at ? ` at ${at}` : ""}`,
  rest: () => "resting",
  waiting: () => "waiting",
  travel: () => "on the way somewhere",
  trip: () => "away on a trip",
  errand: () => "running an errand",
  chores: () => "doing chores",
  appointment: (at) => `at an appointment${at ? ` at ${at}` : ""}`,
  visiting: (at) => (at ? `visiting ${at}` : "visiting someone"),
  agenda: () => "about their own business",
  busy: () => "busy",
};

/** Words that already read after "is" ("among his collection", "out on the lake", "asleep"). */
const LEADS = new Set(["at", "in", "on", "out", "away", "among", "with", "off", "up", "down", "back", "home", "inside", "outside", "asleep", "awake", "busy", "about", "by", "near", "under", "over", "behind"]);

/** Words ending in "-ing" that are nouns, not what someone is doing ("evening walk", "wedding prep"). */
const NOT_GERUND = new Set(["morning", "evening", "wedding", "building", "spring", "king", "thing", "something", "nothing", "anything", "everything", "ring", "string", "wing", "clothing", "pudding", "ceiling", "sibling", "darling", "outing"]);

/**
 * The predicate for someone's activity, to follow "is": null for none ("idle" or empty), when the
 * line should say only where they are. `at`: the place's name, for the kinds that say it.
 */
export function activityPhrase(activity: string, at: string | null = null): string | null {
  const words = activity.replace(/_/g, " ").trim();
  if (words === "" || words === "idle") return null;
  const kind = KIND_PHRASE[words.toLowerCase()];
  if (kind) return kind(at);
  const first = words.split(/\s+/)[0]?.toLowerCase() ?? "";
  // A gerund ("selling herbs at her stall") or a phrase that already places them reads as it is.
  if ((/^[a-z]+ing$/.test(first) && !NOT_GERUND.has(first)) || LEADS.has(first)) return words;
  // A noun phrase ("village duty", "tea and legal gossip") is what they are busy with.
  return `busy with ${words}`;
}
