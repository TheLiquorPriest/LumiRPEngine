---
description: write_reply as the model is told it - what the tool does, and what each of its arguments is. Its writer is the agent definition that writes the reply when write_reply is called.
writer: narrator
arguments:
  brief: What the writer is to tell - what happens, in order, with the outcomes, what must and must not be said, and the point of view.
  live: True to send the reply to the player as it is written, with no draft to read first.
---
Hands the telling of the reply to another writer. A reply you write yourself needs no tool: this one is only for when someone else is to write it. The writer works on the prompt exactly as the chat application sent it, with the preset's own sampling and its prefilled start, and with your brief. Without live, the draft comes back to you, and nothing is shown until you release it with reply_release. With live, the reply reaches the player as it is written, and what went out comes back to you.
