---
description: job_start as the model is told it - what the tool does, and what each of its arguments is.
arguments:
  agent: The name of the agent definition to start.
  brief: Its task, in full. It sees nothing of your conversation, only this and what you give it.
  attach: What to give it in full beside the task, each by name, as delegate takes them.
  plays: The character it plays, when it plays one.
  returns: What its report should hold, when you want it in a particular form.
---
Starts another agent on a task in the background, as its definition says: its own model, its own tools, its own instructions. It works on after this turn's reply, and nothing it says comes back to this call: the answer only says the job was started. What it last writes is its report, kept with the job; the system tells a later turn that it ended.
