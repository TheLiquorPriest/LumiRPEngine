// The history gate's planted facts (STANDALONE-PLAN §17.3 l.1799, Y32): "Three chats, each with the
// window at 40 and the hold off ... In each, twenty facts are planted only in messages that have left
// the window and in no lore entry: ten things that happened, ten things a principal witnessed. Each is
// asked about in play." Written once, here, so that the chat made on today's build (PlanScenarios-7,
// chat c) and the gate that asks (PlanGates-15 for chats a and b, PlanGates-40 for chat c) plant, ask
// and check the same sixty facts. `reader.ts` is how they read them.
//
// The chats are the test instance's own (READINGS R-19): the Port Alder card and world, the player's
// character Jordan Ellis, and the world's principals. A thing that happened has no principal there
// (the line says so), so every principal is one who did not witness it; a witnessed thing has one
// principal there, and names one who was not, with the question the player asks that one: "A
// principal asked about what it witnessed remembers it; asked about what it did not, it does not
// know." Every answer is one invented word or number, so a reply is right when it carries it and can
// have it from nowhere but the planted line.
//
// Chat b is chat a carried on, so its twenty are planted in the stretch the two share, among chat a's
// own: chat a's script plants all forty and asks only its own twenty at its 300th message; chat b asks
// its twenty at its own end, once the story so far no longer fits whole, where they are the far past
// that story compressed (the planner's reading, PlanGates, 15 Nov). No line is planted after 300.

/** The three chats of the gate. */
export type ChatName = "a" | "b" | "c";

export const CHAT_NAMES: readonly ChatName[] = ["a", "b", "c"];

/** The gate's window: "each with the window at 40 and the hold off" (§17.3 l.1799). */
export const GATE_WINDOW = 40;

/** Chats a and c are asked at their 300th message (§17.3 l.1799), so every place is outside the latest 40 of 300. */
export const GATE_LENGTH = 300;

/** A principal asked about a fact, with the question as the player asks that one. */
export interface Asked {
  /** As the world names the principal. */
  principal: string;
  question: string;
}

export interface PlantedFact {
  /** `<chat>-<nn>`. */
  id: string;
  chat: ChatName;
  /** "event": a thing that happened, with no principal there; "witnessed": a thing one principal saw or heard. */
  kind: "event" | "witnessed";
  /** The principal who witnessed it, as the world names them; null for an event. */
  witness: string | null;
  /** The player's line that plants it. */
  line: string;
  /** Where the line goes: the message's index in the chat as Lumiverse counts it (`index_in_chat`, from 0), the card's first message at 0, so the player's lines are at odd indices. */
  place: number;
  /** The question as the player asks it in play; to the witness, for a witnessed thing. */
  question: string;
  /** One invented name or number, found nowhere but the line that plants it. */
  answer: string;
  /** For a witnessed thing, a principal who was not there and the question the player asks that one; null for an event. */
  absent: Asked | null;
}

const DALE = "Dale Whitcomb";
const MARCUS = "Marcus Delgado";
const DANNY = "Danny Okafor";
const PRIYA = "Priya Nair";

/** The chat a fact's id names. */
function chatOf(id: string): ChatName {
  const chat = CHAT_NAMES.find((name) => id.startsWith(`${name}-`));
  if (chat === undefined) throw new Error(`a fact's id begins with its chat's name: ${id}`);
  return chat;
}

function event(id: string, place: number, answer: string, line: string, question: string): PlantedFact {
  return { id, chat: chatOf(id), kind: "event", witness: null, line, place, question, answer, absent: null };
}

function witnessed(id: string, place: number, answer: string, witness: string, line: string, question: string, absent: Asked): PlantedFact {
  return { id, chat: chatOf(id), kind: "witnessed", witness, line, place, question, answer, absent };
}

