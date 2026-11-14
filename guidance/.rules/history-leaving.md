---
description: Warns the Author when messages are about to leave the prompt and the story record does not cover them. A reminder of what `TURN.md` asks about keeping the record ahead of the window.
agents: [author]
needs: TURN
fact: history.leaving.uncovered > 0
at: turn-start
repeat: once per turn
---
{{history.leaving.uncovered}} messages ({{history.leaving.range}}) are about to leave the prompt, and the story record does not cover them yet.
Once they are gone, the story knows of them only what is recorded. See `TURN.md`, "Keep the record ahead of the window".
