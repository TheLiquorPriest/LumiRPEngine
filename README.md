# LumiRPEngine

Persistent world simulation for [Lumiverse](https://github.com/prolix-oc/Lumiverse).

I built LumiRPEngine because long roleplay chats forget things. Who owes whom money, how much fuel is left in the truck, what an NPC did last night while you were somewhere else: a chat history is a poor place to keep any of that. LumiRPEngine keeps a real world underneath your chat (places, people, belongings, money, vehicles, schedules, quests and the calendar) and settles the things that should be settled by rules, like prices, travel times and dice odds, so the AI model can spend its effort on writing. The model proposes; the engine decides.

You choose how deep it goes. On the lowest setting it is a light layer that tracks where you are, what time it is and what you are carrying. On the highest it runs payroll with withholding, credit card statements, fuel and maintenance, and whole days of NPC life, while you are chatting.

## What you get

- **A world you can build.** Kinds with typed fields and derived values, entities and relationships, places, routes and grids, inventories and ownership, character sheets. A schema-driven editor for all of it, and three starter worlds to begin from: Brindlemere (a fantasy town), Harrowmere Hall (a mystery manor) and Port Alder (a modern slice-of-life town).
- **Deterministic actions.** Move, take, give, buy, pay, drive, lend, wear, sleep, wait and more. Checks use dice with exact odds, shown before you choose, and the result is decided before the narrator writes a word. How much the dice decide is up to the world and to you: every check, only risky ones or only marked ones; how much your described approach counts; and whether the roll or the story settles it.
- **Ready-made rulesets.** Start a world's ruleset from a profile: Modern, Classic or Fifth-style d20 play, or a minimal Custom one, each with abilities, skills, saves, HP, levels from XP, a character sheet and combat, all editable data. The profiles are original implementations of common tabletop mechanics, with no rules text.
- **NPCs that live.** Schedules and agendas for everyone, day planning and needs for the people who matter, and encounters between NPCs, on screen and off. The AI is consulted only on close calls.
- **Quests, puzzles, secrets and triggers.** Stages, objectives, hints and rules. Secrets stay out of what you see until they are revealed.
- **Context control.** The engine writes the established facts into the prompt as short sections, and an inspector shows each section, its size and whether it reached the prompt. LumiRPEngine doesn't manage your World Info for now: it works as usual in world chats. The engine's own helpers read the world's lore instead, each step finding what it needs, and a secret entry reaches only the helpers you pick.
- **Realism you can dial.** Money, gear, vehicles, cast life, relationships, space and travel, calendar and time, weather, and character sheets each have their own level. Story, Grounded and Simulation presets set them all at once. Modern US defaults (approximate 2025–26 prices, pay, taxes and rents) are included and editable.
- **Time on your terms.** A tick for each kind of scene, a time scale, a pause button, and Timelapse, Speed through and Montage for skipping ahead without losing what happens along the way.
- **Your choice of model use.** Lean, Standard, Full or your own mix, with each step on the connection you pick, when it runs, a call budget for each phase of a turn, and a call meter that shows what each turn cost.
- **Safe with swipes, edits and branches.** Every reply carries its own record of what happened. Swiping, editing or branching never corrupts the world, and when an earlier change affects later turns you get a report and a choice.
- **Made for small screens too.** A drawer tab, a status pill, chips for what changed, an action palette in the input bar, and a fullscreen map.
- **Portable worlds.** Worlds export to a published, versioned file format with their own lore inside, and a world you import lists any macros in its lore and templates for your review.

The full walkthrough is in the [user guide](docs/USER-GUIDE.md).

## Documentation

- **[User guide](docs/USER-GUIDE.md):** playing, tuning and building, every button explained.
- **[GM guide](docs/GM-GUIDE.md):** running a chat: who sees what, the GM view and its edits, fixes and Undo, checks, realism and time in one chat, Upgrade, and the Context inspector.
- **[Recipes](docs/RECIPES.md):** small worlds that each show one thing working, from XP and levels to a family's schedule, every one checked by a test.
- **[Expressions](docs/EXPRESSIONS.md):** the formula language for requirements, checks, derived fields and rules.
- **[Reference](docs/REFERENCE.md):** every kind, field, effect, formula function, action, event and lint code the engine and its packs register, generated from the code (`bun run reference`).
- **[Studio contract](docs/STUDIO.md):** for tools that author worlds outside Lumiverse: the `lumi-rp-engine/studio` API, the file formats, the JSON Schemas (`schemas/lre-world-v1.schema.json` and the map's) and versioning.
- **[Design](docs/DESIGN.md)** and **[Architecture](docs/ARCHITECTURE.md):** how the engine works and why, and the contract between its modules.

## Install

1. In Lumiverse, open the **Extensions** tab and tap **Add Extension**.
2. Choose **Install from Source**, enter `https://github.com/TheLiquorPriest/LumiRPEngine` as the GitHub repo URL (the branch is optional), and tap **Install**.
3. Review the permissions below, switch them on under **Permissions** (or tap **Enable All**), and enable the extension.

LumiRPEngine requires **Lumiverse's `staging` branch from 16 October 2026 (commit `9cc9f5d`) or later**.

## Permissions

LumiRPEngine asks for eight permissions. Here is why each one is there:

- `generation`: to follow each reply from start to finish, to run the World Info interceptor that puts the world's sections into the prompt, and to make its own small helper calls.
- `context_handler`: to plan each turn (elapsed time, what your action does, what the world did in the meantime) before the reply is generated.
- `chats`: to read your chat, its messages and swipes, so the world stays in step with every swipe, edit and branch.
- `chat_mutation`: to save the world's record on each reply, and to add your palette, chip and map actions to the chat as messages.
- `world_books`: to create and maintain the world's own lore book, which holds its sections, attach it to the chat, read the books you pick for **Import from lore** or **Index a World Info book**, and tell you when a book that lore was indexed from has changed.
- `presets`: to read your active preset, so it can check where the world's sections will land in the prompt and warn you about settings that cause trouble.
- `decisions`: to use Lumiverse's Decisions API for the probability questions the engine asks, such as what an NPC does on a close call.
- `ui_panels`: for the drawer tab, the status pill and the map.

LumiRPEngine deliberately does **not** request the `characters` permission. Character cards stay out of its reach. Where it needs to know whether the world's sections really reach the prompt, it checks with a test prompt build instead, and if it cannot confirm something it says so ("unverified").

## Quick start

1. Open the **LumiRPEngine** tab in the drawer and go to **Build**.
2. Tap **New world**, pick a **Template** (fantasy town, mystery manor or modern slice-of-life) or **Blank**, name it and tap **Create world**. To build from your existing lore books instead, create a Blank world and use its **Import from lore** tool.
3. Attach the world to a chat with the world's **Attach to this chat** tool (or, in **Play**, **Attach a world to this chat…**). LumiRPEngine creates a lore book for the world's sections and adds it to that chat.
4. Go to **Play** and write. Blank worlds start on the **Story** preset, which keeps things light, as does the fantasy town; the mystery manor starts on **Grounded** and the modern slice-of-life on **Simulation**. Change the realism whenever you like in **Settings → Realism**.

## Things to know before you install

These are the known limits of this release. Most of them need a change in Lumiverse itself, which I plan to propose after release.

- **Prompt assembly moves to the main process, for everyone.** While LumiRPEngine is enabled, Lumiverse builds prompts for all users on the host on its main process instead of a separate worker. On the live host, with a 1,000-message chat, that added about 23 ms per prompt build (121 ms with LumiRPEngine enabled against 98 ms without). On a shared host, tell the people you share it with.
- **Other extensions that write message metadata.** Lumiverse replaces a message's whole metadata when something saves it, so another extension can overwrite LumiRPEngine's records and LumiRPEngine can overwrite theirs. LumiRPEngine keeps a second copy of its records and restores them, but I cannot promise the other extension does the same.
- **Other extensions' World Info interceptors.** They cannot switch on an entry in the world's own book that LumiRPEngine has left off. Everything they do to your own lore books works as usual.
- **If the worker stalls,** the world's sections are missing from that turn's prompt, and the turn is flagged.
- **"Unverified" delivery.** The engine can confirm that an entry was activated, but not always that it landed where you placed it. Where it cannot be resolved the entry keeps its normal place and is marked unverified.
- **Text and world can disagree after some edits and Continues.** When you edit a reply, or continue one in a way the engine cannot read as part of a turn (a continue on an older message, a stopped continue, or a continue where Lumiverse rewrote the earlier text), the world stays as it was simulated until you use **Re-read edit**.
- **Detail opened while a reply streams** shows as "pending" until the reply finishes, and anything you change in that moment lands right after it.
- **Continue shows the world as it was before the reply.** The engine learns which message you are continuing only when the reply ends.
- **Changes made on another branch** stay stored but have no effect until you switch back to that branch. The Keep report lists them as "made on another branch". Deleting a message also drops the other-branch changes attached to it.
- **A rare overlap case.** If another extension writes to a reply while it is still streaming, an edit you make to your own message right afterwards can be mistaken for Lumiverse's own re-render and will not pause the chat.
- **Rare overlapping turns** fall back to planning from the last saved state.
- **Worlds from other people can carry macros.** A world file's lore and templates may contain Lumiverse macros (`{{…}}`), which Lumiverse runs when it builds a prompt, as in any World Book. Lumiverse's macro engine also acts on control characters (it turns some of them back into braces on a later pass) and on the `<user>`, `<char>` and `<bot>` shorthands. LumiRPEngine keeps authored text as written. Everything it inserts itself (a name, a price, what a model said) has its braces swapped for look-alikes, its control characters dropped and its `<user>`-style shorthands broken, so a value can never form a macro however many times Lumiverse processes it. It lists all of these in an imported world for you to review before you play it.

## Credits

Parts of the engine are adapted from [Warp](https://github.com/japolino/warp) by japolino, used with the author's permission for this non-commercial project. The details, file by file, are in [`NOTICE`](NOTICE).

## License

No license yet; all rights reserved for now.
