// The plan's 68 scenarios (PlanScenarios-1 item 2), written once from §17.4 (`STANDALONE-PLAN.md`
// l.1808-1888) and §18.3's table (l.1980-1983): each one's number, the wave whose checkpoint plays it,
// the line of its row, the scenario, and what must be seen, in the plan's own words. `run.ts check`
// holds every scenario file to it, and the report counts what was played against it.

export interface Listed {
  number: number;
  /** The wave §18.3's table lists it at: the first wave in which every page, part and shipped file it names exists. */
  wave: number;
  /** Its row's line in the plan. */
  line: number;
  /** The plan's "Scenario" column. */
  title: string;
  /** The plan's "What must be seen" column. */
  seen: string;
}

export const LIST: readonly Listed[] = [
  // Lanes and the tree
  { number: 1, wave: 3, line: 1811, title: "Six hours pass, with an arrival scheduled and a market due to close", seen: "The GM's session shows the list of what the time brought due; as shipped, each item's outcome is recorded; the World page shows them" },
  { number: 2, wave: 2, line: 1812, title: "Three characters on stage carrying twelve things between them", seen: "The world state lists all twelve; none cut. The next town shows as one line, and a query opens it" },
  { number: 3, wave: 3, line: 1813, title: "A principal leaves, and returns two scenes later", seen: "As shipped: while away, the Cast page shows its whereabouts and intention, and it stays on the horizon. On return, the Author records what it did meanwhile, and the GM fills in what it carries, with a gap check on record" },
  { number: 4, wave: 2, line: 1814, title: "\"She spent most of her coin\"", seen: "A vague fact on the World page beside the last exact amount; a later exact amount settles it" },
  { number: 5, wave: 2, line: 1815, title: "The same impossible operation under two `SIMULATION.md` texts", seen: "Under the shipped text: applied, with a report, and listed as unsettled. Under a text that makes the rules bind: the Author stops and resolves it before the reply" },
  { number: 6, wave: 3, line: 1816, title: "You say you are heading for the harbour", seen: "After the turn, the horizon on the Story page includes the harbour, and the next world state opens it in full" },
  // Cast and perceptions
  { number: 7, wave: 3, line: 1818, title: "A long told turn: six hours, two principals, one moment the second is absent for", seen: "One reply. As shipped: the scene sheet lists the moments; the first has a perception for each; the second's perception of the missed moment is none or told; its memories and knowledge lack what happened; asked next turn, it does not know" },
  { number: 8, wave: 3, line: 1819, title: "RPE is killed right after a reply", seen: "The Turn page shows who has no perception for that turn. As shipped, with the perceptions rules in force: at the next turn's start the reminder `perceptions-missing` names them in the briefing, and the Author writes them before those characters act" },
  { number: 9, wave: 3, line: 1820, title: "Ten story days pass", seen: "A weak memory shows as faint, gist only, on the Cast page. A `recall` in a scene brings it back to top of mind. Top of mind never exceeds its limit" },
  { number: 10, wave: 3, line: 1821, title: "A supporting character is recast as a principal", seen: "Its kept perceptions are given to its new agent as not yet taken in. After its first run, its first memories are on the Cast page in its own words" },
  { number: 11, wave: 3, line: 1822, title: "A character is asked about something it never perceived", seen: "It does not know; its session shows no lore, chat or state tool, because its definition holds none" },
  // Consent
  { number: 12, wave: 2, line: 1824, title: "A sub-agent needs a fact that is in an entry that did not activate", seen: "As shipped: its session shows the search and cites the entry. No question to the Author" },
  { number: 13, wave: 3, line: 1825, title: "You ask about a person who exists nowhere", seen: "As shipped: the gap check and its empty result are in `queries/`; the Author's consent with bounds is on the Turn page; the person is on the World page with source invented" },
  { number: 14, wave: 3, line: 1826, title: "An agent records a new named thing and gives no source", seen: "The write is applied and marked unsourced; the shipped rule's line is in the tool's result; the Turn page lists it under unsettled" },
  { number: 15, wave: 3, line: 1827, title: "The narrator's draft adds a named detail the brief did not have", seen: "As shipped: the Author's reading of the draft lists it, with its accept or return, before release" },
  // The prompt map
  { number: 16, wave: 2, line: 1829, title: "A chat's first turn on a preset never seen", seen: "The reply is not delayed. A mapping job runs; the Prompt page then shows named slices with their kinds; the next turn's files are grouped by them. A second chat on the same preset uses the same prompt map" },
  { number: 17, wave: 2, line: 1830, title: "The preset gains a block; a fixed block's words change; two blocks swap places", seen: "Each shows as its own notice in the next briefing and on the Prompt page. Nothing is blocked" },
  { number: 18, wave: 2, line: 1831, title: "Each of Lumiverse's post-processing modes", seen: "Every slice is still found, and history and lore are still told apart" },
  { number: 19, wave: 2, line: 1832, title: "You rename a marker and merge two slices; the map is learned again", seen: "Your edits are kept" },
  // Turn kinds
  { number: 20, wave: 2, line: 1834, title: "Swipe", seen: "A sibling turn. Time, place, coin and one item's holder on the World page equal the parent's. The earlier attempt is offered to the Author. The swipe did not wait for the earlier attempt's run" },
  { number: 21, wave: 2, line: 1835, title: "Delete the first of three swipes, then go back to what was the third", seen: "The right text with the right state, by the same four values" },
  { number: 22, wave: 2, line: 1836, title: "Delete two turns", seen: "The four values are as before those turns; a note written in them is back to its earlier text" },
  { number: 23, wave: 2, line: 1837, title: "Branch", seen: "The new chat's World page shows the same four values. After one more turn in each chat, the value that turn changed differs between them, and the source chat's other values are as they were" },
  { number: 24, wave: 3, line: 1838, title: "Edit a reply to change who holds an item", seen: "As shipped: after the next turn, or \"Settle now\", the World page shows the edit" },
  { number: 25, wave: 3, line: 1839, title: "Continue; impersonate; stop mid-turn", seen: "Continue extends the same turn. Impersonate changes no state. After a stop, nothing staged is visible" },
  { number: 26, wave: 3, line: 1840, title: "Two replies made on another connection, then back", seen: "The briefing gives the range; as shipped, the Author records what matters" },
  { number: 27, wave: 3, line: 1841, title: "A group chat with two members", seen: "Each turn is written as its speaker; one state. As shipped, both members are cast as principals" },
  { number: 28, wave: 3, line: 1842, title: "RPE killed mid-turn", seen: "After the restart the World page's four values are what they were before the turn; Lumiverse shows a failed generation" },
  // Story, places, quests, lore
  { number: 29, wave: 3, line: 1844, title: "A twelve-turn scene with a planted promise", seen: "As shipped: the Story page shows the thread, marked hot. Closing the scene writes its summary and the next session opens with it. A beat is shown next to its prose" },
  { number: 30, wave: 3, line: 1845, title: "Part of a place burns", seen: "As shipped: the Places page shows it under \"since\"; the Author's overlay is on the lore map beside the entry; \"by the window\" shows as a position" },
  { number: 31, wave: 3, line: 1846, title: "A quest stage is met; a secret exists", seen: "The journal updates with the Author's reason; the secret is absent from the player's view" },
  { number: 32, wave: 4, line: 1847, title: "A lore proposal is approved; the entry is edited in Lumiverse; a second proposal for it is approved", seen: "The first write appears in Lumiverse; the second is refused as stale; revert restores the earlier text" },
  { number: 33, wave: 4, line: 1848, title: "The projection book is turned on", seen: "After a scene's end the chat's own book has entries for what the story made; going back a swipe re-renders it; a branch gets its own" },
  { number: 34, wave: 2, line: 1849, title: "A 60-entry book is indexed, then one entry is changed", seen: "At most 4 calls; then one entry redone" },
  // Sessions and bootstrap
  { number: 35, wave: 3, line: 1851, title: "A scene is closed and the closing turn is swiped; a session outgrows its room; the compaction prompt file is edited", seen: "The swipe reopens the session. Before compacting, as shipped, the `save-before-compaction` call is in the live view. The summary follows the edited file. On a long turn with progress lines set to their least, one line arrives inside every ten minutes and Lumiverse does not cut the turn off" },
  { number: 36, wave: 4, line: 1852, title: "The session measurement", seen: "Its report, for the three modes" },
  { number: 37, wave: 4, line: 1853, title: "Bootstrap on a 1,500-message chat with 20 planted facts", seen: "It reaches \"done enough\" within its limit; at least 16 of 20 are answered right afterwards; the chat was playable throughout" },
  // Migration
  { number: 38, wave: 1, line: 1855, title: "The rehearsal on the test instance of §15.5, run from a copy of the new build in another folder", seen: "The report. The read-only stand-in logged no write to disk, the two cases where today's own reader would have written included, and RPE's database is unchanged. Run again with today's build stopped: checksums of today's storage are the same before and after" },
  { number: 39, wave: 4, line: 1856, title: "The real run", seen: "The file no row names fails the first rehearsal, by name. Once it has a row, found equals carried plus attached plus archived for every row of §15.2, and nothing is unclassified. Every chat matches at the head and at every swipe" },
  { number: 40, wave: 4, line: 1857, title: "A chat from each of today's three engines, after the run", seen: "The time, place, coin, five items and two quest stages on RPE's pages equal what today's panels showed before, a corrected value included. Going back a swipe shows the earlier state. Every mind file's text is on its character's record; a principal's agent is given its files on its first run, and the Author is given a supporting character's. The notebook is in the notes. The assistant thread opens. A secret the character had learned before is in the first prompt after" },
  { number: 41, wave: 4, line: 1858, title: "A chat that was on the classic pipeline is played", seen: "The Author answers; the briefing says it is a migrated chat; the HUD and panels show its state carried on" },
  { number: 42, wave: 4, line: 1859, title: "The run is made a second time", seen: "Nothing is duplicated" },
  { number: 43, wave: 4, line: 1860, title: "Going back, by the written steps of §15.6", seen: "`rpe down`; the extension switched to the previous build's branch, not removed; its permissions approved and the extension switched off and on; its own install line. The same chats play as before, with their state as at the cutover, reading chats and writing books included, and a chat on the classic pipeline is played by its engine again. The connection in Lumiverse was never changed, and today's storage has the checksums it had when `rpe up` stopped today's service" },
  { number: 44, wave: 4, line: 1861, title: "The cutover itself, starting from today's pushed build", seen: "`rpe migrate` from a copy, while today's build goes on answering: the report and every chat's check, with nothing of today's changed. Then, still on today's build: a turn is played, a world is edited in Build, a setting is changed, and an earlier reply is corrected. Then the extension is switched to the new build and `rpe up` is run: it stops today's service, migrates again, and starts RPE. All four changes are in RPE, and the chats answer" },
  // Control, files, security, UI
  { number: 45, wave: 4, line: 1863, title: "An agent tries to write an instruction file; you edit one; you switch one off", seen: "The write is refused and a suggestion appears. Your edit shows in the Files page's stack view, its new text is in the next briefing, and it is in the opening block from the next session. The file you switched off is named as off in the next briefing, and what it asked for stops at that turn" },
  { number: 46, wave: 4, line: 1864, title: "A call limit is set to 3; `WRITING.md` is edited to hand prose to the narrator and back; the GM's model is changed in its definition", seen: "The turn ends at 3 and says so; the next turns' sessions show who wrote the reply; the live view shows the GM's new model" },
  { number: 47, wave: 4, line: 1865, title: "The engine lane is set to Confirm", seen: "The review card lists the turn's changes; undoing one reverts that value on the World page" },
  { number: 48, wave: 4, line: 1866, title: "Talk", seen: "The assistant changes a value with the same tools; it shows on the World page with its source" },
  { number: 49, wave: 3, line: 1867, title: "Rules of each kind: a stream rule that interrupts the reply; a question rule; an interval rule; a rule on a tool call with hold, and the same tool called through `tool_use`", seen: "Each fires on its condition, once. The reply never shows the forbidden sentence and reads on cleanly from the last sentence shown. The question rule's text is in the next briefing. The tool rule fires both ways. The Rules page logs each firing and what the agent did next" },
  { number: 50, wave: 4, line: 1868, title: "A hook blocks a tool; a command tool and an MCP tool are called", seen: "The block's reason in the live view; both tools' results" },
  { number: 51, wave: 4, line: 1869, title: "Requests with a foreign origin, a wrong host, a bad key; a page token asked for by another Lumiverse user; a search of a transcript and a turn folder for a key", seen: "Refused, refused, refused, refused; no key found" },
  { number: 52, wave: 4, line: 1870, title: "Every page and adornment, both shells, at 390 and 1440 pixels wide", seen: "A checklist per page: it loads, scrolls, and its main action works" },
  { number: 53, wave: 4, line: 1871, title: "The live view over the relay during a Full turn", seen: "It keeps streaming and neither socket is closed" },
  // History window, limits, tools, maps
  { number: 54, wave: 4, line: 1873, title: "The window is set to 40 on a chat of 100 messages", seen: "The prompt Lumiverse stores with the reply and the Author's request both hold exactly the latest 40 history messages, whatever the record covers. With a step of 20 set, they hold 40 to 60. The briefing holds the story so far for the rest; the chat shows the marker where the window ends; nothing in Lumiverse's chat has changed; lore still activates from the preset's full scan depth" },
  { number: 55, wave: 4, line: 1874, title: "The same, with a stretch that was never recorded about to leave", seen: "It leaves all the same. As shipped, the rule `history-leaving` put its text in the briefing before it left. Afterwards the briefing and the marker say how many messages are not covered, and the Story page lists the stretch" },
  { number: 56, wave: 4, line: 1875, title: "The hold is switched on", seen: "Uncovered messages stay in the prompt, up to 40 more. Once the Author records them they leave at the next turn. Past the cap they leave anyway, and the briefing says so" },
  { number: 57, wave: 4, line: 1876, title: "A chat arrives with 2,000 messages and no record", seen: "It plays at once, with the latest 40 in the prompt. The briefing says which range is neither in the prompt nor covered. Bootstrap covers the nearest stretch first, and the marker's count falls" },
  { number: 58, wave: 4, line: 1877, title: "A model pi knows, a model it does not (the test bed's own model is one), and an override", seen: "The first shows pi's numbers; the second takes the connection's or asks for them; the third uses yours" },
  { number: 59, wave: 2, line: 1878, title: "A turn needs a tool that is not in the fixed list", seen: "`tool_search` finds it, `tool_use` calls it, and the tool list sent to the model is the same before and after. The Turn page names the tool that was found" },
  { number: 60, wave: 3, line: 1879, title: "A scene opens, on a simple turn, in a place whose only map has squares a town block wide and nobody on it", seen: "As shipped: the Author asks the GM to set the map; the GM's `map_lay` and `map_place` are in the live view; the world state and the map panel show a room grid with everyone and everything on squares, marked assumed" },
  { number: 61, wave: 3, line: 1880, title: "Someone crosses the room; a door is locked; a lantern is put on a table", seen: "The token moves; the door shows locked, and `map_measure` finds no way and no line of sight through it until it is opened; the lantern shows on the table's square, and a query of the table lists it" },
  { number: 62, wave: 3, line: 1881, title: "A fight starts in a place with no map", seen: "As shipped: the GM lays a grid of 5 ft squares for it; it shows on the Places page as belonging to the chat; five rounds of the fight move the clock by seconds, not minutes; \"keep in the world\" copies it into the world's draft" },
  { number: 63, wave: 3, line: 1882, title: "You drag a token on the map panel", seen: "A change with source player; the next briefing tells the Author" },
  // Secrets, panel actions, switching on, swipes, the world's lore
  { number: 64, wave: 3, line: 1884, title: "A lore entry has a passage marked secret that your character does not hold, and an unmarked copy of it sits in another entry; a turn in which your character learns it; a swipe of that turn; RPE stopped; RPE answering too late", seen: "Before: the prompt carries the passage as a secret with who holds it, or leaves it out, by the narrator's view you set; a character's agent who does not hold it is not given it. After, as shipped (the perceptions rule asks for the record): the next prompt carries it with your character among those who hold it. After the swipe: it is kept from them again, at that very generation. With RPE stopped or late: the passage and its unmarked copy are both absent from the prompt" },
  { number: 65, wave: 4, line: 1885, title: "A panel action of each kind: a tap that manages money; \"Walk here\" on the map; a chip that plays now", seen: "The first is applied at once, shows on the World page with its Undo, and is told to the Author at the next turn. The second shows as your request in the next briefing and on the Turn page. The third puts its line in the chat as your message, and a reply starts. As shipped, the Author plays the last two. Nothing was written to message metadata" },
  { number: 66, wave: 4, line: 1886, title: "An MCP server that is started by a command is added from the UI", seen: "It is listed as waiting. Nothing runs, and `tool_search` does not find its tools. After `rpe allow` on the server, its tools are found and one is called" },
  { number: 67, wave: 2, line: 1887, title: "On a chat of six turns, you flip the second reply to its other swipe, then back", seen: "With the other swipe showing: the World page shows the later turns' changes applied on top of it, anything that no longer applies is listed, and the next briefing names the stretch. Flipped back: the four values are what they were" },
  { number: 68, wave: 3, line: 1888, title: "A world with lore entries of its own: one public; one known only to those who know what it links; one secret, held by a named character, behind a gate", seen: "`lore_search` finds all three for the Author, each marked with who may know it. The lore map lists the public one when its keys come up in the chat. The second reaches a character's agent only once that character knows every person and place it links. The secret reaches its holder's agent before its gate holds, and never reaches another character's agent, even after the gate holds" },
];

