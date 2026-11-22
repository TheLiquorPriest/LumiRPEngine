---
description: How the tools that read and search the chat are called - chat_read and chat_search. It says how to call them, not when. Delete this file and an agent that holds one of them is given no such guide.
---
chat_read reads messages, whether or not they are in the prompt. Positions count the chat's first message as 0. Give a stretch by `from` and `to` (both included), by `from_id` and `to_id`, or `last` for the last so many. One read gives at most as many messages as its answer says; read on with another call. `how` says how much of each message: `whole` (in full, which is what it gives when `how` is left out), `part` (its lines from `start` to `end`, counted from 1; with no `end`, as many lines as one part holds), or `gist` (its first line); a message not given whole is followed by a line that says how much it is of how much. With `question`, a reader reads the stretch in full and answers it: you are given its answer, the line that says which stretch it read, and none of the messages. chat_search takes `query`, names and words, and gives each hit with its position and id; read a hit in full with chat_read.

    chat_read {"from": 120, "to": 130}
    chat_read {"from": 120, "to": 160, "how": "gist"}
    chat_read {"from": 40, "to": 139, "question": "What did the reeve promise the ferryman, in his own words, and when?"}
    chat_search {"query": "the reeve's letter"}
