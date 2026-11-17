---
description: How a reply and an intent record are marked, in the form this connection uses, and what ends a run. It says only how things are marked. Whether to write an intent record, and what goes in it, is in TURN.md. Who writes the reply is in WRITING.md. The tags' names are set here and nowhere else.
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
- **Working text goes in files, never in a message.** Whatever is written as the text of a message is the reply, and the player sees it: a plan, a note or a line about what comes next is working text. An intent record, when your instructions ask for one: written to `{{intent_file}}` in the turn's folder with `file_write`.
- **The reply:** the plain text of a message of its own, written there directly and not into a file first. One reply per turn. Calls in the reply's own message run once the reply is out.
{{/form.two_step}}

A message of yours that makes no call ends your run.
