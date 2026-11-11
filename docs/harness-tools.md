# What an agent can do on the harness engine

On the harness engine nothing in LumiRPEngine plays a turn: the author and the agents it starts decide everything by calling tools, and the engine checks and records what they call for. This page lists every surface a game master can read or change in LumiRPEngine (the GM pages and the requests behind them, the change types, the packs) and says what an agent can do to it through a tool. Where a surface is not an agent's to change, the table says so and why.

A test holds this page to the engine (`test/backend/harness-cast-docs.test.ts`). It fails when a tool named here doesn't exist, when a tool the harness lists is missing from the table, when a surface can be created on but not read, when a tier here is not the one the engine's registry gives the tool (`HARNESS_LISTED`, its `needs`), and when the bridge lets a call through that the tier closes: in a real turn it calls every listed tool as an agent that only reads, as one at the story's tier and as the author, and expects each call refused or let through as the tier says, before the tool runs. It also calls every tool once with no arguments, which proves only that each answers in words and reaches no model. What a tool does is proven in its family's own tests (`test/backend/harness-cast-*.test.ts`).

## How to read it

- **Surface**: what is read or changed, with the page or request a game master reaches it by.
- **Tool**: the tool's name. A tool that serves several surfaces is listed under each.
- **Does**: `create`, `read`, `change`, `remove`, one or several.
- **Tier**: who may call it.

| Tier | Who may call it |
|---|---|
| `read` | Any agent given the tool. It changes nothing. |
| `story` | An agent at the story's tier or above: a change the story itself makes (the chronicler holds this tier, and so does the author). |
| `gm` | An agent at the game master's tier: the author, or an agent the author granted it to (`grant_writes`). |
| `author` | The author alone, in its own turn: the run's main agent, never an agent it started and never an agent of a job. |
| `mind` | A character's own agent alone, for the one person it is. |
| `any` | Any agent given the tool: what it records is checked by the engine's own validator for the step it stands in for. |

Whatever tools an agent's definition lists, the bridge holds every call to the tool's tier before the tool runs, and no agent writes above the one that started it: started by an agent that only reads, an agent only reads, in a turn and in a job. A grant (`grant_writes`) raises an agent to the story's tier or the game master's for the rest of the turn, never above the author's own and never past the agent that started it; a character's agent takes none.

What an agent passes a tool is what a model said. Before any tool reads it, every string in a call's arguments has its macros' braces and its `<user>`-style shorthands broken and its control characters dropped; a string that is itself JSON is treated inside, value by value.

Every change is staged with the turn and lands when the author commits (`commit`), under the mode the player set for its change type (Settings → Changes from the reply): Auto lands, Confirm waits on the review card, Never is refused. After the reply, in a job's run, a change is written as it is made, under the same modes. Every tool that writes has a change type: one of the old engines' tools its own; what the author plays (`action_play` and the fight tools) "What the author plays"; a mind's own tools "Characters' minds"; the turn's time (`time_pass`) the type of time passing; what the reply told (`story_record`) the type of each kind of change it records, as a reply's own read has it on the classic and agents engines; the world's document its own (below). `time_pass` with 0 minutes records nothing, so no mode has anything to refuse: it only says that the turn takes no time. Three kinds of write are no event of the chat's record, so each says here how it holds to its mode: the world's draft (below); a file kept in the harness's workspace (a lore entry saved under `lore/` or drafted under `lore-drafts/`, under "Workspace notes": written at once under Auto, staged for the review card under Confirm, refused under Never); and a mind's own file (`mind_file_write`: written under Auto, refused with the reason under Confirm, since a file can't wait on the card, and under Never). One tool changes nothing of the world at all: `story_departure` keeps lines on the reply's record where the reply says something against its turn, so no mode applies to it, only the story's tier.

