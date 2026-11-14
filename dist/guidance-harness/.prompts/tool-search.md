---
description: The words tool_search and tool_use answer with - each tool a search found, with what it takes (untyped is the word for a value of any kind), what a search did not find, a tool that waits to be switched on, and a name that is no tool. A found tool's family is the name of its group, which an agent definition's out_of_reach takes; the families of RPH's own tools are files, todo, reply, agents, chat, lore, continuity, skills, suggestions, stores, web and tools. One line per name, a name, a colon, then its text. Change the words freely. Delete a line and that answer is given with no words; on some connections the model is then shown its provider's own note that the tool gave nothing, such as "(no tool output)".
format: lines
---
found: {{name}} ({{family}}): {{line}} Takes {{takes}}
untyped: any
more: {{count}} more found. Give more words, or a higher limit, to see them.
waiting: {{name}} waits for the player to switch it on, so {{tools}} cannot be used yet.
none_found: No tool was found for {{words}}.
no_words: Give the words to look for.
no_tool: There is no tool named {{tool}} that you can use.
not_switched_on: {{tool}} was not run: {{name}} waits for the player to switch it on.
