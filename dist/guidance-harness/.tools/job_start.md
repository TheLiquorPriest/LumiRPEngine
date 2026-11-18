---
description: job_start as the model is told it - what the tool does, and what each of its arguments is.
doing: starting a job in the background
arguments:
  agent: The name of the agent definition to start.
  brief: Its task, in full. It sees nothing of your conversation, only this and what you give it.
  attach: What to give it in full beside the task, each by name, as delegate takes them.
  plays: The character it plays, when it plays one.
  returns: What its report should hold, when you want it in a particular form.
  repeats: The id of an earlier job of this chat that was interrupted, failed or cancelled, to start it again. Its agent, its task, what it was given and its limits are used, except where you give others here.
---
Starts another agent on a task in the background, as its definition says: its own model, its own tools, its own instructions. It works on after this turn's reply, and nothing it says comes back to this call: the answer only says the job was started. What it last writes is its report, kept with the job; the system tells a later turn that it ended.
