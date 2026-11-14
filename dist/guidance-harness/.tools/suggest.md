---
description: suggest as the model is told it - what the tool does, and what each of its arguments is.
arguments:
  file: The file the change is for, as the agents see the files. Name one of file, lore and new_lore.
  lore: The id of the lore entry the change is for.
  new_lore: True when it is a new lore entry.
  text: The proposed text.
  reason: Why.
---
Puts a proposed change to one of the player's files, or to lore, before the player, with its reason. The player accepts it, changes it or dismisses it; the tool itself changes nothing.
