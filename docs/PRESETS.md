# Presets and RPEngine

This page is for people who write Lumiverse presets and want them to play well with LumiRPEngine. A preset needs nothing special to work in a world chat: the engine puts its sections into the prompt where the world places them. What follows lets a preset place those sections itself, give the engine's helpers style and rules of its own, and give the narrator rules for world chats only. All of it applies while the preset is active, and only in world chats.

The preset that counts is the one Lumiverse generates the chat with, as it picks it: the selected preset, else the one the chat's connection links, with the block states a preset profile binds to the chat, its character, persona or connection (a block switched off for the chat places nothing). When Lumiverse can't say which it is, the engine stops before the reply and the chat says why. Saving another preset changes nothing; saving this one makes the engine run again before the reply only when the save moves an outlet or changes a guidance block or the narrator rules. Prompt-activation regex scripts are invisible to the engine; the delivery check (below) catches a section they leave out. **Settings → Preset** shows which preset counts, what of the below it has, and a button that adds the guidance blocks for you.

## Section slots and their outlets

Each section the engine fills has an outlet named `lre_` and its slot. Put `{{outlet::lre_scene}}` in an enabled block and the Scene section goes exactly there, and nowhere else, for every generation while the preset is active.

| Slot | Section | Outlet |
|---|---|---|
| `outcome` | Outcome: what the turn's action did, and corrections the last reply needs | `{{outlet::lre_outcome}}` |
| `montage` | Montage: what happened during a timelapse | `{{outlet::lre_montage}}` |
| `scene` | Scene: where you are, the time, who is there, how long the turn took | `{{outlet::lre_scene}}` |
| `people` | People: the people present and how they stand | `{{outlet::lre_people}}` |
| `money` | Money | `{{outlet::lre_money}}` |
| `gear` | Gear: what you carry and wear | `{{outlet::lre_gear}}` |
| `vehicles` | Vehicles | `{{outlet::lre_vehicles}}` |
| `quest` | Quest: the stories and goals you can see | `{{outlet::lre_quest}}` |
| `outline` | Outline: the engine's beats for the reply, with the brief and prose outline | `{{outlet::lre_outline}}` |
| `stance` | Stance: how the people here behave, with the cues their secrets give | `{{outlet::lre_stance}}` |
| `minds` | Minds: each character's mind this turn, scoped to what they know (under `brief` secrecy, only how they come across). It has its own token budget (Settings → Minds), apart from the section budget | `{{outlet::lre_minds}}` |
| `knowledge` | Who knows what: what the player character knows and, as the narrator's knowledge allows, what the people with them know, while the chat tracks who knows what. Settings → Minds → Knowledge caps its tokens | `{{outlet::lre_knowledge}}` |
| — | The narrator rules (below) | `{{outlet::lre_narrator}}` |

A world may list sections of its own (Build → Sections); each one's outlet is `lre_` and its id, so a section `stance` goes to `{{outlet::lre_stance}}`. A section is filled only by a pack that renders one with its id (weather, for example, goes into Scene, not a section of its own); one nothing fills is a lint warning (`section_unfed`) and never goes in. Outlet names are matched without regard to case, as Lumiverse matches them.

Place all of the world's sections or none. A preset that places some with their outlets but leaves others out sends the rest in on their own, outside its blocks; Settings → Caveats warns about it (`preset_partial_outlets`) and names the missing outlets.

Only blocks Lumiverse assembles in every prompt count. A block that is switched off, limited to some generation types (its injection trigger) or to characters with certain tags (its character tag trigger), or a second switched-on block under a radio category (Lumiverse keeps only the first one), places nothing: the section would go missing from the prompts that block isn't in, so the world's placement stands instead. A block Lumiverse leaves out for reasons the engine can't see, such as a preset profile's block states or a prompt-activation regex script, is caught when you open the Context panel: its test prompt build looks for each section the preset placed, and a section it doesn't find goes back to the world's placement until the preset changes.

## Placement precedence

