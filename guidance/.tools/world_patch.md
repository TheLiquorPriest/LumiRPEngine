---
description: world_patch as the model is told it - what the tool does, and what each of its arguments is.
arguments:
  world: "A world, by its id; left out, the world this chat plays."
  ops: "The operations, in order: each an object with op (add, remove, replace, move, copy or test), path (a JSON pointer into the document) and, where it takes one, value or from."
---
Changes a world's draft by a list of JSON Patch operations, all or none, with the same checks as Build's. The draft is changed, not the world as kept: world_commit keeps it as the next revision.
