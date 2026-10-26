// What holds the heap: the dominator tree of a JSC heap snapshot (`Bun.generateHeapSnapshot()`,
// the Inspector format: nodes `[id, size, class, flags]`, edges `[from, to, type, data]`), and the
// bytes each object retains, the bytes that would go if it went. Used by `engine-state.ts`.

interface InspectorSnapshot {
  nodes: number[];
  nodeClassNames: string[];
  edges: number[];
  edgeTypes: string[];
  edgeNames: string[];
}

export interface Retainer {
  /** The path from the object asked about, by property name (`[i]` an index, `·` a link no property names). */
  path: string;
  className: string;
  bytes: number;
}

export class HeapGraph {
  private readonly size: Float64Array;
  private readonly cls: Int32Array;
  private readonly outStart: Int32Array;
  private readonly outTo: Int32Array;
  private readonly outEdge: Int32Array;
  private readonly idom: Int32Array;
  /** Bytes each node retains (its own and those of every node it dominates). */
  readonly retained: Float64Array;
  private readonly kids: Int32Array;
  private readonly kidStart: Int32Array;
  private readonly snapshot: InspectorSnapshot;

  constructor(raw: unknown) {
    const s = raw as InspectorSnapshot;
    this.snapshot = s;
    const n = s.nodes.length / 4;
    const e = s.edges.length / 4;
    let maxId = 0;
    for (let i = 0; i < n; i++) maxId = Math.max(maxId, s.nodes[i * 4] as number);
    const index = new Int32Array(maxId + 1).fill(-1);
    this.size = new Float64Array(n);
    this.cls = new Int32Array(n);
    let root = 0;
    for (let i = 0; i < n; i++) {
      const id = s.nodes[i * 4] as number;
      index[id] = i;
      this.size[i] = s.nodes[i * 4 + 1] as number;
      this.cls[i] = s.nodes[i * 4 + 2] as number;
      if (id === 0) root = i;
    }
    // Out-edges, by source node.
    this.outStart = new Int32Array(n + 1);
    for (let k = 0; k < e; k++) {
      const from = index[s.edges[k * 4] as number] as number;
      this.outStart[from + 1] = (this.outStart[from + 1] as number) + 1;
    }
    for (let i = 0; i < n; i++) this.outStart[i + 1] = (this.outStart[i + 1] as number) + (this.outStart[i] as number);
    this.outTo = new Int32Array(e);
    this.outEdge = new Int32Array(e);
    const fill = this.outStart.slice(0, n);
    for (let k = 0; k < e; k++) {
      const from = index[s.edges[k * 4] as number] as number;
      const at = fill[from] as number;
      fill[from] = at + 1;
      this.outTo[at] = index[s.edges[k * 4 + 1] as number] as number;
      this.outEdge[at] = k;
    }
    // Depth-first from the root: preorder and postorder numbers.
    const pre = new Int32Array(n).fill(-1);
    const post = new Int32Array(n).fill(-1);
    const order = new Int32Array(n);
    const stackNode = new Int32Array(n);
    const stackEdge = new Int32Array(n);
    let reached = 0;
    let posts = 0;
    let top = 0;
    stackNode[0] = root;
    stackEdge[0] = this.outStart[root] as number;
    pre[root] = 0;
    order[reached++] = root;
    while (top >= 0) {
      const v = stackNode[top] as number;
      const k = stackEdge[top] as number;
      if (k < (this.outStart[v + 1] as number)) {
        stackEdge[top] = k + 1;
        const w = this.outTo[k] as number;
        if (w >= 0 && pre[w] === -1) {
          pre[w] = reached;
          order[reached++] = w;
          top++;
          stackNode[top] = w;
          stackEdge[top] = this.outStart[w] as number;
        }
      } else {
        post[v] = posts++;
        top--;
      }
    }
    // Predecessors of the reached nodes.
    const inStart = new Int32Array(n + 1);
    for (let v = 0; v < n; v++) {
      if (pre[v] === -1) continue;
      for (let k = this.outStart[v] as number; k < (this.outStart[v + 1] as number); k++) {
        const w = this.outTo[k] as number;
        if (w >= 0) inStart[w + 1] = (inStart[w + 1] as number) + 1;
      }
    }
    for (let i = 0; i < n; i++) inStart[i + 1] = (inStart[i + 1] as number) + (inStart[i] as number);
    const inFrom = new Int32Array(inStart[n] as number);
    const inFill = inStart.slice(0, n);
    for (let v = 0; v < n; v++) {
      if (pre[v] === -1) continue;
      for (let k = this.outStart[v] as number; k < (this.outStart[v + 1] as number); k++) {
        const w = this.outTo[k] as number;
        if (w < 0) continue;
        const at = inFill[w] as number;
        inFill[w] = at + 1;
        inFrom[at] = v;
      }
    }
    // Immediate dominators (Cooper, Harvey and Kennedy), over the reached nodes in reverse postorder.
    const rpo = Int32Array.from(order.subarray(0, reached)).sort((a, b) => (post[b] as number) - (post[a] as number));
    const idom = new Int32Array(n).fill(-1);
    idom[root] = root;
    const intersect = (a0: number, b0: number): number => {
      let a = a0;
      let b = b0;
      while (a !== b) {
        while ((post[a] as number) < (post[b] as number)) a = idom[a] as number;
        while ((post[b] as number) < (post[a] as number)) b = idom[b] as number;
      }
      return a;
    };
    for (let changed = true; changed; ) {
      changed = false;
      for (const b of rpo) {
        if (b === root) continue;
        let next = -1;
        for (let k = inStart[b] as number; k < (inStart[b + 1] as number); k++) {
          const p = inFrom[k] as number;
          if (idom[p] === -1) continue;
          next = next === -1 ? p : intersect(p, next);
        }
        if (next !== -1 && idom[b] !== next) {
          idom[b] = next;
          changed = true;
        }
      }
    }
    this.idom = idom;
    // Retained bytes: a dominator comes before every node it dominates in any depth-first preorder.
    this.retained = Float64Array.from(this.size);
    for (let i = reached - 1; i > 0; i--) {
      const v = order[i] as number;
      const d = idom[v] as number;
      if (d >= 0 && d !== v) this.retained[d] = (this.retained[d] as number) + (this.retained[v] as number);
    }
    for (let v = 0; v < n; v++) if (pre[v] === -1) this.retained[v] = 0;
    // The dominator tree's children, by parent.
    this.kidStart = new Int32Array(n + 1);
    for (let v = 0; v < n; v++) if (pre[v] !== -1 && v !== root) this.kidStart[(idom[v] as number) + 1] = (this.kidStart[(idom[v] as number) + 1] as number) + 1;
    for (let i = 0; i < n; i++) this.kidStart[i + 1] = (this.kidStart[i + 1] as number) + (this.kidStart[i] as number);
    this.kids = new Int32Array(this.kidStart[n] as number);
    const kidFill = this.kidStart.slice(0, n);
    for (let v = 0; v < n; v++) {
      if (pre[v] === -1 || v === root) continue;
      const d = idom[v] as number;
      const at = kidFill[d] as number;
      kidFill[d] = at + 1;
      this.kids[at] = v;
    }
  }

