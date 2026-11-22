---
description: chat_read as the model is told it - what the tool does, and what each of its arguments is.
doing: reading the chat
arguments:
  from: The position of the first message, counted from 0. Leave it out to start at the first.
  to: The position of the last message, included. Leave it out to read to the end.
  from_id: The id of the first message, in place of from.
  to_id: The id of the last message, in place of to.
  last: The last this many messages, in place of the others.
  story: True to give only the messages that are part of the story. Leave it out to give every message.
  how: How much of each message - whole (its text in full, which is what it gives when you leave this out), part (some of its lines), or gist (its first line, since the chat keeps no shorter form of a message).
  start: With how part, the first line of each message to give, counted from 1. Leave it out to start at the first.
  end: With how part, the last line of each message to give. Leave it out for as many lines as one part holds.
  question: A question about these messages. A reader reads them in full and answers it, and its answer is what you are given in place of the messages; how, start and end are then left aside.
---
Reads messages of the chat, whether or not they are in the prompt: each in full, or as much of each as you ask for. Each comes with its position, its id and who wrote it; a hidden or summarized one is marked, and so is one the chat's story choice leaves out of the story. A message not given whole is followed by a line that says how much it is of how much. Asked with a question, it gives the answer of a reader that read the messages in full, and not the messages.
