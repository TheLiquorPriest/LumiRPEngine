---
description: world_map_place as the model is told it - what the tool does, and what each of its arguments is.
arguments:
  map: "The map: its id or its title, as this chat plays it."
  place: "The place on the map to change or take off: its id or its name. Leave it out to put a new place on the map."
  name: "The place's name: Bluebird Coffee. For a place already on the map, its new name."
  id: "The id for a new place: letters, digits and _. Leave it out and it is made from the name."
  x: "Where it is on the map, from the left, a whole number from 0: a position in the map's frame on a node map, a square's column (from 0) on a grid map. It goes with y."
  y: "Where it is on the map, from the top, a whole number from 0. It goes with x."
  opens: "The map that draws the inside of this place: its id or title. That map's scope must be this place, so lay it first (map_lay)."
  remove: "true to take the place off the map, and its links with it."
  source: "Where it comes from: from is prose, lore, author, gm, character, player, default or invented; lore, message and roll cite an entry, a message or a roll by id; an invention cites its gap_check and consent."
  precision: "How exact: exact, approximate, vague or unknown."
  standing: "How it stands: established, proposed or assumed."
---
Puts a place on a map, moves it, renames it, says which map draws its inside (its opens), or takes it off. A place put on a map is a new place of the world, inside the map's scope, and its id must be one no place has yet. To put one, give map and name; to change one, name it in place and give what changes. A place's description and other fields are not the map's: they cannot be set here. Taking a place off the map takes it out of this chat's world, with the map's links to it. It writes this chat's own world, played at once and kept by world_keep; a map the world draws is changed square by square (map_edit). A call that leaves the map as it stands says so.
