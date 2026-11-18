---
description: map_place as the model is told it - what the tool does, and what each of its arguments is.
arguments:
  at: "The place whose map they go on."
  pieces: "Each person or thing to put on the map, in order."
  pieces.who: "Who or what."
  pieces.square: "The square it stands on, [column, row] from the top left; its top left square when it covers more than one."
  pieces.near: "Someone or something to stand beside, on the nearest free square, or on the nearest square there is when the room is full; where they stand on no square, the words stay as where it is."
  pieces.zone: "A zone of the map to stand in, on its free square nearest the middle; a zone the map has not stays as where it is."
  pieces.on: "A thing to lie on or in, the lantern on the table: it shares that thing's square and moves with it."
  pieces.lift: "true to take it off the map: it stays at the place with no square."
  pieces.walk: "true when it walks to the square from where it stands: the answer gives the way and the time it took."
  pieces.size: "Its footprint, [columns, rows], for what covers more than one square."
  pieces.blocks: "What its footprint blocks: way, view, both or none."
  pieces.source: "Where this piece's position comes from, where it differs from the call's own; the same as source."
  pieces.precision: "How exact this piece's position is, where it differs from the call's own."
  pieces.standing: "How this piece's position stands, where it differs from the call's own: established for what the prose says, assumed for what you put by plain sense."
  why: "Why a thing comes to someone by this, kept with it as how they came to have it. A square, a footprint or where someone stands keeps no reason."
  source: "Where it comes from: from is prose, lore, author, gm, character, player, default or invented; lore, message and roll cite an entry, a message or a roll by id; an invention cites its gap_check and consent."
  precision: "How exact: exact, approximate, vague or unknown."
  standing: "How it stands: established, proposed or assumed."
---
Puts people and things on a place's map of squares, many in one call: each on a square, beside someone, in a zone, on a thing, or off the map, with one of square, near, zone, on or lift; and gives a thing its footprint and what it blocks. Someone at another place is brought to this one first. Each is recorded as a change of position, applied as given, with a report of what does not add up: a square in a wall, over something that blocks, no way there, a room with no free square. A square you did not give, beside someone or in a zone, is recorded as assumed. Where the place has no map, a zone or words stay as where someone is; only a square that does not exist is refused, and the answer says what does. The answer says where each now stands.
