---
description: How the tools that have a reply written by another agent are called - write_reply and reply_release. It says how to call them, not when. Delete this file and an agent that holds one of them is given no such guide.
---
write_reply hands the telling to the agent your definition names as its writer. The `brief` is all the writer has of the turn beside the prompt, so it holds the beats, outcomes, limits and point of view in words of their own. With `live` true the reply goes to the player as it is written and what went out comes back to you; without it the draft comes back and nothing is shown.

reply_release sends the waiting reply to the player whole: with no argument the writer's last draft, or, with `path`, the text of a file. One reply goes out per turn.

    write_reply {"brief": "Wren reaches the quay at dusk and finds the boat gone. She says nothing aloud. Her point of view, close, past tense."}
    reply_release {}
