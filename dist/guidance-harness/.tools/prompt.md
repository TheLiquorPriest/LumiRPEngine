---
description: prompt as the model is told it - what the tool does, and what its argument is.
arguments:
  names: The parts to read, each by name. Leave it out for the map of the prompt.
---
Reads the prompt the chat application assembled for this reply, part by part. With no names it gives the map: each part's name, its kind, how it behaves, its size and a line on what it is, then any notice about the prompt's shape. With names it gives each part's text exactly as it stands in the prompt. A part goes by the name the map gives it. Chat history goes by message: history[-30:] for the last thirty messages in the prompt, history[#120..#130] for the chat's messages 120 to 130 that are in it, history for all of it; history the prompt left out is read with chat_read. A lore entry in the prompt goes by its id, lore[e-112]. kind(style) gives every part of that kind; the kinds are instructions, style, character, persona, world, note, lore, history and other. message[3] is the fourth message whole, layout is the raw layout the prompt was cut by, and * is the whole prompt.
