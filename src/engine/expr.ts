// A small, safe, deterministic formula language for rules, predicates and derived fields.
//
//   20 + skill / 12 - here.security
//   has('lockpick') and hour >= 20
//   stress > 8000 ? 2 : 0
//
// Adapted from Warp's engine/expr.ts (see NOTICE). Source text is parsed into an AST and
// interpreted: no eval, no Function constructor, no access to globals. A formula can read only
// what the ExprEnv handed to it exposes, and it can never loop, so cost is bounded by hard
// limits (below).
//
// ── Syntax ────────────────────────────────────────────────────────────────────────────────
//   numbers      12   3.5   .5            (no exponent form, no leading sign: use unary minus)
//   strings      'text'  "text"           (a backslash makes the next character literal: \' \" \\)
//   literals     true  false  null
//   names        stress   stats.body      (a dotted path is ONE lookup: lookup(["stats","body"]))
//   calls        min(a, b, c)   has('x')  (name followed by "(", zero or more comma-separated args)
//   unary        -x   +x   !x   not x     (+x is a no-op; ! and not are the same)
//   binary       * / %   +  -   < <= > >=   == !=   and &&   or ||
//   ternary      cond ? a : b
//   grouping     ( ... )
//   whitespace is ignored; there are no comments.
//
// Precedence, tightest first:  unary  >  * / %  >  + -  >  < <= > >=  >  == !=  >  and  >  or
// >  ?: .  Binary operators are left-associative. The ternary is the loosest and is
// right-associative: `a ? b : c ? d : e` is `a ? b : (c ? d : e)`, and `1 + 1 ? x : y` tests
// `1 + 1`. Unary operators bind tighter than every binary one: `not 0 == 2` is `(not 0) == 2`.
//
// ── Semantics (kept from Warp) ──────────────────────────────────────────────────────────
//   Values are number | string | boolean | null.
//   Truthiness: false, null, 0 and "" are false; everything else is true.
//   Numeric coercion (arithmetic, comparisons, math functions): true → 1, false → 0, null → 0,
//     a numeric string → its number, any other string → 0.
//   `+` concatenates when either side is a string (null prints as ""), otherwise adds numbers.
//   `== !=` compare as text when either side is a string, otherwise as numbers (so null == 0).
//   `< <= > >=` are always numeric.
//   `/` and `%` by zero give 0, never Infinity or NaN.
//   `and` / `or` short-circuit and return the deciding operand, not a boolean: `0 or 'x'` is 'x'.
//   `?:` evaluates only the chosen branch.
//   An unknown name or function evaluates to 0 and is reported in `opts.unknown` when given.
//   Built-in functions (checked before the environment's): min, max (any number of arguments),
//     clamp(v, lo, hi), floor, ceil, round, abs.
//   `opts.all` evaluates every branch of and / or / ?: (a validator can then see every name).
//
// ── Deliberate differences from Warp ────────────────────────────────────────────────────
//   * Hard limits (ExprLimits) with a typed ExprLimitError: source length, nesting depth, AST
//     nodes and evaluation steps.
//   * Every number is finite: arithmetic that overflows, a missing math argument, or an
//     environment value of NaN or Infinity yields 0 (as division by zero already did). A numeric
//     literal too large for a double is a parse error.
//   * Built-ins are looked up as own entries, so `toString(1)` or `constructor(2)` call the
//     environment (and are unknown) instead of reaching Object.prototype.
//   * No module-level compile cache. `compile` is pure; callers that evaluate a formula often
//     keep the Program it returns.
//   * Randomness and time are not available to formulas. A function that needs a random number
//     must be supplied by the environment and close over an injected Rng (engine/rng).
//
// ── Limits ───────────────────────────────────────────────────────────────────────────────
//   maxSourceLength 4096  UTF-16 code units of the raw source, checked before parsing.
//   maxDepth          64  Nesting: parenthesised groups, call arguments, ternary branches and
//                         chained prefix operators each add one level. A flat chain such as
//                         a + b + c + … is not nested. 64 levels pass; 65 throw.
//   maxNodes        2048  AST nodes. Parentheses and a unary plus make no node.
//   maxSteps      100000  AST nodes visited during evaluation, summed over every evaluation that
//                         shares an ExprBudget. One evaluation of a program visits each node at
//                         most once, so with the default maxNodes a single evaluation cannot
//                         exhaust the default; the budget exists for callers that evaluate many
//                         formulas (a whole tick, a whole rule pass) under one cap.

