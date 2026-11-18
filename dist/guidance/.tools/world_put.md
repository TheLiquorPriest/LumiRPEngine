---
description: world_put as the model is told it - what the tool does, and what each of its arguments is.
arguments:
  world: "A world, by its id; left out, the world this chat plays."
  collection: "The collection: entities, places, maps, rules and the others world_shape lists."
  id: "The item's id: a new one makes it, one there replaces it whole."
  value: "The item, as an object."
---
Puts one item into a collection of a world's draft, as Build does, with the same checks. The draft is changed, not the world as kept: world_commit keeps it as the next revision. The answer says where the draft stands and what the world's checks make of it.
