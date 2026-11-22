---
description: file_read as the model is told it - what the tool does, and what each of its arguments is.
doing: reading a file
arguments:
  path: The file's path as the agents see the files, from the chat's folder; the other levels are under their own names, such as @global/.
  start: The first line to read, counted from 1. Leave it out to read from the start.
  end: The last line to read. Leave it out to read to the end; with how part, for as many lines as one part holds.
  how: How much of the file - whole (all of it, which start and end narrow when you leave this out), part (lines from start, with a line under them that says which lines they are of how many), or gist (its first line and its size).
  question: A question about the file. A reader reads it (the lines from start to end, where you name any) and answers it, and its answer is what you are given in place of the text; how is then left aside.
---
Reads a file, or some of its lines. The text comes back as it is in the file. Asked for a part or the gist, a line under the text says how much it is of how much. Asked with a question, it gives the answer of a reader that read the file, and not its text.
