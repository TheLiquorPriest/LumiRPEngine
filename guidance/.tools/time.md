---
description: How the tools for routines, weather and a person's day are called - gm_routine_edit, weather_set, weather_clear and time_day. It says how to call them, not when. Delete this file and the agents that are given it by a search are given no such guide.
---
time_day reads and changes nothing: give `person` and, if you want another than today, `day`. weather_set takes the `region`, the weather `state` and, to hold it for a time, `minutes`; weather_clear takes the `region` and lifts the hold. gm_routine_edit changes one person's routine: their `person`, the `op`, and the fields that op takes. Each tool that writes also takes `source`, `precision` and `standing`.

    time_day {"person": "Ada"}
    weather_set {"region": "the Skerry", "state": "fog", "minutes": 180, "source": {"from": "prose", "message": "m-12"}}
