---
name: ruleset-and-sheets
description: Ruling by the world's own rules. How to read a sheet, call for a check and roll it once, apply what the outcome does, and change a stat; with the tabletop rules, how their own actions do it. Load it when a check is called for, or when a sheet changes.
---
# Ruling by the ruleset

The world has a ruleset of its own: how checks are made, how people advance, how a fight is counted, what a sheet holds. You were given it. Rule by it, not by another game's habits.

## Which rules this world has

Some worlds play by the tabletop rules: a rule set such as Classic, Classic Revised or Modern, or one built the same way. Its skills, classes, feats, conditions, weapons and creatures are rows in the world's own tables, and every number on a sheet is worked out from them. You can tell by `world_query` at `ruleset`: it names the rule set and lists its abilities, skills, saves, classes, conditions and usual difficulties, and the actions to use. In a world without them, `world_query` at `ruleset` lists the world's own checks and actions, and `sheet` answers that there is no sheet of that kind to read.

Where the world has them, read "With the tabletop rules" and skip "Without them"; the other sections hold for both. The chat can switch them off ("For this chat" on the World page); an action then says so and changes nothing. If the player wants them in a world that has none, `rules_apply` puts a rule set on this chat's world, and its `preview` says first what it would add.

## Reading a sheet

`world_query` on the person, at full depth: their stats and skills, their conditions, what they wear and carry, and where each value comes from. Read it before you rule on what they can do. Do not rule from memory.

With the tabletop rules, read the sheet with `sheet` (`who`): every total with its parts and where each part comes from, so that you work none out yourself. It gives defence and its variants, each weapon in hand with its attack, damage and range, saves, skills, hit points and the states they bring, conditions and effects with what is left of each, classes and traits.

## With the tabletop rules

Every roll, every harm and every change to a sheet has an action of the rules, carried out with `world_apply` and the operation `act`: `action` is its id, `who` is the one who acts (left out: the player's character), and `params` holds what it takes. Each answers with what it worked out, every number with its parts, and is one Undo.

**You name who, what and against whom. The action reads every number.** Do not hand in a modifier, a defence, a total, a damage figure or a count of hit points that a sheet or the rules have: the action takes them from the sheets and the tables, says them in its answer and keeps them on the sheet, so that what was rolled can be seen and followed. What you do give is what the story gives and no sheet has: a circumstance (`mods`: a number, its type and why, as in "+2 circumstance: high ground"), a difficulty the table has not, how long an effect lasts, the harm of a fall or a fire.

### Choosing a difficulty

The rules have a table of usual difficulties, each with a name and a number: read it with `world_query` at `ruleset`. Choose the one that fits what is attempted and the circumstances, by its name (`difficulty` "hard"). Choose by the task, never by who attempts it: the sheet already counts who. Give a number only where the story has set one. Against another person's skill, name them (`vs`) and the action rolls theirs.

### A check

`check`: `skill` (a skill or an ability, by name) and either `difficulty` or `vs` (someone who rolls against it; `vs_skill` where theirs is another skill). `aid` names those who help: each rolls the same check, and the rules say what a helper adds. `take` is 10 or 20 in place of the roll, where the rules have such a number to take. `mods` holds the circumstances.

The action rolls the die and adds the sheet's total for the skill (ranks, ability, class skill, armour, size, traits, conditions and effects). A skill the rules want ranks for, used with none, is rolled all the same and the answer says so. It answers with the roll, its parts and the outcome; with no difficulty and no `vs` it gives the total and no outcome.

### A save

`save`: `save` (which one, by name), `difficulty` (a save is not made without one), `also` (others who make the same save: each rolls their own), `mods`. The difficulty comes from what caused the save: choose it as for a check.

### An attack

`attack`: `target`, and `with` where it is not what the attacker has readied (a weapon held or carried, one of its own attacks, or a weapon of the rules, by name). `full` makes every attack a high base attack gives. `touch`, `held`, `shots` (as the rules name them), `nonlethal` and `concealment` (the miss chance in percent) say how; `mods` holds the circumstances (cover is "+4 cover to ac: behind the wall").

The action reads the weapon's row, the attack total, the target's defence (flat-footed until it has acted in a fight), the range from the grid where both stand on one, the natural die's rule, a threat and its confirming roll, the damage with its multiplier, the target's reduction and resistances and the round spent from the magazine. Then it sets the hit points and the states they leave the target in. One attack is one record, and into the fight under way. `reload` fills a magazine from the rounds carried: `item` where it is not what is readied.

### Ruling without dice

Where the story has settled an outcome, or the GM rules it without a roll, give `outcome` and the action takes it and rolls nothing for it: `success` or `failure` for a check or a save, `hit`, `miss` or `critical` for an attack. The record says it was ruled. The damage of a ruled hit is rolled all the same. What is rolled is rolled by the action, never worked out in your own words.

### Harm, healing and rest

- **An attack's harm comes from the attack.** For harm no weapon gives, `harm`: `amount` (dice such as 2d6, or a number the story gives), `type`, and who is harmed (`who`, `targets`, or a `centre` and a `radius` on the grid for everyone in an area). `save` with `difficulty` makes each roll a save, and `half` says a save made halves the harm; `nonlethal` for harm that does not kill.
- The action reads each one's reduction and resistance to the type, holds the hit points to the bounds the sheet gives, and puts the states they bring (disabled, dying, dead or what the rules call them) on the sheet as conditions, each recorded. Do not `set` hit points or those conditions yourself.
- `heal`: `amount` (dice or a number the story gives); `nonlethal` for nonlethal harm only, `temporary` for temporary hit points, `stabilize` to make someone who is dying stable.
- `d20_rest` is a night's rest (its id is that, since `rest` is another action's): `hours` left out is the rules' night, `also` the others who rest. It gives back what the rules give: hit points by level, nonlethal harm by the hour, and each daily gauge.

