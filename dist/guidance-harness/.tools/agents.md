---
description: How the tools that start other agents and talk to them are called - delegate, task, ask_author, agent_message and agent_drop. It says how to call them, not when. Delete this file and an agent that holds one of them is given no such guide.
---
delegate takes the definition's name as `agent`, the whole task as `brief` (the agent sees only the brief and what you `attach`, a list of names such as `file:<path>`, `chat:history[-30:]` or `lore:<id>`). Several delegate calls in one message run at the same time. What comes back is what the agent last said, with the name it goes by this turn (such as gm-1), which agent_message and agent_drop take as `agent`.

    delegate {"agent": "gm", "brief": "Rule whether Wren can swim the channel at night.", "attach": ["chat:history[-30:]", "lore:e-12"]}

A definition gives an agent what it names for every start, and may name what it gives for each purpose: `for` names the purpose, and `leave` the names of its list not to give this time. With `preview: true`, nobody starts: the answer lists what it would be given, each name with its size and who named it.

    delegate {"agent": "gm", "brief": "Rule on the jump.", "for": "check", "leave": ["chat:history[scene]"], "preview": true}

task starts several pieces at once and answers once all have ended. Each piece is an instance of a definition, your own unless `agent` names another (for every piece, or in one piece for that piece), with its own `brief`, and `attach`, `for` and `leave` as delegate takes them; `attach` also takes the names of your own window, such as `call:<id>`. `shared` is told to every piece once; `together: true` gives the pieces one notes file. A piece with `fork: true` starts from your own work as it stands. Each receipt names the lines of the file that hold the piece's whole answer.

    task {"shared": "The storm reaches Gannet Rock tonight.", "pieces": [{"brief": "Rule whether the supply boat can land.", "name": "boat"}, {"brief": "Say what Wren knows of the storm.", "fork": true, "name": "wren"}]}

Work over a list goes in batches, one piece each: `shared` holds what every batch is told, each piece's `brief` names its own batch, and `together: true` gives them one running note to read and add to. Each piece starts with its own batch and nothing of the others', so what one batch read does not ride on the next.

    task {"shared": "For each entry, write its subject, its places and its people.", "together": true, "pieces": [{"brief": "Entries 1 to 40.", "name": "batch 1"}, {"brief": "Entries 41 to 80.", "name": "batch 2"}, {"brief": "Entries 81 to 120.", "name": "batch 3"}]}

agent_message goes on with an agent that stopped; if it asked a question, the message is the answer. Only to allow it to invent something, add `consent`: `topic`, and where you have them `bounds` and `gap_check` (the id of the gap check it rests on). agent_drop takes back everything the named agent wrote this turn. ask_author is for an agent that was given a task: `question` in full and, in `searched`, what it looked for and where; the answer comes back to the same call.
