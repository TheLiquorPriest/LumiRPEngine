---
description: How the tools for a business's takings, prices, projects and the effects the GM may run are called - gm_revenue, set_price, gm_project, gm_effects and gm_effect. It says how to call them, not when. Delete this file and an agent that finds one of them by search is given no such guide.
---
gm_revenue changes a revenue `stream`, by name: `factor` multiplies its takings (1.5 is half as much again), `amount` adds a flat sum in the world's main coin (negative takes away), `days` is how long it lasts (left out, until changed again), and `reason` is kept with it. A stream its author closed to change in play is reported. set_price sets an `asset`'s `price` to the sum you give: nothing is worked out or checked against a market. gm_project acts on a production project by `act`: start (with the `org`, its `template` from the world's list, a `name` of its own and the `account` that pays), pause, resume or drop (by `project`), or note (a `step` set back by `days` or made dearer by `amount`); `why` is kept with each.

gm_effects lists the effects the world's packs let the GM run by name, each with the arguments it reads (`search` narrows it), and changes nothing. gm_effect runs one: `effect` as gm_effects names it and `args` as field: value; a name that is not one is answered with the nearest and the list.

Each write also takes `source`, and `precision` and `standing` where you know them.

    tool_use {"name": "gm_revenue", "args": {"stream": "Bluebird Coffee takings", "factor": 0.5, "days": 7, "reason": "The street is closed for repairs.", "source": {"from": "prose", "message": "m-12"}}}
    tool_use {"name": "gm_effects", "args": {"search": "fire"}}
