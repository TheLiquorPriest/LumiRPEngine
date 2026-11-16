---
description: world_upgrade as the model is told it - what the tool does, and what each of its arguments is.
arguments:
  revision: "The revision of the world this chat plays to move it to, by its id; left out, the world's head."
---
Moves this chat on to another revision of the world it plays, from its next turn: each change the revision brings takes its default, and what play changed since stays as played. A turn that runs now keeps the revision it started with. The answer says the revision, whether the move took effect, and whether it waits for the next turn.
