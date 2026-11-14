---
name: items-and-wardrobe
description: Things, and what people wear and carry. How to record a thing made, handed over, put on, put away, used up or lost, so that nobody draws a sword they left at home. Load it when things change hands or clothes change.
---
# Keeping track of things

Every thing has four facts, and they are separate:

1. **Where it is:** a place, a container, or on a person.
2. **Who has it:** in whose hands or on whose body, if anyone's.
3. **Whose it is.**
4. **Who may use it.**

A borrowed coat is on one person and belongs to another. A stolen ring is in a thief's pocket and is still its owner's. Change only the facts the story changed.

## The everyday changes

All through `world_apply`:

- **`give`:** a thing passes from one person to another. Say how: handed over to hold, lent, returned, given, sold, traded, stolen. That decides whether whose-it-is changes too.
- **`wear`:** put on or taken off; a weapon readied, holstered, sheathed or slung.
- **`store`:** put into a bag, a drawer, a car, a room; or put back where it is kept.
- **`place`:** set down on a surface or a square, picked up from one.
- **`spawn`:** a thing that was not in the world before. Say where it comes from: a lore entry, a line of the chat, a roll, or invented. For invented, the consent rule applies.

A thing used up (a potion drunk, arrows shot, a candle burned) is one operation that says how much is left.

## What someone is wearing

The world state shows what each person present wears and carries. Prose that contradicts it breaks the scene.

- When the story changes someone's clothes, record it in the same turn, even when it is only "she had changed for dinner".
- When nobody has said, they are still wearing what they wore. That is carried forward as assumed, and it is fine.
- A saved outfit or loadout puts on a whole set in one call. Find those tools with `tool_search` ("outfit").

## Before a thing is used

If the scene turns on whether someone has a thing with them, look: `world_query` on the person, at full depth. Do not rely on memory of an earlier turn.

## The rest

A thing's condition (broken, worn, mended), its names and description, standing permission to use another's things, two records of one thing merged, a thing lost: each has a tool of its own, found with `tool_search`.

## What a tool tells you

A tool applies what you give it and reports what does not add up: a thing given by someone who does not hold it, a thing in two places, a container inside itself. Read the report, and put it in your answer to the Author.
