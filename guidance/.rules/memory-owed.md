---
description: Reminds the Author, as its run ends, when a principal on stage this turn holds perceptions its own agent has not taken in. The header says whose count; change it and the reminder follows. A reminder of the perceptions rule.
agents: [author]
needs: perceptions
fact: stage.untaken(principal) > 0
at: run-end
repeat: once per turn
---
These characters were on stage this turn and hold perceptions their own agent has not taken in: {{stage.untaken.names}}.
{{#stage.untaken.held}}
- {{name}} ({{casting}}): {{perceptions}} waiting, the oldest {{#turns}}from {{turns}} turn(s) ago, at message {{since}}{{/turns}}{{^turns}}of this turn{{/turns}}.
{{/stage.untaken.held}}
For one who acted this turn, through its own agent or voiced in your reply, have its agent take them in now: `agent_message` to the agent you kept, or, if it has none this turn, `delegate` to the `character` definition with `plays` naming it and a brief that asks it to take in what it perceived. Its definition gives it every perception it has not taken in. A job (`job_start` with the same `agent`, `plays` and `brief`) does the same, but what a job writes counts only from the next turn: if you have started one for it, that is enough. For one who was only present, they wait for the scene's end or for when it next acts. See the perceptions rule, "When".
