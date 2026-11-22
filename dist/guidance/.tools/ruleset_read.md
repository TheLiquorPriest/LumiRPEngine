---
description: ruleset_read as the model is told it - what the tool does, and what each of its arguments is.
doing: reading a part of the ruleset
arguments:
  part: "The part of the ruleset, by its name as the ruleset's index lists it (bestiary, checks, actions, and the world's own parts)."
  id: "One entry of that part, by its id or its name; left out, the part whole."
---
Reads one part of the world's ruleset whole, or one entry of it: the same data world_query gives at ruleset, a part at a time. A part the ruleset does not have is answered with the parts it has. Nothing changes.