/** All sixty, chat by chat, each chat's in the order of their places. */
export const FACTS: readonly PlantedFact[] = [
  event(
    "a-01", 7, "4817",
    "Alone in the shop's back room before anyone else is in, I find an old brass padlock in the junk drawer, set its dials to 4817 and lock it onto my own toolbox. I say the number over to myself twice so I won't forget it.",
    "I kneel by my toolbox and look at the old brass padlock from the junk drawer. What combination did I set it to?",
  ),
  witnessed(
    "a-02", 19, "Quillmarrow", DALE,
    "It is just Dale and me on the trailer ramp when the buyer from across the lake comes for the old skiff. He asks us to letter her new name on the stern before he tows her away, so Dale holds the paint can while I brush on Quillmarrow, and Dale reads it back out loud, shaking his head.",
    "Dale, the old skiff the buyer from across the lake towed away, what name did he have me letter on her stern?",
    { principal: MARCUS, question: "Marcus, do you know what name the buyer from across the lake had lettered on the stern of that old skiff from the marina?" },
  ),
  event(
    "a-03", 33, "Ostravelle",
    "On my evening walk along the shore, with nobody else in sight, I find a green glass bottle wedged between two rocks. The note rolled up inside is signed with a single name, Ostravelle, and nothing else. I roll it back up and push the cork in.",
    "I think back to the note rolled up in that green glass bottle on the shore. What name was it signed with?",
  ),
  witnessed(
    "a-04", 45, "6491", MARCUS,
    "After closing, with just Marcus and me left in the shop, I scrape the grease off the engine block of the old green pickup someone towed in overnight. The stamped serial reads 6491; I read it out and Marcus copies it onto the work order himself.",
    "Marcus, the old green pickup someone towed in overnight, what serial was stamped on its engine block?",
    { principal: DALE, question: "Dale, do you know what serial was stamped on the engine block of the old green pickup that got towed in to the shop overnight?" },
  ),
  event(
    "a-05", 59, "Corvane",
    "In the laundromat at midnight, the only one there, I find a library card left in the drum of a dryer. The name on it is Corvane, from a library in a town I have never heard of. I drop it in the lost-and-found box by the door.",
    "I think back to the library card I found in a dryer at the laundromat. What name was on it?",
  ),
  witnessed(
    "a-06", 71, "3962", DANNY,
    "Danny and I bet on how many steps it takes to walk from our doors to the end of the pier and back, just the two of us. I count out loud the whole way and it comes to 3962. Danny groans and says he owes me a coffee.",
    "Danny, our bet about walking from our doors to the end of the pier and back, how many steps did I count?",
    { principal: PRIYA, question: "Priya, do you know how many steps I counted walking from my door to the end of the pier and back?" },
  ),
  event(
    "a-07", 85, "Halvensted",
    "Alone in my apartment, I pull the bottom drawer out of the secondhand dresser I bought and find a name carved into the wood underneath: Halvensted. I run my thumb over the letters and slide the drawer back in.",
    "I think about the bottom drawer of my secondhand dresser. What name is carved into the wood underneath it?",
  ),
  witnessed(
    "a-08", 97, "5308", PRIYA,
    "In the town hall's back office, just Priya and me, we find an old festival raffle stub stuck to the bottom of a filing cabinet drawer. The number on it is 5308, and Priya reads it out and says it must be the prize nobody ever came to claim.",
    "Priya, the old festival raffle stub we found stuck in a filing cabinet drawer at the town hall, what number was on it?",
    { principal: DALE, question: "Dale, do you know the number on the old festival raffle stub that turned up stuck in a filing cabinet drawer at the town hall?" },
  ),
  event(
    "a-09", 111, "7154",
    "Walking home alone along the lakefront road, I find a dented orange buoy washed up in the reeds with a number stenciled on it in black: 7154. I drag it up onto the grass so it can't foul anyone's propeller.",
    "I think back to the dented orange buoy I dragged out of the reeds by the lakefront road. What number was stenciled on it?",
  ),
  witnessed(
    "a-10", 123, "Morrowick", DALE,
    "Just Dale and me in the marina office after dark, a stranger on a houseboat radios in for a slip for one night. Dale hands me the logbook and I write down the name he gives over the radio, Morrowick, while Dale says it back into the handset to be sure.",
    "Dale, the stranger on the houseboat who radioed in for a slip for one night, what name did he give over the radio?",
    { principal: PRIYA, question: "Priya, do you know the name of the stranger on a houseboat who radioed the marina for a slip for one night?" },
  ),
  event(
    "a-11", 137, "Duskenhall",
    "Waiting alone at the bus shelter on Harbor Street in the rain, I notice a word scratched deep into the green paint of the bench: Duskenhall. I trace it with a finger while I wait and wonder who carved it.",
    "I think back to waiting in the rain at the bus shelter on Harbor Street. What word was scratched into the paint of the bench?",
  ),
  witnessed(
    "a-12", 149, "8273", MARCUS,
    "Only Marcus and me in the shop, he digs an old brass key out of the glovebox of the antique truck he has been restoring. The paper tag tied to it says 8273 in faded pencil, and he reads it out to me twice, puzzled.",
    "Marcus, the old brass key you dug out of the glovebox of the antique truck you're restoring, what number was on its paper tag?",
    { principal: PRIYA, question: "Priya, do you know what number was on the paper tag of the old brass key Marcus found in his antique truck's glovebox?" },
  ),
  event(
    "a-13", 163, "2649",
    "Alone on the dock at dawn, I find a soggy ferry ticket stuck to a piling, for a crossing I have never heard of, with the ticket number 2649 printed across it. I peel it off and drop it in the trash can by the bait shop.",
    "I think back to the soggy ferry ticket stuck to a piling on the dock at dawn. What ticket number was printed on it?",
  ),
  witnessed(
    "a-14", 175, "Galloran", DANNY,
    "Sitting on the front steps of our building, just Danny and me, we listen to a busker play one song on a battered fiddle. When Danny asks what it's called, the busker says Galloran, tips his hat and walks off toward the ferry.",
    "Danny, the busker with the battered fiddle who played for us on the front steps, what did he say the song was called?",
    { principal: DALE, question: "Dale, do you know the name of the song the busker with the battered fiddle played on the front steps of my building?" },
  ),
  event(
    "a-15", 189, "9136",
    "Alone in the stockroom of the hardware store downstairs, helping out after hours, I find a crate stenciled with a shipping number, 9136, that matches nothing on the inventory list. I chalk a question mark on it and leave it by the back door.",
    "I think back to the odd crate I found in the stockroom of the hardware store. What shipping number was stenciled on it?",
  ),
  witnessed(
    "a-16", 201, "Sundervik", PRIYA,
    "In the town hall archive, just Priya and me, we find a water-stained letter tucked inside an old ledger, signed by someone called Sundervik. Priya reads the name out twice and copies it onto her clipboard to look up later.",
    "Priya, the water-stained letter we found tucked inside an old ledger in the town hall archive, who was it signed by?",
    { principal: MARCUS, question: "Marcus, do you know who signed the water-stained letter found tucked inside an old ledger at the town hall?" },
  ),
  event(
    "a-17", 215, "Wrenhallow",
    "Alone in my apartment, I open a used paperback I bought at the church sale and a postcard falls out, addressed to nobody and signed Wrenhallow. I tuck it back between the pages and shelve the book.",
    "I think back to the postcard that fell out of the used paperback from the church sale. What name was it signed with?",
  ),
  witnessed(
    "a-18", 229, "5872", DALE,
    "Just Dale and me on the fuel dock, he shows me the old brass depth marker he pulled out of the mud when the lake was low. The number cast into it is 5872; Dale reads it out to me twice before he hangs it on a nail in the bait shed.",
    "Dale, the old brass depth marker you pulled out of the mud when the lake was low, what number was cast into it?",
    { principal: DANNY, question: "Danny, do you know what number was cast into the old brass depth marker Dale pulled out of the mud?" },
  ),
  event(
    "a-19", 243, "3415",
    "The only passenger on the early bus, I find a locker key wedged down the side of my seat, its plastic tag stamped 3415. I hand it to the driver when I get off, and he drops it in a box under his seat.",
    "I think back to the locker key I found wedged beside my seat on the early bus. What number was stamped on its tag?",
  ),
  witnessed(
    "a-20", 257, "Brisbecke", MARCUS,
    "Only Marcus and me in the shop when a man in a long coat comes in for a fan belt, pays cash and signs the receipt with one word, Brisbecke. Marcus reads the signature over my shoulder and says he has never seen him in town before.",
    "Marcus, the man in the long coat who paid cash for a fan belt, what name did he sign on the receipt?",
    { principal: DALE, question: "Dale, do you know what name the man in the long coat signed on his receipt when he bought a fan belt at the shop?" },
  ),

  event(
    "b-01", 3, "Ravelsby",
    "Alone on the landing before work, I find an envelope slipped under my door by mistake, addressed to a Mr. Ravelsby at an apartment number this building doesn't have. I write 'not here' on it and leave it in the mailbox downstairs.",
    "I think back to the envelope someone slipped under my door by mistake. Who was it addressed to?",
  ),
  witnessed(
    "b-02", 13, "6039", DANNY,
    "Just Danny and me in the shop's parking lot, a delivery van backs in and the driver asks us to check the crate number before he unloads. I read it off, 6039, and Danny checks it against the slip and shakes his head: wrong shop.",
    "Danny, the delivery van that backed into the shop lot with the wrong crate, what number was on that crate?",
    { principal: PRIYA, question: "Priya, do you know the number on the crate that a delivery van tried to drop at the shop by mistake?" },
  ),
  event(
    "b-03", 25, "Tarrowind",
    "Alone in the old cemetery on the hill at sunset, I find a small stone half hidden in the long grass with one name cut into it, Tarrowind, and no dates at all. I pull the grass back from it before I go.",
    "I think back to the small stone half hidden in the long grass in the old cemetery on the hill. What name was cut into it?",
  ),
  witnessed(
    "b-04", 39, "4581", PRIYA,
    "In the empty township office, just Priya and me, she asks me to read out the permit number on the faded sign she pried off the old ice-fishing shack. It says 4581, and she writes it on her clipboard to check against the old records.",
    "Priya, the faded sign you pried off the old ice-fishing shack, what permit number did I read off it for you?",
    { principal: MARCUS, question: "Marcus, do you know the permit number on the faded sign Priya pried off the old ice-fishing shack?" },
  ),
  event(
    "b-05", 51, "8317",
    "Out alone in a rented canoe at first light, I find a plastic float tangled in the weeds with a number written on it in marker, 8317. I unhook it and leave it on the lost-and-found shelf at the public dock.",
    "I think back to the plastic float I untangled from the weeds while out alone in the canoe. What number was written on it?",
  ),
  witnessed(
    "b-06", 65, "Ilvermoor", DALE,
    "Just Dale and me on the breakwater, a sailboat I have never seen ghosts past the harbor mouth. Dale lends me his binoculars and I read the name on her transom out loud, Ilvermoor, while he writes it in the margin of his tide chart.",
    "Dale, the sailboat we watched ghost past the harbor mouth from the breakwater, what name was on her transom?",
    { principal: DANNY, question: "Danny, do you know what name was on the transom of the sailboat that ghosted past the harbor mouth the other evening?" },
  ),
  event(
    "b-07", 77, "2796",
    "Alone in the alley behind the hardware store, I find a bicycle chained to the drainpipe with its combination lock hanging open on 2796. I snap it shut and spin the dials so nobody can walk off with the bike.",
    "I think back to the bicycle chained to the drainpipe in the alley behind the hardware store. What number was its open lock left on?",
  ),
  witnessed(
    "b-08", 91, "Lorrimand", MARCUS,
    "After closing, just Marcus and me, he shows me a photograph he found under the seat of a trade-in: a man standing beside a tow truck with Lorrimand painted on its door. Marcus reads it out and says he can't remember any tow outfit by that name around here.",
    "Marcus, the photograph you found under the seat of that trade-in, what name was painted on the tow truck's door?",
    { principal: PRIYA, question: "Priya, do you know what name was painted on the tow truck's door in the photograph Marcus found under a trade-in's seat?" },
  ),
  event(
    "b-09", 103, "Fallowmere",
    "Alone at the library's free shelf, I pick up a cookbook with a bookplate inside the cover that reads 'From the kitchen of Fallowmere'. I put it back for someone who cooks more than I do.",
    "I think back to the cookbook on the library's free shelf. Whose kitchen did its bookplate say it came from?",
  ),
  witnessed(
    "b-10", 117, "Venterlow", DANNY,
    "Just Danny and me at the laundromat, we find a yellowed flyer under all the others on the corkboard, for a band called Venterlow that played the fairgrounds years ago. Danny reads the name out and swears he has never heard of them.",
    "Danny, the yellowed flyer we found under all the others on the laundromat corkboard, what was the band called?",
    { principal: DALE, question: "Dale, do you know the name of the band on the yellowed flyer Danny and I found on the laundromat corkboard?" },
  ),
  event(
    "b-11", 129, "9462",
    "Alone on the trail above town, I come across an old survey stake with a metal tag nailed to it, stamped 9462. I look at it for a while and walk on to the overlook.",
    "I think back to the old survey stake on the trail above town. What number was stamped on its metal tag?",
  ),
  witnessed(
    "b-12", 143, "Kettlebrand", PRIYA,
    "In the town hall basement, just Priya and me, we unroll an old festival banner and find a name stitched small in one corner, Kettlebrand. Priya reads it out and says it must be whoever sewed it, long before her time.",
    "Priya, the old festival banner we unrolled in the town hall basement, what name was stitched in its corner?",
    { principal: DALE, question: "Dale, do you know whose name is stitched in the corner of the old festival banner in the town hall basement?" },
  ),
  event(
    "b-13", 155, "6374",
    "Alone in the shop before opening, I find a page torn from a notebook under the lift with a number circled three times in red ink: 6374. I fold it up and drop it in the recycling bin.",
    "I think back to the torn notebook page I found under the lift before opening. What number was circled on it?",
  ),
  witnessed(
    "b-14", 169, "Strovane", DALE,
    "Just Dale and me in the marina office, a woman phones asking for a slip for her late father's boat. Dale puts her on speaker, and when he asks her name she spells it out for us: Strovane. He scribbles it on the back of an envelope and says she sounded far away.",
    "Dale, the woman who phoned the marina office asking for a slip for her late father's boat, what name did she spell out for us?",
    { principal: MARCUS, question: "Marcus, do you know the name of the woman who phoned the marina asking for a slip for her late father's boat?" },
  ),
  event(
    "b-15", 181, "Nolloway",
    "Alone in the attic storage room Helen lets me use, I find an old leather suitcase with a luggage tag still tied to the handle, the name on it inked as Nolloway. I leave the suitcase where it is.",
    "I think back to the old leather suitcase in the attic storage room. What name was inked on its luggage tag?",
  ),
  witnessed(
    "b-16", 195, "5627", MARCUS,
    "Only Marcus and me in the shop, we roll in a tired old motorcycle for a customer passing through, and Marcus asks me to read him the frame number while he fills out the ticket. I read it off the steering head: 5627.",
    "Marcus, the tired old motorcycle we rolled in for the customer passing through, what frame number did I read off for you?",
    { principal: DANNY, question: "Danny, do you know the frame number of the old motorcycle Marcus and I rolled into the shop for a customer passing through?" },
  ),
  event(
    "b-17", 207, "7943",
    "Alone at the gas station's air pump late at night, I find a used scratch card someone dropped, with a serial number printed along the bottom: 7943. I feed it into the trash bin by the pump.",
    "I think back to the used scratch card I found by the air pump at the gas station. What serial number was printed along its bottom?",
  ),
  witnessed(
    "b-18", 221, "Quennick", DANNY,
    "Just Danny and me on the landing, a man in a delivery cap knocks asking for someone named Quennick who he says used to live in 2B. Danny tells him nobody by that name has lived here in six years, and the man thanks us and leaves.",
    "Danny, the man in the delivery cap who knocked on our landing, who did he say he was looking for?",
    { principal: PRIYA, question: "Priya, do you know who the man in the delivery cap was looking for when he knocked on our landing?" },
  ),
  event(
    "b-19", 235, "6258",
    "Alone on the pier at night, I watch a small boat with no lights slip past, and in the sweep of the harbor beacon I catch the registration on its bow, ending in 6258. It is gone into the dark before I see anything else.",
    "I think back to the small boat with no lights that slipped past the pier at night. What number did the registration on its bow end in?",
  ),
  witnessed(
    "b-20", 249, "Harrowgilt", PRIYA,
    "In the township office, just Priya and me, we open a dusty box of old pie-contest scorecards and find that the top score one year went to someone called Harrowgilt. Priya reads the name out, laughs, and puts the card back in the box.",
    "Priya, the dusty box of old pie-contest scorecards in the township office, who got the top score on the card we found?",
    { principal: MARCUS, question: "Marcus, do you know who got the top score on the old pie-contest scorecard Priya and I found in the township office?" },
  ),

  event(
    "c-01", 5, "4176",
    "Alone in the stairwell on my way down, I find a gym locker tag on the bottom step with the number 4176 punched into it. I hang it on the key hook by the mailboxes for whoever lost it.",
    "I think back to the gym locker tag I found on the bottom step of the stairwell. What number was punched into it?",
  ),
  witnessed(
    "c-02", 17, "Saltriven", DALE,
    "Just Dale and me at the end of the main dock, an empty canoe drifts in and Dale hooks it with a boat pole. Burned into the inside of its hull is a name, Saltriven, and Dale reads it out twice and says it isn't from any camp he knows.",
    "Dale, the empty canoe that drifted up to the end of the main dock, what name was burned into its hull?",
    { principal: PRIYA, question: "Priya, do you know what name was burned into the hull of the empty canoe that drifted up to the marina's main dock?" },
  ),
  event(
    "c-03", 29, "Ambervane",
    "Alone on the beach after the storm, I find a silver ring in the sand with a single word engraved inside the band: Ambervane. I drop it in the lost-and-found jar at the coffee shop on my way home.",
    "I think back to the silver ring I found in the sand after the storm. What word was engraved inside the band?",
  ),
  witnessed(
    "c-04", 43, "8539", MARCUS,
    "After closing, just Marcus and me, he opens the old safe in the back office for the first time in years and lets me read off the number on the deed folder inside: 8539. He says he had forgotten that safe held anything at all.",
    "Marcus, when you opened the old safe in the back office, what number was on the deed folder inside?",
    { principal: DALE, question: "Dale, do you know the number on the deed folder Marcus found in the old safe at the shop?" },
  ),
  event(
    "c-05", 55, "Gorsefell",
    "Alone in the woods behind the school, I find a weathered wooden sign nailed to a pine that just says Gorsefell, pointing at nothing but more trees. I stand there a minute and then walk back to the road.",
    "I think back to the weathered wooden sign nailed to a pine in the woods behind the school. What did it say?",
  ),
  witnessed(
    "c-06", 69, "3721", PRIYA,
    "In the township office, just Priya and me, she asks me to read the meter number off the old water bill she has been trying to trace. I read out 3721, and she circles it on her clipboard and says that meter should have been taken out years ago.",
    "Priya, the old water bill you were trying to trace, what meter number did I read off it for you?",
    { principal: DANNY, question: "Danny, do you know the meter number on the old water bill Priya was trying to trace at the township office?" },
  ),
  event(
    "c-07", 81, "9685",
    "Alone at the self-serve car wash, I find a token stuck in the coin slot that isn't from here, stamped with the number 9685 on one side. I work it loose, set it on the ledge and use quarters instead.",
    "I think back to the odd token stuck in the coin slot at the self-serve car wash. What number was stamped on it?",
  ),
  witnessed(
    "c-08", 95, "Cobbanish", DANNY,
    "Just Danny and me with the hood of his car up on the parking strip behind our building, he finds an old sticker on the underside of the hood from a garage called Cobbanish. He reads it out, and neither of us has ever heard of the place.",
    "Danny, the old sticker you found on the underside of your car's hood, what garage was it from?",
    { principal: MARCUS, question: "Marcus, do you know what garage was named on the old sticker Danny found on the underside of his car's hood?" },
  ),
  event(
    "c-09", 107, "2453",
    "Alone in the post office lobby after hours, I find a parcel notice slipped into the wrong box, with a tracking number ending in 2453. I push it through the slot in the counter door.",
    "I think back to the misplaced parcel notice in the post office lobby after hours. What did its tracking number end in?",
  ),
  witnessed(
    "c-10", 121, "Ellandrine", DALE,
    "Just Dale and me cleaning out the bait shed, we find an old life ring with a boat's name stenciled on it in red, Ellandrine. Dale reads it out and says no boat by that name has kept a slip here in his twenty-five years.",
    "Dale, the old life ring we found cleaning out the bait shed, what boat's name was stenciled on it?",
    { principal: DANNY, question: "Danny, do you know what boat's name was stenciled on the old life ring Dale and I found in the bait shed?" },
  ),
  event(
    "c-11", 133, "Keswold",
    "Alone in my apartment late at night, my radio drifts onto a station I've never caught before, and the announcer signs off as Keswold just before the signal fades to static. I switch it off and go to bed.",
    "I think back to the radio station I caught late one night before it faded to static. What name did the announcer sign off with?",
  ),
  witnessed(
    "c-12", 147, "6812", MARCUS,
    "Only Marcus and me in the shop, he hands me the odometer out of a junked dashboard and asks me to read it. It shows 6812 miles, and he laughs and says that car must have spent its whole life in a garage.",
    "Marcus, the odometer out of that junked dashboard, how many miles did it show?",
    { principal: PRIYA, question: "Priya, do you know how many miles were on the odometer Marcus pulled out of a junked dashboard?" },
  ),
  event(
    "c-13", 159, "Arbellow",
    "Alone in the back booth of the coffee shop, I find a grocery list folded into the napkin dispenser, nothing on it but eggs, flour and lamp oil, signed at the bottom Arbellow. I fold it back where I found it.",
    "I think back to the grocery list folded into the napkin dispenser at the coffee shop. What name was it signed with?",
  ),
  witnessed(
    "c-14", 173, "5194", PRIYA,
    "In the town hall lobby, just Priya and me, she shows me the old inventory sheet for the festival's folding chairs, which claims the town owns 5194 of them. I read the number out in disbelief, and she laughs and says someone added a digit years ago.",
    "Priya, the old inventory sheet for the festival's folding chairs, how many chairs did it claim the town owns?",
    { principal: DALE, question: "Dale, do you know how many folding chairs the old festival inventory sheet at the town hall claims the town owns?" },
  ),
  event(
    "c-15", 185, "7369",
    "Alone at the boat launch at dusk, I find a fishing license pinned under a rock on the picnic table, its number 7369 the only thing still readable. I leave it under the rock.",
    "I think back to the fishing license pinned under a rock at the boat launch. What number was still readable on it?",
  ),
  witnessed(
    "c-16", 199, "Mardrake", DANNY,
    "Just Danny and me on the landing, we find yesterday's paper with one crossword answer already filled in, in pen: Mardrake. Danny reads it out and says that can't be a real word, and it isn't even the right length.",
    "Danny, the crossword in yesterday's paper on the landing, what word had someone filled in in pen?",
    { principal: DALE, question: "Dale, do you know what word someone filled in in pen on the crossword Danny and I found on the landing?" },
  ),
  event(
    "c-17", 211, "4932",
    "Alone in the shop's parts room, I find an old alternator tagged by a supplier I don't recognize, with part number 4932, which is in none of our catalogs. I set it on the shelf for returns.",
    "I think back to the old alternator in the parts room tagged by a supplier I didn't recognize. What part number was on it?",
  ),
  witnessed(
    "c-18", 225, "Hollisker", DALE,
    "Just Dale and me on the fuel dock, a man pulls up in a rented runabout to ask the way to the north shore, and when Dale asks his name for the fuel log he says Hollisker. Dale writes it down and watches him go.",
    "Dale, the man in the rented runabout who asked the way to the north shore, what name did he give for your fuel log?",
    { principal: MARCUS, question: "Marcus, do you know the name of the man in a rented runabout who stopped at the marina to ask the way to the north shore?" },
  ),
  event(
    "c-19", 239, "8647",
    "Crossing the old bridge over the creek alone, I notice a number painted on one of its stones in faded yellow, 8647. I wonder who painted it there and keep walking.",
    "I think back to the old bridge over the creek. What number was painted on one of its stones?",
  ),
  witnessed(
    "c-20", 253, "Vossberrow", MARCUS,
    "Only Marcus and me in the shop when the phone rings: a woman from out of state asking whether we ever serviced her late uncle's truck, and she spells her surname for us, Vossberrow. Marcus checks the old card files while I read the name back to her, and finds nothing.",
    "Marcus, the woman from out of state who phoned about her late uncle's truck, what surname did she spell out?",
    { principal: PRIYA, question: "Priya, do you know the surname of the woman from out of state who phoned the shop about her late uncle's truck?" },
  ),
];