export type Value = number | string | boolean | null;

export type Node =
  | { readonly k: "num"; readonly v: number }
  | { readonly k: "str"; readonly v: string }
  | { readonly k: "lit"; readonly v: boolean | null }
  | { readonly k: "id"; readonly path: readonly string[] }
  | { readonly k: "call"; readonly name: string; readonly args: readonly Node[] }
  | { readonly k: "un"; readonly op: "-" | "not"; readonly a: Node }
  | { readonly k: "bin"; readonly op: string; readonly a: Node; readonly b: Node }
  | { readonly k: "tern"; readonly c: Node; readonly a: Node; readonly b: Node };

/** Everything a formula can see. Names and functions resolve only through this object. */
export interface ExprEnv {
  /** Resolve an identifier path like ["stress"] or ["flags", "door_open"]. Return undefined when unknown. */
  lookup(path: readonly string[]): Value | undefined;
  /** Ruleset-specific functions (has, count, flag, rel…). Built-in math functions are always available. */
  call?(name: string, args: Value[]): Value | undefined;
}

/** A formula that cannot be parsed or evaluated. */
export class ExprError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExprError";
  }
}

export type ExprLimitKind = "sourceLength" | "depth" | "nodes" | "steps";

/** A hard limit was exceeded. `limit` says which one and `max` is its value. */
export class ExprLimitError extends ExprError {
  readonly limit: ExprLimitKind;
  readonly max: number;
  constructor(limit: ExprLimitKind, max: number) {
    super(`Formula exceeds the ${LIMIT_NAMES[limit]} limit of ${max}`);
    this.name = "ExprLimitError";
    this.limit = limit;
    this.max = max;
  }
}

const LIMIT_NAMES: Record<ExprLimitKind, string> = {
  sourceLength: "source length",
  depth: "nesting depth",
  nodes: "node count",
  steps: "evaluation step",
};

export interface ExprLimits {
  maxSourceLength: number;
  maxDepth: number;
  maxNodes: number;
  maxSteps: number;
}

export const DEFAULT_LIMITS: Readonly<ExprLimits> = Object.freeze({
  maxSourceLength: 4096,
  maxDepth: 64,
  maxNodes: 2048,
  maxSteps: 100_000,
});

function resolveLimits(overrides?: Partial<ExprLimits>): ExprLimits {
  const out = { ...DEFAULT_LIMITS };
  if (overrides) {
    for (const key of Object.keys(DEFAULT_LIMITS) as (keyof ExprLimits)[]) {
      const v = overrides[key];
      if (v === undefined) continue;
      if (!Number.isSafeInteger(v) || v < 1) throw new RangeError(`${key} must be a positive integer, got ${v}`);
      out[key] = v;
    }
  }
  return out;
}

/** A pool of evaluation steps. Share one across evaluations to cap their combined cost. */
export class ExprBudget {
  readonly max: number;
  private left: number;
  constructor(max: number = DEFAULT_LIMITS.maxSteps) {
    if (!Number.isSafeInteger(max) || max < 1) throw new RangeError(`budget must be a positive integer, got ${max}`);
    this.max = max;
    this.left = max;
  }
  /** Steps spent so far. */
  get used(): number { return this.max - this.left; }
  /** Spend one step; throws ExprLimitError("steps") when the pool is already empty. */
  spend(): void {
    if (this.left <= 0) throw new ExprLimitError("steps", this.max);
    this.left--;
  }
}

// ───────────────────────────── tokenizer ─────────────────────────────

type Tok = { readonly t: "num" | "str" | "id" | "op"; readonly v: string; readonly at: number };

const OPS = ["<=", ">=", "==", "!=", "&&", "||", "+", "-", "*", "/", "%", "<", ">", "!", "(", ")", ",", ".", "?", ":"];

