---
description: Reminds the Author, as its run is about to end, of each press of one of the world's actions the player made from a panel for this turn that no `act` or `pass_time` has carried out or had refused. A reminder of what `TURN.md` asks of a request from a panel.
title: A press from a panel not carried out
agents: [author]
needs: TURN
fact: asked.unanswered > 0
at: run-end
repeat: once per turn
---
The player pressed these from a panel for this turn, and no `act` of theirs has reached the world yet: {{asked.unanswered.names}}.
{{#asked.unanswered.asked}}
- {{what}}{{#on}}, on {{on}}{{/on}}: {{#skip}}a skip of time, carried out with the `pass_time` operation{{/skip}}{{^skip}}the action `{{action}}`{{/skip}}.
{{/asked.unanswered.asked}}
Carry each out now with the `world_apply` operation the briefing named for it: `act` for an action, with its action and the values the briefing gave; `pass_time` for a skip of time, with the values the briefing gave for it. If the world will not have it, its answer says why, and that answers the press. See `TURN.md`, "A request from a panel".
