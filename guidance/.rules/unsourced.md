---
description: Points out writes that named no source, when a run is about to end. A reminder of what the file for every agent asks.
agents: all
needs: ALL-AGENTS
fact: unsourced.writes > 0
at: run-end
repeat: once per turn
---
{{unsourced.writes}} of this turn's writes name no source. The file for every agent says what a source is. If a write has none of those, it is new, and the consent rule applies.