  className(v: number): string {
    return this.snapshot.nodeClassNames[this.cls[v] as number] ?? "?";
  }

  /** Every node of the class, largest retainer first. */
  ofClass(name: string): number[] {
    const out: number[] = [];
    for (let v = 0; v < this.cls.length; v++) if (this.className(v) === name && (this.retained[v] as number) > 0) out.push(v);
    return out.sort((a, b) => (this.retained[b] as number) - (this.retained[a] as number));
  }

  /** The property `name` of `v` (the first edge so named), or -1. */
  property(v: number, name: string): number {
    for (let k = this.outStart[v] as number; k < (this.outStart[v + 1] as number); k++) {
      const e = this.outEdge[k] as number;
      const type = this.snapshot.edgeTypes[this.snapshot.edges[e * 4 + 2] as number];
      if ((type === "Property" || type === "Variable") && this.snapshot.edgeNames[this.snapshot.edges[e * 4 + 3] as number] === name) return this.outTo[k] as number;
    }
    return -1;
  }

  /** How `parent` links to `child`: a property name, an index, or `·` when no edge of its own does. */
  private label(parent: number, child: number): string {
    for (let k = this.outStart[parent] as number; k < (this.outStart[parent + 1] as number); k++) {
      if (this.outTo[k] !== child) continue;
      const e = this.outEdge[k] as number;
      const type = this.snapshot.edgeTypes[this.snapshot.edges[e * 4 + 2] as number];
      const data = this.snapshot.edges[e * 4 + 3] as number;
      if (type === "Index") return `[${data}]`;
      if (type === "Property" || type === "Variable") return this.snapshot.edgeNames[data] ?? "?";
      return "(internal)";
    }
    return "·";
  }

  /**
   * The dominator subtree under `v` as paths: each child retaining at least `minBytes`, opened up to
   * `depth` levels while one child holds most of its parent; the rest of each level summed by class.
   */
  tree(v: number, minBytes: number, depth: number, prefix = ""): Retainer[] {
    const out: Retainer[] = [];
    const children = Array.from(this.kids.subarray(this.kidStart[v] as number, this.kidStart[v + 1] as number)).sort((a, b) => (this.retained[b] as number) - (this.retained[a] as number));
    const small = new Map<string, number>();
    for (const c of children) {
      const bytes = this.retained[c] as number;
      const path = `${prefix}${prefix ? "." : ""}${this.label(v, c)}`;
      if (bytes < minBytes) {
        const key = `${prefix}${prefix ? "." : ""}* (${this.className(c)})`;
        small.set(key, (small.get(key) ?? 0) + bytes);
        continue;
      }
      out.push({ path, className: this.className(c), bytes });
      if (depth > 0) out.push(...this.tree(c, minBytes, depth - 1, path));
    }
    for (const [path, bytes] of small) if (bytes >= minBytes) out.push({ path, className: "(summed)", bytes });
    return out;
  }
}
