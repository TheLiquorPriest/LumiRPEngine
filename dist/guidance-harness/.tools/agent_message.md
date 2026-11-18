---
description: agent_message as the model is told it - what the tool does, and what each of its arguments is.
arguments:
  agent: The name the agent goes by this turn, as the answer to delegate gave it, such as gm-1.
  message: What you tell it - the answer to its question, or what you want of it now.
  consent: Only when you allow it to invent something - topic, what may be invented; bounds, within what bounds; gap_check, the gap check it rests on. It is kept with the turn.
  keep: true keeps the agent past this turn's reply, false lets it end when the reply goes out; left out, it stays as it was.
---
Sends a message to an agent started this turn. It goes on from where it stopped, with everything it had; if it asked a question, the message is the answer. What it says next comes back as the answer to this call.