const isDigit = (c: string | undefined): boolean => c !== undefined && c >= "0" && c <= "9";
const isIdStart = (c: string): boolean => (c >= "A" && c <= "Z") || (c >= "a" && c <= "z") || c === "_";
const isIdPart = (c: string): boolean => isIdStart(c) || isDigit(c);

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (isDigit(c) || (c === "." && isDigit(src[i + 1]))) {
      let j = i;
      while (isDigit(src[j])) j++;
      if (src[j] === "." && isDigit(src[j + 1])) {
        j++;
        while (isDigit(src[j])) j++;
      }
      out.push({ t: "num", v: src.slice(i, j), at: i });
      i = j;
      continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      let s = "";
      while (j < src.length && src[j] !== c) {
        if (src[j] === "\\" && j + 1 < src.length) { s += src[j + 1]; j += 2; continue; }
        s += src[j++];
      }
      if (j >= src.length) throw new ExprError(`Unclosed quote starting at character ${i + 1}`);
      out.push({ t: "str", v: s, at: i });
      i = j + 1;
      continue;
    }
    if (isIdStart(c)) {
      let j = i + 1;
      while (j < src.length && isIdPart(src[j])) j++;
      out.push({ t: "id", v: src.slice(i, j), at: i });
      i = j;
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op) throw new ExprError(`Unexpected "${c}" at character ${i + 1}`);
    out.push({ t: "op", v: op, at: i });
    i += op.length;
  }
  return out;
}

// ───────────────────────────── parser ─────────────────────────────

const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

// Binding power for binary operators (higher binds tighter). Read through hasOwn so a token
// can never resolve to an Object.prototype member.
const BP: Record<string, number> = {
  or: 1, "||": 1,
  and: 2, "&&": 2,
  "==": 3, "!=": 3,
  "<": 4, "<=": 4, ">": 4, ">=": 4,
  "+": 5, "-": 5,
  "*": 6, "/": 6, "%": 6,
};

class Parser {
  private i = 0;
  private depth = 0;
  private nodes = 0;
  constructor(private readonly toks: readonly Tok[], private readonly limits: ExprLimits) {}

  parse(): { root: Node; nodeCount: number } {
    const root = this.expr(0);
    if (this.i < this.toks.length) this.fail(`Unexpected "${this.toks[this.i].v}"`);
    return { root, nodeCount: this.nodes };
  }

  private peek(): Tok | undefined { return this.toks[this.i]; }

  private fail(msg: string): never {
    const at = this.peek()?.at;
    throw new ExprError(at === undefined ? `${msg} at end of expression` : `${msg} at character ${at + 1}`);
  }

  private eat(v: string): void {
    const t = this.peek();
    if (!t || t.v !== v) this.fail(`Expected "${v}"`);
    this.i++;
  }

  /** Count one AST node against the limit. */
  private node<T extends Node>(n: T): T {
    if (++this.nodes > this.limits.maxNodes) throw new ExprLimitError("nodes", this.limits.maxNodes);
    return n;
  }

  /** Run `fn` one nesting level deeper. */
  private nest<T>(fn: () => T): T {
    if (++this.depth > this.limits.maxDepth) throw new ExprLimitError("depth", this.limits.maxDepth);
    const r = fn();
    this.depth--;
    return r;
  }

  private binOp(t: Tok | undefined): string | null {
    if (!t) return null;
    if (t.t === "op" && hasOwn(BP, t.v)) return t.v;
    if (t.t === "id" && (t.v === "and" || t.v === "or")) return t.v;
    return null;
  }

  private expr(minBp: number): Node {
    let left = this.unary();
    for (;;) {
      const t = this.peek();
      if (t?.t === "op" && t.v === "?" && minBp === 0) {
        this.i++;
        const a = this.nest(() => this.expr(0));
        this.eat(":");
        const b = this.nest(() => this.expr(0));
        left = this.node({ k: "tern", c: left, a, b });
        continue;
      }
      const op = this.binOp(t);
      const bp = op === null ? 0 : BP[op];
      if (op === null || bp <= minBp) break;
      this.i++;
      // The right operand only recurses to a strictly higher binding power, so this is at most
      // six levels deep whatever the input is and needs no depth accounting.
      const right = this.expr(bp);
      left = this.node({ k: "bin", op: op === "&&" ? "and" : op === "||" ? "or" : op, a: left, b: right });
    }
    return left;
  }

