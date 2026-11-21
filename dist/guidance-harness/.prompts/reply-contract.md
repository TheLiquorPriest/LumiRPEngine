---
description: How a reply and an intent record are marked, in the form this connection uses, and what ends a run. It says only how things are marked. Whether to write an intent record, and what goes in it, is for the instructions that ask for one. The tags' names are set here and nowhere else, and so is the file an intent record is written to when the tags are not used.
tags:
  reply: reply
  intent: intent
intent_file: scratch/intent.md
---
# The reply contract

{{#form.tags}}
- **An intent record,** when your instructions ask for one: between `<{{tags.intent}}>` and `</{{tags.intent}}>`, at the head of your first message.
- **The reply:** whatever the player should see goes between `<{{tags.reply}}>` and `</{{tags.reply}}>`. Nothing else you write reaches the chat. The replies among this conversation's assistant turns are shown unmarked, as the chat saved them; the reply you write is marked.
- One reply per turn. Within one message the text comes first and its calls after it. Calls may come before the reply, after it, or both.
{{/form.tags}}
{{#form.two_step}}
- **Working text goes in files, never in a message.** An intent record, when your instructions ask for one: written first to `{{intent_file}}` in the turn's folder with `file_write`.
- **The reply:** the plain text of a message that makes no call. One reply per turn. The text of a message that makes a call is never shown.
{{/form.two_step}}

Whatever language you write in, a name these instructions give you is written exactly as given: a tag, a file's path, the label of a line of the intent record, a field of a record, a tool and its arguments, an id.

A message of yours that makes no call ends your run.
