---
description: How the tools for vehicles are called - vehicles_classes and vehicles_drive. It says how to call them, not when. Delete this file and the agents that are given it by a search are given no such guide.
---
vehicles_classes reads and changes nothing: it lists the world's vehicle classes, with `domain` or `search` to narrow them. vehicles_drive takes the `vehicle`, the place `to`, its `driver` and its `riders`, and moves them all by the world's routes, burning the fuel the trip takes. It does not pass the time of the trip. It also takes `source`, `precision` and `standing`.

    vehicles_drive {"vehicle": "the Gull", "to": "Gull Skerry", "driver": "Ada", "riders": ["Tobin"], "source": {"from": "prose", "message": "m-12"}}
