// A bottom bar's height, published on the frame that holds it as a CSS variable (`--lre-play-nav-h`
// on Play, `--lre-gm-nav-h` on GM), so what floats at the bottom of a view (Back to top, a selection
// bar, an edit's notice) sits above the bar however tall its buttons are (an icon and a label: 59 px
// at 390 px wide, not the 44 px of a bare tap target), never under it: at once, and again whenever
// the bar's size changes (a second row of buttons, a larger font).

/** What the bar's height is read from: its element. */
export interface Bar {
  readonly offsetHeight: number;
}

/** What watches the bar's size: the page's `ResizeObserver`. */
export type SizeWatch<B> = new (callback: () => void) => { observe(target: B): void; disconnect(): void };

/** Publishes `bar`'s height on `frame` as `name`, now and on each change of its size while `Watch` (none: once) watches it; the returned function stops watching. */
export function publishBarHeight<B extends Bar>(frame: { readonly style: { setProperty(name: string, value: string): void } }, bar: B, name: string, Watch: SizeWatch<NoInfer<B>> | undefined): () => void {
  const publish = (): void => frame.style.setProperty(name, `${bar.offsetHeight}px`);
  publish();
  const watch = Watch === undefined ? null : new Watch(publish);
  watch?.observe(bar);
  return () => watch?.disconnect();
}
