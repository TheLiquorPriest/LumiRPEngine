---
description: Example. Not in force while it sits in examples/. Copy it into rules/ to switch it on. When a scene has run for forty turns it asks the Author to consider whether the scene has ended. A reminder of what TURN.md says about scenes.
agents: [author]
needs: TURN
fact: session.turns >= 40
at: turn-start
repeat: after 10 turns
---
This scene has run for {{session.turns}} turns. Consider whether it has ended. `TURN.md` says what ends a scene.
