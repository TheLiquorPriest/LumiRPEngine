---
description: Tells the Author, at a turn's start, when a principal has held perceptions its own agent has not taken in for as many turns as the header says (one who acted was owed them right after the reply, so a turn later they are late), with how many and how large they are. Those of a scene that has closed are memory-scene-end's. The header says whose count and how many turns; change it and the reminder follows. A reminder of the perceptions rule.
title: Memory work late for a character
agents: [author]
needs: perceptions
fact: path.untaken.turns(principal) >= 1
at: turn-start
repeat: once per turn
---
These characters hold perceptions of earlier turns their own agent has not taken in, the oldest from {{path.untaken.turns}} turn(s) ago: {{path.untaken.turns.names}}.
{{#path.untaken.held}}
- {{name}} ({{casting}}): {{perceptions}} waiting{{#tokens}}, about {{tokens}} tokens{{/tokens}}, the oldest of message {{since}}, {{turns}} turn(s) ago.
{{/path.untaken.held}}
For one who acted in those turns, they are late: have its agent take them in now, with `delegate` to the `character` definition, `plays` naming it, `for: take-in` and a brief that asks it to take in what it perceived, or with `job_start` and the same `agent`, `plays`, `for` and `brief`. Where a great deal waits, start it as a job: its agent is given the batches and hands them to instances of itself. If it has slept, or lived a long stretch, since it last dreamt, the same brief asks it to dream after: one run of its agent, never two at once. For one who was only present, they wait for the scene's end or for when it next acts; if it acts first, its agent is given the newest of them at the start of that run. See the perceptions rule, "When".
