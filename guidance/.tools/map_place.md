---
description: map_place as the model is told it - what the tool does, and what each of its arguments is.
family: map
arguments:
  at: "The place whose map they go on."
  pieces: "Each person or thing to put on the map, in order."
  pieces.who: "Who or what."
  pieces.square: "The square it stands on, [column, row] from the top left; its top left square when it covers more than one."
  pieces.near: "Someone or something to stand beside, on the nearest free square."
  pieces.zone: "A zone of the map to stand in, on its free square nearest the middle."
  pieces.on: "A thing to lie on or in, the lantern on the table: it shares that thing's square and moves with it."
  pieces.lift: "true to take it off the map: it stays at the place with no square."
  pieces.walk: "true when it walks to the square from where it stands: the answer gives the way and the time it took."
  pieces.size: "Its footprint, [columns, rows], for what covers more than one square."
  pieces.blocks: "What its footprint blocks: way, view, both or none."
  why: "Why a thing comes to someone by this, kept with it as how they came to have it. A square, a footprint or where someone stands keeps no reason."
  source: "Where it comes from: from is prose, lore, author, gm, character, player, default or invented; lore, message and roll cite an entry, a message or a roll by id; an invention cites its gap_check and consent."
  precision: "How exact: exact, approximate, vague or unknown."
  standing: "How it stands: established, proposed or assumed."
---
Puts people and things on a place's map of squares, many in one call: each on a square, beside someone, in a zone, on a thing, or off the map, with one of square, near, zone, on or lift; and gives a thing its footprint and what it blocks. Someone at another place is brought to this one first. Each is recorded as a change of position, applied as given, with a report of what does not add up: a square in a wall, over something that blocks, no way there. The answer says where each now stands.
