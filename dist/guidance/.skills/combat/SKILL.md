---
name: combat
description: Running a fight. How to open it, take it round by round on the grid, let each fighter choose for themselves, record harm and position, and close it with its aftermath; with the tabletop rules, how a turn is taken with their actions. Load it when blows are about to be traded.
---
# Running a fight

A fight is the part of the story where position, order and numbers decide things. Run it by the world's ruleset, on the map, a round at a time.

## Before the first blow

1. **Who is in it,** and on which side. Everyone present either fights, flees, hides or watches: say which for each.
2. **Where everyone stands.** If the place has no grid at the scale of a room, lay one first (the skill `places-and-maps`). Place everyone.
3. **What each fighter has to hand:** check what they wear and carry. A weapon left at home is not drawn. With the tabletop rules, `sheet` shows the weapons each has readied: a weapon it does not show is not yet one of the rules' own (the skill `items-and-wardrobe` says how a weapon comes to be), and that is put right before the first blow, not during the fight.
4. **Open the fight** with the fight tools. Find them with `tool_search` ("fight"). The engine has the action `fight` (`target`) for the player's own press on it, carried out with the `world_apply` operation `act`; `who` is the one who starts it.

## A round

A round on a room grid is a few seconds. The grid keeps that time, and `fight_round` moves the clock by the rounds it records; do not pass minutes on top of it.

1. **The player's character first, from the player's message.** If the message covers several rounds, take it one round at a time and stop where what happens would change what they would do next. The Author decides whether to stop there.
2. **Each principal chooses for themselves.** Their own agent is given the fight as that character perceives it and answers with what they do. Do not choose for them.
3. **You choose for everyone else,** by who they are and what they want. A guard fights like a guard. Something cornered fights like something cornered. Most people do not fight to the death.
4. **Resolve in the ruleset's order.** Measure reach, range and line of sight with `map_measure`. Roll what the ruleset calls for, once each.
5. **Record what changed.** With the tabletop rules, the next section is this step. Without them: the round with `fight_round`, each fighter's act as it came out, the roll that decided it, and the harm it did in `harm`, a number that comes off the gauge the world's ruleset names for a fight's harm (a fighter it leaves down is marked down; where the world names no gauge, the answer says so). Do not set a value of your own naming for harm. Conditions are a `set`; who moved is `move`; what was dropped, drawn or broken is `place`, `wear` or the item tools. A player's press to end their turn is the action `end_turn`, carried out with `act`; a requirement that does not hold is told in the answer, and the action is carried out all the same (`SIMULATION.md`).
6. **Say what the round did** to whoever asked: who acted, what landed, who is down, where everyone now stands. A reply tells it as the story, in the story's own voice, with no block of numbers: they are on the turn's card.

## With the tabletop rules

The world has them when `world_query` at `ruleset` names a rule set; the skill `ruleset-and-sheets` says how to tell, and how each action below is called. Then a fighter's act is an action of the rules, carried out with `world_apply` and the operation `act`, and every number comes from the sheets, not from you. Name who, the target and the weapon; give no modifier, defence or damage.

- **Opening.** `fight_start` rolls each fighter's initiative from its sheet and sets the order, unless you give `order` yourself or `roll_initiative` false. Place everyone first: range and areas are read from the grid.
- **A turn.** `fight_read` says whose turn it is. Carry out what that fighter does, one action at a time, each with `who`: `attack` (`full` for every attack a high base attack gives), `reload`, `condition` or `effect` for what it puts on someone, `heal`, `harm` for harm no weapon gives, and `move` for where it goes. An action of the rules taken in a fight under way is recorded into that fight, spends what it costs of the turn's budgets (a standard action, a move and the rest) and settles who is down. Where the fighter has not that much left, the answer says so and the action is carried out all the same.
- **Ending a turn.** `act` with `end_turn` for the one whose turn it is. It moves the fight to the next fighter and does what the rules say happens as a turn comes: a dying fighter's roll to stabilize, a condition or an effect counted in rounds losing one and ending at none, one that lasts until a save having the save tried. The answer says what it did. Do not work any of it out in your own words.
- **Who is down.** The actions put the hit points and the states they bring on the sheet, each recorded, and a fighter left down is marked down in the fight. Do not `set` hit points or those conditions yourself.
- **A turn ruled in words.** A turn you decided in words that no action carries is recorded with `fight_round`, as without the rules. Record a turn one way or the other: one recorded with the actions is not recorded again with `fight_round`, and `fight_round`'s `harm` is only for harm you ruled in words.
- **Time.** The actions pass no time. Pass the round's seconds once for the round, with `pass_time` and `rounds`; `fight_round` moves the clock itself, and then you pass nothing on top.

## Ending it

A fight ends when one side is down, has fled, has yielded, or when the story interrupts. Close it with the fight tools.

Then the aftermath, which is where fights are forgotten:

- Wounds that will last are facts on the person, with how they got them. With the tabletop rules, hit points and conditions are on the sheet already, and a fact is only for what the sheet has no field for.
- What was taken from the fallen changes hands with `give`, said as taken.
- Who saw it. The perceptions rule says what is owed to those who did.
- Time: the fight itself took seconds. What follows it (binding wounds, searching, fleeing) takes its own time, passed afterwards.
- With the tabletop rules, **experience:** when the fight is over, give it with `act` and `award`. `overcame` names each one the party overcame (the rules' own table says what each is worth), and `who` and `also` those who took part, who share it. If the answer says someone has reached a level, take it with `advance` (`class`). A fight broken off with nothing overcome gives none.
- With the tabletop rules, what is given back in the story is `heal`, and a night's rest is `d20_rest`. The skill `ruleset-and-sheets` says how each is called.

## What a tool tells you

A tool applies what you give it and reports what does not add up: a blow at someone out of reach, a move through a wall, a fighter acting twice in a round. `SIMULATION.md` says what to do with a report.