  private unary(): Node {
    const t = this.peek();
    if (!t) this.fail("Expression ended too early");
    if (t.t === "op" && t.v === "-") { this.i++; return this.node({ k: "un", op: "-", a: this.nest(() => this.unary()) }); }
    // Leading plus is just emphasis ("+(12 + x)" reads as "add this"), so it is a no-op.
    if (t.t === "op" && t.v === "+") { this.i++; return this.nest(() => this.unary()); }
    if ((t.t === "op" && t.v === "!") || (t.t === "id" && t.v === "not")) {
      this.i++;
      return this.node({ k: "un", op: "not", a: this.nest(() => this.unary()) });
    }
    return this.primary();
  }

  private primary(): Node {
    const t = this.peek();
    if (!t) this.fail("Expression ended too early");
    this.i++;
    if (t.t === "num") {
      const v = Number(t.v);
      if (!Number.isFinite(v)) throw new ExprError(`Number too large at character ${t.at + 1}`);
      return this.node({ k: "num", v });
    }
    if (t.t === "str") return this.node({ k: "str", v: t.v });
    if (t.t === "op" && t.v === "(") {
      const n = this.nest(() => this.expr(0));
      this.eat(")");
      return n;
    }
    if (t.t === "id") {
      if (t.v === "true") return this.node({ k: "lit", v: true });
      if (t.v === "false") return this.node({ k: "lit", v: false });
      if (t.v === "null") return this.node({ k: "lit", v: null });
      if (this.peek()?.v === "(") {
        this.i++;
        const args: Node[] = [];
        if (this.peek()?.v !== ")") {
          for (;;) {
            args.push(this.nest(() => this.expr(0)));
            if (this.peek()?.v === ",") { this.i++; continue; }
            break;
          }
        }
        this.eat(")");
        return this.node({ k: "call", name: t.v, args });
      }
      const path = [t.v];
      while (this.peek()?.v === ".") {
        this.i++;
        const next = this.peek();
        if (!next || next.t !== "id") this.fail('Expected a name after "."');
        path.push(next.v);
        this.i++;
      }
      return this.node({ k: "id", path });
    }
    this.i--;
    this.fail(`Unexpected "${t.v}"`);
  }
}

/** A parsed formula. Immutable; safe to keep and to evaluate repeatedly with different environments. */
export interface Program {
  readonly source: string;
  readonly root: Node;
  /** AST nodes in the program: the most evaluation steps one evaluation can spend. */
  readonly nodeCount: number;
}

/** Formulas parsed with the default limits, by their text: a view or a turn evaluates the same few many times over. */
const PARSED = new Map<string, Program>();
const PARSED_CAP = 4096;

/** Parse a formula. Throws ExprError for bad syntax and ExprLimitError for source length, depth or node count. */
export function compile(src: string, limits?: Partial<ExprLimits>): Program {
  const known = limits === undefined ? PARSED.get(src) : undefined;
  if (known) return known;
  const lim = resolveLimits(limits);
  if (typeof src !== "string") throw new TypeError("formula must be a string");
  if (src.length > lim.maxSourceLength) throw new ExprLimitError("sourceLength", lim.maxSourceLength);
  const source = src.trim();
  const { root, nodeCount } = new Parser(tokenize(source), lim).parse();
  const program: Program = { source, root, nodeCount };
  if (limits === undefined) {
    if (PARSED.size >= PARSED_CAP) PARSED.delete(PARSED.keys().next().value ?? "");
    PARSED.set(src, program);
  }
  return program;
}

// ───────────────────────────── evaluation ─────────────────────────────

const MATH: Record<string, (a: number[]) => number> = {
  min: (a) => Math.min(...a),
  max: (a) => Math.max(...a),
  clamp: ([v, lo, hi]) => Math.min(hi, Math.max(lo, v)),
  floor: ([v]) => Math.floor(v),
  ceil: ([v]) => Math.ceil(v),
  round: ([v]) => Math.round(v),
  abs: ([v]) => Math.abs(v),
};

/** The math built-ins' names (they resolve before any environment function). */
export const MATH_FUNCTIONS: readonly string[] = Object.keys(MATH);

/** A finite number, or 0 for NaN / Infinity. */
function fin(x: number): number {
  return Number.isFinite(x) ? x : 0;
}

