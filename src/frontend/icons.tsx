// The engine's icon set: original line drawings on a 24-unit grid with ~2 units of padding,
// stroked in currentColor so every icon takes its colour from the text around it. Each icon is
// stored as a few shape specs rather than markup, so the set stays small and nothing parses
// strings into DOM.

export type IconName =
  | "dice" | "eye" | "eye-off" | "hammer" | "gear" | "compass" | "user" | "users" | "map" | "book" | "globe" | "sliders"
  | "chevron-left" | "chevron-right" | "chevron-up" | "chevron-down" | "close" | "check" | "plus" | "minus" | "more"
  | "search" | "filter" | "edit" | "trash" | "copy" | "undo" | "refresh" | "expand" | "shrink" | "lock" | "info" | "alert"
  | "help" | "link" | "external" | "download" | "upload" | "list" | "grid" | "layers" | "code" | "function" | "branch"
  | "table" | "checklist" | "sparkle" | "wand" | "send" | "message" | "clock" | "calendar" | "hourglass" | "pause" | "play"
  | "fast-forward" | "bolt" | "pin" | "home" | "route" | "sun" | "moon" | "cloud" | "rain" | "snow" | "wind" | "wallet"
  | "coins" | "card" | "bank" | "receipt" | "bag" | "box" | "key" | "car" | "boat" | "fuel" | "wrench" | "briefcase"
  | "heart" | "pulse" | "shield" | "sword" | "flag" | "scroll" | "star" | "user-plus";

/** A path's `d`; a stroked circle; a filled dot (the only fill the set allows); a rounded rect. */
type Shape =
  | string
  | readonly ["c", number, number, number]
  | readonly ["dot", number, number, number]
  | readonly ["r", number, number, number, number, number];

