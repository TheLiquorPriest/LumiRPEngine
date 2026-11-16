---
description: How a reply, an intent record and a closing call are marked, in the form this connection uses. It says only how things are marked. Whether to write an intent record, and what goes in it, is in TURN.md. Who writes the reply is in WRITING.md. The tags' names are set here and nowhere else.
tags:
  reply: reply
  intent: intent
intent_file: scratch/intent.md
---
# The reply contract

## Closing calls

A call marked `closing: true` is one that needs no answer and after which nothing is left to do this turn. When every closing call of a message comes back clean, and nothing else is due, the turn ends there, with no further call. If one comes back with a report, you get another call to read it. A call made before the reply has gone out is not a closing call: marked so, it would end the turn with no reply.

## The marks

{{#form.tags}}
- **An intent record,** when your instructions ask for one: between `<{{tags.intent}}>` and `</{{tags.intent}}>`, at the very start of your first message, before the reply and before any call.
- **The reply:** whatever the player should see goes between `<{{tags.reply}}>` and `</{{tags.reply}}>`. Nothing else you write reaches the chat. The replies among this conversation's assistant turns are shown unmarked, as the chat saved them; the reply you write is marked.
- One reply per turn. Within one message the text comes first and its calls after it, so a message that opens with a call holds neither an intent record nor a reply. Calls may come before the reply, after it in the reply's own message, or both.

A first message that holds an intent record, the reply and calls is marked like this, its calls after the text:

```
<{{tags.intent}}>
…
</{{tags.intent}}>

<{{tags.reply}}>
…
</{{tags.reply}}>
```
{{/form.tags}}
{{#form.two_step}}
- **Working text goes in files, never in a message.** Whatever is written as the text of a message is the reply, and the player sees it: a plan, a note or a line about what comes next is working text. An intent record, when your instructions ask for one: written to `{{intent_file}}` in the turn's folder with `file_write`.
- **The reply:** the plain text of a message of its own, written there directly and not into a file first. One reply per turn.
- **Calls in the reply's own message** run once the reply is out. A message with no call ends the turn.
{{/form.two_step}}
