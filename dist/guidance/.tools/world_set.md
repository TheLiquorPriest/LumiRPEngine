---
description: world_set as the model is told it - what the tool does, and what each of its arguments is.
doing: setting a part of the world's draft
arguments:
  world: "A world, by its id; left out, the world this chat plays."
  part: "The part: calendar, realism, time, meta, tiers, ruleset, loreIndex, minds, lorePins, routineSettings or needs."
  value: "The part's new value, whole."
---
Sets one part of a world's draft whole, as Build does, with the same checks. The draft is changed, not the world as kept: world_commit keeps it as the next revision.
