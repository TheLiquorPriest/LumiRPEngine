# LumiRPEngine

Persistent world simulation for [Lumiverse](https://github.com/prolix-oc/Lumiverse).

I built LumiRPEngine because long roleplay chats forget things. Who owes whom money, how much fuel is left in the truck, what an NPC did last night while you were somewhere else: a chat history is a poor place to keep any of that. LumiRPEngine keeps a real world underneath your chat (places, people, belongings, money, vehicles, schedules, quests and the calendar) and settles the things that should be settled by rules, like prices, travel times and dice odds, so the AI model can spend its effort on writing. You and the story always win: your own instructions come first, then what the story has narrated, and the engine's world follows both.

You choose how deep it goes. On the lowest setting it is a light layer that tracks where you are, what time it is and what you are carrying. On the highest it runs payroll with withholding, credit card statements, fuel and maintenance, and whole days of NPC life, while you are chatting.

Since November 2026 a world chat can be played by an **AI author**. On the harness engine nothing about a turn is fixed in code: the author reads what it needs of the world, has each person present think for themselves, plays what needs a roll through the rules, moves people and things, lets time pass, and briefs your model, which writes the reply under your preset as before. LumiRPEngine supplies the tools and the rules. The agents run in [LumiAH](https://github.com/TheLiquorPriest/LumiAH), which is built in, so there is nothing else to install. A chat new to its world plays this way from its first turn. The two earlier engines are still there, chosen per chat, for any chat that prefers them.

## What you get

- **An AI author that runs the game.** On the harness engine the author plays each turn with the engine's own tools, and hands work to other agents when a turn needs them: a **character** agent for each person who has to think, who is given only what that person perceives and knows; a **game master** who rules on what the rules don't settle; a **knowledge** agent who works out who learned what; a **chronicler** who holds each reply to its turn, recording what the reply added and marking where it says otherwise. Together they can do what a human GM does in the GM and Build pages: make a person whole (sheet, place, belongings, a mind), make items and places, lay paths and maps into the world, run a fight, write lore. Every change goes through the engine's own rules and through the modes you set (Auto, Confirm on the review card, or Never). The author decides and you review after: a change it makes to the world you authored is listed on the reply, with Undo. [The harness engine](docs/HARNESS.md) explains a turn; [the tools](docs/harness-tools.md) lists every surface and the tool for it.
- **A world you can build.** Kinds with typed fields and derived values, entities and relationships, places, routes and grids, inventories and ownership, character sheets. A schema-driven editor for all of it, and three starter worlds to begin from: Brindlemere (a fantasy town), Harrowmere Hall (a mystery manor) and Port Alder (a modern slice-of-life town).
- **Deterministic actions.** Go places, take, give, wear, use, eat, rest, sleep, buy, pay, drive, lend, let time pass and more. Checks use dice with exact odds, shown before you choose, and the result is decided before the narrator writes a word. How much the dice decide is up to the world and to you: every check, only risky ones or only marked ones; how much your described approach counts; and whether the roll or the story settles it.
- **Ready-made rulesets.** Start a world's ruleset from a profile: Modern, Classic or Fifth, three takes on d20 play, each with abilities, skills, saves, HP, levels from XP, a character sheet and combat; or Custom, the least to grow from (one stat, one check, an HP pool, a plain attack and a single level). All of it is editable data. The profiles are original implementations of common tabletop mechanics, with no rules text.
- **NPCs that live.** Schedules and agendas for everyone, day planning and needs for the people who matter, and encounters between NPCs, on screen and off. The AI is consulted only on close calls.
- **Quests, puzzles, secrets and triggers.** Stages, objectives, hints and rules. Secrets stay out of what you see until they are revealed, and the narrator gets only how the people who keep them behave ("evasive about the cellar"), never the secrets themselves.
- **Context control.** The engine writes the established facts into the prompt as short sections, and an inspector shows each section, its size and whether it reached the prompt. LumiRPEngine doesn't select your World Info, and writes into it only when you press for it in Build: it works as usual in world chats, and a secret you mark in an entry's own text (`{{// Secret (known to Marcus Delgado): …}}`) reaches the narrator marked as a secret, while Lumiverse leaves it out everywhere else. The engine's own helpers read the world's lore instead, each step finding what it needs, and a secret entry reaches only the helpers you pick.
- **Realism you can dial.** Money, gear, vehicles, cast life, relationships, space and travel, calendar and time, weather, and character sheets each have their own level. Story, Grounded and Simulation presets set them all at once. Modern US defaults (approximate 2025–26 prices, pay, taxes and rents) are included and editable.
- **Time on your terms.** A tick for each kind of scene, a time scale, a pause button, and Timelapse, Speed through and Montage for skipping ahead without losing what happens along the way.
- **Your choice of model use.** Lean, Standard, Full or your own mix, with each step on the connection you pick, when it runs, a call budget for each phase of a turn, and a call meter that shows what each turn cost.
- **Safe with swipes, edits and branches.** Every reply carries its own record of what happened. Swiping, editing or branching never corrupts the world, and when an earlier change affects later turns you get a report and a choice.
- **Made for small screens too.** A drawer tab, a status pill, chips for what changed, an action palette in the input bar, and a fullscreen map.
- **Portable worlds.** Worlds export to a published, versioned file format with their own lore inside, and a world you import lists any macros in its lore and templates for your review.

The full walkthrough is in the [user guide](docs/USER-GUIDE.md).

## Documentation

- **[User guide](docs/USER-GUIDE.md):** playing, tuning and building, every button explained.
- **[Presets and RPEngine](docs/PRESETS.md):** for preset authors: the section outlets, placement precedence, guidance blocks for the engine's helpers and the narrator, with examples.
- **[GM guide](docs/GM-GUIDE.md):** running a chat: who sees what, the GM view and its edits, fixes and Undo, checks, realism and time in one chat, Upgrade, and the Context inspector.
- **[The harness engine](docs/HARNESS.md):** the engine where an AI author plays each turn: what happens in a turn, who the agents are, what you can change, and how the code is laid out.
- **[The harness tools](docs/harness-tools.md):** every GM surface and the tool that gives it to an agent, with each tool's tier, checked by a test.
- **[Recipes](docs/RECIPES.md):** small worlds that each show one thing working, from XP and levels to a family's schedule, every one checked by a test.
- **[Expressions](docs/EXPRESSIONS.md):** the formula language for requirements, checks, derived fields and rules.
- **[Reference](docs/REFERENCE.md):** every kind, field, effect, formula function, action, event and lint code the engine and its packs register, generated from the code (`bun run reference`).
- **[Design](docs/DESIGN.md)** and **[Architecture](docs/ARCHITECTURE.md):** how the engine works and why, and the contract between its modules.
- **[Roadmap](docs/ROADMAP.md):** the October 2026 review: what it found, the decisions made, and the order of the fixes and the work after them.

## Install

1. In Lumiverse, open the **Extensions** tab and tap **Add Extension**.
2. Choose **Install from Source**, enter `https://github.com/TheLiquorPriest/LumiRPEngine` as the GitHub repo URL (the branch is optional), and tap **Install**.
3. Review the permissions below, switch them on under **Permissions** (or tap **Enable All**), and enable the extension.

LumiRPEngine requires **Lumiverse's `staging` branch from 16 October 2026 (commit `9cc9f5d`) or later**.

## Permissions

LumiRPEngine asks for sixteen permissions. Here is why each one is there:

- `generation`: to follow each reply from start to finish, to stop a reply the engine hasn't prepared yet so the engine can run first, and to make its own small helper calls.
- `context_handler`: to check, just before each reply, that the engine has prepared it (the turn's plan, and the world's sections in the prompt), and stop it when it hasn't.
- `chats`: to read and update a chat's metadata, where a world chat records the world it plays and lists the world's lore book (attaching a world writes both), and to know which chat is open.
- `chat_mutation`: to read each chat's messages and swipes, so the world stays in step with every swipe, edit and branch; to save the world's record on each reply; and to add your palette, chip and map actions to the chat as messages.
- `world_books`: to create and maintain the world's own lore book, which holds its sections, and attach it to the chat; to read your World Info books as lore, live, and the ones you pick for **Import from lore**; and to write into one of your books only when you press for it in **Build → Lore** (a secret line or an entry's own fields, or **Build an index entry**, which it then keeps in sync until you stop it in **Settings → Lore**).
- `presets`: to read your active preset, so it can check where the world's sections will land in the prompt, warn you about settings that cause trouble, place sections where the preset's `{{outlet::lre_…}}` macros ask and pass its RPEngine blocks to the engine's helpers; and, when you ask in **Settings → Preset**, to add those blocks to it.
- `regex_scripts`: to keep the JSON blocks some presets ask replies to carry out of World Info scanning and hide them in world chats, with two regex scripts in each world chat and two global ones that take the engine's wrapper off again before your own scripts read a reply. **Settings → Preset** turns the hiding off.
- `decisions`: to use Lumiverse's Decisions API for the probability questions the engine asks, such as what an NPC does on a close call.
- `ui_panels`: for the status pill, the map and the action palette with its Timelapse tab, which float over the chat. The drawer tab needs no permission.
- `mcp_servers` (optional; only an owner or admin can switch it on): if Lumiverse runs LumiRPEngine's MCP server itself, to check that Lumiverse's own MCP client has the new tools after an update, for **Reconnect in Lumiverse**. It reads which of your Lumiverse MCP servers hold LumiRPEngine's tools and nothing else of them, and never adds, changes, connects or disconnects one. Without it, Reconnect in Lumiverse still works and goes by what the server says. On a Harness chat it also lets the agents call the tools of the MCP servers you switched on for them (the drawer's **Harness** tab → **Tools**); none is on until you switch it on.
- `interceptor`: to let the Harness engine's author work on a reply before it is written. On a chat you switch to **Harness** (**GM → This chat → Engine**), Lumiverse waits, for up to five minutes, while the author plays the turn, then sends the prompt with the author's brief in it. Chats on the other engines don't use it.
- `embeddings` (optional): on a Harness chat, so the agents' searches of the chat and its lore can match by meaning as well as by word, where you have an embedding connection. Without it they search by word, and say so.
- `memories` (optional): on a Harness chat, so the agents can search what Lumiverse's own memory keeps of the chat, where you have that on. Without it they aren't offered that search.
- `databanks` (optional): on a Harness chat, so the agents can list, search and read the databanks that apply to the chat. It only reads them. Without it they aren't offered those tools.
- `web_search` (optional): on a Harness chat, so the agents can search the web through the search provider you set up in Lumiverse. Without it, or with no provider, they aren't offered it.
- `generation_parameters` (optional): only for a Harness chat you choose to run in a runtime, a program you start beside Lumiverse for turns that need longer than Lumiverse waits before a reply. It lets the extension mark that chat's request so the runtime finds it. A chat that runs built in, which is how every chat starts, never uses it.

