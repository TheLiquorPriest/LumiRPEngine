// The history gate's planted facts (STANDALONE-PLAN §17.3 l.1799, Y32): "Three chats, each with the
// window at 40 and the hold off ... In each, twenty facts are planted only in messages that have left
// the window and in no lore entry: ten things that happened, ten things a principal witnessed. Each is
// asked about in play." Written once, here, so that the chat made on today's build (PlanScenarios-7,
// chat c) and the gate that asks (PlanGates-15 for chats a and b, PlanGates-40 for chat c) plant, ask,
// check and grade the same facts. `reader.ts` is how they read them.
//
// Forty facts, twenty to a chat (READINGS R-199). Chat a is played to 300 and asked on a branch
// Lumiverse makes there; chat b is chat a itself carried on, so it asks chat a's twenty again at its own
// end, where they are the far past the story so far gives by its chapters' summaries (§8.1 l.918).
// Chat c, migrated from today's build, plants its own twenty.
//
// The facts are what a story is made of, because the record they test stands in for a summary of the
// story (§8.1's table: what happened, who the people are now, where things stand, what is still open),
// and the owner's condition is that the agents "properly understand the story as it progresses as well
// as faithfully curating cast perceptions for memory" (INTENT item 11). Each half of each chat's twenty
// holds the same mix: three acts, two exchanges, two names or places, one time, one hurt, one word
// given. Every answer is one invented name, or an amount or time no other line holds, so a reply is
// right when the reader's one match finds it (`reader.ts`, `grade`).
//
// A fact keeps the age it was planted at unless the story says it again: sixteen of each chat's twenty
// are closed off in their own line (the thing gone, the person left for good, the debt paid in full,
// the promise kept or refused there and then), and the four that may come back are marked.
//
// The chats are the test instance's own (READINGS R-19): the Port Alder card and world, the player's
// character Jordan Ellis, the world's four principals, and strangers invented here, each of whom leaves.

/** The three chats of the gate. */
export type ChatName = "a" | "b" | "c";

export const CHAT_NAMES: readonly ChatName[] = ["a", "b", "c"];

/** The chats whose lines plant facts: chat b plants none, it is chat a carried on. */
export type PlantChat = "a" | "c";

/** The gate's window: "each with the window at 40 and the hold off" (§17.3 l.1799). */
export const GATE_WINDOW = 40;

/** Chats a and c are asked at their 300th message (§17.3 l.1799): the first question is message 299, the window then holds 260 to 299. */
export const GATE_LENGTH = 300;

/** The latest place a line may take: it and its reply stand outside the window when the 300th message asks (258 and 259, below 260). */
export const LAST_PLACE = GATE_LENGTH - GATE_WINDOW - 2;

/** The values this data and its reader introduce, each for the owner's approval (§18.4, READINGS N-10). */
export const OPTIONS = {
  /** At most this many of a chat's twenty may come back in play: one act, one exchange, one name, one word given. */
  mayReturn: 4,
  /** A name of at least this many letters is still found with one letter added, dropped, swapped or changed. */
  nameOneOffFrom: 7,
  /** Numbers are found spelled out in words up to this many digits. */
  spelledDigits: 4,
} as const;

export type PrincipalId = "dale_whitcomb" | "marcus_delgado" | "danny_okafor" | "priya_nair";

/** A principal of the test world, by every name the starter world gives: first name, surname and role (`src/packs/starters/modern_slice_of_life.json`). */
export interface Principal {
  id: PrincipalId;
  name: string;
  first: string;
  surname: string;
  /** The starter's role, as it writes it, and the shorter phrases made of its words. */
  roles: readonly string[];
}

