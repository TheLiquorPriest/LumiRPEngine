---
description: How a reply, an intent record and a closing call are marked, in the form this connection uses. It says only how things are marked. Whether to write an intent record, and what goes in it, is in TURN.md. Who writes the reply is in WRITING.md. The tags' names are set here and nowhere else.
tags:
  reply: reply
  intent: intent
intent_file: scratch/intent.md
---
# The reply contract

{{#form.tags}}
- **The reply:** whatever the player should see goes between `<{{tags.reply}}>` and `</{{tags.reply}}>`. Nothing else you write reaches the chat.
- **An intent record,** when your instructions ask for one: between `<{{tags.intent}}>` and `</{{tags.intent}}>`.
- Tool calls may come before the reply, after it, or both. One reply per turn.
{{/form.tags}}
{{#form.two_step}}
- **Working text goes in files, never in a message.** Whatever is written as the text of a message is the reply, and the player sees it: a plan, a note or a line about what comes next is working text. An intent record, when your instructions ask for one: written to `{{intent_file}}` in the turn's folder with `file_write`.
- **The reply:** the plain text of a message of its own, written there directly and not into a file first. One reply per turn.
- **Calls in the reply's own message** run once the reply is out. A message with no call ends the turn.
{{/form.two_step}}

## Closing calls

A call marked `closing: true` is one that needs no answer and after which nothing is left to do this turn. When every closing call of a message comes back clean, and nothing else is due, the turn ends there, with no further call. If one comes back with a report, you get another call to read it. A call made before the reply has gone out is not a closing call: marked so, it would end the turn with no reply.
