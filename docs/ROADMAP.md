# Roadmap: the October 2026 review

This records a review of LumiRPEngine after long play on a large world: about 700 entities, 320 places and 83 vehicles. It covers what the review found, the decisions I made, and the order the work goes in. The [user guide](USER-GUIDE.md) and [design](DESIGN.md) describe the engine as built; this page is the plan for changing it.

## What one turn showed

On the last turn reviewed:

- **The prompt** was 275K tokens. World Info took 179K of it (65%). The engine's sections were 7,167 characters, about 2.3K tokens, or 0.85% of the prompt.
- **The engine's own calls:** 7 model calls read 460K tokens and wrote 1.5K. Three of them were character minds, reading 209K between them, and none of their output reached the prompt.
- **One pinned lore entry**, a chronological timeline of about 35–47K tokens, was pinned to all 13 steps, so it went whole into every call. That's more than half of the 460K.
- **What the narrator got:**
  - People was one line: "You feel hungry and tired and lonely."
  - Minds, Stance and Montage were empty.
  - Vehicles listed the player character's own 18 vehicles, 12 of them elsewhere, and none of the other people's vehicles where he was.

## Three root causes

1. **"With the player" means the exact same place, and the engine's places are often wrong.**
   - Minds are chosen before the turn's plan: anyone in the same place, or named this turn. But the Minds section shows only people whose place is exactly the player character's.
   - Narrated moves were refused for lacking a route.
   - Go moved only the player character, so companions stayed behind.
   - A reply's reading placed a companion on a floor while the player character stood in a room on that floor.
   - Minds had content on 3 of the last 12 turns, and People and Stance went empty with it.
2. **The narrator's feed is a thin, player-only view, by design.**
   - It carries only what the player character knows, and only his gear, money and vehicles.
   - It carries no world lore and no items lying where he is.
   - Budgets are ceilings, not targets, and the Story defaults trim most areas to level 1.
3. **The engine's checks veto the story, and each refusal knocks out something else.**
   - Refused moves leave people out of the scene, so Minds goes empty.
   - "Put on my clothes" became the wear action, which failed because the engine didn't track the clothes. That stopped the rest of the message, and the Outcome told the narrator not to narrate it.

## Item by item

