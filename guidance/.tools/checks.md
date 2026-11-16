---
description: How checks_odds is called. It says how to call it, not when. Delete this file and an agent that finds it by search is given no such guide.
---
checks_odds reads the odds of an action as things stand and changes nothing; `roll` is what rolls. `action` is the action's id, and an id the world does not have is answered with the ones it has. `actor` is who would take it, by name or id (left out, the player's character). `params` holds the action's own arguments by name, a person, thing or place by name or id. The answer says whether it can be tried now and, if not, why; how many minutes it takes; the chance of each outcome in percent; the dice, the modifier, the difficulty, any advantage and whom it is rolled against; and what the world's way of judging checks makes of it.

    tool_use {"name": "checks_odds", "args": {"action": "attempt", "actor": "Bram", "params": {"stat": "strength", "difficulty": "hard"}}}
