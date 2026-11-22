---
description: How checks_odds, sheet and ruleset_read are called. It says how to call them, not when. Delete this file and an agent that finds them by search is given no such guide.
---
checks_odds reads the odds of an action as things stand and changes nothing; `roll` is what rolls. `action` is the action's id, and an id the world does not have is answered with the ones it has. `actor` is who would take it, by name or id (left out, the player's character). `params` holds the action's own arguments by name, a person, thing or place by name or id. The answer says whether it can be tried now and, if not, why; how many minutes it takes; the chance of each outcome in percent; the dice, the modifier, the difficulty, any advantage and whom it is rolled against; and what the world's way of judging checks makes of it.

    tool_use {"name": "checks_odds", "args": {"action": "attempt", "actor": "Bram", "params": {"stat": "strength", "difficulty": "hard"}}}

sheet reads someone's sheet under the world's tabletop rules, every total with its parts: `who` by name or id (left out, the player's character). A check, a save, an attack, harm or healing is the action of that name, carried out with the `world_apply` operation `act`, which works its numbers out from this same sheet.

    tool_use {"name": "sheet", "args": {"who": "Bram"}}

ruleset_read reads one part of the world's ruleset whole, or one entry of a part: `part` by its name as the ruleset's index lists it, `id` an entry of it by id or name (left out, the part whole). A part the ruleset does not have is answered with the parts it has.

    tool_use {"name": "ruleset_read", "args": {"part": "bestiary", "id": "wolf"}}