### Conditions and effects, and how long they last

- `condition`: `condition` by name from the rules' list, `off` to take it off. What it changes, and what holds while someone is under it, comes from the table, so give no modifier.
- `effect`: for what a spell, a thing or a ruling gives for a while where the rules have no condition for it: `label`, `mods` (each a number, its type, what it changes and why: "+2 morale to attack: a rousing song"), `off` to take it off by its label. The sheet counts them with the rest by the rules' stacking.
- **How long.** Both take `rounds` (the one's own turns in a fight: one comes off when their turn comes, and it ends at none), `minutes` or `hours` (the clock's: it ends when the clock passes them), or `save` with `difficulty` (it ends when the save is made, tried on each of their turns). With none it lasts until it is taken off.

### Experience and a new level

- `award`: `xp` where the story gives a number, or `overcame` (who was overcome: the rules' own table says what each is worth, shared among the one who acts and `also`). The answer says who has reached a level they have not yet taken.
- A level is taken, not set: `advance` for each level open, with `class` (by name) and `hp` left out, which is the rules' way. The answer says the level's hit points, the skill points to place (with `ranks`), whether a feat is to choose (with `trait`) and whether an ability point is to place (a `set` of that ability's score). The class features it names come with the class: give nothing for them.

### Someone new, in one call

A person or a creature with no sheet gets one in one `world_apply`, its operations in order. From a row of the creatures table that fits: `stat_as` (`creature`), which gives the values, the attacks and the challenge rating. Built by class: a `set` for each ability score the story gives, `advance` once for each level, `trait` for each race or feat, `ranks` for each skill (`skill`, and the ranks in all). The answers say the most a skill takes and the points left. Say that you drew it, and from which row, as a ruling you made this turn.

### A row the story needs

When the story needs a feat, a creature, a weapon, a condition, a skill or a class the tables do not have, add it with `rules_add`: `table` (what the row is), `id` (its key) and `row` (its columns, by name). It is checked against the table's columns and the world's own checks before anything is written, and a row that cannot work is told with why. The world gets a new revision with the row, and this chat moves to it from the next turn; the world's other chats stay as they were. Until then the row is not in the rules: rule that turn in words, with a `fact`, and use the row's action from the next.

## Without them

### Calling for a check

`SIMULATION.md` says when the dice are rolled. When they are:

1. Say what is attempted, by whom, and by what approach.
2. Find what the ruleset makes of it: which stat or skill, against what difficulty, with what helping or hindering. If the ruleset has an action for it, use that action. `world_query` at `ruleset` lists the world's checks and every action it has (the engine's own and the world's own, a quest's step among them); `checks_odds` (found with `tool_search`) gives an action's odds and the names of its outcomes. `attempt` (`stat`, `difficulty`) is the engine's own for something hard that one stat decides.
3. Say what each outcome will do before you roll, in a line each. Success, failure, and anything between that the ruleset has.
4. Roll with `roll`. It rolls once and records the roll with what it was for.
5. Apply the outcome with `world_apply`. An action is carried out with the operation `act`: `who` takes it, `params` holds what it takes, and `outcome` is the one your roll decided, so that the action does not roll a second time. Left out, an action with a check has the check rolled by the world's rules. A requirement that does not hold is told in the answer, and the action is carried out all the same (`SIMULATION.md`); `act` passes no time.

### Changing a sheet

- A stat, a skill, a condition, a level: `world_apply` with a `set` operation.
- Harm and recovery are changes to a condition or a stat, as the ruleset counts them.
- Advancement is the ruleset's: check what it requires before anyone advances.

## One roll

A roll that has been made stands. Do not roll again for a result you would like better, and do not rule around it. If the attempt can be tried again, the ruleset says what trying again costs.

The player's own swipe of a turn is another matter: `SWIPE.md` says whether the dice are rolled afresh then.

## Something with no field

Something true of a person that the sheet has no field for (a limp, a fever, a promise weighing on them) is a `fact`.

## Foes and strangers

Someone who comes into view with no sheet gets one from the lore if the lore has them. If it does not, the ruleset's bestiary has ordinary examples to draw from: take the nearest and say that you did; a sheet drawn this way is a ruling you made this turn (with the tabletop rules, `stat_as` gives it). Anything past that is invented, and the consent rule applies.

## What a tool tells you

A tool applies what you give it and reports what does not add up: a stat past its bounds, a skill the ruleset does not have, a roll with no check named. An action of the tabletop rules says a skill used without ranks, a trait whose requirement does not hold, a shot a weapon cannot fire and a target out of range, and goes on. It refuses only what it cannot work out: a skill, a save, a condition, a class or a creature that is not in the tables, and then it lists the ones that are. `SIMULATION.md` says what to do with a report.
