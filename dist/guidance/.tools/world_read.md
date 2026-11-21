---
description: world_read as the model is told it - what the tool does, and what each of its arguments is.
doing: reading the world's document
arguments:
  world: "A world, by its id; left out, the world this chat plays."
  source: "draft (the working copy Build edits; the default), playing (the world as this chat plays it) or revision (a kept revision, named in revision)."
  revision: "With source revision: the revision to read."
  at: "Where to read, as a JSON pointer into the document (/entities/bram); left out, the whole document, outlined when it is too long for one answer."
---
Reads a world's document: the draft, what this chat plays, or a kept revision. A value too long for one answer is given as an outline of what it holds, to read further into with at. Nothing is changed.
