---
description: cast_query as the model is told it - what the tool does, and what each of its arguments is.
arguments:
  who: "The character, by name or id. Leave it out for who is in the cast, and as what."
  part: "Which part: sources, base, casting, growth, mind, relationships, knowledge or history. Leave it out for every part."
  with: "relationships: only toward this person."
  words: "Only entries that hold all of these words."
  history: "true: every version of the base, and each entry with every write of it, oldest first; struck entries too."
  skip: "Skip this many entries of each part first, to see the rest of a long one."
---
Reads a character's record as it stands on this turn's path. Sources are read from Lumiverse as they are now; one marked newer than the base has changed since the base was drawn from it. Each entry comes with its id, its date in story time, and since and touched: the messages of the turns that first and last wrote it (empty for this turn, whose reply is not saved yet).
