---
description: story_query as the model is told it - what the tool does, and what each of its arguments is.
doing: reading the story record
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
  how: "gist: each item by what the record holds that stands for it, its title and its summary, with the size of the whole. whole, or left out: each item whole."
  question: "A question about what this call reads. A reader reads the answer whole (each item whole, unless you name a how) and answers it: you are given its answer and none of the record."
---
Reads the story record as it stands on this turn's path. Each item comes with its id, the messages it lies in, and touched: the message of the turn that last wrote it (empty for this turn, whose reply is not saved yet). Messages are numbered as the story so far numbers them. Asked for gists, it answers with what each item is and how large it is whole, so that you can read whole only what you need: a part of the record is asked for by the arguments above.

Asked with a question, it hands its answer to a reader and gives you what the reader says in its place.
