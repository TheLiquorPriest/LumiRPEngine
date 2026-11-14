---
description: map_edit as the model is told it - what the tool does, and what each of its arguments is.
family: map
arguments:
  at: "The place whose map to change."
  strokes: "What to draw, in order: a symbol on squares, in a rectangle or along a line."
  strokes.symbol: "The symbol to draw: # wall, . floor, + door, a space nothing, or one of the legend's."
  strokes.squares: "Single squares, each [column, row]."
  strokes.rect: "A filled rectangle between two corner squares."
  strokes.line: "A line between two end squares."
  legend: "Symbols to add or change, as map_lay's legend: words are floor named by them, with \"blocks\": true a square nobody walks through ({\"b\": {\"terrain\": \"bar\", \"blocks\": true, \"seeThrough\": true}}); null takes one out."
  source: "Where it comes from: from is prose, lore, author, gm, character, player, default or invented; lore, message and roll cite an entry, a message or a roll by id; an invention cites its gap_check and consent."
  precision: "How exact: exact, approximate, vague or unknown."
  standing: "How it stands: established, proposed or assumed."
---
Changes part of a place's map of squares without redrawing it: squares, rectangles and lines drawn with a symbol, and its legend added to or changed, for a wall, a door, a fixture, terrain or a zone. The change is kept square by square over the map, so a later change to the world's own map still shows through. What a stroke reaches off the map is left out, and the answer says once for each such stroke how many of its squares that was; it also says which symbols no legend names, read as floor.
