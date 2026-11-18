---
description: The line under which an agent goes on after a call to its model broke off (the connection was lost, the provider failed) once the player had been shown some of the reply, and the call is made again. Nothing of the broken call is kept but what the player was shown. A call that broke before any of the reply was shown is made again as it was, with no line. `shown` is the end of what the player was shown; `form.tags` or `form.two_step` says how the reply is marked on the agent's connection, and `tags.reply` is the reply's tag in the tag form.
---
{{#shown}}
Your last answer broke off before it ended, and only what the player was shown of it is kept. The player has already been shown the text below. Go on from where it ends, without repeating any of it.
{{#form.tags}}
Write what follows between `<{{tags.reply}}>` and `</{{tags.reply}}>`, as you write the reply: only text so marked reaches the chat, and it is put straight after what was shown.
{{/form.tags}}
{{#form.two_step}}
Write what follows as the text of your next message: it is put straight after what was shown.
{{/form.two_step}}

{{shown}}
{{/shown}}