const ICONS: Record<IconName, readonly Shape[]> = {
  dice: [["r", 3.5, 3.5, 17, 17, 3.5], ["dot", 8.25, 8.25, 1.3], ["dot", 15.75, 8.25, 1.3], ["dot", 12, 12, 1.3], ["dot", 8.25, 15.75, 1.3], ["dot", 15.75, 15.75, 1.3]],
  eye: ["M2.5 12C5 7.6 8.2 5.5 12 5.5s7 2.1 9.5 6.5c-2.5 4.4-5.7 6.5-9.5 6.5S5 16.4 2.5 12Z", ["c", 12, 12, 3]],
  "eye-off": ["M2.5 12C5 7.6 8.2 5.5 12 5.5s7 2.1 9.5 6.5c-2.5 4.4-5.7 6.5-9.5 6.5S5 16.4 2.5 12Z", ["c", 12, 12, 3], "M4 4l16 16"],
  hammer: ["M12 2.5l8.5 8.5-3.5 3.5L8.5 6Z", "M13.75 11.25L5.5 19.5a1.4 1.4 0 0 1-2-2l8.25-8.25"],
  gear: ["M18.42 10.46L20.89 10.59L20.89 13.41L18.42 13.54L17.63 15.45L19.28 17.29L17.29 19.28L15.45 17.63L13.54 18.42L13.41 20.89L10.59 20.89L10.46 18.42L8.55 17.63L6.71 19.28L4.72 17.29L6.37 15.45L5.58 13.54L3.11 13.41L3.11 10.59L5.58 10.46L6.37 8.55L4.72 6.71L6.71 4.72L8.55 6.37L10.46 5.58L10.59 3.11L13.41 3.11L13.54 5.58L15.45 6.37L17.29 4.72L19.28 6.71L17.63 8.55Z", ["c", 12, 12, 3]],
  compass: [["c", 12, 12, 9], "M15.5 8.5l-2 5-5 2 2-5Z"],
  user: [["c", 12, 8, 3.75], "M4.5 20c0-4 3.4-6.75 7.5-6.75s7.5 2.75 7.5 6.75"],
  users: [["c", 9, 8.5, 3.25], "M2.75 19.5c0-3.5 2.8-5.9 6.25-5.9s6.25 2.4 6.25 5.9", "M15 5.4a3.25 3.25 0 0 1 0 6.2", "M17 14c2.5.6 4.25 2.6 4.25 5.5"],
  map: ["M3 6.5l5.5-2.5 7 2.5 5.5-2.5v13.5l-5.5 2.5-7-2.5L3 20Z", "M8.5 4v13.5", "M15.5 6.5V20"],
  book: ["M12 6.5C10 5 7 4.5 3.5 5v13.5c3.5-.5 6.5 0 8.5 1.5 2-1.5 5-2 8.5-1.5V5c-3.5-.5-6.5 0-8.5 1.5Z", "M12 6.5V20"],
  globe: [["c", 12, 12, 9], "M12 3c-2.4 2.5-3.6 5.5-3.6 9s1.2 6.5 3.6 9c2.4-2.5 3.6-5.5 3.6-9S14.4 5.5 12 3Z", "M3 12h18"],
  sliders: ["M4 6h9M17 6h3", ["c", 15, 6, 2], "M4 12h3M11 12h9", ["c", 9, 12, 2], "M4 18h7M15 18h5", ["c", 13, 18, 2]],
  "chevron-left": ["M14.5 5.5L8 12l6.5 6.5"],
  "chevron-right": ["M9.5 5.5L16 12l-6.5 6.5"],
  "chevron-up": ["M5.5 14.5L12 8l6.5 6.5"],
  "chevron-down": ["M5.5 9.5L12 16l6.5-6.5"],
  close: ["M6 6l12 12M18 6L6 18"],
  check: ["M4.5 12.5l4.75 4.75L19.5 7"],
  plus: ["M12 5v14M5 12h14"],
  minus: ["M5 12h14"],
  more: [["dot", 5.5, 12, 1.5], ["dot", 12, 12, 1.5], ["dot", 18.5, 12, 1.5]],
  search: [["c", 10.5, 10.5, 6.5], "M15.25 15.25L20 20"],
  filter: ["M4 5h16l-6 7.5V19l-4-2v-4.5Z"],
  edit: ["M15 4.5l4.5 4.5L9 19.5H4.5V15Z", "M12.5 7l4.5 4.5"],
  trash: ["M4 6.5h16", "M9.5 6.5v-2h5v2", "M6 6.5l1 13h10l1-13", "M10 10.5v5.5M14 10.5v5.5"],
  copy: [["r", 8.5, 8.5, 11.5, 11.5, 2], "M15.5 8.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5"],
  undo: ["M8.5 14L4 9.5 8.5 5", "M4 9.5h10a5.25 5.25 0 0 1 0 10.5h-3"],
  refresh: ["M20 12a8 8 0 1 1-2.34-5.66", "M18.5 3v4h-4"],
  expand: ["M14 4h6v6M10 20H4v-6", "M20 4l-6.5 6.5M4 20l6.5-6.5"],
  shrink: ["M14 4v6h6M10 20v-6H4", "M14 10l6-6M10 14l-6 6"],
  lock: [["r", 5, 10.5, 14, 10, 2], "M8 10.5V8a4 4 0 0 1 8 0v2.5", "M12 14.5v2"],
  info: [["c", 12, 12, 9], "M12 11v5.5", ["dot", 12, 7.75, 1.15]],
  alert: ["M12 3.5L21 19.5H3Z", "M12 9.5v4.5", ["dot", 12, 16.75, 1.1]],
  help: [["c", 12, 12, 9], "M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7v.3", ["dot", 12, 16.75, 1.15]],
  link: ["M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1", "M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"],
  external: ["M18 13.5V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4.5", "M14 4h6v6", "M20 4l-9 9"],
  download: ["M12 4v11", "M7.5 10.5L12 15l4.5-4.5", "M4.5 19.5h15"],
  upload: ["M12 15V4", "M7.5 8.5L12 4l4.5 4.5", "M4.5 19.5h15"],
  list: ["M9 6.5h11M9 12h11M9 17.5h11", ["dot", 4.75, 6.5, 1.15], ["dot", 4.75, 12, 1.15], ["dot", 4.75, 17.5, 1.15]],
  grid: [["r", 4, 4, 6.5, 6.5, 1.5], ["r", 13.5, 4, 6.5, 6.5, 1.5], ["r", 4, 13.5, 6.5, 6.5, 1.5], ["r", 13.5, 13.5, 6.5, 6.5, 1.5]],
  layers: ["M12 4l8.5 4.5L12 13 3.5 8.5Z", "M3.5 12.5L12 17l8.5-4.5", "M3.5 16.5L12 21l8.5-4.5"],
  code: ["M8.5 7L3.5 12l5 5", "M15.5 7l5 5-5 5", "M13.5 4.5l-3 15"],
  function: ["M13 4.5h-1a2.5 2.5 0 0 0-2.47 2.1L7.97 17.4A2.5 2.5 0 0 1 5.5 19.5h-1", "M7 10h6", "M15 13l4.5 5.5M19.5 13L15 18.5"],
  branch: [["c", 6.5, 5.5, 2], ["c", 6.5, 18.5, 2], ["c", 17.5, 8.5, 2], "M6.5 7.5v9", "M17.5 10.5a4.5 4.5 0 0 1-4.5 4.5H6.5"],
  table: [["r", 3.5, 4.5, 17, 15, 2], "M3.5 9.5h17M3.5 14.5h17M10 9.5v10"],
  checklist: ["M3.5 6l1.75 1.75L8.5 4.5", "M3.5 12l1.75 1.75L8.5 10.5", "M3.5 18l1.75 1.75L8.5 16.5", "M12 6.5h8.5M12 12.5h8.5M12 18.5h8.5"],
  sparkle: ["M11 5c.7 4.8 2.7 6.8 7.5 7.5-4.8.7-6.8 2.7-7.5 7.5-.7-4.8-2.7-6.8-7.5-7.5C8.3 11.8 10.3 9.8 11 5Z", "M18.5 2.5v4M16.5 4.5h4"],
  wand: ["M4 20l11-11", "M17.5 3v4M15.5 5h4", "M20 11v3M18.5 12.5h3", "M9.5 3.5v2.5M8.25 4.75h2.5"],
  send: ["M20.5 3.5L10 14", "M20.5 3.5L14 20.5l-4-6.5-6.5-4Z"],
  message: ["M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-7l-4.5 3.5V17H6a2 2 0 0 1-2-2Z"],
  clock: [["c", 12, 12, 9], "M12 7.5V12l3 2"],
  calendar: [["r", 3.5, 5, 17, 15.5, 2], "M3.5 10h17", "M8 3v4M16 3v4"],
  hourglass: ["M6.5 3.5h11M6.5 20.5h11", "M7.5 3.5c0 4 4.5 5.5 4.5 8.5s-4.5 4.5-4.5 8.5", "M16.5 3.5c0 4-4.5 5.5-4.5 8.5s4.5 4.5 4.5 8.5"],
  pause: [["r", 6.5, 5, 3.5, 14, 1], ["r", 14, 5, 3.5, 14, 1]],
  play: ["M7.5 5L18.5 12 7.5 19Z"],
  "fast-forward": ["M4 6.5L11.5 12 4 17.5Z", "M12.5 6.5L20 12l-7.5 5.5Z"],
  bolt: ["M13.5 3L5 13.5h6.5L10.5 21 19 10.5h-6.5Z"],
  pin: ["M12 21s6.5-5.6 6.5-11a6.5 6.5 0 0 0-13 0c0 5.4 6.5 11 6.5 11Z", ["c", 12, 10, 2.5]],
  home: ["M4 11l8-6.5 8 6.5", "M6 9.5v10h4.5v-5h3v5H18v-10"],
  route: [["c", 6, 18.5, 2], ["c", 18, 4.5, 2], "M8 18.5h7.5a3.5 3.5 0 0 0 0-7h-7a3.5 3.5 0 0 1 0-7H16"],
  sun: [["c", 12, 12, 4], "M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"],
  moon: ["M20 14.5A8.5 8.5 0 1 1 9.5 4a7.5 7.5 0 0 0 10.5 10.5Z"],
  cloud: ["M7 18.5a4 4 0 0 1-.6-7.95A5.5 5.5 0 0 1 17 9.5a4.5 4.5 0 0 1 .5 9Z"],
  rain: ["M7 14.5a3.5 3.5 0 0 1-.5-7A5 5 0 0 1 16 6.5a4 4 0 0 1 .5 8Z", "M8 17.5l-1 2.5M12 17.5l-1 2.5M16 17.5l-1 2.5"],
  snow: ["M12 21V3M4.21 16.5L19.79 7.5M4.21 7.5L19.79 16.5", "M10.3 19.9L12 18.2l1.7 1.7M4.31 14.48l2.32.62-.62 2.32M6.01 6.58l.62 2.32-2.32.62M13.7 4.1L12 5.8l-1.7-1.7M19.69 9.52l-2.32-.62.62-2.32M17.99 17.42l-.62-2.32 2.32-.62"],
  wind: ["M3 8.5h11a2.5 2.5 0 1 0-2.5-2.5", "M3 12.5h15.5a2.5 2.5 0 1 1-2.5 2.5", "M3 16.5h7"],
  wallet: [["r", 3.5, 6.5, 17, 13, 2.5], "M20.5 10.5H16a2.25 2.25 0 0 0 0 4.5h4.5", "M6 6.5l9-2.5 1 2.5"],
  coins: [["c", 14.5, 14.5, 6], "M15.4 8.6A6 6 0 1 0 8.6 15.4", ["c", 14.5, 14.5, 2.5]],
  card: [["r", 3, 5.5, 18, 13, 2], "M3 10h18", "M6.5 15h3"],
  bank: ["M3.5 9.5L12 4.5l8.5 5Z", "M5.5 9.5v8M9.8 9.5v8M14.2 9.5v8M18.5 9.5v8", "M3.5 20h17"],
  receipt: ["M6 3.5h12v17l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5-2 1.5Z", "M9 8h6M9 12h6M9 16h3"],
  bag: ["M5 8h14l-1 12.5H6Z", "M9 10.5V7a3 3 0 0 1 6 0v3.5"],
  box: ["M12 3.5l8 4.25v8.5L12 20.5l-8-4.25v-8.5Z", "M4 7.75L12 12l8-4.25", "M12 12v8.5"],
  key: [["c", 7.75, 16.25, 4.25], "M10.75 13.25L20 4", "M16.75 7.25l2.75 2.75", "M14.25 9.75l2 2"],
  car: ["M5.5 17h-2v-3.5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2V17h-2M9.5 17h5", "M6 11.5l1.6-4.2A1.5 1.5 0 0 1 9 6.5h6a1.5 1.5 0 0 1 1.4.8L18 11.5", ["c", 7.5, 17, 2], ["c", 16.5, 17, 2]],
  boat: ["M2.5 15.5h19l-3 4.5h-13Z", "M12 3V15.5", "M12 3.5l7 9.5h-7", "M10 6.5l-5 6.5h5"],
  fuel: ["M5 20.5v-15a2 2 0 0 1 2-2h5a2 2 0 0 1 2 2v15", "M3.5 20.5h12", ["r", 7.5, 6.5, 4, 4, 0.5], "M14 11h1.5a1.5 1.5 0 0 1 1.5 1.5v4a1.5 1.5 0 0 0 3 0v-8l-2.5-2.5"],
  wrench: ["M13.22 13.04L7.54 18.72A1.6 1.6 0 0 1 5.28 16.46L10.96 10.78A4.75 4.75 0 0 1 17.38 4.5L14.72 7.16A1.5 1.5 0 0 0 16.84 9.28L19.5 6.62A4.75 4.75 0 0 1 13.22 13.04Z"],
  briefcase: [["r", 3.5, 7, 17, 12.5, 2], "M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7", "M3.5 12.5h17"],
  heart: ["M12 19.5S4 14.8 4 9.2A4.2 4.2 0 0 1 12 7a4.2 4.2 0 0 1 8 2.2c0 5.6-8 10.3-8 10.3Z"],
  pulse: ["M3 12h4l2.5-6 5 12 2.5-6h4"],
  shield: ["M12 3.5l7 2.5v5.5c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6Z"],
  sword: ["M20 4v3.5L10.5 17 7 13.5 16.5 4Z", "M5.5 12l6.5 6.5", "M8.25 15.75L4 20"],
  flag: ["M5 21V4", "M5 4.5h12l-2.5 4 2.5 4H5"],
  scroll: ["M5.5 4.5h10a2 2 0 0 1 2 2v10", "M5.5 4.5a2 2 0 0 0-2 2V8h4V6.5a2 2 0 0 0-2-2", "M7.5 8v10a2 2 0 1 0 4 0v-1.5h9V18a2 2 0 0 1-2 2H9.5", "M10.5 8.5h4M10.5 12h4"],
  star: ["M12 3.6l2.35 5.96 6.4.4-4.95 4.08 1.61 6.2L12 16.8l-5.41 3.44 1.61-6.2-4.95-4.08 6.4-.4Z"],
  "user-plus": [["c", 10, 8, 3.75], "M3 20c0-4 3.1-6.75 7-6.75 1.4 0 2.7.35 3.75 1", "M18 13v6M15 16h6"],
};

function shape(spec: Shape, key: number) {
  if (typeof spec === "string") return <path key={key} d={spec} />;
  switch (spec[0]) {
    case "c":
      return <circle key={key} cx={spec[1]} cy={spec[2]} r={spec[3]} />;
    case "dot":
      return <circle key={key} cx={spec[1]} cy={spec[2]} r={spec[3]} fill="currentColor" stroke="none" />;
    case "r":
      return <rect key={key} x={spec[1]} y={spec[2]} width={spec[3]} height={spec[4]} rx={spec[5]} />;
  }
}

export function Icon(props: { name: IconName; size?: number; label?: string; class?: string }) {
  const size = props.size ?? 20;
  return (
    <svg
      class={props.class ? `lre-icon ${props.class}` : "lre-icon"}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.75"
      stroke-linecap="round"
      stroke-linejoin="round"
      focusable="false"
      aria-hidden={props.label ? undefined : "true"}
      role={props.label ? "img" : undefined}
      aria-label={props.label}
    >
      {ICONS[props.name].map(shape)}
    </svg>
  );
}
