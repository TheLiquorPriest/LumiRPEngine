---
description: map_lay as the model is told it - what the tool does, and what each of its arguments is.
family: map
arguments:
  place: "The place to lay a map for. With over and square, the name of a new place made on that square when none is drawn there."
  rows: "The map's rows, top first, one symbol to a square: # wall, . floor, + door, a space nothing, and the legend's own symbols."
  width: "Without rows: a walled room this many squares wide, floor inside."
  height: "Without rows: how many squares high the room is."
  doors: "Without rows: the squares of the room's walls that are doors, each [column, row]."
  legend: "What the rows' other symbols stand for, such as {\"T\": {\"terrain\": \"table\", \"blocked\": true}}, {\"c\": {\"item\": \"chest\"}} or {\"z\": {\"zone\": \"dais\"}}."
  feet: "How wide a square is, in feet; the usual 5 ft when left out."
  title: "The map's title."
  over: "The place whose coarser map this one lies over one square of: a building on a town's map."
  square: "With over: that square of the coarser map, [column, row]."
  source: "Where it comes from: from is prose, lore, author, gm, character, player, default or invented; lore, message and roll cite an entry, a message or a roll by id; an invention cites its gap_check and consent."
  precision: "How exact: exact, approximate, vague or unknown."
  standing: "How it stands: established, proposed or assumed."
---
Lays a map of squares for a place that has none, as play goes: rows of symbols, or a walled room of a width and a height. With over and square it lies over one square of a coarser map, for the place drawn there or a new one. The map belongs to the chat, and keeps how wide a square is and how time passes on it: a map of 5 ft squares counts rounds of seconds. Whoever stood on that coarse square stands on no square of the new map until placed on it.
