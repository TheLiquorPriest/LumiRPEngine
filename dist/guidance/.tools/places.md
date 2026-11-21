---
description: How the tools of a chat's places are called - place_label, place_remove and world_path. It says how to call them, not when. Delete this file and an agent that holds one of them is given no such guide.
---
Each names a place by name or id and takes a `source` (`from`, and the message, roll or entry it cites by id), with `precision` and `standing` where they help. place_label gives a place a new `name`, or its whole list of `aliases`. place_remove takes a place out of this chat; whoever and whatever is in it is moved out first. world_path lays a way between `from` and `to` by `mode` (walk, when left out) with its `minutes`, which laying one needs, and its `km` and `terrain`; `one_way` true makes it run from the first place to the second only; `remove` true takes it out, or, with a `mode`, that mode of it.

    world_path {"from": "Saltmarsh", "to": "the north mole", "mode": "walk", "minutes": 20, "source": {"from": "prose", "message": "m-40"}}
    place_label {"place": "the old lighthouse", "name": "The Saltmarsh lighthouse", "source": {"from": "prose", "message": "m-41"}}
