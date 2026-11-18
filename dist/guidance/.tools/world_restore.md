---
description: world_restore as the model is told it - what the tool does, and what each of its arguments is.
arguments:
  world: "A world, by its id; left out, the world this chat plays."
  revision: "The revision to bring back, by its id: world_history lists them."
---
Brings a kept revision back into a world's draft, which it replaces. The draft is changed, not the world as kept: world_commit keeps it as the next revision.
