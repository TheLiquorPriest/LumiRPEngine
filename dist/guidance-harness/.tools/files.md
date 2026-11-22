---
description: How the tools that read, find and write files are called - file_read, file_find and file_write. It says how to call them, not when. Delete this file and an agent that holds one of them is given no such guide.
---
Paths are the files as the agents see them, from the chat's folder; the other levels are under their own names, such as `@global/`. file_find looks by `by` (list, glob or grep) with a `pattern` and where, and gives each file with its size; file_read reads one file, or the lines from `start` to `end`, counted from 1. With `how` set to `part`, file_read gives the lines from `start` (as many as one part holds when no `end` is named) and a line that says which lines they are of how many; with `gist`, the file's first line and its size. With `question`, a reader reads the file (or the lines from `start` to `end`) and answers it: you are given its answer and none of the text.

    file_find {"by": "grep", "pattern": "harbour", "glob": "**/*.md"}
    file_read {"path": "persistent-workspace/notes.md", "start": 1, "end": 40}
    file_read {"path": "persistent-workspace/notes.md", "how": "part", "start": 200}
    file_read {"path": "persistent-workspace/notes.md", "question": "Which of these notes are about the harbour, and what does each say?"}

file_write changes one file where agents may write: the notes folder and this turn's own folders. `op` is write, append, edit (`old` is the text to replace exactly as the file has it, `new` what replaces it) or delete. The answer shows what the file now says, so no read is needed after it.

    file_write {"path": "persistent-workspace/notes.md", "op": "edit", "old": "dusk", "new": "dawn"}

A write that waits for the player's answer, because the player set it to Confirm, holds the other calls of its message until the answer comes. Such a write is best sent alone or last.