For each section and each generation, the first of these that applies places it:

1. **The preset.** An enabled block of the preset that counts (its block states applied) holds `{{outlet::lre_<slot>}}`.
2. **The world.** The section's Position in Build → Sections: at a chat depth, at an outlet of the world's own naming (`{"type":"outlet","name":"…"}`, which can be a card's or the preset's), or native.
3. **The host's editor.** A native section's entry sits where you put it in Lumiverse's World Info editor (before the character to begin with).

The preset never changes what is in a section, how much the sections may cost (the section budget) or which sections there are: only where they land.

## Guidance for the engine's helpers

The engine makes small model calls of its own around each turn. A switched-off block named **RPEngine ·** and the helper's name gives that helper style and rules for your preset, added to its prompt after the world's own step template (or the built-in prompt) and its output format. Guidance can shape how a helper reads and writes; it can't change what the helper returns or its format.

| Block | The helper | What guidance helps it |
|---|---|---|
| `RPEngine · interpret` | Reads your typed message and picks the engine action it describes | Who "I" and "you" are in your preset's messages, how actions are marked (*asterisks*, brackets), what is only speech |
| `RPEngine · extract` | Reads the narrator's reply for what changed: money, places, time, things, who learned what | How the narrator writes: person and tense, tags or trackers it adds, what it tells that doesn't happen (dreams, plans, offers) |
| `RPEngine · brief` | Briefs the narrator in a few sentences before the reply | What your preset wants stressed, and what to leave to the narrator |
| `RPEngine · outline` | Outlines the reply in a few beats | How your preset paces a reply and how much happens in one |
| `RPEngine · choices` | Suggests what you could do next | Tone, length and person of the suggestions |
| `RPEngine · npc.choose` | Picks what people do on close calls | How your preset's characters behave: how bold or kind, what they never do |
| `RPEngine · judge` | Rates how well your described approach suits an action | How generous to be, and what a good plan looks like in your genre |
| `RPEngine · puzzle.answer` | Judges whether a typed answer matches a puzzle's | How loose to be about wording and spelling |
| `RPEngine · mind` | Thinks as one character at a time, from only what that character knows, and gives the narrator their mind | How your preset's characters think: how candid or scheming, how far ahead they plan |
| `RPEngine · memory` | Writes down, as each character present, what they'll remember of the reply: notes, promises and debts, plans | What your preset's characters hold on to: slights, kindnesses, money, promises |
| `RPEngine · skip` | Finds the moments worth stopping at inside a time skip | How often your preset wants a skip interrupted |
| `RPEngine · consolidate` | Folds a character's older notes into their summary | What a summary should keep in your preset's story |
| `RPEngine · knowledge` | Works out after each reply who learned what, what they worked out and what they now doubt | How your preset's people take things in: how quickly they guess, how readily they believe what they're told |

**On a chat that plays agents** (GM → This chat → Engine), the same blocks guide the roles that stand in for those helpers, until the classic steps are removed: each role gets the blocks of the steps it does, each under its step's name, after its own instructions, in this order: the intent, `interpret`, `judge` and `puzzle.answer`; the minds, `mind`; the knowledge step, `knowledge`; the director, `brief`, `outline`, `choices` and `npc.choose`; the read, `extract`; the memory, `memory` and `consolidate`; the skip, `skip`. The scene and the world's steps have no block of their own. A role set to **prompt-only** (Settings → Agents → Roles) is its classic step's own call, and reads its block as that helper does. How a role is told them is the **Every role** page's text on Settings → Agents → Prompts.

How the engine reads a guidance block:

- **It stays switched off.** A switched-on block of that name goes to the narrator in every chat, like any block, so the engine doesn't read it; Settings → Preset says so.
- **Lines starting with `//` are notes** for you, and the engine skips them. The blocks **Add RPEngine blocks** makes hold only such notes, so they do nothing until you write below them.
- **No macro runs in it.** The engine reads the text as written and never resolves a Lumiverse macro in it: `{{char}}` reaches the helper as look-alike braces, not as a name.
- **It is kept short.** The engine reads the first 1,500 characters (after the notes), cut at a word.
- **The first block of a name counts**, and the name is matched without regard to case or extra spaces.
- **An `RPEngine · contradiction` block is no longer read.** An earlier version checked each reply against the engine's facts; what a reply narrates is the story now, so the check is gone. Delete the block, or leave it switched off.