LumiRPEngine deliberately does **not** request the `characters` permission. Character cards stay out of its reach. To know whether the world's sections really reached a reply's prompt, it reads which of its entries Lumiverse activated for that reply, and a section whose entry didn't activate shows as "not delivered".

## Quick start

1. Open the **LumiRPEngine** tab in the drawer and go to **Build**.
2. Tap **New world**, pick a **Template** (fantasy town, mystery manor or modern slice-of-life) or **Blank**, name it and tap **Create world**. To build from your existing lore books instead, create a Blank world and use its **Import from lore** tool.
3. Attach the world to a chat with the world's **Attach to this chat** tool (or, in **Play**, **Attach a world to this chat…**). LumiRPEngine creates a lore book for the world's sections and adds it to that chat.
4. Go to **Play** and write. Blank worlds start on the **Story** preset, which keeps things light, as does the fantasy town; the mystery manor starts on **Grounded** and the modern slice-of-life on **Simulation**. Change the realism whenever you like in **Settings → Realism**. A new world chat plays on the harness engine with nothing more to set up: the author works on the chat's own connection before each reply, for up to five minutes, and the drawer's Harness tab shows what it is doing. To play a chat on the classic steps or on agents instead, choose it in **GM → This chat → Engine**.

## Your own agent: the CLI and MCP server

