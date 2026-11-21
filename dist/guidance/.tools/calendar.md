---
description: How the tools for the calendar's holidays and named days are called - calendar_read, holiday_set and holiday_remove. It says how to call them, not when. Delete this file and an agent that finds one of them by search is given no such guide.
---
calendar_read reads the holidays and named days as this chat keeps them, each with its rule, whether it is a day off and the day it next falls on; `holiday` reads one, and it changes nothing. holiday_set names the `holiday` by name or id: one that is there is changed, any other is added, with its `label`, its `date` (MM-DD) or, for a day that moves, its `rule` (fixed, nth_weekday, easter or relative), and `day_off` (false for a named day that is no day off). holiday_remove takes the `holiday` off. What the story changes is this chat's own: the world's calendar is never edited.

Each write also takes `source`, and `precision` and `standing` where you know them.

    tool_use {"name": "holiday_set", "args": {"holiday": "Lantern Night", "date": "10-31", "day_off": false, "source": {"from": "prose", "message": "m-12"}}}
