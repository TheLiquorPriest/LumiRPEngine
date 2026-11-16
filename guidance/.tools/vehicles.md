---
description: How the tools for vehicles are called - vehicles_classes and vehicles_drive. It says how to call them, not when. Delete this file and an agent that finds one of them by search is given no such guide.
---
vehicles_classes reads and changes nothing: `domain` (road, offroad, marine or air) and `search` words narrow it. Each class comes with its id, its names, its make and model and its price used and new, from cheap to dear; a class of air is listed only in a world that plays air. vehicles_drive takes the `vehicle` and the place `to`, with `driver` (left out, the player's character) and `riders`, each by name or id. The vehicle, its driver and its riders arrive together. A trip the world's rules would refuse (no way there, no fuel, a breakdown) is made all the same, and the answer reports it. It also takes `source`, and `precision` and `standing` where you know them.

    tool_use {"name": "vehicles_drive", "args": {"vehicle": "Old van", "to": "The Far Road", "driver": "Bram", "riders": ["Odile"], "source": {"from": "prose", "message": "m-12"}}}
    tool_use {"name": "vehicles_classes", "args": {"domain": "road", "search": "van"}}