## The narrator block

In world chats every reply gets narrator rules from the engine, as a short "[Narrator rules]" section before the character, or exactly where an enabled block holds `{{outlet::lre_narrator}}`. They give the order of authority first, as the top rule: the player's own instructions first (what they say out of character, and what they write their character does; an attempt the engine rolled for goes as the roll says), then what the story has already established, then the engine's sections, the world as it stands, to follow unless the player directs otherwise; and people, places and things the story brings in become part of the world. Then, under that order, comes what marked facts mean: a fact marked "[unknown to you; known to …]" or "[unknown to you; GM only]" is one the player character doesn't know, and the mark says who does; every character stays consistent with what they know, so no one says, acts on or is narrated as knowing a fact they don't until the story reveals it to them or the player's own instructions make it known; unless the player's own instructions say otherwise, a marked fact isn't told in the narration or revealed by the reply, but comes out only through what the story has already established or what the player character does or finds; and marked facts are for steering the story and the people who know them. The rules are in the same words in every world and on every turn.

A switched-off **RPEngine · narrator** block adds your preset's own rules after them, marked as the player's, in world chats only, so a preset used for other chats too can carry rules about the engine's sections without them showing up elsewhere. It doesn't count against the section budget, and the same reading rules apply: notes skipped, no macros run, 1,500 characters at most.

Good narrator rules are about using the sections: what to show of them, what to stress, what to leave in the background. The order of authority and what marked facts mean come first in every world chat, so your rules don't need to repeat them.

## Examples

A preset that keeps the engine's facts together near the end of the prompt, in its own words:

```
[Block "World state", enabled, after chat history]
The world as it stands this turn, from LumiRPEngine.
{{outlet::lre_outcome}}
{{outlet::lre_scene}}
{{outlet::lre_people}}
```

Outcome, Scene and People go there; every other section stays where the world places it.

Guidance for a second-person preset whose narrator ends each reply with a status line:

```
[Block "RPEngine · extract", switched off]
// LumiRPEngine reads this block while it stays switched off …
The narrator writes in second person: "you" is the player character.
Each reply ends with a line like "HP 12/14 · Gold 30". It repeats the state; it is not a change.
```

Narrator rules for world chats:

```
[Block "RPEngine · narrator", switched off]
Open on the place and the time the Scene section gives, in a sentence or two.
Show the Outcome through what the people there do and say, not as a list.
Leave Gear and Money in the background unless the reply turns on them.
```

## With world step templates and Build → Sections

- **Step templates** (Build → Step templates) are the world's: they say what a helper is asked. Guidance is the preset's: it is added after the template, or after the built-in prompt when the world has none, so a world and a preset each keep their part. A world written for many presets keeps its templates neutral; a preset adds how its own narrator writes.
- **Sections** (Build → Sections) say what each section holds and where the world places it. A preset's outlet moves a section only while that preset is active, and only where the preset holds its outlet; switch presets and the world's placement is back on the next generation.
- **Hidden JSON blocks.** If your preset asks replies to end with a `<json>…</json>` block, world chats keep it out of World Info scanning and hide it in the chat (Settings → Preset → Hide JSON blocks in world chats turns the hiding off), and the engine's helpers read the reply without it. Your preset's own regex scripts read each reply as the AI wrote it: the wrapper that keeps the block from World Info goes on after them when a reply is saved and comes off before them on display and in the prompt, and the hiding comes after them. So a display script that draws the block as a tracker keeps its tracker, and a prompt script that strips old blocks from the history still finds them. The block stays exactly as written, so `{{jsonBlock}}` still reads it.
