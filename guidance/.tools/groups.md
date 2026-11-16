---
description: How the tools for groups and organizations are called - gm_org and orgs_who_may. It says how to call them, not when. Delete this file and an agent that finds one of them by search is given no such guide.
---
gm_org makes one change in each call, in `change`: an object whose `do` names the change (admit, remove, appoint, hire, issue, vote and the rest the tool's `change` lists) and whose other fields are that change's own. People, groups and places in it are named as the world names them, or by id. Every sum in it (`capital`, `price`, `rate`, `cents`) is in the world's smallest unit, not its main coin. A change that cannot be read is answered with the fields its `do` takes and the ones you left out. `propose` puts another change, in its own `change`, to the group's decision. What the world's rules would refuse is recorded as you gave it, and the answer reports it.

orgs_who_may reads and changes nothing: give the `org`, a `power` as the organizations name them (org.govern, money.spend, assets.use) and, to ask about one person, `who`. Each holder comes with the basis it rests on.

gm_org also takes `source`, and `precision` and `standing` where you know them.

    tool_use {"name": "gm_org", "args": {"change": {"do": "admit", "org": "The Lamplighters", "who": "Tam", "title": "Apprentice", "why": "sworn in at the lamp-house"}, "source": {"from": "prose", "message": "m-12"}}}
    tool_use {"name": "orgs_who_may", "args": {"org": "The Lamplighters", "power": "org.govern", "who": "Bram"}}
