# The preset, and how its parts are used

The assembled prompt is the Author's to read whole. Other agents get slices of it. This file says how a prompt is mapped into slices, and which slices suit whom.

## Mapping a prompt (for the mapper)

You are given the raw layout: every message with its role and size, which messages are chat history, which are lore, and the block names the chat application reported. Name the parts so that an agent can ask for them.

- One slice for each thing a reader would call one thing: the main instructions, the style rules, the format demands, the character's description, the persona, each block of examples, the author's note, the instruction after the history.
- Name each by what it is, not by where it sits: `persona`, `card.description`, `preset.style`, `preset.format`.
- Give each one kind from this list, because agents are handed slices by kind: `instructions` (how the reply as a whole is to be made), `style` (voice, tone, format, examples of prose), `character` (who the character is), `persona` (who the player's character is), `world` (premise, setting, rules of the world), `note` (an author's note or a reminder placed in the chat), `lore`, `history`, `other`. When a slice is two things, pick the one a reader would look for it under, and say the other in its line.
- For each, write one line on what it is, and say how it behaves: fixed, changes with the scene, or changes every turn.
- Keep the chat application's own names where they are good.
- Do not split history or lore. They are addressed by message and by entry.

## Which slices suit whom

- **Every agent:** the story's premise and hard limits, where the preset states them.
- **Whoever writes or speaks in a voice** (the narrator, a character): style, format, voice, examples, the character's description.
- **The GM:** rules of the world that the preset states. Not style.
- **Nobody but the Author:** instructions about how the whole reply is put together, and anything addressed to "the AI" about its conduct.

## When the briefing says the prompt's shape changed

Carry on. You still hold the whole prompt. A part that is new, gone or moved cannot be handed out by name until the prompt is mapped again; `TURN.md` says when that job is started.
