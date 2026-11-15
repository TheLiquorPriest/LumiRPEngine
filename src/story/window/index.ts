// The history window (plan §4.2, §8.1): which of the chat's messages the prompt keeps. The user's
// setting keeps the latest X; a step, when set, lets the window grow to X plus the step before it is
// cut back to X, so the front of the prompt stays the same between cuts (READINGS R-95: with 40 and a
// step of 20 it holds 40 to 60, and the turn that would hold 61 is cut back to 40); the hold, when on,
// keeps an uncovered message in the prompt for at most its cap of extra messages. The answer is worked
// out from the count of messages and which of them the story record covers, never from what they say,
// and it holds no state: the same path and settings give the same first message every time. A message
// the user hid is not in the prompt and is not counted (READINGS R-21). The window cuts between the
// prompt's messages: two of the player's messages next to each other (hidden ones between them
// skipped) reach the prompt as one, which Lumiverse joins under the first one's id
// (`prompt-assembly.service.ts:6754-6843`), so a cut that falls inside such a message keeps it whole
// and names its first row (READINGS R-202).

/** A message on the chat's path, as the adapter names it: its id, its place in the chat, whether the user hid it, and whether it is the player's. */
export interface WindowMessage {
  id: string;
  index: number;
  /** Hidden from the prompt by the user: never kept, never left out by the window, and not counted toward its size. */
  hidden?: boolean;
  /** The player's: Lumiverse joins it into the player's message before it, where no message it keeps stands between them. */
  user?: boolean;
}

export interface WindowSettings {
  /** Keep the latest this many messages; null keeps them all. A whole number, at least 1. */
  size: number | null;
  /** Let the window grow to `size` plus this before it is cut back to `size`; null is off. A whole number, at least 1. */
  step: number | null;
  /** Keep a message the record does not cover, for at most `cap` messages more than the window would keep. */
  hold: { on: boolean; cap: number };
}

/** Appendix D.1: exactly the latest 40, no step, the hold off (40 more at most when switched on). */
export const WINDOW_DEFAULTS: WindowSettings = { size: 40, step: null, hold: { on: false, cap: 40 } };

/** A run of messages the window leaves out, all of them covered by the record or none. */
export interface LeftOutRange {
  from: WindowMessage;
  to: WindowMessage;
  count: number;
  covered: boolean;
}

export interface WindowCut {
  /** The first message to keep, in the form the adapter's `KeepPoint` takes; null keeps every message. */
  first: WindowMessage | null;
  /** What is left out, oldest first, split where the record's covering starts or stops. */
  left: LeftOutRange[];
}

function wholeAtLeast(value: number, least: number, what: string): void {
  if (!Number.isInteger(value) || value < least) throw new RangeError(`The history window's ${what} must be a whole number of at least ${least}; it is ${value}.`);
}

/**
 * The place of the first message the window keeps among `count` messages (0: it keeps them all).
 * `covered(place)` says whether the message at that place is covered; it matters only to the hold.
 */
export function windowStart(count: number, settings: WindowSettings, covered: (place: number) => boolean): number {
  const { size, step, hold } = settings;
  if (size !== null) wholeAtLeast(size, 1, "size");
  if (step !== null) wholeAtLeast(step, 1, "step");
  wholeAtLeast(hold.cap, 0, "hold's cap");

  let first = 0;
  if (size !== null && count > size) {
    // With a step, the cut moves only in whole steps of `step + 1`, so the window runs from `size` to `size + step`, both
    // held, and the message that would make it `size + step + 1` cuts it back to `size` (R-95).
    first = step === null ? count - size : Math.floor((count - size) / (step + 1)) * (step + 1);
  }

  if (hold.on && first > 0) {
    const reach = Math.max(0, first - hold.cap);
    for (let i = reach; i < first; i++) {
      if (!covered(i)) {
        first = i;
        break;
      }
    }
  }
  return first;
}

/**
 * The window over the chat's messages on the path, oldest first. `covered` holds the ids of the
 * messages the story record covers; it matters only to the hold, and to how `left` is split. Only the
 * messages the user did not hide are counted, kept or left out. A first kept message that Lumiverse
 * joins into the one before it moves the cut back to the first row of the message it is joined into,
 * so the prompt holds at least the latest X and never a message cut apart (R-202).
 */
export function historyWindow(messages: readonly WindowMessage[], settings: WindowSettings, covered: ReadonlySet<string>): WindowCut {
  const counted = messages.filter((m) => m.hidden !== true);
  let first = windowStart(counted.length, settings, (place) => covered.has(counted[place]?.id ?? ""));
  while (first > 0 && counted[first]?.user === true && counted[first - 1]?.user === true) first--;
  const left: LeftOutRange[] = [];
  for (let i = 0; i < first; i++) {
    const message = counted[i];
    if (message === undefined) continue;
    const isCovered = covered.has(message.id);
    const point = { id: message.id, index: message.index };
    const last = left[left.length - 1];
    if (last !== undefined && last.covered === isCovered) {
      last.to = point;
      last.count++;
    } else left.push({ from: point, to: point, count: 1, covered: isCovered });
  }

  const kept = first > 0 ? counted[first] : undefined;
  return { first: kept === undefined ? null : { id: kept.id, index: kept.index }, left };
}
