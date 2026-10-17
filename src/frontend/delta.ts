// Applies `lre.state.delta` ops to a state view (ARCHITECTURE §4). Copy-on-write: every
// container on a touched path is a new object, every untouched subtree keeps its identity, so
// components that read unchanged parts skip re-rendering. A path that does not resolve means the
// frontend and backend have diverged; the caller discards the delta and resyncs.

import { isRecord } from "../shared/json";
import type { DeltaOp } from "../shared/protocol";

export class DeltaError extends Error {
  override name = "DeltaError";
}

type Container = Record<string, unknown> | unknown[];
type Path = readonly (string | number)[];

function isContainer(value: unknown): value is Container {
  return Array.isArray(value) || isRecord(value);
}

function pathText(path: Path): string {
  return path.length === 0 ? "(root)" : path.map(String).join(".");
}

/** Resolves one path step: array indexes are non-negative integers, object keys strings. */
function stepKey(container: Container, key: string | number, path: Path): string | number {
  if (!Array.isArray(container)) return String(key);
  const index = typeof key === "number" ? key : /^\d+$/.test(key) ? Number(key) : Number.NaN;
  if (!Number.isInteger(index) || index < 0) throw new DeltaError(`bad array index ${String(key)} at ${pathText(path)}`);
  return index;
}

/** Sets an own property without touching the prototype (`__proto__` can arrive as an ordinary key). */
function writeKey(container: Container, key: string | number, value: unknown): void {
  if (Array.isArray(container)) container[Number(key)] = value;
  else Object.defineProperty(container, String(key), { value, enumerable: true, writable: true, configurable: true });
}

function applyOne(root: unknown, op: DeltaOp): unknown {
  const path = op.path;
  if (path.length === 0) {
    if (op.op === "del") throw new DeltaError("cannot delete the root");
    return op.value;
  }
  if (!isContainer(root)) throw new DeltaError("root is not a container");
  const nextRoot: Container = Array.isArray(root) ? root.slice() : { ...root };
  let parent: Container = nextRoot;
  for (let i = 0; i < path.length - 1; i += 1) {
    const key = stepKey(parent, path[i] ?? "", path);
    const child: unknown = Array.isArray(parent) ? parent[Number(key)] : parent[String(key)];
    if (!isContainer(child)) throw new DeltaError(`no container at ${pathText(path.slice(0, i + 1))}`);
    const copy: Container = Array.isArray(child) ? child.slice() : { ...child };
    writeKey(parent, key, copy);
    parent = copy;
  }
  const key = stepKey(parent, path[path.length - 1] ?? "", path);
  if (Array.isArray(parent)) {
    const index = Number(key);
    if (op.op === "del") {
      if (index >= parent.length) throw new DeltaError(`no element at ${pathText(path)}`);
      parent.splice(index, 1);
    } else {
      if (index > parent.length) throw new DeltaError(`index past the end at ${pathText(path)}`);
      parent[index] = op.value;
    }
  } else if (op.op === "del") {
    if (!Object.prototype.hasOwnProperty.call(parent, key)) throw new DeltaError(`no key at ${pathText(path)}`);
    delete parent[String(key)];
  } else {
    writeKey(parent, key, op.value);
  }
  return nextRoot;
}

/**
 * Returns a new tree with every op applied in order, or throws `DeltaError` when a path does not
 * resolve (a missing intermediate container, an index past the end, deleting an absent key).
 */
export function applyDelta(root: unknown, ops: readonly DeltaOp[]): unknown {
  let next = root;
  for (const op of ops) next = applyOne(next, op);
  return next;
}
