---
description: How a reply, an intent record and a closing call are marked, in the form this connection uses. It says only how things are marked. Whether to write an intent record, and what goes in it, is in TURN.md. Who writes the reply is in WRITING.md. The tags' names are set here and nowhere else.
tags:
  reply: reply
  intent: intent
---
# The reply contract

{{#form.tags}}
- **The reply:** whatever the player should see goes between `<{{tags.reply}}>` and `</{{tags.reply}}>`. Nothing else you write reaches the chat.
- **An intent record,** when your instructions ask for one: between `<{{tags.intent}}>` and `</{{tags.intent}}>`, at the very start of your first message.
- Tool calls may come before the reply, after it, or both. One reply per turn.
{{/form.tags}}
{{#form.two_step}}
- **Working text goes in files, never in a message.** An intent record, when your instructions ask for one: written first to `scratch/intent.md` in the turn's folder with `file_write`.
- **The reply:** the plain text of a message of its own. That message may carry closing calls and nothing else. One reply per turn.
{{/form.two_step}}

## Closing calls

A call marked `closing: true` is one that needs no answer. When every closing call of a message comes back clean, and nothing else is due, the turn ends there, with no further call. If one comes back with a report, you get another call to read it.
