---
description: How the tools for a fight are called - fight_start, fight_read and fight_end. It says how to call them, not when. Delete this file and the agents that are given it by a search are given no such guide.
---
fight_start takes `foes`, the names of those the player's character fights, and rolls each side's initiative once. fight_read takes no arguments and changes nothing: it says whether a fight is on, who is on which side, the order, whose turn it is and how each fighter stands. fight_end takes `winner`, a side, or `break_off` true for a fight left unfinished. Each tool that writes also takes `source`, `precision` and `standing`.

    fight_start {"foes": ["Reeve's guard", "Hound"], "source": {"from": "prose", "message": "m-12"}}
    fight_end {"winner": "player", "source": {"from": "prose", "message": "m-15"}}
