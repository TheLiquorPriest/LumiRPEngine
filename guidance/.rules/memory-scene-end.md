---
description: Tells the Author, at a turn's start, when a scene has closed and a principal still holds perceptions of it that its own agent has not taken in. The header says whose count; change it and the reminder follows. A reminder of the perceptions rule.
agents: [author]
needs: perceptions
fact: scene.untaken(principal) > 0
at: turn-start
repeat: once per turn
---
A scene has closed, and these characters still hold perceptions of it their own agent has not taken in: {{scene.untaken.names}}.
{{#scene.untaken.held}}
- {{name}} ({{casting}}): {{perceptions}} waiting, of {{scenes}}.
{{/scene.untaken.held}}
The scene's end is when their memory work runs: start it now as a job, `job_start` with `agent: character`, `plays` naming the character and a brief that asks it to take in what it perceived, one job for each. See the perceptions rule, "When".