`lumirpengine` lets your own agent (Claude Code, Codex, Cursor and the like) or your shell manage your worlds on your Lumiverse: read, search, create, import, edit, check, playtest, commit, restore, delete and export them, and attach and upgrade the chats that play them. It runs on Bun 1.4 or newer or on Node 22 or newer, with the engine bundled in, so checking and playtesting a world file needs no Lumiverse at all. Install it, sign in once in a terminal (the password is asked at a hidden prompt and never stored), then add the MCP server to your harness:

```bash
npm i -g github:TheLiquorPriest/LumiRPEngine
lumirpengine login --url http://localhost:7860 --username you
claude mcp add lumirpengine -- lumirpengine mcp
```

The install downloads about 14 MB from GitHub; add `#<tag or commit>` after the repo name to pin a version. Installed, the server starts in a fraction of a second. `npx -y github:TheLiquorPriest/LumiRPEngine <command>` works without installing, but takes about 7 to 9 s to start the server, too slow for some harnesses' start-up timeouts unless they are raised (MCP.md shows Codex's). npm and npx need Node; on a machine with only Bun, such as one that only runs Lumiverse, give your harness the extension's own copy instead, `bun <Lumiverse data>/extensions/lumi_rp_engine/repo/dist/lumirpengine.js mcp`, as LumiRPEngine's Settings → MCP server shows it. An agent edits the same draft as your Build tab, so you see its changes as it makes them, and a Commit in Build commits its unfinished work too. `--read-only` keeps the MCP server to reading and checking, but an agent with a shell can still run `lumirpengine` without it. Plain `http` to another machine sends your password and session token in clear, so `login` asks for `--allow-http` first. To cut an agent off, run `lumirpengine logout` on its machine or stop its harness: a running server goes on working after its session is ended any other way. Setup for other harnesses, every tool, safety and troubleshooting are in [MCP.md](docs/MCP.md), and agents read [AGENT-GUIDE.md](docs/AGENT-GUIDE.md).