| Item | What's there today | Verdict |
|---|---|---|
| Step template macros | `{{name}}` vars: 13 for helper steps (world, pov, place, clock, scene, facts, present, outcome, beats, brief, user, reply, recent), 5 for minds steps, none for decision steps. Lumiverse macros don't run in them. No screen lists them. The lint wrongly flags `usual` and `sections`. Time-skip beats are documented with 5 vars but get 1. | Weak. Lint and doc bugs now; a vars panel plus gear, money, property, position and knowledge vars later. |
| Awareness controls for gear, property, money and property location | Only the per-area realism level (0 = off), the "notable" flag at Gear 1, and minds' "Their own life" source. | Missing: nothing chooses per recipient (player, narrator, other characters). There's no property section at all. |
| Not every step editable | Build → Step templates reaches all 13 steps, but each uses the template differently: added in front, replacing the instruction, or replacing only the question. Settings has prompts only for the 4 minds steps. A per-step prompt setting is saved and documented but nothing reads it. The skip plan can't be edited and ignores the time-skip step's connection, model and token settings. | True. The skip plan ignoring its settings is a bug: it runs on the helper's 8,192-token default. |
| Items in quests and puzzles | Quest stages can test items (`carries`, `has_item`, `at`), rules can fire on a hand-over, and puzzles take typed answers. There's no search or examine action (DESIGN claims one), no hidden or discoverable items, no authored container contents, and no check that a quest's item ids exist. | Works only when hand-built: a hidden quest item takes 3–4 linked objects written by hand. |
| Item tracking | At Gear 1 (the Story default) only "notable" items show, and nothing marks found, received or claimed items notable, so the Gear panel and the narrator never see them. Narrated hand-overs match ids only, which makes duplicates. The reply-reading step sees 30 entities without who holds them. Refused changes vanish silently. There's no channel for finding, picking up, dropping, using up, wearing or losing an item. A change applied from a chip doesn't advance a quest until the next turn. | Several bugs; the missing channels are bigger work. |
| Preview and edit before applying | Only claims' "Ask first" and suggested checks pause a turn. | Missing; the claims pause is the pattern to reuse. |
| Map doors inside a place | A map cell has one meaning, so a door can't belong to a room and has to sit in a line between rooms. | Missing: a map format change, which recompiles routes. |
| GM position control | ✎ Place exists for the player character only, and it writes the field without doing a real move (no arrival, no activity reset). GM "Move to a place" works one person at a time. | ✎ is a bug; bulk and NPC pickers come later. |
| Pathing | A narrated move with no route is refused with a chip, and the Outcome says it "didn't happen", even for moves the reply only implied. Typed Go is walk-only. NPC routines never check routes. There's no off switch: Space ≤ 1 comes closest, and grid maps force it back up. | A bug against story first; the full rework comes later. |
| Time per turn | A plain message gets the scene's tick (2 minutes in conversation). Typed spans understand numbers, parts of the day and dates, but not "until dinner" or "a few minutes later". The reply-reading step never sees the player's message. Only the prompt stops narrated time being counted twice. | Bugs and gaps, all fairly small. |
| Minds and Montage empty | Minds: cause 1. Montage exists only on time-skip turns and shows only notes and the player character's own money. It never shows the band crossings it computes, and the distance and needs it promises aren't computed. | Bugs. |
| Control over the engine's output | The layout can be set: label, order, wrapper, position, outlet. The content can't: no per-section switch, no caps except Minds, no per-user layer. A custom section has no data source and silently stays empty. | Missing. |
| People shows only the player character | Lists only people in the exact same place, and never says who the player character is. | Bug (cause 1) plus a missing identity line. |
| Vehicles shows only the player character's | Keeps only vehicles he owns: no family, assigned or lent ones, and no owner names, though DESIGN promises owners at level 2. | Bug. |
| Needs | Rates are fixed in code: hunger 4/h, fatigue 3/h, social 1.5/h, fun 1/h. Needs run only at Cast life 4 and never show in Play. Sleep counts as rest when it starts, not when it ends. Sleeping through a time skip probably doesn't rest the player character (read from the code, not tested). Nothing meets the social need. | Bugs plus missing settings. |
| Group plans | A plan belongs to one person, and "with" is only a list of names. Nothing shares a plan. Accepting an invitation records nothing. Minds don't read their own plans by default. | Missing. |
| Location outlet | Scene carries the place, nearby exits, time and weather. Place descriptions, items at the place, the map layout and place lore all exist, but nothing sends them. The narrator gets no world lore. Spindle's World Info interceptor can switch off a World Info entry on the same turn a Place section carries it, so nothing goes in twice. | Missing; it changes the sections' rules, and duplicate removal uses the interceptor. |
| Cancel a run | Exists only for minds runs and Build jobs. A turn's cancel signal is never fired, and Lumiverse's Stop can't reach the engine's work before the reply. | Missing. |
| A second lore system | World lore exists for secrets that open on story conditions, per-step audiences, Known by, lore frozen with each world revision, and replay. World Info can gate entries too: the World Info interceptor runs before activation and can switch any entry on or off, or replace its text, for one turn. LRE already holds the permission it needs. Today the two systems don't touch: the narrator sees World Info only, and helpers see world lore plus pins (pins already read World Info live). | Decided: one lore system on World Info (decision 4). |
| Beds | None. Sleep happens "at home", which is a whole place, and Go to bed moves no one. | Missing. |
| Positioning overhaul | Six or more code paths each write a person's place with their own rules. | Needed; the largest job here. |
| Current bed and location pickers | Only the two location controls above, and no bed picker. | Missing. |
| Multi-select and batch editing | Only "Choose who to run" and job proposal ticks. The protocol already takes batches. The 64-edit cap contradicts the MCP tools' 200. | Bug plus missing UI. |
| Settings that fail a turn | Any settings save between the engine starting and the reply starting throws away the prepared turn ("didn't start", Retry). A deleted connection fails its step, signals aren't validated, and switching Model use replaces every step's settings. | The first is a bug; pre-flight checks are missing. |
| Output too short for its cost | 2.3K tokens of sections in a 275K prompt. | Causes 1 and 2. |
| Real-engine facts (who knows what, everyone's gear, ownership) | Knowledge gating exists and is strict. The narrator is told only what the player character knows, and nothing about anyone else's gear. Ownership is stored in four different shapes, and no section brings them together. | Decided: a GM-level feed (decision 1). |

## Decisions

1. **The engine feed is GM-level, granular and informative.**
   - It may carry what the GM knows, with its own scope for each recipient: the narrator, the player character and the characters in the scene, each controlled separately.
   - Each fact says who knows it.
   - "Only what the player character knows" becomes one setting, not the rule.
2. **Moves are story first in every world.** A narrated move is never refused for lack of a route. Route checking stays as an opt-in travel simulation.
3. **Minds follow the scene and what's in motion.**
   - A mind runs for each character in the scene.
   - It runs for a character off scene only while they're actively involved in something that could surface soon: a plan or appointment with the player character, an agenda, a GM intent. It doesn't run while they idle or follow their routine. That way, what they did off scene is on record when it matters.
   - Being named in a message no longer makes someone a mind on its own.
4. **LRE may use the World Info interceptor.** This is the one exception to not using interceptors. It makes World Info the one lore system:
   - secrets are stored switched off and switched on once their gate holds, and stay off if the hook fails;
   - an entry a section already carries is switched off on the same turn.

## Group 1: quick fixes (shipped October 2026)

**The scene rule as built:** two places are together when they're the same place, or one is at most two levels inside the other with nothing spread out on the way up. A place is spread out only if some route inside it needs a mode other than walking, or a walk longer than 10 minutes. Interior walks between rooms never spread a building, and people in sibling rooms are apart.

**A. Presence, People and minds**

1. **One "with the player" test:** the same place, or one inside the other within the same building or site. Minds, People, Stance, relationships and minds' presence all use it, on the state after the plan.
2. **People names the player character first.**
3. **Minds by decision 3:** characters in the scene by that test, and off-scene characters only while they're actively involved.

**B. Moves**

4. **Story-first moves:**
   - a narrated move is never refused for lack of a route;
   - an implied move never gets a "didn't happen" note;
   - typed Go accepts any travel mode, and with no route it still goes, at a nominal travel time;
   - a world setting turns route checking on as a travel simulation.
5. **✎ Place** does a real move.
6. **A refused change** gets a chip instead of vanishing.

**C. Sections**

7. **Vehicles** lists everything the player character may use (his own, family, assigned and lent), each with its owner, and folds far-away ones into one line.
8. **Montage** shows the band crossings it already computes.
9. **Preset checks:** a warning when an engine block places some section outlets but not all, and when a custom section has no source.

**D. Items**

10. **Found, received and claimed items** count as notable, so Gear 1 shows them.
11. **Hand-overs and claims:**
    - narrated hand-overs match item names, not just ids;
    - the reply-reading step sees who holds what;
    - a claim never duplicates a hidden authored item.
12. **Quest item checks:** Check flags quest conditions that name items which don't exist.

**E. Steps and settings**

13. **Saving settings mid-turn:** only settings that change the turn throw away a prepared one.
14. **The skip plan** uses the time-skip step's connection, model, tokens and preset guidance.
15. **Template checks and docs:** the `usual` and `sections` vars, the time-skip vars, and blank templates.
16. **One batch-edit limit** for the UI and the tools.

**F. Time**

17. **The message's own time wins:** "until dinner" and "a few minutes later" read as spans, and narrated time is netted against what the turn already applied.

## Group 2: after the quick fixes

1. **Positioning overhaul:**
   - one move path for everything that changes a place;
   - a per-world pathing mode;
   - companions travel with the player character;
   - GM bulk moves and an NPC ✎;
   - current-location and bed pickers;
   - beds;
   - doors on a room's edge.
2. **A GM-level engine feed (decision 1):**
   - per-section switches, caps and sources;
   - recipient scopes for the narrator, the player character and the characters in the scene, with each fact marked by who knows it;
   - a Place section: description, items here, layout and place lore, with World Info duplicates switched off;
   - what everyone visibly carries;
   - who owns or may use what;
   - a Property section.
3. **Items:**
   - Search/examine with discoverable items and authored container contents;
   - reading finds, pick-ups, drops, use, wear and losses from replies;
   - stacking;
   - chip changes advancing quests at once;
   - tracking gaps no longer vetoing the story;
   - Build helpers for placing and revealing quest items.
4. **Steps:**
   - your own prompt for every step (yours, then the world's, then the built-in);
   - a vars panel and the missing vars;
   - preview and edit for intent and outline;
   - cancelling a turn;
   - checking connections before a turn runs.
5. **Time and needs:**
   - stated durations on actions;
   - the reply-reading step sees the player's message;
   - one time cap instead of three;
   - per-world needs settings;
   - Needs shown in Play;
   - rest through time skips;
   - a way to meet the social need.
6. **Group plans:** a shared plan reaches everyone in it, accepting an invitation books it, and minds read their plans by default.
7. **Batch editing** on the Build and GM lists.
8. **One lore system on World Info (decision 4):**
   - world lore's gates, audiences and links stored on World Info entries;
   - secrets switched on through the interceptor;
   - a long pinned timeline that has to be cut keeps its newest part, not its oldest.

## Settings for long chats

- **Check your preset's outlets.** Check that a preset's engine block places every section's outlet. A section whose outlet is missing goes in as its own entry, outside the block, and Group 1's preset check will warn about it.
- **Pin long timelines only where they're needed.**
  - Pin a long chronological entry only to the steps that need it: Character minds, Character memory, Memory consolidation and Time-skip beats.
  - Don't cap it instead. A capped entry keeps its beginning and cuts its end, so a timeline written oldest-first loses its newest events first.
  - Lowering a helper step's Lore tokens also squeezes out the lore that step finds on its own each turn, because pinned text is read first.
