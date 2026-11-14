---
description: The wording of every notice an agent can be shown. One notice per line, a name, a colon, then its text. Change the words freely. Delete a line and that notice is no longer shown. A notice states a fact; it asks for nothing.
format: lines
---
file_changed: You changed {{path}} since this session opened. The copy in the opening block no longer stands. Its whole current text follows.
file_off: {{path}} has been switched off since this session opened. The copy in the opening block no longer stands.
prompt_unmapped: This preset's prompt has not been mapped yet. The whole prompt is in front of you as always. Its parts cannot be named until it is mapped.
prompt_shape: The prompt's shape has changed since it was mapped: {{what}}. Nothing is stopped by this.
migrated_chat: This chat was carried over from the earlier build. Its state, cast and story record are as that build left them. {{carried}}
unplayed: Messages {{range}} were added to the chat without a turn of yours.
edited: Message {{message}} was edited after its turn.
deleted: {{count}} turn(s) were deleted since the last one.
swipe_flipped: An earlier reply ({{message}}) was changed to another of its swipes. The turns after it were applied again on it. {{dropped}}
job_finished: A job finished: {{job}}. {{outcome}}
job_interrupted: A job was interrupted by a restart: {{job}}. It had done: {{done}}
change_awaiting: A change is waiting for the player's yes or no: {{what}}
panel_request: From a panel: {{what}}
depth_asked: The player asked for this turn to be played {{depth}}.
pictures_left_out: The prompt held {{count}} picture(s). This model does not take pictures, so they were left out.
history_trimmed: Messages {{range}} did not fit this model's window and were left out. {{covered}}
previous_run_stopped: The last turn's work was still going when this one began, and was stopped where it stood. What it had recorded is kept.
