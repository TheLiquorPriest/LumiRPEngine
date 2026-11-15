---
description: map_door as the model is told it - what the tool does, and what each of its arguments is.
arguments:
  at: "The place whose map the door is on."
  door: "The door's square, [column, row] from the top left."
  state: "open, closed or locked."
  source: "Where it comes from: from is prose, lore, author, gm, character, player, default or invented; lore, message and roll cite an entry, a message or a roll by id; an invention cites its gap_check and consent."
  precision: "How exact: exact, approximate, vague or unknown."
  standing: "How it stands: established, proposed or assumed."
---
Opens, closes or locks a door on a place's map of squares. A door that is not open blocks the way and the view until it is opened. The answer says how the door stood and how it stands now, and reports a door shut on someone standing in it.
