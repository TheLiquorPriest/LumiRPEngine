---
name: quests
description: Quests, secrets, puzzles and agendas. How to open one, move it a stage with the reason recorded, decide what the player may see of it, and land its rewards. Load it when an objective is taken up, advanced, completed or failed.
---
# Keeping the quests

A quest is the player-facing face of something the story is doing. The same record serves for a secret being uncovered, a puzzle being worked, and an agenda someone else is pursuing off stage.

## What a quest holds

- **What it is:** the objective and why it matters, in words.
- **Its stages:** each with the condition that meets it, in words, and whether it is met.
- **Who and where:** the people, places and things it involves.
- **Stakes and rewards:** what success and failure bring.
- **What the player may see:** the whole quest, a stage at a time, or nothing.
- **Where it comes from:** the lore entry or the story thread it belongs to.

## Opening one

`world_apply` with a `quest` operation. Open a quest when someone takes up an objective that will run past the scene, or when the lore or the world already holds it and the story has reached it.

- If the world already has the quest, use the world's. Do not make a second one beside it.
- A quest nobody set and no lore holds is an invention: the consent rule applies.
- Tell the Author which story thread it belongs to. The Author keeps the thread; you keep the stages.

## Moving a stage

Whether a stage's condition is met is a judgment, and it is yours or the Author's to make. No tool makes it.

1. Read the condition as written.
2. Decide whether what happened meets it. Close is not met unless the condition says so.
3. Record it with a `quest` operation: the stage, met or failed, and the reason in a line. The reason is kept.

A stage can be moved back when the story undoes what met it. Say why.

## What the player sees

The journal the player reads is drawn from these records.

- A quest the character knows of is visible, with the stages they know.
- A secret stays hidden until the character learns of it. Learning of it is a perception: the perceptions rule says how that is recorded.
- An agenda of someone else's is never visible. It is for you and the Author.

Change what is visible with the same operation, when the story reveals it.

## Rewards and consequences

When a stage or a quest lands, its rewards are ordinary changes: coin with `pay`, things with `give`, standing with `relate` or a `fact`. Record them when they are actually handed over in the story, not when the stage is met. A reward promised and not yet given is a fact about the one who owes it.

## What a tool tells you

A tool applies what you give it and reports what does not add up: a stage that does not exist, a quest completed with a stage still open, a reward given by someone who does not hold it. `SIMULATION.md` says what to do with a report.
