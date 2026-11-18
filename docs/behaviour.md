# How behaviour lives in files

Everything that decides how RPE's agents behave is written in plain files. How a turn is run, who writes the reply, when a reminder is owed, what a tool is said to do: each is in a file you can read, copy and change. The code supplies tools, records, dice and arithmetic. It does not decide what an agent does.

So to change what the agents do, change a file. The next turn reads it.

## Where the files are

The files are under `files/` in RPE's data folder (see [Install](install.md#the-data-folder)). You can edit them in any editor, keep them under git, or use the **Files** page.

There are four levels, from far to near:

| Level | Folder | What it is |
|---|---|---|
| Shipped | `files/defaults/` | Every file RPE ships. Read-only, and laid out again at every start, so an update's defaults arrive by themselves. Read and copy from it. |
| Yours | `files/` | Your own files for every chat. |
| A character's | `files/chats/<character>/` | Your files for every chat with one character or group: `AGENTS.md`, `agents/`, `rules/`, `skills/`. |
| A chat's | `files/chats/<character>/<chat>/` | Your files for one chat, and its config file `RPE.yml`. |

The shipped files come from this repository's `guidance/` folder. The instruction files in `guidance/chat-defaults/` are laid at the root of `files/defaults/`, beside `ALL-AGENTS.md`.

**A file at a nearer level replaces the file of the same name at a farther one.** Your `files/.rules/consent.md` replaces the shipped one, and a chat's `rules/consent.md` replaces yours for that chat. The one exception is `AGENTS.md`: a character's and a chat's both apply (the `stack.layered` list in `guidance/RPE-global.yml`).

**A shipped file can be switched off** without replacing it: name it in the `stack.off` list of your `files/RPE-global.yml`, or of a chat's `RPE.yml`. An instruction file is named by its own name (`WORLD`); anything else by its folder and name (`rules/perceptions-owed`). "Delete" on a shipped file in the Files page writes that entry for you.

When an update changes a shipped file you have replaced, your file is kept. The Files page says the default changed and shows the difference.

## The kinds of file

### Instruction files

Plain markdown, with no header. Each agent reads the ones its definition names, in this order, general first:

1. `ALL-AGENTS.md`: for every agent. ([shipped](../guidance/ALL-AGENTS.md))
2. The rules that are always on (see below).
3. `AGENTS.md`: the character's, then the chat's. None ships; write one to speak to every agent of one character or chat.
4. `WORLD.md`, `SIMULATION.md` and `WRITING.md`: this story's world, how its game side is run, and how its reply is written.
5. The agent's own definition.
6. `TURN.md` and `PRESET.md`: how a turn is run, and how the preset's prompt is used. As shipped, the Author reads both every turn.
7. For the turn at hand: `SWIPE.md` on a swipe or a regenerate, `DELETE.md` when turns were deleted since the last one. They are read with `TURN.md`, not in place of it. Which kind of turn adds which file is the `stack.added` list in `guidance/RPE-global.yml`.

The turn's process is written in `TURN.md` ([shipped](../guidance/chat-defaults/TURN.md)). Change it and the turn runs differently.

### Rules

A rule is a file in `.rules/` (yours and the shipped ones) or `rules/` (a character's or a chat's), with a header and a text. A rule is one of two kinds:

- **Always on.** Its text is part of the instructions of the agents its header names (`agents:`). The shipped `guidance/.rules/consent.md` and `guidance/.rules/perceptions.md` are of this kind.
- **Triggered.** Its header adds a condition. It costs nothing until the condition holds; then its text is put in front of the agent. A condition is a moment (`at:`, such as the end of a run), alone or with a fact drawn from the records (`fact:`); a pattern in what the agent writes (`condition:`); a yes-or-no question a small model answers (`question:`); or a count of turns (`every:`). `repeat:` says how often it may fire, once per turn unless it says otherwise. `needs:` ties it to another file: while that file is off, so is the rule.

