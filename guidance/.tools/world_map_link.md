---
description: world_map_link as the model is told it - what the tool does, and what each of its arguments is.
arguments:
  map: "The map: its id or its title, as this chat plays it."
  from: "One end of the link: a place, by its name or id."
  to: "The other end: a place, by its name or id."
  mode: "The way of travelling: walk, road (driving), offroad or water (by boat). Walk when left out for a new link; needed to pick one when the two places have several links."
  minutes: "How long the link takes, in minutes. Needed for a new link."
  one_way: "true: the link only leads from from to to. false: both ways. Left out, a new link goes both ways and an existing one stays as it is."
  remove: "true to remove the link instead: the one of that mode when mode is given, else every link between the two."
  source: "Where it comes from: from is prose, lore, author, gm, character, player, default or invented; lore, message and roll cite an entry, a message or a roll by id; an invention cites its gap_check and consent."
  precision: "How exact: exact, approximate, vague or unknown."
  standing: "How it stands: established, proposed or assumed."
---
Links two places on a map so people can travel between them, changes a link, or removes one. A map's links become the world's paths. Once a map has any link, its places join only where they are linked: link every place of the map, or none. Two places may have one link for each way of travelling. A link may also lead to a place that is not on the map, by its id. It writes this chat's own world, played at once and kept by world_keep. A call that leaves the map as it stands says so.
