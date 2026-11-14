---
description: file_read as the model is told it - what the tool does, and what each of its arguments is.
arguments:
  path: The file's path as the agents see the files, from the chat's folder; the other levels are under their own names, such as @global/.
  start: The first line to read, counted from 1. Leave it out to read from the start.
  end: The last line to read. Leave it out to read to the end.
---
Reads a file, or some of its lines. The text comes back as it is in the file.
