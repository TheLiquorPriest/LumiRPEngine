---
description: Reminds the Author, as its run ends, when a principal has begun a sleep, or lived a stretch of story time as long as the setting cast.dreamAfterHours, since it last dreamt. The header says whose count; change it and the reminder follows. A reminder of the perceptions rule.
agents: [author]
needs: perceptions
fact: dream.due(principal) > 0
at: run-end
repeat: once per turn
---
Since they last dreamt, these characters have slept or lived a long stretch: {{dream.due.names}}.
{{#dream.due.due}}
- {{name}} ({{casting}}): {{#slept}}a sleep has begun{{/slept}}{{^slept}}{{hours}} story hours have passed{{/slept}} since {{#dreamt}}its last dream, at message {{dreamt}}{{/dreamt}}{{^dreamt}}it first perceived anything; it has never dreamt{{/dreamt}}.
{{/dream.due.due}}
Ask its agent to dream: `delegate` to the `character` definition with `plays` naming it and a brief that says it sleeps, or how much time has passed, or the same as a job. See the perceptions rule, "When".
