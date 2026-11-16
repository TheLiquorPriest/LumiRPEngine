---
description: story_query as the model is told it - what the tool does, and what each of its arguments is.
arguments:
  part: "Which part: premise, chapter, scene, beat, thread, arc, player, future, canon, retcon or record. Leave it out for every part."
  id: "One item, by its id."
  from: "Only what lies from this message on, by number."
  to: "Only what lies up to this message, by number."
  who: "Only what involves this name; for a scene, who is on stage."
  quest: "Only the beats that moved this quest: its name or id."
  place: "Only what happened or lies at this place: its name or id; a place of the world is matched by its ref, any other by its words."
  open: "true: only chapters, scenes, threads and futures not closed."
  due: "true: only futures whose time has come."
  hot: "true: only the threads you hold hot."
  history: "true: each item with every write of it, oldest first."
---
Reads the story record as it stands on this turn's path. Each item comes with its id, the messages it lies in, and touched: the message of the turn that last wrote it (empty for this turn, whose reply is not saved yet). Messages are numbered as the story so far numbers them.