## Things to know before you install

These are the known limits of this release. Most of them need a change in Lumiverse itself, which I plan to propose after release.

- **Prompt assembly moves to the main process, for everyone.** While LumiRPEngine is enabled, Lumiverse builds prompts for all users on the host on its main process instead of a separate worker. On the live host, with a 1,000-message chat, that added about 23 ms per prompt build (122 ms with LumiRPEngine enabled against 99 ms without). On a shared host, tell the people you share it with.
- **Other extensions that write message metadata.** Lumiverse replaces a message's whole metadata when something saves it, so another extension can overwrite LumiRPEngine's records and LumiRPEngine can overwrite theirs. LumiRPEngine keeps a second copy of its records and restores them, but I cannot promise the other extension does the same.
- **Other extensions' World Info interceptors** can switch the world's sections off for a reply; the Context panel then shows them as not delivered. Everything they do to your own lore books works as usual.
- **If the engine stalls or one of its steps fails,** nothing is generated: the chat says which step failed and why, with a **Retry**.
- **Replies for an earlier message.** Lumiverse can start only the last reply again, so in a world chat an in-place **Edit and Send** on an earlier message, or a swipe of an older reply asked through Lumiverse's API, is stopped with a card that says so, and nothing is written. Edit and Send as a branch works.
- **Delivery is checked, not traced.** The engine confirms that its sections were activated for the reply, but not where in the prompt each one landed.
- **Text and world can disagree after some edits and Continues.** When you edit a reply, or continue one in a way the engine cannot read as part of a turn (a continue on an older message, a stopped continue, or a continue where Lumiverse rewrote the earlier text), the world stays as it was simulated until you use **Re-read edit**.
- **Detail opened while a reply streams** shows as "pending" until the reply finishes, and anything you change in that moment lands right after it.
- **Continue shows the world as it was before the reply.** The engine learns which message you are continuing only when the reply ends.
- **Changes made on another branch** stay stored but have no effect until you switch back to that branch. The Keep report lists them as "made on another branch". Deleting a message also drops the other-branch changes attached to it.
- **A rare overlap case.** If another extension writes to a reply while it is still streaming, an edit you make to your own message right afterwards can be mistaken for Lumiverse's own re-render and will not pause the chat.
- **Rare overlapping turns** fall back to planning from the last saved state.
- **Worlds from other people can carry macros.** A world file's lore and templates may contain Lumiverse macros (`{{…}}`), which Lumiverse runs when it builds a prompt, as in any World Book. Lumiverse's macro engine also acts on control characters (it turns some of them back into braces on a later pass) and on the `<user>`, `<char>` and `<bot>` shorthands. LumiRPEngine keeps authored text as written. Everything it inserts itself (a name, a price, what a model said) has its braces swapped for look-alikes, its control characters dropped and its `<user>`-style shorthands broken, so a value can never form a macro however many times Lumiverse processes it. It lists all of these in an imported world for you to review before you play it.
- **On the harness engine a reply starts later,** because the author works first. The Harness tab shows the work and how long it may take at most. Skipping it sends the prompt on with the world as it stood, and the reply is marked "No turn was played".
- **A path, a map or a place of the world's own that the author makes is played from the next turn.** Those live in the world's document. As shipped the author commits them with its turn, and the reply lists what changed, with Undo. If the world's draft holds your own unfinished Build edits, the commit waits on the review card for your Apply instead. People, things and places made in play are there at once.
- **The reply serves the turn.** On a harness chat the author decides what happens before the reply is written. After the reply the chronicler checks it against the turn. What the reply added is recorded under your change modes. Where the reply says otherwise, the world stands: the reply is marked "The reply doesn't match the world" with what differs, and the next turn's author is told. Nothing rewrites the reply; Regenerate plays the turn again.
- **If you direct the story instead of playing a character,** set Sovereign Hand to On for harness chats (**GM → This chat → Engine**). The author then reads your message as a direction from outside the story, not as your character's words, and the agents' history tools read only the replies. Lumiverse doesn't yet tell extensions whether its own Sovereign Hand switch is on, so Follow Lumiverse can't see it.
- **On a harness chat the engine reads no reply itself,** so Re-read edit, Retry read and Swipe as… aren't offered. A swipe or a Regenerate plays the turn afresh.
- **The harness engine is new.** It is covered by tests and was read by an independent reviewer, whose serious findings were fixed. It has not had the months of play the classic steps have, and the fixes have not had a second review. Sovereign Hand, the check of the reply against its turn, and Undo of an author's change to the world's document are newer still and have had no independent review. A chat can be switched to another engine between turns.

