---
description: cast_update as the model is told it - what the tool does, and what each of its arguments is.
arguments:
  operations: The operations, written in order, in one write.
  operations.op: "The operation: cast, bind, base, growth, history, relationship or knowledge."
  operations.who: "The character, by name or id. Someone the cast does not hold yet is added by a cast operation in the same call."
  operations.id: "growth, history, knowledge: the entry to change, by its id. Leave it out to add one."
  operations.as: "cast: principal, supporting or extra."
  operations.line: "cast: who they are, in one line. All an extra has."
  operations.card: "bind: the character card's id in Lumiverse."
  operations.persona: "bind: the persona's id in Lumiverse."
  operations.entry: "bind: the lore entry's id, as the lore map shows it."
  operations.memory: "bind: their entity's id in Lumiverse's memory."
  operations.defines: "bind: which side of them the source defines (background, appearance, voice)."
  operations.seed: "base: who they are, in two lines."
  operations.soul: "base: what drives them, and what they will not do."
  operations.inner_voice: "base: how they think, and how they talk to themselves."
  operations.background: "base: where they come from."
  operations.text: "growth: how they have changed from their base. history: what happened to them, as their story tells it. relationship: how they feel about the person, in their voice. knowledge: one short statement of what they know."
  operations.cause: "growth: what caused the change."
  operations.beats: "history: the ids of the story's beats it comes from."
  operations.with: "relationship: the person it is toward, by name."
  operations.trust: "relationship: from -100 to 100, when useful."
  operations.warmth: "relationship: from -100 to 100, when useful."
  operations.respect: "relationship: from -100 to 100, when useful."
  operations.fear: "relationship: from -100 to 100, when useful."
  operations.how: "knowledge: how they learned it."
  operations.accept: "growth: true to accept a change a character's reflection proposed, by its id; false to set it back to proposed."
  operations.drop: "bind: true to take the source away. growth, history, relationship, knowledge: true to strike it; say why."
  operations.why: "cast: why this casting. With drop: why it goes."
---
Writes a character's record, as many operations as you need in one call: their casting, the sources bound to them, their base, and their growth, history, relationships and knowledge. Casting, growth, history, relationships and knowledge belong to this turn: if the turn is swiped or deleted, they go with it. The sources and the base stand outside turns, and every version of the base is kept. The answer gives what each operation wrote and how that part of the record now stands.
