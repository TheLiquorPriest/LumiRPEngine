---
description: The facts of the turn at hand, as the briefing shows them under the turn's kind. Its fields are kind, speaker, message (the message the reply is saved to), story_time (where the world keeps a clock) and settle (set for a Settle now run, which goes on with the turn as a continue does). It lays facts out; it asks for nothing.
---
{{#settle}}
- This run is a Settle now of the turn, which the player asked for from the Turn page. It writes no reply.
{{/settle}}
{{#message}}
- The reply goes into message {{message}}.
{{/message}}
{{#story_time}}
- Story time: {{story_time}}.
{{/story_time}}
