---
description: How the tools for routines, weather and a person's day are called - gm_routine_edit, weather_set, weather_clear and time_day. It says how to call them, not when. Delete this file and an agent that finds one of them by search is given no such guide.
---
gm_routine_edit's `op` says which change it is and which other arguments it reads: routine_follow reads any of `mode`, `awareness`, `role` and `skips`, and `default` for one gives the world's own back; routine_block reads `block`, a block's id, and `value`, the block as their routine shapes it; schedule_override reads `schedule`, a schedule's id, and `value`, which is `{"off": true, "until": null}` to take it off (a time in `until` ends that), their own slots, or null to drop this chat's change. A `value` that cannot be read is answered with what it takes. weather_set takes the `region`, or a place for the region it lies in, the weather `state` as the region's climate names its states, and `minutes` to hold it; weather_clear lifts the hold and takes a `state` for the weather it turns to. time_day takes `person` and `day`, counted from today: 0 today, 1 tomorrow, -1 yesterday. None of these passes time.

Each write also takes `source`, and `precision` and `standing` where you know them.

    tool_use {"name": "weather_set", "args": {"region": "Thornbury", "state": "fog", "minutes": 120, "source": {"from": "prose", "message": "m-12"}}}
    tool_use {"name": "gm_routine_edit", "args": {"op": "routine_follow", "person": "Bram", "mode": "no_invitations", "source": {"from": "prose", "message": "m-12"}}}
