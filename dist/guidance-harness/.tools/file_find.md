---
description: file_find as the model is told it - what the tool does, and what each of its arguments is.
doing: looking for files
arguments:
  by: How to look - list (what is in a folder), glob (paths that match a pattern such as **/*.md), or grep (lines that match a pattern).
  path: The folder to look in. Leave it out to look from the top.
  pattern: For glob, the pattern the paths must match; for grep, what the lines must match, as a regular expression unless literal is true.
  literal: For grep, the pattern is plain text.
  ignore_case: For grep, upper and lower case count as the same.
  glob: For grep, only files whose path matches this pattern.
  depth: For list, how many folders deep to list; one when left out.
  limit: The most results to give.
---
Finds files and folders in the agents' files: lists a folder, matches paths against a pattern, or finds the lines that match a pattern. Each result is one line. When a search stopped before it looked everywhere, a last line says why and how to narrow it.
