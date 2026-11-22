---
description: How the tools that read and write the world's recorded state are called - world_query, world_search, world_apply and roll. It says how to call them, not when. Delete this file and an agent that holds one of them is given no such guide.
---
world_query reads the world's tree at a point: `at` is a place, someone or something by name or id, or `world`, `groups`, `elsewhere`, `ruleset` or `quests` (a quest by its name or id reads its record whole); `depth` is how many levels below to show, or `full`; `due` is a span ahead (two hours, until 22:00) to list what falls due there; `map` true adds the place's map as text; `part` (since, feature or access) reads that part of a place's record whole. world_search finds people, things, places, groups and quests by `words`, best first; `kind` limits it to one of them.

    world_query {"at": "Keeper's kitchen", "depth": 2}

Where no `depth` is said, `how` names one: `gist` the point alone, `whole` everything beneath it. With `question`, a reader reads the answer whole and answers it: you are given the reader's answer and none of the tree.

    world_query {"at": "Thornbury", "question": "Who in the village owes the reeve, and how much?"}

world_apply takes `operations`, applied in order, each on the state the ones before it left, so a later one may name what an earlier one made. Each has an `op` and the fields that op takes, which the tool's arguments list, and a `source` saying where it comes from (`from`, and the message, roll or entry it cites by id). A name that is not there, or a value outside its choices, answers the whole call with what would work, and nothing is recorded.

    world_apply {"operations": [{"op": "move", "who": "Ada", "to": "Keeper's kitchen", "source": {"from": "prose", "message": "m-12"}}, {"op": "pay", "who": "Ada", "to": "Tobin", "amount": 3, "reason": "purchase", "source": {"from": "prose", "message": "m-12"}}]}

An `act` operation carries out one of the world's actions by its id (`action`; `world_query` at `ruleset` lists them all): `who` takes it (left out, the player's character), `params` are the action's own arguments by name, and `outcome` is the one you ruled (left out, an action with a check rolls it). The answer says any requirement that does not hold, the action's own minutes and the activity it started; the time passes only by a `pass_time` after it.

    world_apply {"operations": [{"op": "act", "action": "eat", "who": "Ada", "params": {"minutes": 30}, "source": {"from": "prose", "message": "m-14"}}, {"op": "pass_time", "minutes": 30, "source": {"from": "prose", "message": "m-14"}}]}

roll rolls once for `who`, by `dice` (such as 1d20+3) or by one of the world's checks (`check`), with an optional `against` difficulty and `for`, what it decides. The answer gives the roll's id, which a later write cites as its source.

    roll {"who": "Ada", "check": "athletics", "against": 15, "for": "swimming the channel"}