The dice are the engine's. An attempt is read with `checks_stakes`, which answers the odds and what each outcome does and never a roll; the roll is made once, when the author plays the attempt (`action_play`, or `fight_round` inside a fight), and is recorded with what it did. It is drawn from the turn, who rolls and how many rolls the turn has recorded for them: no argument and no wording moves it, and an argument the action doesn't declare is refused.

The world's document has two kinds of tool. Those that edit its draft write it at once, as Build does: nobody plays a draft, and nothing of it reaches the chat until it is committed and the chat brought to it. Each such write is for the draft as its tool just read it: one written to in between is refused. The four that change what was authored for every chat, or can throw work away (`world_commit`, `world_upgrade`, `world_discard`, `world_restore`), go through the same gate as every other change, under the change type "The world's document": staged with the turn and decided when the author commits, by the mode set then. As shipped it lands: each is made when the author commits (an Upgrade made inside a turn lands at the turn's end, so the chat plays the new revision from the next turn), the commit's answer says what it came to, and the user is told after: the reply lists what each commit changed, with **Undo** and **Open in Build**. Undo puts the world back to the revision before the commit and brings the chat back to it, whole or not at all, and only while that revision is still the world's newest and the chat has played no later turn. Whatever the mode, a commit, a drop or a restore of a draft that holds edits no agent of the turn wrote (the user's own unfinished work in Build, there before the turn's first write or written between its writes) goes to the reply's review card with a line that says so, and a move to the head asked after such a commit waits there with it: no agent publishes or throws away the user's work. Under Confirm each goes to the review card in the tool's own words and Apply makes it. A commit, an Upgrade and a restore say there what they would change against the world's head, by collection, in the engine's own comparison: for a commit everything the draft holds, the user's own unsaved edits too, so the player sees all their Apply commits; what the world keeps from the player's character is counted on the card and never named, and is named, marked as a secret, to the agent that asked. A commit and a restore are for the draft as it stood when asked: written to since, they are refused. Under Never every write of the document is refused, the draft's own edits too: the draft is the user's working copy. An Upgrade that names no revision goes to the world's head as it is when the move is made, so a commit and an Upgrade asked together land together, on one Apply or one commit. What could never be applied is refused when asked rather than left for Apply to find: a draft with errors, a draft begun on an older head (the engine never rebases one: drop it and write again), and a revision the world doesn't have.

Some of the document is closed to agents, whatever the mode: who the player's character is, and what the engine limits or checks agents by. No draft tool writes one of these paths, by any route (a patch of it or of what holds it, a part set whole, a pack put whole), and no agent commits a draft that changes one, restores a revision that differs in one, or brings the chat to a revision that differs in one from the one it plays. Each such call is refused with the paths, and is the user's to do in Build. Everything else, the world's content and its rules, is an agent's to build.

| Closed path | Why |
|---|---|
| `/pov` | Who the player's character is. Every rule that asks it (whose mind no agent may be, whom a secret is kept from) is asked of this one value. |
| `/spawnCap`, `/placeCap`, `/placesPerTurn` | How many people and places a chat's replies may bring in. |
| `/packs/economy/config/claimCap`, `/packs/economy/config/unpricedCap` | The price past which a thing made for the story asks first, and the most a narrated price may be. |
| `/realism/claims` | What a reply may make real of what the player says they have. |
| `/narrator`, `/minds/secrecy` | What the narrator is told: whose knowledge, whether secrets, how much of a mind. |
| `/loreBooks` | Which of the user's own World Info books the world reads. |

A way between two places and a map exist only in the world's document (`world_path`, `world_map` and the tools beside it): neither can be made in play. A place made in play (`place_make`) is reached through the place it is under. A place of the world's own, a way or a map is played from the turn after it is applied: the turn that asked for it still reads the world as it was.

## The table

