---
description: chat_read as the model is told it - what the tool does, and what each of its arguments is.
arguments:
  from: The position of the first message, counted from 0. Leave it out to start at the first.
  to: The position of the last message, included. Leave it out to read to the end.
  from_id: The id of the first message, in place of from.
  to_id: The id of the last message, in place of to.
  last: The last this many messages, in place of the others.
---
Reads messages of the chat, each in full, whether or not they are in the prompt. Each comes with its position, its id and who wrote it; a hidden or summarized one is marked.