## Tests

The suite runs on Bun (`bun install` first). Which run to use when:

| When | Run | What it runs |
|---|---|---|
| During a change | `bun run test` | The test files that cover what changed since your branch left `main`, committed or not. A changed test, the tests named after a changed module and the tests that read a changed doc or template always run; then the tests nearest what changed through their imports, cheapest first, up to about a minute of recorded test time. Usually done in under a minute. |
| Before a commit | `bun run check` | Both typechecks, the checks that `docs/REFERENCE.md` and the starter worlds are current and that the templates validate, then `bun run test`. |
| At release | `bun run test:release` | The release gate: those checks, every test file, and the ledger property suite on its 200 fixed sequences and on 200 fresh ones, in parallel across the cores. About two minutes. |

`bun run test -- --list` prints what it would run and why; `--base <branch or commit>` compares with something other than `main` (`--base HEAD`: only what isn't committed), and `--budget <seconds>` changes the minute. `bun run test:all` runs every test file but the property suite, `bun run test:properties` the property suite alone, and `bun run test <test files>` just those files. Plain `bun test` still runs every file in one process, the property suite's fixed sample whole, in about five minutes.

The release gate prints the fresh sequences' seed base: `LRE_PROPERTY_SEED=<base>-<n> bun test ./test/ledger/properties.test.ts` replays one, and a seed that fails, shrunk, goes into `test/ledger/regressions.json`. `test/timings.json` holds each file's recorded time, for the budget and to start the slowest files first; `bun run test:timings` records it again after a slow test changes.

## Credits

Parts of the engine are adapted from [Warp](https://github.com/japolino/warp) by japolino, used with the author's permission for this non-commercial project. The details, file by file, are in [`NOTICE`](NOTICE).

The harness engine's agents run in [LumiAH](https://github.com/TheLiquorPriest/LumiAH), my own agent harness for Lumiverse (MIT), built into LumiRPEngine as a package.

## License

No license yet; all rights reserved for now.
