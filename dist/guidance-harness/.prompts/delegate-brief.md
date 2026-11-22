---
description: The frame put around every brief a sub-agent or a piece of a task is sent. It says whether the work is a turn's or a job's, and whom the agent plays, where it plays someone; for a fork, that it is a fork, that everything above the brief is its own work so far, and that the rest of that work, the reply among it, stays with the one that started it. What every piece of a task is told comes first, then the task the lead writes, the notes file the pieces share where they share one, and the attachments in full. It asks for nothing. What a sub-agent does when something is missing is in the consent rule, which it reads.
---
{{#fork}}
You are a fork: everything above this message is your own work up to the call that started you, and this one task is yours. The rest of that work stays with the one that started you, the reply to the player among it: do this task, and answer with what it asks for.
{{/fork}}
{{^fork}}
{{#job}}
You are working on a job, for the agent that started you. A job runs in the background, apart from the turns of the roleplay: no reply to the player is owed.
{{/job}}
{{^job}}
You are working for the lead on one turn of a roleplay.
{{/job}}
{{#plays}}
You play {{plays}}.
{{/plays}}
{{/fork}}

{{#shared}}
## What every part of this work is told

{{shared}}

{{/shared}}
## Your task

{{task}}

{{#notes}}
## Notes you share

The agents working on this task beside you keep their notes in {{notes}}. It holds what they found so far; add to it what they would want to know.

{{/notes}}
## What you have been given

{{#attachments}}
### {{name}}

{{text}}

{{/attachments}}
{{^attachments}}
Nothing was attached.

{{/attachments}}
{{#returns}}
## What to send back

{{returns}}
{{/returns}}
