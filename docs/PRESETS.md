# Presets and RPEngine

This page is for people who write Lumiverse presets and want them to play well with LumiRPEngine. A preset needs nothing special to work in a world chat: the engine puts its sections into the prompt where the world places them. What follows lets a preset place those sections itself, give the engine's helpers style and rules of its own, and give the narrator rules for world chats only. All of it applies while the preset is active, and only in world chats.

The preset that counts is the one prompts assemble with, as far as the engine can tell: the active Loom preset, else the preset the chat's connection links, else the one the last reply was assembled with. A preset bound to a chat, persona or character, and a preset profile's block states, are invisible to the engine; the delivery check (below) catches a section they leave out. **Settings → Preset** shows which preset counts, what of the below it has, and a button that adds the guidance blocks for you.

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
| — | The narrator rules (below) | `{{outlet::lre_narrator}}` |

A world may define sections of its own (Build → Sections); each one's outlet is `lre_` and its id, so a section `weather` goes to `{{outlet::lre_weather}}`. Outlet names are matched without regard to case, as Lumiverse matches them.

Only blocks Lumiverse assembles in every prompt count. A block that is switched off, limited to some generation types (its injection trigger) or to characters with certain tags (its character tag trigger), or a second switched-on block under a radio category (Lumiverse keeps only the first one), places nothing: the section would go missing from the prompts that block isn't in, so the world's placement stands instead. A block Lumiverse leaves out for reasons the engine can't see, such as a preset profile's block states or a prompt-activation regex script, is caught when you open the Context panel: its test prompt build looks for each section the preset placed, and a section it doesn't find goes back to the world's placement until the preset changes.

## Placement precedence

For each section and each generation, the first of these that applies places it:

1. **The preset.** An enabled block of the active preset holds `{{outlet::lre_<slot>}}`.
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
| `RPEngine · contradiction` | Checks the reply against the engine's facts | What the narrator may add without it counting (weather, small talk, thoughts) |
| `RPEngine · puzzle.answer` | Judges whether a typed answer matches a puzzle's | How loose to be about wording and spelling |

How the engine reads a guidance block:

- **It stays switched off.** A switched-on block of that name goes to the narrator in every chat, like any block, so the engine doesn't read it; Settings → Preset says so.
- **Lines starting with `//` are notes** for you, and the engine skips them. The blocks **Add RPEngine blocks** makes hold only such notes, so they do nothing until you write below them.
- **No macro runs in it.** The engine reads the text as written and never resolves a Lumiverse macro in it: `{{char}}` reaches the helper as look-alike braces, not as a name.
- **It is kept short.** The engine reads the first 1,500 characters (after the notes), cut at a word.
- **The first block of a name counts**, and the name is matched without regard to case or extra spaces.

## The narrator block

A switched-off **RPEngine · narrator** block gives the narrator rules in world chats only, so a preset used for other chats too can carry rules about the engine's sections without them showing up elsewhere. The engine puts its text into the prompt as a short "[Narrator rules]" section, before the character, or exactly where an enabled block holds `{{outlet::lre_narrator}}`. It doesn't count against the section budget, and the same reading rules apply: notes skipped, no macros run, 1,500 characters at most.

Good narrator rules are about using the sections: trust the Outcome and narrate the result it states, don't invent prices, purchases or events the sections don't hold, keep to the time the Scene section says passed.

## Examples

A preset that keeps the engine's facts together near the end of the prompt, in its own words:

```
[Block "World state", enabled, after chat history]
Established facts for this turn. Treat them as true.
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
The engine's sections are the facts. Narrate the Outcome's result as stated, never a different one.
Don't name a price the sections don't give.
```

## With world step templates and Build → Sections

- **Step templates** (Build → Step templates) are the world's: they say what a helper is asked. Guidance is the preset's: it is added after the template, or after the built-in prompt when the world has none, so a world and a preset each keep their part. A world written for many presets keeps its templates neutral; a preset adds how its own narrator writes.
- **Sections** (Build → Sections) say what each section holds and where the world places it. A preset's outlet moves a section only while that preset is active, and only where the preset holds its outlet; switch presets and the world's placement is back on the next generation.
- **Hidden JSON blocks.** If your preset asks replies to end with a `<json>…</json>` block, world chats keep it out of World Info scanning and hide it in the chat (Settings → Preset → Hide JSON blocks in world chats turns the hiding off), and the engine's helpers read the reply without it. Your preset's own regex scripts read each reply as the AI wrote it: the wrapper that keeps the block from World Info goes on after them when a reply is saved and comes off before them on display and in the prompt, and the hiding comes after them. So a display script that draws the block as a tracker keeps its tracker, and a prompt script that strips old blocks from the history still finds them. The block stays exactly as written, so `{{jsonBlock}}` still reads it.