function num(v: Value): number {
  if (typeof v === "number") return fin(v);
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v === null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function truthy(v: Value): boolean {
  return !(v === false || v === null || v === 0 || v === "");
}

/** Check a value returned by the environment: NaN and Infinity become 0, other non-Values are an error. */
function fromEnv(v: Value, what: string): Value {
  switch (typeof v) {
    case "number": return fin(v);
    case "string": case "boolean": return v;
    default:
      if (v === null) return v;
      throw new ExprError(`The environment returned an unsupported value for ${what}`);
  }
}

export interface EvalOptions {
  /** Collects identifiers/functions that could not be resolved (used by the validator). */
  unknown?: Set<string>;
  /** Run every branch of and / or / ?: (the validator: a name in a branch not taken is still checked). */
  all?: boolean;
  /** Steps to spend. Share one across evaluations to cap their total; default is a fresh pool of limits.maxSteps. */
  budget?: ExprBudget;
  /** Limits for compiling (and the default step pool). Only needed to tighten or relax the defaults. */
  limits?: Partial<ExprLimits>;
}

interface Ctx {
  readonly env: ExprEnv;
  readonly opts: EvalOptions;
  readonly budget: ExprBudget;
}

function walk(n: Node, c: Ctx): Value {
  c.budget.spend();
  switch (n.k) {
    case "num": case "str": case "lit": return n.v;
    case "id": {
      const v = c.env.lookup(n.path);
      if (v === undefined) { c.opts.unknown?.add(n.path.join(".")); return 0; }
      return fromEnv(v, n.path.join("."));
    }
    case "call": {
      const args = n.args.map((a) => walk(a, c));
      const math = hasOwn(MATH, n.name) ? MATH[n.name] : undefined;
      if (math) return fin(math(args.map(num)));
      const v = c.env.call?.(n.name, args);
      if (v === undefined) { c.opts.unknown?.add(`${n.name}()`); return 0; }
      return fromEnv(v, `${n.name}()`);
    }
    case "un": {
      const a = walk(n.a, c);
      return n.op === "-" ? -num(a) : !truthy(a);
    }
    case "tern": {
      if (c.opts.all) {
        const cond = walk(n.c, c), a = walk(n.a, c), b = walk(n.b, c);
        return truthy(cond) ? a : b;
      }
      return truthy(walk(n.c, c)) ? walk(n.a, c) : walk(n.b, c);
    }
    case "bin": {
      if (c.opts.all && (n.op === "and" || n.op === "or")) {
        const a = walk(n.a, c), b = walk(n.b, c);
        return n.op === "and" ? (truthy(a) ? b : a) : (truthy(a) ? a : b);
      }
      if (n.op === "and") { const a = walk(n.a, c); return truthy(a) ? walk(n.b, c) : a; }
      if (n.op === "or") { const a = walk(n.a, c); return truthy(a) ? a : walk(n.b, c); }
      const a = walk(n.a, c);
      const b = walk(n.b, c);
      switch (n.op) {
        case "+": return typeof a === "string" || typeof b === "string" ? `${a ?? ""}${b ?? ""}` : fin(num(a) + num(b));
        case "-": return fin(num(a) - num(b));
        case "*": return fin(num(a) * num(b));
        case "/": return fin(num(a) / num(b)); // x / 0 is Infinity or NaN, which fin() turns into 0
        case "%": return fin(num(a) % num(b)); // x % 0 is NaN
        case "<": return num(a) < num(b);
        case "<=": return num(a) <= num(b);
        case ">": return num(a) > num(b);
        case ">=": return num(a) >= num(b);
        case "==": return typeof a === "string" || typeof b === "string" ? String(a) === String(b) : num(a) === num(b);
        case "!=": return typeof a === "string" || typeof b === "string" ? String(a) !== String(b) : num(a) !== num(b);
      }
      return null;
    }
  }
}

/** Evaluate a compiled program. Spends one step per node visited; see EvalOptions.budget. */
export function runProgram(program: Program, env: ExprEnv, opts: EvalOptions = {}): Value {
  const budget = opts.budget ?? new ExprBudget(resolveLimits(opts.limits).maxSteps);
  return walk(program.root, { env, opts, budget });
}

/** Evaluate an expression. Numbers and booleans pass through untouched so literal data values work everywhere expressions do. */
export function evaluate(src: string | number | boolean, env: ExprEnv, opts: EvalOptions = {}): Value {
  if (typeof src === "number" || typeof src === "boolean") return src;
  return runProgram(compile(src, opts.limits), env, opts);
}

export function evalNumber(src: string | number | boolean | undefined, env: ExprEnv, fallback = 0, opts: EvalOptions = {}): number {
  if (src === undefined) return fallback;
  return num(evaluate(src, env, opts));
}

export function evalBool(src: string | number | boolean | undefined, env: ExprEnv, fallback = true, opts: EvalOptions = {}): boolean {
  if (src === undefined) return fallback;
  return truthy(evaluate(src, env, opts));
}

/**
 * Every name a formula reads (each path segment), e.g. "athletics / 10 + stats.body" → athletics,
 * stats, body. A formula that does not parse names nothing; one that exceeds a limit throws
 * ExprLimitError so an over-large formula is not mistaken for an empty one.
 */
export function identifiers(src: string | number | boolean | undefined, limits?: Partial<ExprLimits>): string[] {
  if (typeof src !== "string") return [];
  const out = new Set<string>();
  const visit = (n: Node): void => {
    switch (n.k) {
      case "id": n.path.forEach((p) => out.add(p)); break;
      case "call": n.args.forEach(visit); break;
      case "un": visit(n.a); break;
      case "bin": visit(n.a); visit(n.b); break;
      case "tern": visit(n.c); visit(n.a); visit(n.b); break;
    }
  };
  try {
    visit(compile(src, limits).root);
  } catch (e) {
    if (e instanceof ExprLimitError) throw e;
    if (!(e instanceof ExprError)) throw e;
  }
  return [...out];
}

/** A function call a formula makes: its name, and each argument as its literal when it is a string or number literal (else null). */
export interface FormulaCall {
  name: string;
  args: (string | number | null)[];
}

/**
 * Every call a formula makes, outer calls first: "table('xp', 3, 'level') + roll('1d6')" → table
 * ['xp', 3, 'level'], roll ['1d6']. Lint reads it to find calls by name (`roll()` outside effect
 * arguments, unknown tables). A formula that does not parse makes none; one that exceeds a limit
 * throws ExprLimitError, as `identifiers` does.
 */
export function callsIn(src: string | number | boolean | undefined, limits?: Partial<ExprLimits>): FormulaCall[] {
  if (typeof src !== "string") return [];
  const out: FormulaCall[] = [];
  const visit = (n: Node): void => {
    switch (n.k) {
      case "call":
        out.push({ name: n.name, args: n.args.map((a) => (a.k === "num" || a.k === "str" ? a.v : null)) });
        n.args.forEach(visit);
        break;
      case "un": visit(n.a); break;
      case "bin": visit(n.a); visit(n.b); break;
      case "tern": visit(n.c); visit(n.a); visit(n.b); break;
    }
  };
  try {
    visit(compile(src, limits).root);
  } catch (e) {
    if (e instanceof ExprLimitError) throw e;
    if (!(e instanceof ExprError)) throw e;
  }
  return out;
}

// ───────────────────────────── environment helper ─────────────────────────────

export type EnvVars = { readonly [name: string]: Value | EnvVars | undefined };
export type EnvFns = { readonly [name: string]: (...args: Value[]) => Value | undefined };

/**
 * An environment over plain data. Variables are nested objects read by dotted path; only own
 * properties count, so `constructor`, `__proto__` or `toString` are unknown rather than reaching
 * Object.prototype. A path that names a group rather than a value is unknown too.
 */
export function createEnv(vars: EnvVars, fns: EnvFns = {}): ExprEnv {
  return {
    lookup(path) {
      let cur: Value | EnvVars | undefined = vars;
      for (const seg of path) {
        if (cur === null || typeof cur !== "object" || !hasOwn(cur, seg)) return undefined;
        cur = cur[seg];
      }
      return cur !== null && typeof cur === "object" ? undefined : cur;
    },
    call(name, args) {
      return hasOwn(fns, name) ? fns[name](...args) : undefined;
    },
  };
}