/** What is wrong with a list of the 68 itself: a number missing or given twice, a wave §18.3 does not have, rows out of the plan's order. */
export function listFaults(list: readonly Listed[]): { where: string; what: string }[] {
  const faults: { where: string; what: string }[] = [];
  for (let number = 1; number <= 68; number++) {
    const rows = list.filter((row) => row.number === number);
    if (rows.length === 0) faults.push({ where: `scenario ${number}`, what: "the list of the 68 lacks it" });
    else if (rows.length > 1) faults.push({ where: `scenario ${number}`, what: `the list of the 68 gives it ${rows.length} times` });
  }
  for (const row of list) {
    if (!Number.isInteger(row.number) || row.number < 1 || row.number > 68) faults.push({ where: `scenario ${row.number}`, what: "the list of the 68 holds a number outside 1 to 68" });
    if (!Number.isInteger(row.wave) || row.wave < 1 || row.wave > 4) faults.push({ where: `scenario ${row.number}`, what: `the list gives it wave ${row.wave}, and §18.3's table lists scenarios at waves 1 to 4` });
  }
  const sorted = [...list].sort((a, b) => a.number - b.number);
  sorted.forEach((row, i) => {
    const before = sorted[i - 1];
    if (before && before.line >= row.line) faults.push({ where: `scenario ${row.number}`, what: `the list puts its row at line ${row.line}, not after scenario ${before.number}'s at line ${before.line}` });
  });
  return faults;
}
