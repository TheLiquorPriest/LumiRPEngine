---
description: map_lay as the model is told it - what the tool does, and what each of its arguments is.
doing: laying out a map
arguments:
  place: "The place to lay a map for. With over and square, the name of a new place made on that square when none is drawn there; a place the square does not hold is not laid for, the one it holds is."
  rows: "The map's rows, top first, one symbol to a square: # wall, . floor, + door, a space nothing, and the legend's own symbols; a symbol no legend names reads as floor and is reported. At most 64 rows of 64 squares."
  width: "Without rows: a walled room this many squares wide, floor inside."
  height: "Without rows: how many squares high the room is."
  doors: "Without rows: the squares of the room's walls that are doors, each [column, row]; one outside the room is reported and not drawn."
  legend: "What the rows' other symbols stand for: wall, floor, door, or words, read as floor named by them ({\"~\": \"shallow water\"}); with \"blocks\": true a square nobody walks through ({\"T\": {\"terrain\": \"table\", \"blocks\": true}}); or {\"c\": {\"item\": \"chest\"}}, {\"z\": {\"zone\": \"dais\"}}."
  feet: "How wide a square is, in feet; the usual 5 ft when left out."
  title: "The map's title."
  over: "The place whose coarser map this one lies over one square of: a building on a town's map. Where that map draws the place, its square opens onto this map."
  square: "With over: that square of the coarser map, [column, row]."
  remove: "true to take the map of place out of this chat's world again, as when one was laid in error; whoever stood on its squares stands on none. Only the map laid in play is meant: the world's own map is changed square by square (map_edit)."
  source: "Where it comes from: from is prose, lore, author, gm, character, player, default or invented; lore, message and roll cite an entry, a message or a roll by id; an invention cites its gap_check and consent."
  precision: "How exact: exact, approximate, vague or unknown."
  standing: "How it stands: established, proposed or assumed."
---
Lays a map of squares for a place, as play goes: rows of symbols, or a walled room of a width and a height. A place that has a map already is laid over in this chat only, and the answer says so; the world's own map is untouched, and a swipe takes it back. A map is at most 64 by 64 squares: lay a larger place in parts, each its own place over its square of a coarser map. With over and square it lies over one square of a coarser map, for the place drawn there or a new one. The map belongs to the chat, and keeps how wide a square is and how time passes on it: a map of 5 ft squares counts rounds of seconds. Whoever stood on that coarse square stands on no square of the new map until placed on it. With remove it takes the map of the place out of this chat's world instead (a map laid in error), and the squares and doors drawn on it stay recorded, shown again if a map is laid there. To keep a laid map in the world, world_keep.
