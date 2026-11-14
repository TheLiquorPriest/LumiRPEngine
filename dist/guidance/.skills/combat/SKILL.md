---
name: combat
description: Running a fight. How to open it, take it round by round on the grid, let each fighter choose for themselves, record harm and position, and close it with its aftermath. Load it when blows are about to be traded.
---
# Running a fight

A fight is the part of the story where position, order and numbers decide things. Run it by the world's ruleset, on the map, a round at a time.

## Before the first blow

1. **Who is in it,** and on which side. Everyone present either fights, flees, hides or watches: say which for each.
2. **Where everyone stands.** If the place has no grid at the scale of a room, lay one first (the skill `places-and-maps`). Place everyone.
3. **What each fighter has to hand:** check what they wear and carry. A weapon left at home is not drawn.
4. **Open the fight** with the fight tools. Find them with `tool_search` ("fight").

## A round

A round on a room grid is a few seconds. The grid keeps that time; do not pass minutes on top of it.

1. **The player's character first, from the player's message.** If the message covers several rounds, take it one round at a time and stop where what happens would change what they would do next. The Author decides whether to stop there.
2. **Each principal chooses for themselves.** Their own agent is given the fight as that character perceives it and answers with what they do. Do not choose for them.
3. **You choose for everyone else,** by who they are and what they want. A guard fights like a guard. Something cornered fights like something cornered. Most people do not fight to the death.
4. **Resolve in the ruleset's order.** Measure reach, range and line of sight with `map_measure`. Roll what the ruleset calls for, once each.
5. **Record what changed:** harm and conditions (`set`), who moved (`move`), what was dropped, drawn or broken (`place`, `wear`, the item tools).
6. **Say what the round did** in a few lines for the Author: who acted, what landed, who is down, where everyone now stands.

## Ending it

A fight ends when one side is down, has fled, has yielded, or when the story interrupts. Close it with the fight tools.

Then the aftermath, which is where fights are forgotten:

- Wounds that will last are facts on the person, with how they got them.
- What was taken from the fallen changes hands with `give`, said as taken.
- Who saw it. The perceptions rule says what is owed to those who did.
- Time: the fight itself took seconds. What follows it (binding wounds, searching, fleeing) takes its own time, passed afterwards.

## What a tool tells you

A tool applies what you give it and reports what does not add up: a blow at someone out of reach, a move through a wall, a fighter acting twice in a round. Read the report, and put it in your answer to the Author.
