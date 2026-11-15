---
description: Example. Not in force while it sits in `examples/`; copy it into `rules/` to switch it on. When the Author is about to end its run with two or fewer calls or tool rounds left, it is told so and given one more call, as today's build warned an agent of its last rounds. It names the fact `limits.left`, the fewest left of any limit the Author's definition or the turn sets; an agent held to no limit has no such fact, and nothing is said. Change the number to change when it speaks, `agents:` to say whom it is for.
agents: [author]
fact: limits.left <= 2
at: run-end
repeat: once per turn
---
This run is about to end, and the limit nearest to being spent (calls, tool rounds or tokens) has {{limits.left}} left. What is not yet recorded this turn has to be recorded in what is left, so do it in this call, or say there is nothing.
