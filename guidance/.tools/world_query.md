---
description: world_query as the model is told it - what the tool does, and what each of its arguments is.
arguments:
  at: "The point of the tree: a place, someone or something (by name or id), world, groups or elsewhere; or ruleset for the world's ruleset and its bestiary."
  depth: "How many levels below the point to show, or full for everything beneath it."
  due: "A span ahead (two hours, until 22:00, until a part of the world's day by its name, or a date and time YYYY-MM-DD HH:MM): what falls due in it at that part of the tree."
  map: "true to add the place's map as text."
---
Reads the world's tree at a point: the point with its values and where each comes from, the levels beneath it to the depth asked, each with a line on what is beneath it. Asked for a span, it also lists what falls due in that span there; it applies none of it.