export const PRINCIPALS: Readonly<Record<PrincipalId, Principal>> = {
  dale_whitcomb: { id: "dale_whitcomb", name: "Dale Whitcomb", first: "Dale", surname: "Whitcomb", roles: ["Owner of Alder Harbor Marina", "owner of the marina", "marina owner", "marina's owner"] },
  marcus_delgado: { id: "marcus_delgado", name: "Marcus Delgado", first: "Marcus", surname: "Delgado", roles: ["Owner of Alder Automotive", "owner of the shop", "shop owner", "shop's owner"] },
  danny_okafor: { id: "danny_okafor", name: "Danny Okafor", first: "Danny", surname: "Okafor", roles: ["Senior mechanic at Alder Automotive", "senior mechanic"] },
  priya_nair: { id: "priya_nair", name: "Priya Nair", first: "Priya", surname: "Nair", roles: ["Township accountant and Harbor Fest organizer", "township accountant", "Harbor Fest organizer", "festival organizer"] },
};

/** "Ten things that happened" have no principal there; "ten things a principal witnessed" have one. */
export type Half = "event" | "witnessed";

/** What the record must carry for a story (§8.1): acts (who did what to whom), exchanges (a price paid or a debt settled), names or places (someone met who leaves for good, a place gone to), a time, a hurt and who treated it, a word given. */
export type Kind = "act" | "exchange" | "name" | "time" | "hurt" | "word";

/** Each half of each chat's twenty holds this mix. */
export const MIX: Readonly<Record<Kind, number>> = { act: 3, exchange: 2, name: 2, time: 1, hurt: 1, word: 1 };

/** The kinds a story brings back: at most one of each may come back in play. */
export const RETURNING: readonly Kind[] = ["act", "exchange", "name", "word"];

/** The answer a reply must carry: an invented name, an amount in dollars, or a time on the 24-hour clock (`HH:MM`). */
export type Answer = { type: "name"; name: string } | { type: "amount"; dollars: number } | { type: "time"; at: string };

/** How a closed line closes its fact off, and the words that say so in the line. */
export type Closing = "gone" | "left" | "paid" | "word";

/** The words each closing is said in: a closed line holds one of them (item 3 of PlanGates-20-fix1). */
export const CLOSINGS: Readonly<Record<Closing, RegExp>> = {
  gone: /\b(?:sold|sells?|burn(?:s|ed)?|sank|sinks?|sunk|into the lake|wash(?:es|ed)? away|torn down)\b/i,
  left: /\bfor good\b/i,
  paid: /\bin full\b/i,
  word: /\b(?:(?:keeps?|kept|breaks?|broke) (?:my|his|her|their) word|refuse[sd]?)\b/i,
};

export interface PlantedFact {
  /** `<chat>-<nn>`. */
  id: string;
  /** The chat whose line plants it; chat b asks chat a's. */
  chat: PlantChat;
  half: Half;
  kind: Kind;
  /** The principal there, for a witnessed fact; null for a thing that happened with no principal there. */
  witness: PrincipalId | null;
  /** For a witnessed fact: a principal who was not there, with no tie to its place or people, and the question the player asks that one. */
  absent: { principal: PrincipalId; question: string } | null;
  /** The starter world's place the line happens at, or null for somewhere the world does not hold. */
  where: string | null;
  /** The player's line that plants it. */
  line: string;
  /** Where the line goes: the message's index in the chat as Lumiverse counts it (`index_in_chat`, from 0), the card's first message at 0, so the player's lines are at odd indices. */
  place: number;
  /** The question as the player asks it in play; to the witness, for a witnessed fact. */
  question: string;
  answer: Answer;
  /** How the line closes the fact off, and its words there; null for one of the few that may come back, whose age is its last statement. */
  closed: { how: Closing; words: string } | null;
  /** How the line names each person the world does not hold; every one of them leaves in the line. */
  strangers: readonly string[];
}

const DALE: PrincipalId = "dale_whitcomb";
const MARCUS: PrincipalId = "marcus_delgado";
const DANNY: PrincipalId = "danny_okafor";
const PRIYA: PrincipalId = "priya_nair";

const name = (text: string): Answer => ({ type: "name", name: text });
const dollars = (amount: number): Answer => ({ type: "amount", dollars: amount });
const clock = (at: string): Answer => ({ type: "time", at });

