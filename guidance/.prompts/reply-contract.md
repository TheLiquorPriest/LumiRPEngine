# The reply contract

This file says only how things are marked. Whether to write an intent record, and what goes in it, is in `TURN.md`. Who writes the reply is in `WRITING.md`.

## For connections that keep tags

- **The reply:** whatever the player should see goes between `<reply>` and `</reply>`. Nothing else you write reaches the chat.
- **An intent record,** when your instructions ask for one: between `<intent>` and `</intent>`, at the very start of your first message.
- Tool calls may come before the reply, after it, or both. One reply per turn.

## For connections that do not keep tags

- **Working text goes in files, never in a message.** An intent record, when your instructions ask for one: written first to `scratch/intent.md` in the turn's folder with `file_write`.
- **The reply:** the plain text of a message of its own. That message may carry closing calls and nothing else. One reply per turn.

## Closing calls

A call marked `closing: true` is one that needs no answer. When every closing call of a message comes back clean, and nothing else is due, the turn ends there, with no further call. If one comes back with a report, you get another call to read it.