| Surface | Tool | Does | What it does | Tier |
|---|---|---|---|---|
| People (GM → World; `lre.edit`, `lre.character`) | `person_make` | create | Makes a person whole in one call: kind, tier, place, sheet fields, classes and tags, relations, things held and worn, and how their mind starts (intent, approach, memories, fidelity). | `gm` |
| People | `gm_spawn` | create | Adds a bare person or thing: kind, name, id, tier, place, whether it lives on its own. | `gm` |
| People | `person_add` | create | Notes someone the reply introduced by name, within the world's spawn cap. | `story` |
| People | `people_find` | read | Finds people by name, kind or place. | `read` |
| People | `people_sheet` | read | Reads one person's sheet: kind, tier, place, fields, relations, schedules, lore. | `read` |
| People | `people_where` | read | Says where someone is and what they are doing. | `read` |
| People | `people_regard` | read | Says how someone regards others. | `read` |
| People | `gm_set_field` | change | Sets any field of a person or thing. | `gm` |
| People | `gm_add_to_field` | change | Adds to a number field, within its bounds. | `gm` |
| People | `gm_set_entity` | change | Sets a tier, the agent flag and the detail each part of life is tracked at. | `gm` |
| People | `gm_classify` | change | Sets classes and tags, whole. | `gm` |
| People | `gm_set_life` | change | Sets a life state (alive, dying, dead, or one of the world's own), and who is told: how someone is retired from the story without leaving the world. | `gm` |
| People | `gm_link` | create, change | Makes a relation from one person or thing to another or to a place, or changes its fields. | `gm` |
| People | `gm_unlink` | remove | Ends a relation. | `gm` |
| People | `gm_move` | change | Moves someone or something to a place, with whoever travels with them. | `gm` |
| People | `gm_despawn` | remove | Takes a person or thing out of the world; it is kept, and can be brought back. | `gm` |
| People | `gm_restore` | change | Brings back someone or something taken out. | `gm` |
| People | `story_record` | change | Records what the reply told of people, once it is written: someone moved, a condition came or went, how one feels about another changed, someone died or came round, the player's character learned of someone or somewhere, someone's week changed. One change a call, each under its own change type's mode. | `story` |
| Things, gear and vehicles (GM → Things; `lre.things`) | `item_make` | create | Makes a thing: its type, size, where it is, whose it is, where it is kept; a vehicle by its class with its make, model, year, colour, plate and specs. | `story` |
| Things, gear and vehicles | `purchase` | create | Notes a purchase: the money posted and the goods made or handed over as one change; a vehicle or a property too. | `story` |
| Things, gear and vehicles | `items_find` | read | Finds the things words name, nearest first. | `read` |
| Things, gear and vehicles | `items_read` | read | Reads one thing whole: what it is, where, whose, who may use it. | `read` |
| Things, gear and vehicles | `items_at` | read | Lists what lies at a place or is in a holder, nested. | `read` |
| Things, gear and vehicles | `items_of` | read | Lists a person's things, by where they stand. | `read` |
| Things, gear and vehicles | `items_inventory` | read | Lists what someone wears, carries and owns, and their saved sets. | `read` |
| Things, gear and vehicles | `items_holder` | read | Says where a thing is and who holds it. | `read` |
| Things, gear and vehicles | `items_condition` | read | Reads a thing's condition and state. | `read` |
| Things, gear and vehicles | `items_access` | read | Says whether someone may use or dispose of a thing, and why. | `read` |
| Things, gear and vehicles | `vehicles_classes` | read | Lists the world's vehicle classes and their prices. | `read` |
| Things, gear and vehicles | `item_move` | change | Moves a thing into a holder or to a place. | `story` |
| Things, gear and vehicles | `item_hand` | change | Hands a thing to someone: held, lent, returned, given, sold, traded or stolen. | `story` |
| Things, gear and vehicles | `item_own` | change | Changes whose a thing is. | `story` |
| Things, gear and vehicles | `item_grant` | change | Lets someone use a thing. | `story` |
| Things, gear and vehicles | `item_revoke` | change | Takes back someone's use of a thing. | `story` |
| Things, gear and vehicles | `item_permit` | change | Lets someone use another's things, all of them or those at home. | `story` |
| Things, gear and vehicles | `item_unpermit` | change | Ends a standing permission to use another's things. | `story` |
| Things, gear and vehicles | `item_home` | change | Sets where a thing is kept when not in use. | `story` |
| Things, gear and vehicles | `item_wear` | change | Puts a thing on someone or takes it off; readies, holsters, sheathes or slings it. | `story` |
| Things, gear and vehicles | `item_condition` | change | Breaks a thing, wears it down or mends it. | `story` |
| Things, gear and vehicles | `item_label` | change | Renames a thing, or gives it other names, a description, a size or (a vehicle) its specs. | `story` |
| Things, gear and vehicles | `item_merge` | change | Merges a thing made twice into one. | `story` |
| Things, gear and vehicles | `item_lose` | change | Loses a thing, or has it stolen. | `story` |
| Things, gear and vehicles | `item_use` | remove | Uses up a thing, or some of a stack; the last of it leaves the world. | `story` |
| Things, gear and vehicles | `item_remove` | remove | Destroys a thing: takes it out of the world. | `gm` |
| Things, gear and vehicles | `story_record` | change | Records a count of things going up or down, as the reply tells it. | `story` |
| Things, gear and vehicles | `item_away` | change | Puts a thing back where it is kept, as the game master's Put it away does. | `story` |
| Things, gear and vehicles | `gm_take_out` | change | Takes someone or something out of what holds it (a bag, a car, someone's hands), as the game master's Take out does. | `gm` |
| Saved outfits and loadouts (Gear → Manage) | `set_save` | create | Keeps what someone wears as a saved outfit or loadout. | `story` |
| Saved outfits and loadouts | `items_inventory` | read | Lists a person's saved sets with what they wear and carry. | `read` |
| Saved outfits and loadouts | `set_apply` | change | Changes someone into one of their saved sets. | `story` |
| Saved outfits and loadouts | `set_drop` | remove | Forgets a saved set; the things in it stay. | `story` |
| Places made in play (GM → Places) | `place_make` | create | Makes a room, a spot or a venue under a place the world has, with who may go in. | `story` |
| Places made in play | `places_find` | read | Finds the places words name, places made in play among them. | `read` |
| Places made in play | `places_read` | read | Reads a place: where it sits, what it is, the places inside it and its lore. | `read` |
| Places made in play | `places_contents` | read | Says who and what is at a place. | `read` |
| Places made in play | `place_label` | change | Renames a place made in play, or gives it other names or a description. | `story` |
| Places made in play | `place_remove` | remove | Takes a place made in play out of the world. | `gm` |
| Places of the world's document (Build → Places) | `world_place` | create, change, remove | Makes a place of the world's own, changes its name, parent, scene type, time zone, visibility, description or fields, or takes it out. | `gm` |
| Places of the world's document | `places_read` | read | Reads a place the chat plays. | `read` |
| Places of the world's document | `world_read` | read | Reads a place of the draft or of the played revision, by pointer (`/places/<id>`). | `read` |
| Paths between places (Build → Routes) | `world_path` | create, change, remove | Connects two places, changes the way between them (travel mode, minutes, distance, terrain, one way or both), or disconnects them. A path has no lock of its own: what bars a way is the entry rule of the place it leads to (`gm_org`, `place_make`) and a grid map's walls. | `gm` |
| Paths between places | `places_route` | read | Finds the way between two places and how long it takes. | `read` |
| Maps (Build → Maps; `lre.map`) | `world_map` | create, change, remove | Makes a node map or a grid map of a place, changes its title, size, layout and legend, or takes it out. | `gm` |
| Maps | `world_map_place` | create, change, remove | Puts a place on a map, moves or renames it there, says which map it opens into, or takes it off. | `gm` |
| Maps | `world_map_link` | create, change, remove | Links two places of a map (minutes, travel mode, one way or both), changes the link, or removes it. | `gm` |
| Maps | `world_map_settings` | change | Sets how maps show the world (what is known, or fog), grid movement, the sight radius and the travel simulation. | `gm` |
| Maps | `world_read` | read | Reads a map, or the map settings, by pointer (`/maps/<id>`, `/mapSettings`). | `read` |
| Maps | `checks_odds` | read | Answers what a grid map's Walk here asks of a cell (the action `step`): whether the player's character can walk there, and how long it takes. | `read` |
| Maps | `action_play` | change | Walks the player's character to a cell of a grid map (the action `step`), as Walk here does. | `author` |
| Maps | — | — | Not an agent's: how the map shows in this chat on the player's own page (`lre.map` display) is presentation, kept beside the chat and never in its record. | — |
| The clock (HUD; `lre.fix`) | `time_clock` | read | Reads the date and time. | `read` |
| The clock | `time_pass` | change | Passes the time a turn takes and runs the world across it: schedules, routines, whatever comes due. The author's alone, before the turn's reply; after it, and in a job, it is refused. | `author` |
| The clock | `story_record` | change | Records the time the reply's telling added (an hour later, the next morning), once the reply is written: no farther than a reply passes without asking. | `story` |
| The clock | `gm_fix` | change | Sets the clock to a time (later runs the time between, earlier sets it back), or one field as the player could correct it. | `gm` |
| A person's day in this chat (GM → Routine; `lre.routine`) | `time_day` | read | Reads someone's day as the engine has it. | `read` |
| A person's day in this chat | `gm_routine_edit` | create, change, remove | Sets how someone follows their routine, adds, changes or drops a block of it, or overrides one of their schedules. | `gm` |
| The calendar, schedules and routines of the world (Build) | `world_shape` | read | Says what a schedule, a routine or the calendar looks like: its members, which are required, the values each takes. | `read` |
| The calendar, schedules and routines of the world | `world_read` | read | Reads the calendar (`/calendar`), a schedule (`/schedules/<id>`) or a routine (`/routines/<id>`). | `read` |
| The calendar, schedules and routines of the world | `world_put` | create, change | Writes a schedule or a routine, whole. | `gm` |
| The calendar, schedules and routines of the world | `world_set` | change | Writes the calendar (its epoch, day parts and holidays), the routine settings, the needs or the time rules, whole. | `gm` |
| The calendar, schedules and routines of the world | `world_remove` | remove | Takes a schedule or a routine out. | `gm` |
| Money (GM → Money; the economy pack) | `gm_effect` | create, change, remove | Runs one of the packs' game-master effects: an account opened or closed, an asset priced, a payment, a loan, a tax status. | `gm` |
| Money | `gm_effects` | read | Lists the effects `gm_effect` runs, each with its arguments. | `read` |
| Money | `money_balances` | read | Reads someone's money: accounts, balances, debts and how well off they are. | `read` |
| Money | `money_prices` | read | Prices a thing, or lists what a place sells. | `read` |
| Money | `gm_adjust_money` | change | Moves money into or out of an account against a correction. | `gm` |
| Money | `purchase` | change | Posts what a purchase cost, with its goods. | `story` |
| Money | `gm_revenue` | change | Has a revenue stream earn more or less for a while. | `gm` |
| Money | `revenue_note` | change | Notes what the reply says of a revenue stream earning more or less. | `story` |
| Money | `story_record` | change | Records money that changed hands in the reply's telling, between people or their accounts. | `story` |
| Organizations (GM → Orgs; the orgs pack) | `gm_org` | create, change, remove | One change to an organization: founded, members admitted or removed, positions and delegated powers, people hired, fired and paid, shares issued, bought back, transferred or traded, a place's entry rule and keys, dues, structure, tax status, decisions and votes, merged or wound up. | `gm` |
| Organizations | `orgs_list` | read | Lists the organizations someone belongs to, with their title, position and powers there. | `read` |
| Organizations | `orgs_read` | read | Reads an organization's page, or one part of it. | `read` |
| Organizations | `orgs_who_may` | read | Says who may use a power in an organization, or whether someone may, and why. | `read` |
| Organizations | `gm_project` | create, change, remove | Starts a production project from a template, pauses, resumes or drops it, or sets a step back. | `gm` |
| Organizations | `project_note` | change | Notes a project's step set back or costing more, as the reply tells it. | `story` |
| Organizations | `story_record` | change | Records what the reply states of an organization, quoting it: someone joined, left, was appointed, hired or let go, a plan's item moved along, a vote was cast, a request answered. | `story` |
| Quests, secrets, puzzles and agendas (GM → Story) | `quests_tracks` | read | Lists the quests, secrets, puzzles and agendas. | `read` |
| Quests, secrets, puzzles and agendas | `quests_stage` | read | Reads where a quest or secret stands. | `read` |
| Quests, secrets, puzzles and agendas | `quests_moves` | read | Says what moves a quest or secret on. | `read` |
| Quests, secrets, puzzles and agendas | `gm_set_stage` | change | Moves a quest or secret to a stage: on, with its effects, rewards and reveal; back, only the stage. | `gm` |
| Quests, secrets, puzzles and agendas | `world_put` | create, change | Writes a quest, secret, puzzle or agenda of the world's document (collection `tracks`): its stages, objectives, hints and rewards. | `gm` |
| Quests, secrets, puzzles and agendas | `world_remove` | remove | Takes one out of the world's document. | `gm` |
| Quests, secrets, puzzles and agendas | — | — | Not an agent's: opening a hint (`lre.fix` hint). A hint shown is the player's own doing at the quest log, never a correction and never the story's. | — |
| Who knows what (GM → Minds → Knowledge) | `knowledge_infer` | create, change | Records new facts, who learned which and how, what someone worked out and how sure they are, and what someone now doubts. | `any` |
| Who knows what | `knowledge_who_knows` | read | Says who knows a fact, and how. | `read` |
| Who knows what | `knowledge_what_knows` | read | Says what someone knows. | `read` |
| Who knows what | `knowledge_scene` | read | Gives what a turn gives the people in it to know, each fact and witness line by its id. | `read` |
| Who knows what | `gm_mind_edit` | change, remove | Sets what one person holds of a fact, whole, or takes it away. | `gm` |
| What the writer is given (GM → This chat → Sections; `lre.sections`) | `sections_read` | read | Reads the sections the reply's writer is given, as they would be built now, with each one's settings. | `read` |
| What the writer is given | `gm_feed` | change | Sets a section's settings in this chat: whether it is sent, its limits, its sources, whose knowledge it reads. | `gm` |
| Lore (Build → Lore; `lre.lore`) | `lore_draft` | create | Drafts an edit of a lore entry as a file of the workspace, under `lore-drafts/`, for the user to adopt. | `gm` |
| Lore | `lore_save` | create | Saves a lore entry as a file of the workspace. | `gm` |
| Lore | `lore_index` | read | Gives every entry of the chat's World Info books by its id and title. | `read` |
| Lore | `lore_search` | read | Searches the world's lore and the chat's World Info books. | `read` |
| Lore | `lore_grep` | read | Finds lore entries that hold some text. | `read` |
| Lore | `lore_read` | read | Reads one lore entry, by its id. | `read` |
| Lore | `lore_load` | read | Reads a lore entry into the prompt of the reply the turn is writing. | `read` |
| Lore | `world_put` | create, change | Writes a lore entry of the world's own (collection `lore`). | `gm` |
| Lore | `world_set` | change | Writes the lore lookup table (`loreIndex`) or what is pinned to each mind call (`lorePins`), whole. | `gm` |
| Lore | `world_remove` | remove | Takes a lore entry of the world's own out. | `gm` |
| Lore | — | — | Not an agent's: the user's World Info books (an entry's fields and secret marks, `lre.lore`; a book's secrecy, `lre.secrecy`). They are the user's own, and every write to one is the user's own press. An agent drafts (`lore_draft`), and the user adopts. | — |
| Minds, as the game master (GM → Minds) | `minds_read` | read | Reads a character's mind, memory and plans. | `read` |
| Minds, as the game master | `gm_mind_edit` | create, change, remove | Pins a mind's fidelity, asks for a fresh mind, sets what someone means to do, and adds, changes or deletes a note, a commitment or a plan. | `gm` |
| Minds, as the game master | — | — | Not an agent's: the engine's own minds run (`lre.minds`). It thinks with a model call of the engine's, and on the harness every model call is an agent's: a mind is a character agent the author starts. | — |
| A person's own mind (the character agent) | `mind_view` | read | Gives one person what they perceive, know and remember, the files they keep, and the notes due to fold into their summary. | `mind` |
| A person's own mind | `mind_decide` | change | Records their decision for the turn: thoughts, how they come across, intent, reactions, mood. | `mind` |
| A person's own mind | `mind_remember` | create | Records what they take from a turn as written: notes, commitments, plans, what they told whom, their summary. | `mind` |
| A person's own mind | `mind_consolidate` | change | Folds their older notes into their summary, as they rewrite it. | `mind` |
| A person's own mind | `mind_files` | read | Lists the files they keep for themselves. | `mind` |
| A person's own mind | `mind_file_read` | read | Reads one of their own files, with its version. | `mind` |
| A person's own mind | `mind_file_write` | create, change | Writes one of their own files whole; `core.md` is the user's and is never written. | `mind` |
| Checks and actions (the palette; `lre.action`) | `checks_odds` | read | Gives an action's odds and what the world's policy makes of it. | `read` |
| Checks and actions | `checks_stakes` | read | Reads an attempt before it is played: its odds, what a rating of the approach does to its roll, and what each outcome does. It rolls nothing: no tool shows a roll before it is played. | `read` |
| Checks and actions | `action_play` | change | Plays an action through the world's rules: the engine rolls once and records the roll with what it did, so the rule for trying again holds. An argument the action doesn't declare is refused. | `author` |
| Fights (the combat pack) | `fight_start` | create | Starts an encounter where the player's character stands, with its foes. | `author` |
| Fights | `fight_read` | read | Says whether a fight is on, who is in it, whose turn it is, what the player's character can do, and what each other fighter may do on their next turn. | `read` |
| Fights | `fight_round` | change | Plays one round: the player character's action, then everyone else's turns by the choices given or recorded (the pack's tactics only when the call says so), with who is down and whether it ends. | `author` |
| Fights | `mind_fight` | change | A fighter's own agent reads the fight as they perceive it and what they can do on their next turn, and stages its choice. | `mind` |
| Fights | `fight_end` | remove | Ends the fight, or breaks it off. | `author` |
| The turn | `commit` | change | Makes everything staged so far definitive, the agents' changes with the author's. | `author` |
| The turn | `grant_writes` | change | Lets an agent the author started make more of the world's changes for the rest of the turn. | `author` |
| The turn | `story_departure` | create | Notes, once the reply is written, where it says something against what the turn decided or the world holds: up to 8 lines on the reply, each what the reply says and what the world holds. Nothing of the world changes; the player sees the lines on the reply, and the next turn's author is told. | `story` |
| The world's document as a whole (Build; `lre.editor`, `lre.world`) | `world_put` | create, change | Writes one item of any collection of the draft, whole: a kind, a relation type, an entity, a rule, an action, a check, a table, a section, a classification and the rest. | `gm` |
| The world's document as a whole | `world_status` | read | Says which revision this chat plays, the world's head, whether a draft is open, and what its checks find. | `read` |
| The world's document as a whole | `world_read` | read | Reads the draft or the played revision at any pointer; a value too big to answer whole comes back as an outline. What it shows that is kept from the player's character is listed beside the value, each by its pointer, marked as a secret. | `read` |
| The world's document as a whole | `world_shape` | read | Says what one item of a collection, or a part, looks like. | `read` |
| The world's document as a whole | `world_history` | read | Lists the world's revisions: when each became head, by what, and its note. | `read` |
| The world's document as a whole | `world_set` | change | Writes one part of the draft, whole: the calendar, realism, time, tiers, the ruleset, minds and the rest. | `gm` |
| The world's document as a whole | `world_patch` | change | Changes the draft in place with JSON Patch operations; a patch that would change a closed path is refused whole. | `gm` |
| The world's document as a whole | `world_restore` | change | Makes the draft a copy of an earlier revision, under the mode of "The world's document" (lands as shipped, unless the draft holds the user's own edits); its card lists what the draft would then hold against the world's head. | `gm` |
| The world's document as a whole | `world_commit` | change | Makes the draft the world's next revision, under the mode of "The world's document" (lands as shipped, and the reply lists it with Undo; a draft that holds the user's own edits waits on the card); its card lists everything it would commit against the world's head. | `gm` |
| The world's document as a whole | `world_upgrade` | change | Brings this chat to the world's head, or to another revision (an Upgrade), under the mode of "The world's document" (lands as shipped, played from the next turn); its card lists what that revision brings of the document against the one played. | `gm` |
| The world's document as a whole | `world_remove` | remove | Takes one item out of a collection of the draft. | `gm` |
| The world's document as a whole | `world_discard` | remove | Drops the draft, under the mode of "The world's document" (lands as shipped, unless the draft holds the user's own edits). | `gm` |
| The world's document as a whole | — | — | Not an agent's: making, deleting, importing and exporting a world (`lre.world`), Build's generation jobs (`lre.job`), and an Upgrade's merge with its preview and picks, part by part. An agent works in the world its chat plays; the jobs think with model calls of the engine's own, which the harness path never makes; and an agent's Upgrade switches the revision the chat plays and merges nothing, which stays the player's to do in Build. | — |
| Keep in the world (GM → Things) | `world_keep` | create | Copies things and places made in play into the world's draft, so a new chat starts with them. | `gm` |
| Keep in the world | `world_made` | read | Lists what this chat made in play that the world's document doesn't have. | `read` |
| How this chat plays (GM → This chat; `lre.marker`) | — | — | Not an agent's: realism part by part, the time controls, what a reply may claim, the adjudication policy and inferred checks. They are the rules a turn is held to, and an agent that could change them could loosen what it is checked by. Every agent reads them in the world's guidance. | — |
| This chat's own choices (GM → This chat; `lre.chat.knowledge`) | — | — | Not an agent's: whether the chat tracks who knows what, what the narrator knows, which engine plays it, and tidying impossible holds. They are the player's choices about their own chat. | — |
| Undo, Keep or Discard, the review card (`lre.chip`, `lre.keep`, `lre.review`) | — | — | Not an agent's: they are the player's say over what agents recorded. An agent stages and proposes; the player applies, declines and undoes. | — |
| Settings and prompt texts (`lre.settings.set`, `lre.prompts`) | — | — | Not an agent's: the user's own, among them the modes and caps an agent's changes are held to and the words every agent is sent. | — |
| The workspace (GM → Workspace; `lre.workspace`) | — | — | Not the engine's on the harness: the agents' files are LumiAH's, read and written with its own `workspace_*` tools. The engine's tools that keep a file (`lore_draft`, `lore_save`, `mind_file_write`) write there. | — |
| Diagnostics and the live view (`lre.diag`, `lre.live`) | — | — | Not an agent's: the player's view of the engine's and the agents' own work (what ran, how long it took, what it cost). Nothing in it is the world's, and an agent's own run is told to it by the harness. | — |
