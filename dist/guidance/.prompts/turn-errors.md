---
description: The words RPE gives when a turn cannot be played, when a turn is stopped, when it cannot read what an agent asked of Lumiverse, and when a Settle now is refused. The player reads the lines for a turn that cannot be played (`no_lumiverse`, `no_chat`, `no_lead`) in the chat; a stop shows on the Turn page; an agent reads the next three in what it called; the Turn page shows the last three. One line for each case, a name, a colon, then its text. Change the words freely. Delete a line and that case is told by its name alone.
format: lines
---
no_lumiverse: RPE is not set up for a Lumiverse, so it cannot play this chat.
no_chat: Lumiverse has no chat {{chat}} for this RPE's user.
stopped_mid_run: RPE stopped while this run was going on.
player_stopped: The player stopped the turn.
left_path: The turn left the chat's path.
previous_run_limit: The next turn began, and this run had used the time it was given.
no_lead: No agent is named to lead this chat's turns (turn.lead in RPE-global.yml or the chat's RPE.yml), so the turn was not played.
no_lumiverse_sources: RPE is not set up for a Lumiverse, so it cannot read a character's sources.
no_lumiverse_chat: RPE is not set up for a Lumiverse, so it has no chat to read.
settle_running: A turn of this chat is going on. Settle it once that turn is over.
settle_nothing: No turn of RPE's is on this chat's path, so there is nothing to settle.
settle_shared: The newest turn on this chat's path is the one it shares with the chat it was branched from, so what Settle now records would go into that chat's history too. Play a turn in this chat first, then settle it.
