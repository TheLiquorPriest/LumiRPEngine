---
description: world_commit as the model is told it - what the tool does, and what each of its arguments is.
arguments:
  world: "A world, by its id; left out, the world this chat plays."
  note: "A note for the world's history, at most 200 characters."
---
Keeps a world's draft as its next revision, which becomes the head. A draft the world's own checks refuse is not kept, and the answer says why. Chats that play an older revision stay on it until they are moved on.
