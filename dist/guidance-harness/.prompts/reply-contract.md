---
description: How a reply, an intent record and a closing call are marked, in the form this connection uses. It says only how things are marked. Whether to write an intent record, and what goes in it, is for the instructions that ask for one. The tags' names are set here and nowhere else, and so is the file an intent record is written to when the tags are not used.
tags:
  reply: reply
  intent: intent
intent_file: scratch/intent.md
---
# The reply contract

{{#form.tags}}
- **The reply:** whatever the player should see goes between `<{{tags.reply}}>` and `</{{tags.reply}}>`. Nothing else you write reaches the chat.
- **An intent record,** when your instructions ask for one: between `<{{tags.intent}}>` and `</{{tags.intent}}>`, at the very start of your first message.
- Tool calls may come before the reply, after it, or both. One reply per turn.
{{/form.tags}}
{{#form.two_step}}
- **Working text goes in files, never in a message.** An intent record, when your instructions ask for one: written first to `{{intent_file}}` in the turn's folder with `file_write`.
- **The reply:** the plain text of a message of its own. One reply per turn.
- **What follows the reply rides with it.** A message with no call ends the turn. So whatever is to be recorded after the reply is called in the reply's own message, each call marked `closing: true` and no other call with them. They run once the reply is out.
{{/form.two_step}}

## Closing calls

A call marked `closing: true` is one that needs no answer and after which nothing is left to do this turn. When every closing call of a message comes back clean, and nothing else is due, the turn ends there, with no further call. If one comes back with a report, you get another call to read it. A call made before the reply has gone out is not a closing call: marked so, it would end the turn with no reply.
