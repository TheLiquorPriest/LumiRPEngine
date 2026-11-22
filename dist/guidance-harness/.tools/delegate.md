---
description: delegate as the model is told it - what the tool does, and what each of its arguments is.
doing: giving another agent a task
arguments:
  agent: The name of the agent definition to start.
  brief: Its task, in full. It sees nothing of your conversation, only this and what you give it.
  attach: What to give it in full beside the task, each by name - file:<path> for a file (from the chat's folder, or from this turn's folder); chat:history[scene], chat:history[-30:] or chat:history[#120..#179] for a stretch of the chat; lore:<id> for a lore entry; prompt:<name> for a part of the prompt by the name the prompt tool gives it (prompt:persona, prompt:kind(style), prompt:history[-10:]); a thing of your own window by the name the window tool gives it (call:<id>, work:<id>..<id>, briefing:<section>, given:<name>, carry), whole, even where you let it go; or the name of a view of the story the system offers.
  plays: The character it plays, when it plays one.
  returns: What to send back, when you want it in a particular form.
  keep: true to keep the agent after this turn's reply goes out, so agent_message can still reach it; without it the agent ends when the reply goes out.
  for: The purpose you start it for, when its definition names purposes - it is given what its definition names for that purpose, in place of what it names for every start.
  leave: Names of what its definition gives it that it is not to be given this time, each as its definition writes it.
  preview: true to start nobody and see what it would be given, each name with its size in tokens and who named it.
---
Starts another agent on a task, as its definition says: its own model, its own tools, its own instructions. It works until it is done, and what it last says comes back as the answer to this call, with the name it goes by this turn. If it stops to ask you something, its question comes back instead, and agent_message answers it. Several delegate calls in one message run at the same time.
