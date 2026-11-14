---
description: The wording of every notice an agent can be shown. One notice per line, a name, a colon, then its text. Change the words freely. Delete a line and that notice is no longer shown. A notice states a fact; it asks for nothing.
format: lines
---
file_changed: You changed {{path}} since this session opened. The copy in the opening block no longer stands. Its whole current text follows.
file_off: {{path}} has been switched off since this session opened. The copy in the opening block no longer stands.
migrated_chat: This chat was carried over from the earlier build. Its state, cast and story record are as that build left them. {{carried}}
unplayed: Since your last turn, replies were written in this chat without a turn of yours (messages {{range}}, counting the chat's first message as 0). Those within the chat history above are already in front of you and need no reading again.
edited: Message {{message}} was edited after its turn.{{#old}} Before: {{old}}{{/old}}{{#new}} Now: {{new}}{{/new}}
player_edited: The player's message {{message}} was edited since your last turn.{{#old}} Before: {{old}}{{/old}}{{#new}} Now: {{new}}{{/new}}
deleted: {{count}} turn(s) were deleted since the last one.
swipe_flipped: An earlier reply ({{message}}) was changed to another of its swipes. The turns after it were applied again on it. {{dropped}}
swipe_shown: The newest reply ({{message}}) now shows another of its swipes.
job_finished: A job finished: {{job}} ({{agent}}). Its brief: {{brief}}{{#report}} Its report: {{report}}{{/report}}{{#applied}} Of what it recorded, these took effect now: {{applied}}.{{/applied}}{{#not_applied}} These did not: {{not_applied}}.{{/not_applied}}
job_failed: A job failed before it finished: {{job}} ({{agent}}). Its brief: {{brief}}{{#report}} What it had written: {{report}}{{/report}}{{#applied}} Of what it recorded, these took effect now: {{applied}}.{{/applied}}{{#not_applied}} These did not: {{not_applied}}.{{/not_applied}}
job_cancelled: A job was cancelled before it finished: {{job}} ({{agent}}). Its brief: {{brief}}{{#report}} What it had written: {{report}}{{/report}}{{#applied}} Of what it recorded, these took effect now: {{applied}}.{{/applied}}{{#not_applied}} These did not: {{not_applied}}.{{/not_applied}}
job_interrupted: A job was interrupted by a restart before it finished: {{job}} ({{agent}}). Its brief: {{brief}}{{#report}} What it had written: {{report}}{{/report}}{{#applied}} Of what it recorded, these took effect now: {{applied}}.{{/applied}}{{#not_applied}} These did not: {{not_applied}}.{{/not_applied}}
job_off_path: A job was cut off before it finished, when the turn that started it left the chat's path: {{job}} ({{agent}}). Its brief: {{brief}}{{#report}} What it had written: {{report}}{{/report}}
change_awaiting: A change is waiting for the player's yes or no: {{what}}
panel_request: From a panel: {{what}}{{#on}}, on {{on}}{{/on}}
depth_asked: The player asked for this turn to be played {{depth}}.
settle_asked: The player asked, from the Turn page, for this turn to be settled now against the chat as it reads. This run writes no reply, and nothing of it reaches the chat.
pictures_left_out: The prompt held {{count}} picture(s). This model does not take pictures, so they were left out.
history_trimmed: Messages {{range}} did not fit this model's window and were left out. {{covered}}
previous_run_stopped: The last turn's work was still going when this one began, and was stopped where it stood. What it had recorded is kept.
saved_differs: What the chat saved as message {{message}} is not what was released. Released: {{released}} Saved: {{saved}}
cut_short: The reply in message {{message}} was stopped before it was finished. The chat kept only the part written by then.
