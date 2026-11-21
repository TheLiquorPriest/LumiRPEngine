---
description: The wording of the notices an agent can be shown about its turn, those about the prompt's shape among them (the lines that begin notice_). One notice per line, a name, a colon, then its text. Change the words freely. Delete a line and that notice is no longer shown. A notice states a fact; it asks for nothing.
format: lines
---
file_changed: {{path}} was changed since this session opened. The copy in the opening block no longer stands. Its whole current text follows.
file_off: {{path}} has been switched off since this session opened. The copy in the opening block no longer stands.
skills_changed: The list of skills in the opening block no longer stands.{{#listed}} The list as it stands now follows.{{/listed}}
notice_unmapped: This preset's prompt has not been mapped yet. The whole prompt is given to you in full, and its parts are named by place until it is mapped.
notice_incomplete: The chat application joined parts of this prompt in a way that cannot be told apart, so its parts cannot be found by name this turn.
notice_changed: The text of {{marker}}, which the map says is fixed, has changed since the turn before.
notice_gone: {{marker}} is not in this prompt.
notice_unclaimed: Text that belongs to no part of the map: {{#name}}{{name}}{{/name}}{{^name}}in message[{{message}}]{{/name}}, {{length}} characters.
notice_order: {{markers}} moved: the prompt's parts are in a different order than the turn before.
notice_preset: This prompt is from {{#now}}{{now.name}}{{#now.revision}}, revision {{now.revision}}{{/now.revision}}{{/now}}{{^now}}a preset the chat application did not name{{/now}}, where the turn before was from {{#was}}{{was.name}}{{#was.revision}}, revision {{was.revision}}{{/was.revision}}{{/was}}{{^was}}a preset it did not name{{/was}}.
