---
description: Reminds the Author, as its run is about to end, of each press of one of the world's actions the player made from a panel for this turn that no `act` has carried out or had refused. A reminder of what `TURN.md` asks of a request from a panel.
title: A press from a panel not carried out
agents: [author]
needs: TURN
fact: asked.unanswered > 0
at: run-end
repeat: once per turn
---
The player pressed these from a panel for this turn, and no `act` of theirs has reached the world yet: {{asked.unanswered.names}}.
{{#asked.unanswered.asked}}
- {{what}}{{#on}}, on {{on}}{{/on}}: the action `{{action}}`.
{{/asked.unanswered.asked}}
Carry each out now with the `world_apply` operation `act`, its action and the values the briefing gave. If the world will not have it, its answer says why, and that answers the press. See `TURN.md`, "A request from a panel".
