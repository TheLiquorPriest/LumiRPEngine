---
description: The wording of every notice an agent or the player can be shown - those an agent is given in its briefing, and those the Turn page and the live view show of a turn, among them the notices about the prompt's shape (the lines that begin notice_, for the prompt not mapped yet, a fixed part changed or gone, text that belongs to no part, a new order, and a new preset or revision). One notice per line, a name, a colon, then its text. Change the words freely. Delete a line and that notice is no longer shown. A notice states a fact; it asks for nothing.
format: lines
---
file_changed: {{path}} was changed since this session opened. The copy in the opening block no longer stands. Its whole current text follows.
file_off: {{path}} has been switched off since this session opened. The copy in the opening block no longer stands.
skills_changed: The list of skills in the opening block no longer stands.{{#listed}} The list as it stands now follows.{{/listed}}
migrated_chat: This chat was carried over from the earlier build. Its state, cast and story record are as that build left them. {{carried}}
unplayed: Since your last turn, replies were written in this chat without a turn of yours (messages {{range}}, counting the chat's first message as 0). The newest of them is this conversation's last assistant turn, and those the conversation holds are already in front of you: they need no reading again.
edited: Message {{message}} was edited after its turn.{{#old}} Before: {{old}}{{/old}}{{#new}} Now: {{new}}{{/new}}
edited_more: {{count}} replies were edited after their turns and are not given in full here: messages {{messages}}, counting the chat's first message as 0. chat_read reads any of them.
player_edited: The player's message {{message}} was edited since your last turn.{{#old}} Before: {{old}}{{/old}}{{#new}} Now: {{new}}{{/new}}
deleted: {{count}} turn(s) were deleted since the last one.
swipe_flipped: An earlier reply ({{message}}) was changed to another of its swipes. The turns after it were applied again on it. {{dropped}}
swipe_shown: The newest reply ({{message}}) now shows another of its swipes.
job_finished: A job finished: {{job}} ({{agent}}). Its brief: {{brief}}{{#report}} Its report: {{report}}{{/report}}{{#applied}} Of what it recorded, these took effect now: {{applied}}.{{/applied}}{{#not_applied}} These did not: {{not_applied}}.{{/not_applied}}
job_failed: A job failed before it finished: {{job}} ({{agent}}). Its brief: {{brief}}{{#report}} What it had written: {{report}}{{/report}}{{#applied}} Of what it recorded, these took effect now: {{applied}}.{{/applied}}{{#not_applied}} These did not: {{not_applied}}.{{/not_applied}}
job_cancelled: A job was cancelled before it finished: {{job}} ({{agent}}). Its brief: {{brief}}{{#report}} What it had written: {{report}}{{/report}}{{#applied}} Of what it recorded, these took effect now: {{applied}}.{{/applied}}{{#not_applied}} These did not: {{not_applied}}.{{/not_applied}}
job_interrupted: A job was interrupted by a restart before it finished: {{job}} ({{agent}}). Its brief: {{brief}}{{#report}} What it had written: {{report}}{{/report}}{{#applied}} Of what it recorded, these took effect now: {{applied}}.{{/applied}}{{#not_applied}} These did not: {{not_applied}}.{{/not_applied}}
job_off_path: A job was cut off before it finished, when the turn that started it left the chat's path: {{job}} ({{agent}}). Its brief: {{brief}}{{#report}} What it had written: {{report}}{{/report}}
panel_request: From a panel: {{what}}{{#on}}, on {{on}}{{/on}}
settle_asked: The player asked, from the Turn page, for this turn to be settled now against the chat as it reads. This run writes no reply, and nothing of it reaches the chat.
previous_run_stopped: The last turn's work was still going when this one began, and was stopped where it stood. What it had recorded is kept.
saved_differs: What the chat saved as message {{message}} is not what was released. Released: {{released}} Saved: {{saved}}
cut_short: The reply in message {{message}} was stopped before it was finished. The chat kept only the part written by then.
progress_missing: This chat's progress.md has no still line, so nothing keeps a long turn alive: the chat application ends a generation that shows nothing after ten minutes. The turn's own time limit was held at {{time}} milliseconds.
pictures_not_taken: Pictures in the prompt were left out: {{count}}, in messages {{messages}}, counting the prompt's first message as 0. Your model is not known to take pictures.
parts_not_carried: Parts of the prompt that can be given as neither text nor a picture (audio, for one) were left out: {{count}}, in messages {{messages}}, counting the prompt's first message as 0.
world_state_failed: The world state could not be put in this briefing: {{error}}
on_stage_failed: The cast's views of those on stage could not be put in this briefing: {{error}}
cut_unmatched: Messages the chat application listed were not found in the prompt as it was sent: {{missing}}. The prompt's parts are not told apart.
cut_pictures: Pictures and other parts the chat application listed are not in the prompt it sent: {{dropped}}.
cut_uncut: History messages before the start of the window are still in the prompt, where it could not be cut: {{history}}.
cut_joining_unread: The chat application's joining settings could not be read ({{why}}), so how it joined the prompt's messages was found from the prompt.
cut_room_unknown: The room the Author's model has for the prompt could not be told ({{why}}), so the prompt went as the history window left it, with nothing trimmed to fit the model's own window.
cut_clipped_memory: {{count}} of the messages in the window are not in the prompt: the chat application's memory stands for them with its summary.
cut_clipped_message_limit: {{count}} of the messages in the window are not in the prompt: the chat application's message limit keeps fewer than the window holds.
cut_clipped_context_size: {{count}} of the messages in the window are not in the prompt: the preset's context size left out the oldest of them.
notice_unmapped: This preset's prompt has not been mapped yet. The whole prompt is given to you in full, and its parts are named by place until it is mapped.
notice_incomplete: The chat application joined parts of this prompt in a way that cannot be told apart, so its parts cannot be found by name this turn.
notice_changed: The text of {{marker}}, which the map says is fixed, has changed since the turn before.
notice_gone: {{marker}} is not in this prompt.
notice_unclaimed: Text that belongs to no part of the map: {{#name}}{{name}}{{/name}}{{^name}}in message[{{message}}]{{/name}}, {{length}} characters.
notice_order: {{markers}} moved: the prompt's parts are in a different order than the turn before.
notice_preset: This prompt is from {{#now}}{{now.name}}{{#now.revision}}, revision {{now.revision}}{{/now.revision}}{{/now}}{{^now}}a preset the chat application did not name{{/now}}, where the turn before was from {{#was}}{{was.name}}{{#was.revision}}, revision {{was.revision}}{{/was.revision}}{{/was}}{{^was}}a preset it did not name{{/was}}.
