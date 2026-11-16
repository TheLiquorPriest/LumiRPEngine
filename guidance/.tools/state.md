---
description: How the tools that read and write the world's recorded state are called - world_query, world_search, world_apply and roll. It says how to call them, not when. Delete this file and an agent that holds one of them is given no such guide.
---
world_query reads the world's tree at a point: `at` is a place, someone or something by name or id, or `world`, `groups`, `elsewhere` or `ruleset`; `depth` is how many levels below to show, or `full`; `due` is a span ahead (two hours, until 22:00) to list what falls due there; `map` true adds the place's map as text. world_search finds people, things, places and groups by `words`, best first; `kind` limits it to one of them.

    world_query {"at": "Keeper's kitchen", "depth": 2}

world_apply takes `operations`, applied in order, each on the state the ones before it left, so a later one may name what an earlier one made. Each has an `op` and the fields that op takes, which the tool's arguments list, and a `source` saying where it comes from (`from`, and the message, roll or entry it cites by id). A name that is not there, or a value outside its choices, answers the whole call with what would work, and nothing is recorded.

    world_apply {"operations": [{"op": "move", "who": "Ada", "to": "Keeper's kitchen", "source": {"from": "prose", "message": "m-12"}}, {"op": "pay", "who": "Ada", "to": "Tobin", "amount": 3, "reason": "purchase", "source": {"from": "prose", "message": "m-12"}}]}

roll rolls once for `who`, by `dice` (such as 1d20+3) or by one of the world's checks (`check`), with an optional `against` difficulty and `for`, what it decides. The answer gives the roll's id, which a later write cites as its source.

    roll {"who": "Ada", "check": "athletics", "against": 15, "for": "swimming the channel"}
