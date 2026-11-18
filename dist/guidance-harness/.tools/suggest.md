---
description: suggest as the model is told it - what the tool does, and what each of its arguments is.
arguments:
  file: The file the change is for, as the agents see the files. Name one of file, lore and new_lore.
  lore: The id of the lore entry the change is for.
  new_lore: True when it is a new lore entry.
  text: The proposed text. For an edit of an entry, the passage as it would be.
  reason: Why.
  book: For a new lore entry, the book it goes in.
  title: For a new lore entry, its title.
  keys: For a new lore entry, the words that bring it into the prompt, as a list.
  was: For an edit of an entry, the passage as it stands now.
---
Puts a proposed change to one of the player's files, or to lore, before the player, with its reason. A lore suggestion is shown to the player whole: a new entry with its book, title, keys and text, an edit with the passage as it stands and as it would be. The player accepts it, changes it or dismisses it; the tool itself changes nothing. The chat holds only so many suggestions waiting for the player at once.