A fact is a plain count from the records, such as who was on stage this turn and has no perception recorded. It takes no side. The rule's header says what counts.

Shipped rules in force:

| Rule | What it does |
|---|---|
| `guidance/.rules/consent.md` | No agent improvises without the Author's consent, and only where no lore or continuity covers the gap. |
| `guidance/.rules/perceptions.md` | Why perceptions matter, who gets one, what goes in it, and when it is written. |
| `guidance/.rules/perceptions-owed.md` | Reminds the Author when someone on stage has no perception for this turn. |
| `guidance/.rules/perceptions-missing.md` | Tells the Author at a turn's start when someone on stage in an earlier turn has no perception for it. |
| `guidance/.rules/engine-silent.md` | Notices when nothing has been recorded in the engine lane for a while. |
| `guidance/.rules/history-leaving.md` | Warns the Author when messages are about to leave the prompt and the story record does not cover them. |
| `guidance/.rules/unsourced.md` | Points out a write that named no source. |
| `guidance/.rules/reply-missing.md` | Catches a turn that is about to end without a reply. |
| `guidance/.rules/save-before-compaction.md` | Gives the Author one call to save what matters before a session's earlier turns are summarized. |

Examples to copy from are in `guidance/.rules/examples/`. Nothing there is in force: `no-player-voice`, `banned-phrases`, `memory-nudge`, `scene-too-long`, and three the build added, `intent-missing` (the last reply went out with no intent record before it), `turn-unrecorded` (a turn is about to end with nothing recorded) and `limits-left` (the Author is about to end its run with two or fewer calls or tool rounds left; it names the fact `limits.left`). `TURN.md` is the one home of the first two behaviours.

### Skills

A skill is a folder in `.skills/` with a `SKILL.md`: a name, a description, and a body. Every agent that holds `skill_load` is shown the list of skills in force, each by its name and description: the lead at the end of its opening block, any other agent at the end of its instructions. A skill switched off is not listed, and one replaced at a nearer level is listed as that file has it. When the list changes during a session, the next briefing says so and gives the list as it stands. The list is laid out by `files/defaults/.prompts/skills.md`, which is the harness's own; take it out and no list is given. An agent loads a skill's body when it needs it (`skill_load`). As shipped, the Author, the game master, a character and the assistant hold `skill_load`. The shipped skills cover combat, time, economy, places and maps, quests, casting and more: see `guidance/.skills/`. For example, `guidance/.skills/time/SKILL.md` says how to let time pass.

### Agent definitions

Each agent is a file in `.agents/` (yours and the shipped ones) or `agents/` (a character's or a chat's). Its header says:

- `model`: the connection it uses, by name, or `default`;
- `effort`: how hard its model thinks;
- `tools`: the tools it holds; with `tool_search` and `tool_use` it can reach the rest;
- `reads`: which instruction files it reads;
- `given`: what it is handed at the start of a run (the prompt or parts of it, the briefing, ranges of the chat, views of the world and of its character). The lead's names are found the same way a sub-agent's are, and laid out after its briefing by `files/defaults/.prompts/given.md`; a name nothing could be found for gets one line saying so;
- `limits`: what it may spend, as `limits: { toolRounds: 12, calls: 12 }`, with any of `calls`, `toolRounds` (answers that call tools), `toolsPerAnswer`, `toolsAtOnce`, `messages` (a sub-agent's, after its first answer), `tokensIn`, `tokensOut`, `time`, `callTokensIn`, `callTokensOut` and `callTime` (times in seconds). No shipped agent sets one but the narrator, which makes one call, because that is what a narrator is: no agent's work is cut short unless you set a limit. Each limit, and the effort, is a setting of the agent's too, set on the Agents page for every chat or for one: `agents.<definition>.effort` and `agents.<definition>.limits.<limit>`, with `seconds` and `callSeconds` for `time` and `callTime`. A value set there stands over the header's, and `~` lifts the header's limit.

Its text is its instructions. The shipped agents are the Author, who leads (`guidance/.agents/author.md`); the game master (`guidance/.agents/gm.md`); a character, one run per principal character (`guidance/.agents/character.md`); the narrator (`guidance/.agents/narrator.md`); the keeper, for bookkeeping after the reply (`guidance/.agents/keeper.md`); the historian, the indexer and the mapper, which the Author starts as jobs; and the assistant (`guidance/.agents/assistant.md`), for talking with outside the story, which comes with a later build: nothing starts it yet. The indexing job is meant for a small model: the indexer's `model:` is `default`, and naming your smaller connection there runs it on that. The agent that leads a turn is the setting `turn.lead`.

Build's five model jobs run as agents of their own: Import from lore (`guidance/.agents/build-import-lore.md`), Index this text (`build-index-text.md`), Refine with AI (`build-refine.md`), Describe a map (`build-describe-map.md`) and Propose routines (`build-propose-routines.md`). Each holds the world's reads and `world_propose` and no tool that writes: it proposes, and you apply what you want in Build. The brief each is started with is a line of `guidance/.prompts/build-jobs.md`.

### Tool descriptions

What each tool is said to do, and what each of its arguments means, is a file in `.tools/`, named after the tool. For example `guidance/.tools/roll.md`. Replace one to change how a tool is described to the agents. [The engine's operations](operations.md) lists them all. A file named after a family of tools (`guidance/.tools/things.md`, `world.md`, `cast.md`) is that family's guide: how its tools are called, with a worked call. An agent is given it beside the tools of that family it holds, or when `tool_search` finds them; delete it and none is given.

### Prompt parts

The files in `.prompts/` lay out what the agents are given, and word what RPE answers. They lay facts out; they ask for no behaviour. Replace one, as any shipped file, to change it. Among them:

| File | What it holds |
|---|---|
| `guidance/.prompts/briefing.md` | The briefing the Author is given at the start of every turn. Take a part out of its layout and it is no longer shown. Its header's `on_stage_views` names which views of the characters on stage it shows (see the fourth example below). |
| `guidance/.prompts/world-state.md` | The world state, and the words of each line of the world's tree. |
| `guidance/.prompts/reply-contract.md` | How a reply and an intent record are marked, and what ends a run. |
| `guidance/.prompts/delegate-brief.md` | The frame around every brief a sub-agent is sent. |
| `guidance/.prompts/compaction.md` | What a summary of a session's earlier turns keeps and drops. |
| `guidance/.prompts/notices.md` | Every notice an agent can be shown. |
| `guidance/.prompts/engine-answers.md`, `guidance/.prompts/cast-answers.md`, `guidance/.prompts/story-answers.md`, `guidance/.prompts/lore-answers.md`, `guidance/.prompts/map-answers.md` | The sentences the engine's, the cast's, the story record's, the lore's and the map's tools answer agents with. The Cast and Story pages answer you in the words of the cast's and the story's files too. |
| `guidance/.prompts/reply-errors.md` | The plain line the chat shows when a turn ends without a reply. Where the turn had already shown its progress in the message's thinking block, the line goes there too, so that the message Lumiverse keeps says why. |
| `guidance/.prompts/turn-errors.md` | The words a turn gives when it cannot be played, when it is stopped, when an agent's read of Lumiverse cannot be made, and when a Settle now is refused. |
| `guidance/.prompts/play-answers.md` | What the Play page's panels are told when RPE does not do what they asked, or leaves something as it was. |
| `guidance/.prompts/build-jobs.md` | The words of Build's model jobs: the brief each job's agent is started with, what it is told of each proposal it makes, and how a job that was refused, stopped at a limit, failed or was cancelled is said. |

A chat with no world plays on a blank world. Its clock starts at a date nobody set, so no date is shown (in the briefing, the world state, the engine's answers, the cast's views and the story record) until a change in the story sets the clock to a date and a time. A span or a time of day only moves the clock, and until it is set the engine's answers give a time as how long from now. Memories are still timed, and fade all the same. The time skill tells the agents how a date is set.

### Notes, and what the agents may write

The agents read your files and never write them. They write their notes in the chat's `persistent-workspace/` folder, and their working files in the turn's folder. Notes follow the turn: a swipe or a deleted turn takes back that turn's notes, and your own edits to notes are kept. When an agent thinks one of your files should change, it files a suggestion, which you accept, edit or dismiss on the Files page.

## Four examples

### Hand the prose to the narrator

As shipped, the Author writes the reply itself, and hands the prose to the narrator only when this chat's notes on writing ask for a separate voice, or when the turn's working has grown large. That is written in `WRITING.md` ([shipped](../guidance/chat-defaults/WRITING.md)), under "When to hand it to the narrator".

To have the narrator write every reply of one chat:

1. Copy `files/defaults/WRITING.md` into the chat's folder, `files/chats/<character>/<chat>/WRITING.md`.
2. Under "This chat's notes on writing", write: "Use a separate voice for the prose: hand every reply to the narrator."

For every chat, put the copy in `files/` instead, or change the list under "When to hand it to the narrator" itself.

To give the narrator another model, copy `files/defaults/.agents/narrator.md` to `files/.agents/narrator.md` and set its `model:` to the name of one of your connections.

### Change when perceptions are owed

After a turn, the Author is reminded of each principal and supporting character who was on stage and has no perception recorded. The reminder is the rule `perceptions-owed` ([shipped](../guidance/.rules/perceptions-owed.md)). Its header holds the condition:

```
fact: stage.unperceived(principal, supporting) > 0
```

To be reminded only for principal characters, copy it to `files/.rules/perceptions-owed.md` and change that line to:

```
fact: stage.unperceived(principal) > 0
```

The same goes for `perceptions-missing.md`, which reminds at the next turn's start. Who is owed a perception at all is written in the rule `perceptions` ([shipped](../guidance/.rules/perceptions.md)), under "For whom": change that, and the agents write them for whom you say.

### Switch off a shipped rule

The rule `engine-silent` notices when nothing has been recorded in the engine lane for a while. To switch it off for every chat, add it to the `stack.off` list of your `files/RPE-global.yml`:

```yaml
stack:
  off: [rules/engine-silent]
```

For one chat only, put the same line in that chat's `RPE.yml`. Take the name out of the list to switch it on again. A rule tied to a file with `needs:` goes off with that file: switch off `rules/perceptions` and `perceptions-owed` and `perceptions-missing` go off with it.

### Change what the Author is shown of the characters on stage

At the start of every turn, the Author's briefing has an **On stage** part: views of the characters on stage, from the cast's records. Which views, of which characters, is the `on_stage_views` list in the header of `briefing.md` ([shipped](../guidance/.prompts/briefing.md)):

```
on_stage_views:
  - history:principal
  - imported:supporting
```

As shipped, that is the history of each principal character on stage, and the old mind files, carried from the previous build and not yet filed, of each supporting one. A name alone (`history`) gives that view of everyone on stage the cast holds; a name and a casting (`history:principal`) gives it of those cast so (`principal`, `supporting` or `extra`).

To be shown the history of supporting characters too, and what is on a principal's mind now, copy `files/defaults/.prompts/briefing.md` to `files/.prompts/briefing.md` and change the list to:

```
on_stage_views:
  - history:principal
  - history:supporting
  - mind:principal
  - imported:supporting
```

The views it can name are the cast's: `base`, `growth`, `mind`, `what-comes-to-mind`, `relationships:present`, `unprocessed-perceptions`, `imported`, `game-side` and `history`, each laid out by its own file in `.prompts/` (`guidance/.prompts/cast-mind.md` for `mind`, and so on). A name that is none of these is passed over. Take a name out and that view is no longer given.
