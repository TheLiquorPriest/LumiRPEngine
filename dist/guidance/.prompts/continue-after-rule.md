---
description: The line under which an agent goes on after one of your rules stopped what it was writing. The rule's own text comes just before this. It is there only when the player had been shown some of the reply; a draft, or a reply stopped before any of it was shown, goes on under the rule's text alone. `shown` is the end of what the player was shown; `form.tags` or `form.two_step` says how the reply is marked on the agent's connection, and `tags.reply` is the reply's tag in the tag form.
---
{{#shown}}
The player has already been shown the text below. Go on from where it ends, without repeating any of it.
{{#form.tags}}
Write what follows between `<{{tags.reply}}>` and `</{{tags.reply}}>`, as you write the reply: only text so marked reaches the chat, and it is put straight after what was shown.
{{/form.tags}}
{{#form.two_step}}
Write what follows as the text of your next message: it is put straight after what was shown.
{{/form.two_step}}

{{shown}}
{{/shown}}
