---
description: How the tools that read and search the chat are called - chat_read and chat_search. It says how to call them, not when. Delete this file and an agent that holds one of them is given no such guide.
---
chat_read reads messages in full, whether or not they are in the prompt. Positions count the chat's first message as 0. Give a stretch by `from` and `to` (both included), by `from_id` and `to_id`, or `last` for the last so many. One read gives at most as many messages as its answer says; read on with another call. chat_search takes `query`, names and words, and gives each hit with its position and id; read a hit in full with chat_read.

    chat_read {"from": 120, "to": 130}
    chat_search {"query": "the reeve's letter"}