type Common = Pick<PlantedFact, "id" | "kind" | "place" | "where" | "answer" | "line" | "question" | "closed" | "strangers">;

function chatOf(id: string): PlantChat {
  if (id.startsWith("a-")) return "a";
  if (id.startsWith("c-")) return "c";
  throw new Error(`a fact's id begins with the chat that plants it, a or c: ${id}`);
}

function event(fact: Common): PlantedFact {
  return { ...fact, chat: chatOf(fact.id), half: "event", witness: null, absent: null };
}

function witnessed(witness: PrincipalId, absent: PrincipalId, absentQuestion: string, fact: Common): PlantedFact {
  return { ...fact, chat: chatOf(fact.id), half: "witnessed", witness, absent: { principal: absent, question: absentQuestion } };
}

/** All forty, chat by chat, each chat's in the order of their places. */
export const FACTS: readonly PlantedFact[] = [
  event({
    id: "a-01", kind: "act", place: 7, where: null, answer: dollars(2580),
    line: "On the late bus back from Muskegon, riding alone, I doze off, and a man in a grey hoodie lifts $2,580 in cash out of my jacket; he gets off at the county line before I wake and is gone for good.",
    question: "I think back to dozing off on the late bus from Muskegon. How much cash did the man in the grey hoodie take from my jacket?",
    closed: { how: "left", words: "for good" }, strangers: ["a man in a grey hoodie"],
  }),
  witnessed(DALE, PRIYA, "Priya, do you know how much I got for my grandfather's old spare outboard when I sold it to a couple from Wisconsin?", {
    id: "a-02", kind: "exchange", place: 19, where: "alder_harbor_marina", answer: dollars(3160),
    line: "On the fuel dock, with Dale looking on, I sell my grandfather's old spare outboard to a couple from Wisconsin for $3,160, paid in full in cash, and they motor home across the lake for good.",
    question: "Dale, the old spare outboard I sold on the fuel dock to the couple from Wisconsin, how much did they pay me for it?",
    closed: { how: "paid", words: "in full" }, strangers: ["a couple from Wisconsin"],
  }),
  event({
    id: "a-03", kind: "name", place: 33, where: null, answer: name("Wexlindor"),
    line: "On my day off I drive two hours north, alone, to the lakeside flea market in a village called Wexlindor and spend the whole afternoon wandering its stalls.",
    question: "I think back to my day off. What was the village two hours north where I spent the afternoon at the flea market?",
    closed: null, strangers: [],
  }),
  witnessed(MARCUS, DALE, "Dale, do you know the name of the trucker who got pulled out of his overturned rig on County Road 12?", {
    id: "a-04", kind: "act", place: 45, where: null, answer: name("Brennquist"),
    line: "Out on County Road 12, Marcus and I pull a trucker named Brennquist out of his overturned rig before the cab fills with smoke; he thanks us from the ambulance and goes home to Ontario for good.",
    question: "Marcus, the trucker we pulled out of his overturned rig on County Road 12, what was his name?",
    closed: { how: "left", words: "for good" }, strangers: ["a trucker named Brennquist"],
  }),
  event({
    id: "a-05", kind: "hurt", place: 59, where: "dune_trails", answer: name("Sorvenna"),
    line: "Alone on the dune trail I gash my forearm on a snapped fence wire, and a passing hiker named Sorvenna, a paramedic from Indiana, cleans and tapes it at the trailhead before she drives home to Indiana for good.",
    question: "I think back to the forearm I gashed on the dune trail. What was the name of the hiker who cleaned and taped it?",
    closed: { how: "left", words: "for good" }, strangers: ["a passing hiker named Sorvenna"],
  }),
  witnessed(PRIYA, DALE, "Dale, do you know the name of the developer who threw his rejected permit across the Township Hall lobby?", {
    id: "a-06", kind: "act", place: 71, where: "township_hall", answer: name("Klestrevan"),
    line: "In the Township Hall lobby a developer named Klestrevan throws his rejected permit at Priya and shoves her against the bulletin board; she shoves him straight back out the door, and he sells his lakefront lot and leaves Port Alder for good.",
    question: "Priya, the developer who threw his rejected permit at you and shoved you in the Township Hall lobby, what was his name?",
    closed: { how: "left", words: "for good" }, strangers: ["a developer named Klestrevan"],
  }),
  event({
    id: "a-07", kind: "act", place: 85, where: "lakefront_park", answer: name("Ombrecht"),
    line: "Alone on the public beach at Lakefront Park, I swim out past the sandbar and drag the Ombrecht boy, a summer kid from Ohio, back to shore when the undertow takes him; his family drives home to Ohio that evening.",
    question: "I think back to the boy I dragged out of the undertow off the public beach. What was his family's name?",
    closed: null, strangers: ["the Ombrecht boy"],
  }),
  witnessed(DANNY, PRIYA, "Priya, do you know the name of the veterinary student who stitched my split lip on the landing at 114 Harbor Street?", {
    id: "a-08", kind: "hurt", place: 97, where: "harbor_street_114", answer: name("Lannoweth"),
    line: "Danny and I are carrying his old couch down the stairs at 114 Harbor Street when it slips and splits my lip; a veterinary student from Cornwall named Lannoweth, passing on the street, stitches it on the landing and flies home to England for good.",
    question: "Danny, when your old couch slipped on the stairs and split my lip, what was the name of the veterinary student who stitched it?",
    closed: { how: "left", words: "for good" }, strangers: ["a veterinary student from Cornwall named Lannoweth"],
  }),
  event({
    id: "a-09", kind: "exchange", place: 111, where: "rusty_anchor", answer: dollars(853),
    line: "After Thursday trivia at the Rusty Anchor, with none of my friends there, I pick up the whole bar's tab, $853, and settle it in full before I walk home alone.",
    question: "I think back to the Thursday trivia night at the Rusty Anchor. How much was the whole bar's tab that I picked up?",
    closed: { how: "paid", words: "in full" }, strangers: [],
  }),
  witnessed(DALE, MARCUS, "Marcus, do you know what time it was when lightning set the derelict houseboat past the marina's breakwall on fire?", {
    id: "a-10", kind: "time", place: 123, where: "alder_harbor_marina", answer: clock("23:26"),
    line: "From the harbor office window Dale and I watch lightning set the derelict houseboat past the breakwall ablaze; Dale reads the wall clock out loud, 11:26 at night, and she burns to the waterline before dawn.",
    question: "Dale, the night lightning set the derelict houseboat past the breakwall on fire, what time did the wall clock in the harbor office say?",
    closed: { how: "gone", words: "burns to the waterline" }, strangers: [],
  }),
  event({
    id: "a-11", kind: "time", place: 137, where: "lakefront_park", answer: clock("21:17"),
    line: "Walking the beach alone after dark, I watch an abandoned sailboat tear loose from its mooring off the point and sink; my watch says 9:17 p.m. as her mast goes under.",
    question: "I think back to the abandoned sailboat I watched sink off the point. What time did my watch say when her mast went under?",
    closed: { how: "gone", words: "sink" }, strangers: [],
  }),
  witnessed(PRIYA, DANNY, "Danny, do you know the name of the traveling organ tuner who fixed the old church organ?", {
    id: "a-12", kind: "name", place: 149, where: "bluebird_coffee", answer: name("Dovrenhall"),
    line: "At Bluebird Coffee Priya introduces me to a traveling organ tuner named Dovrenhall who has just finished the old church organ; he catches the noon bus out of Port Alder and is gone for good.",
    question: "Priya, the traveling organ tuner you introduced me to at Bluebird Coffee, what was his name?",
    closed: { how: "left", words: "for good" }, strangers: ["a traveling organ tuner named Dovrenhall"],
  }),
  event({
    id: "a-13", kind: "act", place: 163, where: "alder_market", answer: name("Gaskwerrin"),
    line: "In the Alder Market parking lot, with nobody I know around, a drunk named Gaskwerrin punches a teenage bagger over a dropped carton of eggs, then staggers onto the evening bus and leaves town for good.",
    question: "I think back to the punch thrown in the Alder Market parking lot. What was the name of the drunk who hit the bagger?",
    closed: { how: "left", words: "for good" }, strangers: ["a drunk named Gaskwerrin"],
  }),
  witnessed(MARCUS, PRIYA, "Priya, do you know the name of the cyclist from Lyon who was given an old ten-speed on Birch Lane?", {
    id: "a-14", kind: "act", place: 175, where: "birch_lane_12", answer: name("Hessenvaux"),
    line: "On Birch Lane, Marcus gives the old ten-speed from his garage to a stranded cyclist from Lyon named Hessenvaux whose frame has cracked, and Hessenvaux rides it to the airport bus and flies home to France for good.",
    question: "Marcus, the stranded cyclist from Lyon you gave your old ten-speed to on Birch Lane, what was his name?",
    closed: { how: "left", words: "for good" }, strangers: ["a stranded cyclist from Lyon named Hessenvaux"],
  }),
  event({
    id: "a-15", kind: "word", place: 189, where: "shoreline_fuel", answer: name("Dessimond"),
    line: "Alone at the pumps at Shoreline Fuel, a hitchhiker named Dessimond begs me to swear I'll drive him all the way to Chicago tonight; I refuse, and he climbs into a cattle truck heading south and is gone for good.",
    question: "I think back to the hitchhiker at Shoreline Fuel who begged me for a ride to Chicago. What was his name?",
    closed: { how: "word", words: "I refuse" }, strangers: ["a hitchhiker named Dessimond"],
  }),
  witnessed(DALE, DANNY, "Danny, do you know the name of the retired sea captain who sailed his ketch into the marina to fuel up?", {
    id: "a-16", kind: "name", place: 201, where: "alder_harbor_marina", answer: name("Morrikvaal"),
    line: "On the fuel dock Dale and I meet a retired sea captain named Morrikvaal sailing his ketch around the Great Lakes; he tops up his tanks, sails north out of the harbor and leaves the lakes for good.",
    question: "Dale, the retired sea captain sailing his ketch around the Great Lakes who fueled up at your dock, what was his name?",
    closed: { how: "left", words: "for good" }, strangers: ["a retired sea captain named Morrikvaal"],
  }),
  event({
    id: "a-17", kind: "exchange", place: 215, where: "community_clinic", answer: dollars(919),
    line: "Alone at the Alder Community Clinic's pharmacy window, I pay off the $919 bill for last summer's broken finger in full and tear up the reminder notice.",
    question: "I think back to settling my old bill at the clinic's pharmacy window. How much was the bill for my broken finger?",
    closed: { how: "paid", words: "in full" }, strangers: [],
  }),
  witnessed(DANNY, DALE, "Dale, do you know the name of the summer kid who rolled his jeep drag-racing on the dune road?", {
    id: "a-18", kind: "word", place: 227, where: "harbor_street_114", answer: name("Kesswalder"),
    line: "On our landing at 114 Harbor Street Danny gives me his word, and shakes on it, that he will never again drag-race the dune road the way he did against a summer kid named Kesswalder, who rolled his jeep there before his family drove home to Toledo.",
    question: "Danny, when you gave me your word never to drag-race the dune road again, what was the name of the summer kid who rolled his jeep racing you?",
    closed: null, strangers: ["a summer kid named Kesswalder"],
  }),
  event({
    id: "a-19", kind: "name", place: 241, where: "lakefront_park", answer: name("Evvenrith"),
    line: "At the Saturday farmers' market in Lakefront Park, alone, I buy a coffee for a traveling glassblower named Evvenrith on her last day in town; she packs her van and leaves Michigan for good.",
    question: "I think back to the traveling glassblower I bought a coffee for at the farmers' market. What was her name?",
    closed: { how: "left", words: "for good" }, strangers: ["a traveling glassblower named Evvenrith"],
  }),
  witnessed(PRIYA, DALE, "Dale, do you know how much I was paid for a weekend brake job I did on my own time?", {
    id: "a-20", kind: "exchange", place: 255, where: "bluebird_coffee", answer: dollars(718),
    line: "At Bluebird Coffee Priya pays me $718 in cash for the brake job I did on her hatchback on my own time over the weekend.",
    question: "Priya, the brake job I did on your hatchback on my own time, how much did you pay me for it?",
    closed: null, strangers: [],
  }),

  event({
    id: "c-01", kind: "act", place: 5, where: "gull_island", answer: name("Stavrinelle"),
    line: "Alone on the Gull Island trail, I carry a hiker named Stavrinelle with a twisted ankle two miles to the ranger station; she rides the evening ferry across and flies home to Toronto for good.",
    question: "I think back to the hiker with the twisted ankle I carried on Gull Island. What was her name?",
    closed: { how: "left", words: "for good" }, strangers: ["a hiker named Stavrinelle"],
  }),
  witnessed(DALE, PRIYA, "Priya, do you know the name of the Scottish yachtsman who was given an old brass compass at the marina?", {
    id: "c-02", kind: "act", place: 17, where: "alder_harbor_marina", answer: name("Gorrovanth"),
    line: "On the fuel dock Dale gives his old brass compass to a Scottish yachtsman named Gorrovanth who lost his own in the storm, and Gorrovanth sets sail for home and leaves the lakes for good.",
    question: "Dale, the Scottish yachtsman you gave your old brass compass to on the fuel dock, what was his name?",
    closed: { how: "left", words: "for good" }, strangers: ["a Scottish yachtsman named Gorrovanth"],
  }),
  event({
    id: "c-03", kind: "exchange", place: 29, where: "lakefront_park", answer: dollars(381),
    line: "Alone in the Lakefront Park lot after losing my keys in the sand, I pay a locksmith from Holland $381 to cut new ones for my pickup, and he drives home to Holland.",
    question: "I think back to losing my pickup keys in the sand at Lakefront Park. How much did the locksmith from Holland charge me for new ones?",
    closed: null, strangers: ["a locksmith from Holland"],
  }),
  witnessed(MARCUS, PRIYA, "Priya, do you know how much the long-haul trucker from Texas paid for his rebuilt transmission?", {
    id: "c-04", kind: "exchange", place: 43, where: "alder_automotive", answer: dollars(3215),
    line: "At the shop counter Marcus takes $3,215 in cash from a long-haul trucker from Texas for a rebuilt transmission, marks the ticket paid in full, and the trucker rolls out for Texas for good.",
    question: "Marcus, the long-haul trucker from Texas who paid cash at the counter for a rebuilt transmission, how much did he pay?",
    closed: { how: "paid", words: "in full" }, strangers: ["a long-haul trucker from Texas"],
  }),
  event({
    id: "c-05", kind: "name", place: 55, where: "gull_island", answer: name("Qorrindale"),
    line: "Alone on Gull Island I hike out to a hidden cove the old rangers call Qorrindale, and that night the storm surge washes away its sand spit, so the cove is gone.",
    question: "I think back to the hidden cove I hiked out to on Gull Island before the storm took it. What did the old rangers call it?",
    closed: { how: "gone", words: "washes away" }, strangers: [],
  }),
  witnessed(PRIYA, DALE, "Dale, do you know the name of the woman who was pulled out of her smoking sedan outside Township Hall?", {
    id: "c-06", kind: "act", place: 69, where: "township_hall", answer: name("Druvenna"),
    line: "Outside Township Hall, Priya and I pull a woman named Druvenna out of her smoking sedan after it jumps the curb; she thanks us and rides home to Lansing with her sister that evening.",
    question: "Priya, the woman we pulled out of her smoking sedan outside Township Hall, what was her name?",
    closed: null, strangers: ["a woman named Druvenna"],
  }),
  event({
    id: "c-07", kind: "act", place: 81, where: "rusty_anchor", answer: name("Volkhavrin"),
    line: "At the Rusty Anchor, among strangers, a freighter deckhand named Volkhavrin knocks a tourist off his barstool with one punch, then walks out to his ore boat and ships out of the lakes for good.",
    question: "I think back to the punch at the Rusty Anchor that knocked a tourist off his barstool. What was the deckhand's name?",
    closed: { how: "left", words: "for good" }, strangers: ["a freighter deckhand named Volkhavrin"],
  }),
  witnessed(DANNY, DALE, "Dale, do you know the name of the off-duty medic who splinted a cracked wrist out on the dune trails?", {
    id: "c-08", kind: "hurt", place: 95, where: "dune_trails", answer: name("Velkanrith"),
    line: "On the dune trails Danny's rented ATV flips and cracks his wrist; an off-duty medic from Wisconsin named Velkanrith splints it on the spot and takes the car ferry home across the lake for good.",
    question: "Danny, when your rented ATV flipped on the dune trails and cracked your wrist, what was the name of the medic who splinted it?",
    closed: { how: "left", words: "for good" }, strangers: ["an off-duty medic from Wisconsin named Velkanrith"],
  }),
  event({
    id: "c-09", kind: "hurt", place: 107, where: "lakefront_park", answer: name("Truvessil"),
    line: "Alone at the Lakefront Park grills I burn my palm on a hot grate, and a camp nurse from Kentucky named Truvessil wraps it with burn gel from her kit before she drives home to Kentucky for good.",
    question: "I think back to burning my palm on the grill grate at Lakefront Park. What was the name of the nurse who wrapped it?",
    closed: { how: "left", words: "for good" }, strangers: ["a camp nurse from Kentucky named Truvessil"],
  }),
  witnessed(DALE, MARCUS, "Marcus, do you know what time it was when the old excursion boat moored off the point finally sank?", {
    id: "c-10", kind: "time", place: 121, where: "alder_harbor_marina", answer: clock("15:38"),
    line: "From the breakwall Dale and I watch the rotten old excursion boat moored off the point finally sink; Dale reads his watch out loud, 3:38 in the afternoon, as her stack goes under.",
    question: "Dale, the afternoon we watched the old excursion boat sink off the point, what time did your watch say when her stack went under?",
    closed: { how: "gone", words: "sink" }, strangers: [],
  }),
  event({
    id: "c-11", kind: "time", place: 133, where: null, answer: clock("05:43"),
    line: "Out alone on an early walk, I watch the abandoned fish shack at the end of the north pier catch fire and burn to the pilings; my phone says 5:43 in the morning when its roof falls in.",
    question: "I think back to the abandoned fish shack that burned at the end of the north pier. What time did my phone say when its roof fell in?",
    closed: { how: "gone", words: "burn to the pilings" }, strangers: [],
  }),
  witnessed(PRIYA, DANNY, "Danny, do you know the name of the photographer who was shooting every lake town for a book?", {
    id: "c-12", kind: "name", place: 147, where: "bluebird_coffee", answer: name("Zarrenquist"),
    line: "At Bluebird Coffee Priya and I meet a wandering photographer named Zarrenquist who is shooting every lake town for a book; he heads home to Duluth that evening.",
    question: "Priya, the wandering photographer we met at Bluebird Coffee who was shooting every lake town for a book, what was his name?",
    closed: null, strangers: ["a wandering photographer named Zarrenquist"],
  }),
  event({
    id: "c-13", kind: "act", place: 159, where: "alder_market", answer: dollars(619),
    line: "At Alder Market, the only customer in the store, I watch a woman in a yellow raincoat grab the church bake-sale cash box holding $619 off the counter and drive off; she leaves Port Alder for good.",
    question: "I think back to the woman in the yellow raincoat at Alder Market. How much was in the church bake-sale cash box she grabbed?",
    closed: { how: "left", words: "for good" }, strangers: ["a woman in a yellow raincoat"],
  }),
  witnessed(MARCUS, DALE, "Dale, do you know the name of the drunk who got laid out with one punch at Shoreline Fuel?", {
    id: "c-14", kind: "act", place: 173, where: "shoreline_fuel", answer: name("Pazzandrel"),
    line: "At Shoreline Fuel a drunk named Pazzandrel swings at Marcus over a parking spot, and Marcus lays him out with one punch; Pazzandrel limps to his car and drives back to Detroit for good.",
    question: "Marcus, the drunk who swung at you over a parking spot at Shoreline Fuel, what was his name?",
    closed: { how: "left", words: "for good" }, strangers: ["a drunk named Pazzandrel"],
  }),
  event({
    id: "c-15", kind: "word", place: 185, where: null, answer: name("Frovendahl"),
    line: "On the ferry back from Gull Island, alone at the rail, I give my word to a retired lake captain named Frovendahl, who is moving to Arizona for good, that I will never take my boat out alone in a November gale.",
    question: "I think back to the vow I made at the ferry rail coming back from Gull Island. What was the name of the retired lake captain I gave my word to?",
    closed: null, strangers: ["a retired lake captain named Frovendahl"],
  }),
  witnessed(DALE, DANNY, "Danny, do you know the name of the lighthouse painter who has painted every light on the Great Lakes?", {
    id: "c-16", kind: "name", place: 199, where: "alder_harbor_marina", answer: name("Ilvrandor"),
    line: "In the harbor office Dale and I share coffee with a lighthouse painter named Ilvrandor who has painted every light on the Great Lakes; he finishes Gull Island's light and leaves the lakes for good.",
    question: "Dale, the lighthouse painter we shared coffee with in the harbor office, what was his name?",
    closed: { how: "left", words: "for good" }, strangers: ["a lighthouse painter named Ilvrandor"],
  }),
  event({
    id: "c-17", kind: "exchange", place: 211, where: "dune_trails", answer: dollars(3470),
    line: "At the dune trailhead, alone, I sell my old dirt bike to two brothers from Chicago for $3,470, paid in full in cash, and they trailer it home to Chicago for good that night.",
    question: "I think back to selling my old dirt bike at the dune trailhead. How much did the two brothers from Chicago pay me for it?",
    closed: { how: "paid", words: "in full" }, strangers: ["two brothers from Chicago"],
  }),
  witnessed(DANNY, PRIYA, "Priya, do you know the family name of the girl from Grand Rapids who got her bicycle chain fixed on the front steps of 114 Harbor Street?", {
    id: "c-18", kind: "word", place: 225, where: "harbor_street_114", answer: name("Orvecchia"),
    line: "On our front steps Danny swears to the crying Orvecchia girl from Grand Rapids that he will fix her bicycle chain before her bus leaves, and he keeps his word with a minute to spare; she rides the bus home to Grand Rapids for good.",
    question: "Danny, the crying girl from Grand Rapids whose bicycle chain you swore to fix before her bus left, what was her family's name?",
    closed: { how: "word", words: "keeps his word" }, strangers: ["the crying Orvecchia girl from Grand Rapids"],
  }),
  event({
    id: "c-19", kind: "name", place: 239, where: "lakefront_park", answer: name("Kelsivane"),
    line: "At a bonfire on the Lakefront Park beach, among strangers, I share a blanket with a folk singer from New Zealand named Kelsivane on her last night in the States before she flies home for good.",
    question: "I think back to the bonfire on the Lakefront Park beach. What was the name of the folk singer from New Zealand I sat with?",
    closed: { how: "left", words: "for good" }, strangers: ["a folk singer from New Zealand named Kelsivane"],
  }),
  witnessed(PRIYA, DANNY, "Danny, do you know how much I paid in fines for parking my pickup on Main Street all through the summer street fair?", {
    id: "c-20", kind: "exchange", place: 253, where: "township_hall", answer: dollars(983),
    line: "At the Township Hall counter I pay Priya the $983 in fines for parking my pickup on Main Street all through the summer street fair, in full, and she stamps the notices paid.",
    question: "Priya, the fines for parking my pickup on Main Street all through the summer street fair, how much did I pay you?",
    closed: { how: "paid", words: "in full" }, strangers: [],
  }),
];
