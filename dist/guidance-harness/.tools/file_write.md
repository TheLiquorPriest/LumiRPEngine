---
description: file_write as the model is told it - what the tool does, and what each of its arguments is.
doing: writing to a file
arguments:
  path: The file's path as the agents see the files, from the chat's folder.
  op: What to do - write (make the file, or replace it whole), append (add to its end, making it if needed), edit (replace a piece of its text), or delete.
  text: For write and append, the text.
  old: For edit, the text to replace, exactly as it is in the file.
  new: For edit, the text to put in its place.
  all: For edit, replace the old text everywhere it is, not only once.
---
Changes one file where agents may write: the notes folder, and this turn's own folders. It says what changed and how large the file is now, and shows what the file now says: its text after a write or an append, the lines it changed, with their numbers, after an edit.
