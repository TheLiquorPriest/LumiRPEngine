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

`world_apply` with a `quest` operation: `quest` is its name and `open` its kind (quest, secret, puzzle or agenda). The same operation writes what you know of it: `objective` and `matters` (what it is and why it matters), `stages` (a list, each `{stage, label, condition, after}`, `after` being the stage it follows), `who`, `where` and `things` by name, `stakes` and `rewards`, and `thread`, the id of its thread in the story record. A later operation names the quest in `quest` and writes any of these again; `unbind` true with `who`, `where` or `things` takes those off it. A quest the world defines takes only its stages, `show` and `close`: what else you send it is left out and said.

Open a quest when someone takes up an objective that will run past the scene, or when the lore or the world already holds it and the story has reached it.

- If the world already has the quest, use the world's. Do not make a second one beside it.
- A quest nobody set and no lore holds is an invention: the consent rule applies.
- Tell the Author which story thread it belongs to. The Author keeps the thread; you keep the stages.

## Moving a stage

Whether a stage's condition is met is a judgment, and it is yours or the Author's to make. No tool makes it.

1. Read the condition as written.
2. Decide whether what happened meets it. Close is not met unless the condition says so.
3. Record it with a `quest` operation: the `stage`, its `outcome` (met, failed, or open to call it open again), and the reason in `why`, in a line. The reason is kept.

A stage can be moved back when the story undoes what met it. Say why.

When a `quest` operation moves a stage the world built, its answer carries `authored`: what the world built for the stage reached (`reached`: its effects, rewards, gate, truth, cue, hints and the stages it goes on to) and for the one left (`left`: its rewards and effects). It is data and nothing in it is applied: what the story hands over, you land as ordinary operations (see the rewards below). `world_query` at the quest gives the same for every stage.

## What the player sees

The journal the player reads is drawn from these records.

- A quest the character knows of is visible, with the stages they know.
- A secret stays hidden until the character learns of it. Learning of it is a perception: the perceptions rule says how that is recorded, with the secret named by its id.
- An agenda of someone else's is never visible. It is for you and the Author.

The Author sets what the player may see with the same operation, in `show`: all, none, a list of stage ids, or default to leave it as the quest itself has it. The Author sets it back when the story takes it away.

A quest closes with `close`, saying how it ended (met, failed, or in a word of your own), and the reason in `why`; `close` reopen opens it again. Closing a quest touches its thread, and closing a thread touches its quest, in that turn, with no call of yours. Whether the other closes too is the Author's call.

## Rewards and consequences

When a stage or a quest lands, its rewards are ordinary changes: coin with `pay`, things with `give`, standing with `relate` or a `fact`. Record them when they are actually handed over in the story, not when the stage is met. A reward promised and not yet given is a fact about the one who owes it.

## What a tool tells you

A tool applies what you give it and reports what does not add up: a stage that does not exist, a quest completed with a stage still open, a reward given by someone who does not hold it. `SIMULATION.md` says what to do with a report.
