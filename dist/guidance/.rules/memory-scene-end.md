---
description: Tells the Author, at a turn's start, when a scene has closed and a principal still holds perceptions of it that its own agent has not taken in, with how many and how large they are. The header says whose count; change it and the reminder follows. A reminder of the perceptions rule.
title: Memory work owed for a scene that closed
agents: [author]
needs: perceptions
fact: scene.untaken(principal) > 0
at: turn-start
repeat: once per turn
---
A scene has closed, and these characters still hold perceptions of it their own agent has not taken in: {{scene.untaken.names}}.
{{#scene.untaken.held}}
- {{name}} ({{casting}}): {{perceptions}} waiting{{#tokens}}, about {{tokens}} tokens{{/tokens}}, of {{scenes}}.
{{/scene.untaken.held}}
The scene's end is when their memory work runs: start it now as a job, `job_start` with `agent: character`, `plays` naming the character, `for: take-in` and a brief that asks it to take in what it perceived, one job for each. Its agent is given what waits as work, and hands a backlog out in batches to instances of itself. See the perceptions rule, "When".
