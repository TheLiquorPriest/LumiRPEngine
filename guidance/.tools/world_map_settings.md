---
description: world_map_settings as the model is told it - what the tool does, and what each of its arguments is.
doing: changing how the world's maps work
arguments:
  display: "What the player's map shows: knowledge (the places the player character knows, those only heard of drawn dashed) or fog (fog over what it has not seen)."
  grid_movement: "true: the grid system is on, so walls and doors steer people across grid maps, things lie on squares, and squares and zones can trigger rules. false: grid maps are drawn, not walked."
  sight_radius: "With the grid system on, how many squares around it the player character sees: a whole number."
  travel_simulation: "true: going somewhere needs a path that leads there. false: a move the story tells simply lands."
  source: "Where it comes from: from is prose, lore, author, gm, character, player, default or invented; lore, message and roll cite an entry, a message or a roll by id; an invention cites its gap_check and consent."
  precision: "How exact: exact, approximate, vague or unknown."
  standing: "How it stands: established, proposed or assumed."
---
Changes how the world's maps work: what the player's map shows, whether people walk grid maps square by square, how far the player character sees on one, and whether travel needs a path. Give only what changes; the answer gives the settings as they stand after it. It writes this chat's own world, played at once and kept by world_keep.
