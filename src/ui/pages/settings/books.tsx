// `lore.books` (R-107): which of his books the lore reads, `auto` or a list of his books, chosen among the books
// he has and never typed by hand. The setting takes a list of names, one per line, so the choice is written as
// those lines.

import type { LoreBooks } from "../../../shared/api";

/** The choice a draft's text holds: `auto`, or the ids of the books it lists. */
export function booksOf(text: string): { auto: boolean; ids: string[] } {
  const lines = text.split("\n").map((l) => l.trim()).filter((l) => l !== "");
  return lines.length === 0 || lines.includes("auto") ? { auto: true, ids: [] } : { auto: false, ids: lines };
}

export function BooksChoice(props: { books: LoreBooks; text: string; onText(text: string): void }) {
  const chosen = booksOf(props.text);
  return (
    <div class="lre-stack" data-books>
      <label class="lre-inline">
        <input type="radio" name="lore-books" checked={chosen.auto} onChange={() => props.onText("auto")} />
        <span>auto: every book the chat reads</span>
      </label>
      {props.books.books.map((book) => (
        <label key={book.id} class="lre-inline" data-book={book.id}>
          <input
            type="checkbox"
            checked={chosen.ids.includes(book.id)}
            onChange={(event) => {
              const on = (event.currentTarget as HTMLInputElement).checked;
              const ids = on ? [...chosen.ids, book.id] : chosen.ids.filter((id) => id !== book.id);
              props.onText(ids.length === 0 ? "auto" : ids.join("\n"));
            }}
          />
          <span>
            {book.name}
            {book.attached ? " · attached to this chat" : ""}
            {book.character ? " · a character's" : ""}
          </span>
        </label>
      ))}
    </div>
  );
}
