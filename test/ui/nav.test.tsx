// The shells' bars of pages, drawn as a browser would draw them: at the foot of the web shell at phone
// width and atop the drawer, each keeps the pages a player uses most and every other page is one tap
// behind More; across the top of the web shell every page is there, and those not used most give way to
// More where the bar has no room for them. More shows as current while the page shown is behind it, and
// its list closes on a choice, on More again, on Escape, on a tap elsewhere, and when another page comes up.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { render } from "preact";
import { act } from "preact/test-utils";
import type { Shell } from "../../src/ui/app";
import { type BarPlace, PagesBar, type PagesBarProps } from "../../src/ui/frame";
import type { PageEntry } from "../../src/ui/page-entry";
import { PAGES } from "../../src/ui/page-list";
import { openPage, type Page, PageEvent, type PageElement } from "./kept/dom";

let page: Page;
beforeAll(() => {
  page = openPage();
});
afterAll(() => page.close());

const words = (el: PageElement): string => el.textContent.replace(/\s+/g, " ").trim();

/** The bar drawn at `place`, on `current`: its entries, the list More opens, and where each tap went. */
async function drawn(place: BarPlace, current: string, disabled: PagesBarProps["disabled"] = () => false) {
  const root = page.document.createElement("div");
  const gone: string[] = [];
  const draw = (on: string) => render(<PagesBar place={place} current={on} disabled={disabled} go={(id) => gone.push(id)} />, root as unknown as HTMLElement);
  await act(() => draw(current));
  const nav = (): PageElement => root.querySelector("nav") as PageElement;
  /** The bar's own entries, More last: the web shell's are the nav's buttons, the drawer's are in its row of tabs. */
  const entries = (): PageElement[] => (place === "drawer" ? (nav().querySelector(".lre-tabs") as PageElement).children : nav().children.filter((el) => el.localName === "button"));
  const more = (): PageElement => entries().at(-1) as PageElement;
  const list = (): PageElement | null => root.querySelector(".rpe-more-list");
  return {
    root,
    gone,
    entries,
    more,
    list,
    /** The words of the entries the bar shows. */
    bar: () => entries().map(words),
    redraw: (on: string) => act(() => draw(on)),
    /** Taps a page by its title: in the bar when it is there, else behind More. */
    async tap(title: string): Promise<void> {
      const inBar = entries().find((el) => words(el) === title);
      if (inBar !== undefined) return act(() => inBar.click());
      await act(() => more().click());
      const listed = list()?.children.find((el) => words(el) === title);
      if (listed === undefined) throw new Error(`${title} is neither in the bar nor behind More`);
      await act(() => listed.click());
    },
    async close(): Promise<void> {
      await act(() => render(null, root as unknown as HTMLElement));
    },
  };
}

const pagesOf = (shell: Shell): PageEntry[] => PAGES.filter((item) => item.shells.includes(shell));

describe("the bars of pages", () => {
  test("at the foot of the web shell at phone width, the chats and each chat's own pages stay in the bar, and every page is reached with a tap or two", async () => {
    const bar = await drawn("foot", "live");
    expect(bar.bar()).toEqual(["Chats", "Live", "Turns", "World", "Play", "More"]);
    for (const item of pagesOf("web")) {
      await bar.tap(item.title);
      expect(bar.list()).toBeNull();
    }
    expect(bar.gone).toEqual(pagesOf("web").map((item) => item.id));
    await bar.close();
  });

  test("atop the drawer, each chat's own pages stay in the bar, and every page of the drawer is reached with a tap or two", async () => {
    const bar = await drawn("drawer", "live");
    expect(bar.bar()).toEqual(["Live", "Turns", "World", "Play", "More"]);
    for (const item of pagesOf("drawer")) await bar.tap(item.title);
    expect(bar.gone).toEqual(pagesOf("drawer").map((item) => item.id));
    await bar.close();
  });

  test("across the top of the web shell every page is in the bar; those that give way where it has no room are the ones More lists, and each is reached there", async () => {
    const bar = await drawn("top", "chats");
    expect(bar.bar()).toEqual([...pagesOf("web").map((item) => item.title), "More"]);
    const spare = bar.entries().filter((el) => el.className === "rpe-spare");
    await act(() => bar.more().click());
    expect(bar.list()?.children.map(words)).toEqual(spare.map(words));
    await act(() => bar.more().click());
    // Where the width rule hides them, each is a tap on More and one in its list.
    for (const title of spare.map(words)) {
      await act(() => bar.more().click());
      await act(() => (bar.list()?.children.find((el) => words(el) === title) as PageElement).click());
    }
    expect(bar.gone).toEqual(pagesOf("web").filter((item) => !item.often).map((item) => item.id));
    await bar.close();
  });

  test("More shows as current while the page shown is behind it, and its list marks that page; a page in the bar is marked there", async () => {
    const bar = await drawn("foot", "settings");
    expect(bar.more().getAttribute("aria-current")).toBe("page");
    expect(bar.entries().filter((el) => el.getAttribute("aria-current") === "page").map(words)).toEqual(["More"]);
    await act(() => bar.more().click());
    expect(bar.more().getAttribute("aria-expanded")).toBe("true");
    expect(
      bar
        .list()
        ?.children.filter((el) => el.getAttribute("aria-current") === "page")
        .map(words),
    ).toEqual(["Settings"]);
    await bar.redraw("world");
    expect(bar.more().getAttribute("aria-current")).toBeNull();
    expect(bar.entries().find((el) => el.getAttribute("aria-current") === "page")?.textContent).toBe("World");
    await bar.close();
  });

  test("More's list closes on More again, on Escape with the focus back on More, on a tap anywhere else, and when another page comes up, choosing nothing", async () => {
    const bar = await drawn("drawer", "turns");
    await act(() => bar.more().click());
    expect(bar.list()).not.toBeNull();
    await act(() => bar.more().click());
    expect(bar.list()).toBeNull();

    await act(() => bar.more().click());
    const first = bar.list()?.children[0] as PageElement;
    const escape = new PageEvent("keydown", { key: "Escape" });
    await act(() => {
      first.dispatchEvent(escape);
    });
    expect(bar.list()).toBeNull();
    expect(escape.stopped).toBe(true);
    expect(page.document.activeElement).toBe(bar.more());

    await act(() => bar.more().click());
    await act(() => (bar.root.querySelector(".rpe-more-away") as PageElement).click());
    expect(bar.list()).toBeNull();

    await act(() => bar.more().click());
    await bar.redraw("storage");
    expect(bar.list()).toBeNull();
    expect(bar.more().getAttribute("aria-expanded")).toBe("false");
    expect(bar.gone).toEqual([]);
    await bar.close();
  });

  test("with no chat to show, the web shell's chat pages are there and cannot be pressed, and so are the chat's pages behind More while the rest can be; signed out, More cannot be pressed either", async () => {
    const bar = await drawn("foot", "chats", (item) => item.needsChat);
    expect(bar.entries().filter((el) => el.disabled).map(words)).toEqual(["Live", "Turns", "World", "Play"]);
    await act(() => bar.more().click());
    expect(bar.list()?.children.filter((el) => el.disabled).map(words)).toEqual(["Cast", "Prompt", "Story", "Lore"]);
    await act(() => bar.more().click());
    for (const title of ["Live", "Settings"]) await bar.tap(title);
    expect(bar.gone).toEqual(["settings"]);
    await bar.close();

    const out = await drawn("top", "chats", () => true);
    expect(out.entries().every((el) => el.disabled)).toBe(true);
    await out.close();
  });
});
