---
description: How the tools that start other agents and talk to them are called - delegate, ask_author, agent_message and agent_drop. It says how to call them, not when. Delete this file and an agent that holds one of them is given no such guide.
---
delegate takes the definition's name as `agent`, the whole task as `brief` (the agent sees only the brief and what you `attach`, a list of names such as `file:<path>`, `chat:history[-30:]` or `lore:<id>`). Several delegate calls in one message run at the same time. What comes back is what the agent last said, with the name it goes by this turn (such as gm-1), which agent_message and agent_drop take as `agent`.

    delegate {"agent": "gm", "brief": "Rule whether Wren can swim the channel at night.", "attach": ["chat:history[-30:]", "lore:e-12"]}

agent_message goes on with an agent that stopped; if it asked a question, the message is the answer. Only to allow it to invent something, add `consent`: `topic`, and where you have them `bounds` and `gap_check` (the id of the gap check it rests on). agent_drop takes back everything the named agent wrote this turn. ask_author is for an agent that was given a task: `question` in full and, in `searched`, what it looked for and where; the answer comes back to the same call.
