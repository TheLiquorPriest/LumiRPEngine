// A bottom bar's height published on its frame (src/frontend/bar-height.ts): what floats at the bottom
// of a view (Back to top, a selection bar) is placed by it, so it follows the bar as it is, not a
// guess of 44 px: published at once, again whenever the bar's size changes, and no more once the bar
// is gone. Read without a DOM: the frame, the bar and the page's ResizeObserver are stand-ins.

import { expect, test } from "bun:test";
import { publishBarHeight } from "../../src/frontend/bar-height";

/** The page's ResizeObserver, as far as the bar is watched: what it watches, and whether it has stopped. */
class Watch {
  static made: Watch[] = [];
  readonly watched: unknown[] = [];
  stopped = false;
  constructor(readonly changed: () => void) {
    Watch.made.push(this);
  }
  observe(target: unknown): void {
    this.watched.push(target);
  }
  disconnect(): void {
    this.stopped = true;
  }
}

function frame(): { published: [string, string][]; style: { setProperty(name: string, value: string): void } } {
  const published: [string, string][] = [];
  return { published, style: { setProperty: (name, value) => published.push([name, value]) } };
}

test("the bar's height is published at once, and again when the bar grows a second row or shrinks", () => {
  Watch.made = [];
  const play = frame();
  // Play's bar on a phone: an icon and a label under it.
  const bar = { offsetHeight: 59 };
  const stop = publishBarHeight(play, bar, "--lre-play-nav-h", Watch);
  expect(play.published).toEqual([["--lre-play-nav-h", "59px"]]);
  const [watch] = Watch.made;
  expect(watch?.watched).toEqual([bar]);
  bar.offsetHeight = 108;
  watch?.changed();
  bar.offsetHeight = 49;
  watch?.changed();
  expect(play.published.map(([, value]) => value)).toEqual(["59px", "108px", "49px"]);
  stop();
  expect(watch?.stopped).toBe(true);
});

test("without a ResizeObserver the height is still published, once, and stopping is harmless", () => {
  const play = frame();
  const stop = publishBarHeight(play, { offsetHeight: 59 }, "--lre-play-nav-h", undefined);
  expect(play.published).toEqual([["--lre-play-nav-h", "59px"]]);
  stop();
  expect(play.published).toHaveLength(1);
});
