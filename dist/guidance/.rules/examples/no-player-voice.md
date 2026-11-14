---
description: Example. Not in force while it sits in `examples/`; copy it into `rules/` to switch it on. Flags a reply that spoke for the player's character. A question is asked after the reply is written, so this rule cannot stop a reply; it tells the Author in the next briefing. To stop one as it is written, use a pattern rule (`condition:`) instead.
agents: [author]
scope: [reply]
question: Does this passage decide an action, a line of speech or a feeling for the player's character that the player did not write?
---
Your last reply wrote for the player's character. Do not decide what they do, say or feel. From here on, describe how the world answers what the player wrote.
