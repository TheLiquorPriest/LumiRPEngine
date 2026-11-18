---
description: How the two tools that reach the rest of the tools are called - tool_search and tool_use. It says how to call them, not when. Delete this file and an agent that holds one of them is given no such guide.
---
tool_search takes `words`, what to look for: what a tool does, its name or its family; `limit` caps how many come back. Each tool found comes with its name, its family, a line on what it does and the arguments it takes.

tool_use takes `name`, the tool's name as tool_search gave it, and `args`, one object holding that tool's own arguments. The answer is that tool's own answer.

    tool_search {"words": "job"}
    tool_use {"name": "job_list", "args": {}}
