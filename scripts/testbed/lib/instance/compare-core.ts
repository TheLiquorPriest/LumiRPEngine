// Two read-backs of the test instance compared item by item, ids aside (PlanScenarios-4 item 1: two
// runs from nothing, each into fresh folders, give the same `report.json`). Ids differ from run to
// run by nature (Lumiverse's uuids, the world's id, content hashes of revisions that hold them), so
// everything under a key named `ids` is set aside. What the model chose (how many mind files the
// author wrote, whom it cast) is under a key named `played`: each of its entries must be there on
// both sides, holding something, and the values are not compared; a `found` beside a `played`
// counts what the model made, so it is compared as above zero on both sides. Everything else must
// be equal.

const IDS = "ids";
const PLAYED = "played";

type Value = unknown;

function isObject(value: Value): value is { [key: string]: Value } {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Whether a value holds something: what a `played` entry must do on both sides. */
function holds(value: Value): boolean {
  if (value === undefined || value === null || value === false || value === 0 || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  if (isObject(value)) return Object.keys(value).length > 0;
  return true;
}

function show(value: Value): string {
  const text = JSON.stringify(value);
  return text === undefined ? "nothing" : text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

function comparePlayed(a: Value, b: Value, path: string, out: string[]): void {
  if (isObject(a) && isObject(b)) {
    for (const key of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
      const left = holds(a[key]);
      const right = holds(b[key]);
      if (left !== right) out.push(`${path}.${key}: ${left ? "there" : "missing"} in the first, ${right ? "there" : "missing"} in the second`);
    }
    return;
  }
  if (holds(a) !== holds(b)) out.push(`${path}: ${holds(a) ? "there" : "missing"} in the first, ${holds(b) ? "there" : "missing"} in the second`);
}

function compareValue(a: Value, b: Value, path: string, out: string[]): void {
  if (isObject(a) && isObject(b)) {
    const played = PLAYED in a || PLAYED in b;
    for (const key of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
      if (key === IDS) continue;
      const at = path === "" ? key : `${path}.${key}`;
      if (key === PLAYED) comparePlayed(a[key], b[key], at, out);
      else if (key === "found" && played && typeof a[key] === "number" && typeof b[key] === "number") {
        if ((a[key] as number) > 0 !== (b[key] as number) > 0) out.push(`${at}: ${show(a[key])} in the first, ${show(b[key])} in the second`);
      } else compareValue(a[key], b[key], at, out);
    }
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      out.push(`${path}: ${a.length} entries in the first, ${b.length} in the second`);
      return;
    }
    a.forEach((item, i) => compareValue(item, b[i], `${path}[${i}]`, out));
    return;
  }
  if (a !== b) out.push(`${path}: ${show(a)} in the first, ${show(b)} in the second`);
}

/** Every difference between two read-backs, one line each with its path; none when they are the same, ids aside. */
export function compareReports(first: Value, second: Value): string[] {
  const out: string[] = [];
  compareValue(first, second, "", out);
  return out;
}

function collectPresence(value: Value, path: string, out: Set<string>): void {
  if (Array.isArray(value)) {
    value.forEach((item, i) => collectPresence(item, `${path}[${i}]`, out));
    return;
  }
  if (!isObject(value)) return;
  const played = PLAYED in value;
  for (const [key, inner] of Object.entries(value)) {
    if (key === IDS) continue;
    const at = path === "" ? key : `${path}.${key}`;
    if (key === PLAYED) {
      if (isObject(inner)) for (const name of Object.keys(inner)) out.add(`${at}.${name}`);
      else out.add(at);
    } else if (key === "found" && played) out.add(`${at} (above zero)`);
    else collectPresence(inner, at, out);
  }
}

/** Every field the comparison asks only to be there on both sides (what the model chose), sorted: printed beside the result. */
export function presenceOnly(first: Value, second: Value): string[] {
  const out = new Set<string>();
  collectPresence(first, "", out);
  collectPresence(second, "", out);
  return [...out].sort();
}
