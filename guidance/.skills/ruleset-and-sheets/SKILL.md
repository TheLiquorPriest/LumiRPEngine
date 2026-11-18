---
name: ruleset-and-sheets
description: Ruling by the world's own rules. How to read a sheet, call for a check and roll it once, apply what the outcome does, and change a stat. Load it when a check is called for, or when a sheet changes.
---
# Ruling by the ruleset

The world has a ruleset of its own: how checks are made, how people advance, how a fight is counted, what a sheet holds. You were given it. Rule by it, not by another game's habits.

## Reading a sheet

`world_query` on the person, at full depth: their stats and skills, their conditions, what they wear and carry, and where each value comes from. Read it before you rule on what they can do. Do not rule from memory.

## Calling for a check

`SIMULATION.md` says when the dice are rolled. When they are:

1. Say what is attempted, by whom, and by what approach.
2. Find what the ruleset makes of it: which stat or skill, against what difficulty, with what helping or hindering. If the ruleset has an action for it, use that action; it is carried out with the `world_apply` operation `act` (step 5).
3. Say what each outcome will do before you roll, in a line each. Success, failure, and anything between that the ruleset has.
4. Roll with `roll`. It rolls once and records the roll with what it was for.
5. Apply the outcome with `world_apply`. For an action of the ruleset's, that is an `act` giving the `outcome` your roll decided.

## One roll

A roll that has been made stands. Do not roll again for a result you would like better, and do not rule around it. If the attempt can be tried again, the ruleset says what trying again costs.

The player's own swipe of a turn is another matter: `SWIPE.md` says whether the dice are rolled afresh then.

## Changing a sheet

- A stat, a skill, a condition, a level: `world_apply` with a `set` operation.
- Harm and recovery are changes to a condition or a stat, as the ruleset counts them.
- Advancement is the ruleset's: check what it requires before anyone advances.
- Something true of a person that the sheet has no field for (a limp, a fever, a promise weighing on them) is a `fact`.

## Foes and strangers

Someone who comes into view with no sheet gets one from the lore if the lore has them. If it does not, the ruleset's bestiary has ordinary examples to draw from: take the nearest and say that you did; a sheet drawn this way is a ruling you made this turn. Anything past that is invented, and the consent rule applies.

## What a tool tells you

A tool applies what you give it and reports what does not add up: a stat past its bounds, a skill the ruleset does not have, a roll with no check named. `SIMULATION.md` says what to do with a report.
