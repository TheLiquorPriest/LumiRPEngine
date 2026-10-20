import { describe, expect, test } from "bun:test";
import {
  DEFAULT_LIMITS,
  ExprBudget,
  ExprError,
  ExprLimitError,
  compile,
  createEnv,
  evalBool,
  evalNumber,
  evaluate,
  identifiers,
  runProgram,
  type EnvFns,
  type EnvVars,
  type Value,
} from "../../src/engine/expr";
import { createRng } from "../../src/engine/rng";
import { thrown, withoutAmbient } from "./support";

const ev = (src: string, vars: EnvVars = {}, fns: EnvFns = {}): Value => evaluate(src, createEnv(vars, fns));

describe("precedence and associativity", () => {
  const cases: [string, Value][] = [
    ["1 + 2 * 3", 7],
    ["(1 + 2) * 3", 9],
    ["10 - 4 - 3", 3], // left associative, not 10 - (4 - 3)
    ["100 / 10 / 5", 2],
    ["2 * 3 % 4", 2], // (2*3)%4, not 2*(3%4)
    ["2 - 3 * 4", -10],
    ["1 + 2 < 4", true], // arithmetic binds tighter than comparison
    ["1 != 2 < 1", true], // == / != are looser than < : 1 != (2 < 1)
    ["true or false and false", true], // and binds tighter than or
    ["false and false or true", true],
    ["-2 * 3", -6],
    ["- -3", 3],
    ["2 - -3", 5],
    ["+(4)", 4],
    ["not 0 == 2", false], // (not 0) == 2, unary binds tighter than ==
    ["!1 + 1", 1], // (!1) + 1
    ["1 ? 2 : 3", 2],
    ["0 ? 1 : 0 ? 2 : 3", 3], // right associative
    ["1 ? 0 ? 1 : 2 : 3", 2],
    ["1 + 1 ? 10 : 20", 10], // the condition is the whole `1 + 1`
    ["0 or 1 ? 5 : 6", 5],
    ["min(1 ? 5 : 9, 7)", 5],
  ];
  for (const [src, want] of cases) {
    test(src, () => expect(ev(src)).toBe(want));
  }

  test("a minimally parenthesised print of a random tree equals its fully parenthesised print", () => {
    // Table of printable binary operators: [symbol, precedence]. Higher binds tighter.
    const OPS: [string, number][] = [
      ["or", 1], ["and", 2], ["==", 3], ["!=", 3], ["<", 4], ["<=", 4], [">", 4], [">=", 4],
      ["+", 5], ["-", 5], ["*", 6], ["/", 6], ["%", 6],
    ];
    type T = { leaf: number; neg: boolean } | { op: string; prec: number; a: T; b: T };
    const rng = createRng("expr-precedence-differential");
    const gen = (depth: number): T => {
      if (depth === 0 || rng.int(0, 4) === 0) return { leaf: rng.int(0, 5), neg: rng.int(0, 5) === 0 };
      const [op, prec] = rng.pick(OPS);
      return { op, prec, a: gen(depth - 1), b: gen(depth - 1) };
    };
    const full = (t: T): string => ("leaf" in t ? (t.neg ? `(-${t.leaf})` : String(t.leaf)) : `(${full(t.a)} ${t.op} ${full(t.b)})`);
    const minimal = (t: T): string => {
      if ("leaf" in t) return t.neg ? `-${t.leaf}` : String(t.leaf);
      const side = (c: T, right: boolean): string => {
        const s = minimal(c);
        if ("leaf" in c) return s;
        // left-associative: a right child of equal precedence needs parentheses
        return c.prec < t.prec || (right && c.prec === t.prec) ? `(${s})` : s;
      };
      return `${side(t.a, false)} ${t.op} ${side(t.b, true)}`;
    };
    for (let i = 0; i < 600; i++) {
      const t = gen(4);
      expect(ev(minimal(t))).toBe(ev(full(t)));
    }
  });
});

describe("semantics", () => {
  test("division and modulo by zero give 0", () => {
    expect(ev("5 / 0")).toBe(0);
    expect(ev("5 % 0")).toBe(0);
    expect(ev("x / y", { x: 1, y: 0 })).toBe(0);
  });

  test("truthiness and returning the deciding operand", () => {
    expect(ev("0 or 'x'")).toBe("x");
    expect(ev("'a' and 5")).toBe(5);
    expect(ev("'' or 0")).toBe(0);
    expect(ev("null and 1")).toBe(null);
    expect(ev("not ''")).toBe(true);
    expect(ev("!'0'")).toBe(false); // the string "0" is truthy
    expect(evalBool("0", createEnv({}))).toBe(false);
    expect(evalBool(undefined, createEnv({}), true)).toBe(true);
    expect(evalBool(undefined, createEnv({}), false)).toBe(false);
  });

  test("short-circuit and ternary evaluate only what they need", () => {
    const seen: string[] = [];
    const env = { lookup: (p: readonly string[]) => { seen.push(p.join(".")); return 1; } };
    evaluate("0 and a", env);
    evaluate("1 or b", env);
    evaluate("1 ? c : d", env);
    evaluate("0 ? e : f", env);
    expect(seen).toEqual(["c", "f"]);
  });

  test("opts.all visits every branch so unknown names are all reported", () => {
    const unknown = new Set<string>();
    evaluate("0 and a or 1 ? b : c", createEnv({}), { all: true, unknown });
    expect([...unknown].sort()).toEqual(["a", "b", "c"]);
    const lazy = new Set<string>();
    evaluate("0 and a or 1 ? b : c", createEnv({}), { unknown: lazy });
    expect([...lazy]).toEqual(["b"]);
  });

  test("strings: concatenation, equality, escapes", () => {
    expect(ev("'a' + 'b'")).toBe("ab");
    expect(ev("'n' + 1")).toBe("n1");
    expect(ev("null + 'x'")).toBe("x");
    expect(ev("'a' == 'a'")).toBe(true);
    expect(ev("'a' == 'A'")).toBe(false);
    expect(ev("'1' == 1")).toBe(true);
    expect(ev("'a' != 'b'")).toBe(true);
    expect(ev(String.raw`'it\'s'`)).toBe("it's");
    expect(ev(String.raw`"a\\b"`)).toBe("a\\b");
  });

  test("numeric coercion", () => {
    expect(ev("true + true")).toBe(2);
    expect(ev("null + 4")).toBe(4);
    expect(ev("'7' * 2")).toBe(14);
    expect(ev("'abc' * 2")).toBe(0);
    expect(ev("null == 0")).toBe(true);
  });

  test("number literals", () => {
    expect(ev(".5 + 1.25")).toBe(1.75);
    expect(ev("007")).toBe(7);
    expect(thrown(ExprError, () => compile("12."))).not.toBeInstanceOf(ExprLimitError);
    expect(() => compile("1.5.3")).toThrow(ExprError);
  });

  test("built-in math functions", () => {
    expect(ev("min(3, 1, 2)")).toBe(1);
    expect(ev("max(3, 1, 2)")).toBe(3);
    expect(ev("clamp(15, 0, 10)")).toBe(10);
    expect(ev("clamp(-5, 0, 10)")).toBe(0);
    expect(ev("clamp(5, 0, 10)")).toBe(5);
    expect(ev("floor(2.7)")).toBe(2);
    expect(ev("ceil(2.1)")).toBe(3);
    expect(ev("round(2.5)")).toBe(3);
    expect(ev("abs(-4)")).toBe(4);
  });

  test("built-ins win over environment functions of the same name", () => {
    expect(ev("min(1, 2)", {}, { min: () => 99 })).toBe(1);
  });

  test("environment functions receive evaluated arguments", () => {
    const got: Value[][] = [];
    ev("has('lockpick', 1 + 1)", {}, { has: (...a) => { got.push(a); return true; } });
    expect(got).toEqual([["lockpick", 2]]);
  });

  test("unknown names and functions are 0 and reported", () => {
    const unknown = new Set<string>();
    const v = evaluate("ghost + stats.nope + missing(1)", createEnv({ stats: { body: 3 } }), { unknown });
    expect(v).toBe(0);
    expect([...unknown].sort()).toEqual(["ghost", "missing()", "stats.nope"]);
  });

  test("Object.prototype members are never reachable as functions or variables", () => {
    for (const src of ["toString(1)", "constructor(2)", "__proto__(1)", "valueOf()", "hasOwnProperty('x')"]) {
      const unknown = new Set<string>();
      expect(evaluate(src, createEnv({}), { unknown })).toBe(0);
      expect(unknown.size).toBe(1);
    }
    for (const src of ["constructor", "__proto__", "toString", "a.constructor", "constructor.name", "hasOwnProperty"]) {
      expect(ev(src, { a: 1 })).toBe(0);
    }
  });

  test("createEnv: nested paths, group names and scalars-as-groups are not values", () => {
    const vars: EnvVars = { stats: { body: 3, mind: { deep: 9 } }, flag: true, label: "x", nothing: null };
    expect(ev("stats.body", vars)).toBe(3);
    expect(ev("stats.mind.deep", vars)).toBe(9);
    expect(ev("flag", vars)).toBe(true);
    expect(ev("label", vars)).toBe("x");
    expect(ev("nothing", vars)).toBe(null);
    const unknown = new Set<string>();
    evaluate("stats + flag.x + label.length", createEnv(vars), { unknown });
    expect([...unknown].sort()).toEqual(["flag.x", "label.length", "stats"]);
  });

  test("results are always finite", () => {
    const big = "9".repeat(300);
    expect(ev(`${big} * ${big}`)).toBe(0); // overflows a double
    expect(ev("x + 1", { x: Infinity })).toBe(1);
    expect(evaluate("x", { lookup: () => NaN })).toBe(0);
    expect(ev("clamp(1)")).toBe(0); // missing arguments produce NaN internally
    expect(thrown(ExprError, () => compile("9".repeat(400)))).not.toBeInstanceOf(ExprLimitError);
  });

  test("an environment that returns a non-Value is an error, not a silent coercion", () => {
    expect(() => evaluate("x", { lookup: () => ({}) as unknown as Value })).toThrow(ExprError);
  });

  test("evalNumber and evalBool pass literal data straight through", () => {
    const env = createEnv({});
    expect(evalNumber(5, env)).toBe(5);
    expect(evalNumber(undefined, env, 7)).toBe(7);
    expect(evalNumber("2 + 3", env)).toBe(5);
    expect(evalNumber("'abc'", env)).toBe(0);
    expect(evaluate(true, env)).toBe(true);
  });

  test("identifiers lists every name read, not function names", () => {
    expect(identifiers("athletics / 10 + stats.body + has('x') + min(a, b)")).toEqual(["athletics", "stats", "body", "a", "b"]);
    expect(identifiers("1 +")).toEqual([]); // unreadable formulas name nothing
    expect(identifiers(5)).toEqual([]);
    expect(() => identifiers("(".repeat(65) + "1" + ")".repeat(65))).toThrow(ExprLimitError);
  });
});

describe("syntax errors", () => {
  const bad: [string, RegExp][] = [
    ["", /ended too early/],
    ["   ", /ended too early/],
    ["1 +", /ended too early/],
    ["(1", /Expected "\)"/],
    ["1 2", /Unexpected "2" at character 3/],
    ["@", /Unexpected "@" at character 1/],
    ["'abc", /Unclosed quote starting at character 1/],
    ["a.", /Expected a name after "\."/],
    ["a = 1", /Unexpected "="/],
    ["1 ? 2", /Expected ":"/],
    ["f(1,", /ended too early/],
    ["true(1)", /Unexpected "\("/],
  ];
  for (const [src, msg] of bad) {
    test(JSON.stringify(src), () => {
      const e = thrown(ExprError, () => compile(src));
      expect(e).not.toBeInstanceOf(ExprLimitError);
      expect(e.message).toMatch(msg);
    });
  }

  test("random token soup only ever throws ExprError", () => {
    const rng = createRng("expr-fuzz");
    const pieces = ["1", "2.5", "x", "a.b", "'s'", '"t"', "(", ")", ",", "+", "-", "*", "/", "%", "<", "<=", "==", "!=", "!", "not", "and", "or", "&&", "||", "?", ":", "min", "true", "null", ".", "@", " "];
    for (let i = 0; i < 3000; i++) {
      const n = rng.int(1, 14);
      const src = Array.from({ length: n }, () => rng.pick(pieces)).join(rng.int(0, 1) ? " " : "");
      try {
        const p = compile(src);
        evaluate(src, createEnv({ x: 1, a: { b: 2 } }), { limits: DEFAULT_LIMITS });
        expect(p.nodeCount).toBeGreaterThan(0);
      } catch (e) {
        expect(e).toBeInstanceOf(ExprError);
      }
    }
  });
});

describe("limits", () => {
  describe("source length", () => {
    test("4096 characters pass, 4097 throw", () => {
      expect(compile("1" + " ".repeat(4095)).nodeCount).toBe(1);
      const e = thrown(ExprLimitError, () => compile("1" + " ".repeat(4096)));
      expect(e.limit).toBe("sourceLength");
      expect(e.max).toBe(4096);
    });
    test("is checked before parsing, so garbage that long is a limit error, not a syntax error", () => {
      expect(thrown(ExprLimitError, () => compile("@".repeat(4097))).limit).toBe("sourceLength");
      expect(() => compile("@".repeat(4096))).toThrow(/Unexpected "@"/);
    });
  });

  describe("nesting depth", () => {
    const parens = (n: number) => "(".repeat(n) + "1" + ")".repeat(n);
    test("64 nested groups pass, 65 throw", () => {
      expect(runProgram(compile(parens(64)), createEnv({}))).toBe(1);
      const e = thrown(ExprLimitError, () => compile(parens(65)));
      expect(e.limit).toBe("depth");
      expect(e.max).toBe(64);
    });
    test("chained prefix operators count", () => {
      expect(compile("-".repeat(64) + "1").nodeCount).toBe(65);
      expect(thrown(ExprLimitError, () => compile("-".repeat(65) + "1")).limit).toBe("depth");
      expect(compile("!".repeat(64) + "1").nodeCount).toBe(65);
      expect(thrown(ExprLimitError, () => compile("not ".repeat(65) + "1")).limit).toBe("depth");
    });
    test("nested call arguments count", () => {
      expect(compile("min(".repeat(64) + "1" + ")".repeat(64)).nodeCount).toBe(65);
      expect(thrown(ExprLimitError, () => compile("min(".repeat(65) + "1" + ")".repeat(65))).limit).toBe("depth");
    });
    test("ternary else-chains count", () => {
      expect(compile("0?0:".repeat(64) + "1").nodeCount).toBe(64 * 3 + 1);
      expect(thrown(ExprLimitError, () => compile("0?0:".repeat(65) + "1")).limit).toBe("depth");
    });
    test("a long flat chain is not nesting", () => {
      const flat = "1" + "+1".repeat(1000);
      const p = compile(flat);
      expect(p.nodeCount).toBe(2001);
      expect(runProgram(p, createEnv({}))).toBe(1001);
      expect(evaluate("a" + " and a".repeat(500), createEnv({ a: 1 }))).toBe(1);
    });
    test("absurd nesting stops at the limit instead of overflowing the stack", () => {
      const n = 200_000;
      const e = thrown(ExprLimitError, () => compile("(".repeat(n) + "1" + ")".repeat(n), { maxSourceLength: 1_000_000 }));
      expect(e.limit).toBe("depth");
    });
  });

  describe("AST nodes", () => {
    test("2048 pass, 2049 throw", () => {
      const ok = compile("-1" + "+1".repeat(1023));
      expect(ok.nodeCount).toBe(2048);
      const e = thrown(ExprLimitError, () => compile("1" + "+1".repeat(1024)));
      expect(e.limit).toBe("nodes");
      expect(e.max).toBe(2048);
    });
    test("2047 pass too", () => {
      expect(compile("1" + "+1".repeat(1023)).nodeCount).toBe(2047);
    });
    test("parentheses and unary plus make no node", () => {
      expect(compile("((1))").nodeCount).toBe(1);
      expect(compile("+1").nodeCount).toBe(1);
      expect(compile("-1").nodeCount).toBe(2);
    });
    test("custom limits apply", () => {
      expect(compile("1+1+1", { maxNodes: 5 }).nodeCount).toBe(5);
      expect(thrown(ExprLimitError, () => compile("1+1+1+1", { maxNodes: 5 })).max).toBe(5);
    });
  });

  describe("evaluation steps", () => {
    test("a budget equal to the node count passes, one less throws", () => {
      const p = compile("1 + 2 * 3"); // 5 nodes
      const exact = new ExprBudget(5);
      expect(runProgram(p, createEnv({}), { budget: exact })).toBe(7);
      expect(exact.used).toBe(5);
      const e = thrown(ExprLimitError, () => runProgram(p, createEnv({}), { budget: new ExprBudget(4) }));
      expect(e.limit).toBe("steps");
      expect(e.max).toBe(4);
    });
    test("only visited nodes cost steps", () => {
      const p = compile("0 and (1 + 2 + 3)"); // short-circuits after 2 nodes
      expect(runProgram(p, createEnv({}), { budget: new ExprBudget(2) })).toBe(0);
      expect(() => runProgram(p, createEnv({}), { budget: new ExprBudget(2), all: true })).toThrow(ExprLimitError);
    });
    test("limits.maxSteps sets the default pool for one evaluation", () => {
      const src = "-1" + "+1".repeat(1023); // 2048 nodes
      expect(evaluate(src, createEnv({}), { limits: { maxSteps: 2048 } })).toBe(1022); // -1 + 1023 ones
      expect(thrown(ExprLimitError, () => evaluate(src, createEnv({}), { limits: { maxSteps: 2047 } })).limit).toBe("steps");
    });
    test("one evaluation at the node limit stays far below the default 100,000 steps", () => {
      expect(evaluate("-1" + "+1".repeat(1023), createEnv({}))).toBe(1022);
    });
    test("a shared budget caps the total across evaluations at 100,000", () => {
      const p = compile("1" + "+1".repeat(511)); // 1023 nodes
      const budget = new ExprBudget();
      expect(budget.max).toBe(100_000);
      let done = 0;
      const e = thrown(ExprLimitError, () => {
        for (;;) { runProgram(p, createEnv({}), { budget }); done++; }
      });
      expect(done).toBe(97); // 97 * 1023 = 99,231 <= 100,000 < 98 * 1023
      expect(e.limit).toBe("steps");
      expect(e.max).toBe(100_000);
      expect(budget.used).toBe(100_000);
    });
  });

  test("default limits are the documented ones", () => {
    expect({ ...DEFAULT_LIMITS }).toEqual({ maxSourceLength: 4096, maxDepth: 64, maxNodes: 2048, maxSteps: 100_000 });
  });

  test("limit overrides must be positive integers", () => {
    expect(() => compile("1", { maxDepth: 0 })).toThrow(RangeError);
    expect(() => compile("1", { maxNodes: 1.5 })).toThrow(RangeError);
    expect(() => new ExprBudget(0)).toThrow(RangeError);
  });

  test("ExprLimitError is an ExprError with a readable message", () => {
    const e = thrown(ExprLimitError, () => compile("(".repeat(70) + "1" + ")".repeat(70)));
    expect(e).toBeInstanceOf(ExprError);
    expect(e.message).toBe("Formula exceeds the nesting depth limit of 64");
  });
});

describe("determinism", () => {
  const sources = [
    "20 + skill / 12 - here.security",
    "has('lockpick') and hour >= 20",
    "stress > 8000 ? 2 : 0",
    "clamp(round(a * 1.5) - b % 3, -10, 10)",
    "'x' + (a > 2) + null",
  ];
  const vars: EnvVars = { skill: 37, here: { security: 4 }, hour: 21, stress: 9000, a: 3.3, b: 7 };
  const fns: EnvFns = { has: (name) => name === "lockpick" };

  test("never touches Math.random, Date or performance.now", () => {
    withoutAmbient(() => {
      for (const src of sources) {
        const p = compile(src);
        runProgram(p, createEnv(vars, fns));
        evaluate(src, createEnv(vars, fns), { all: true, unknown: new Set() });
        identifiers(src);
      }
    });
  });

  test("the same program and environment always give the same value, however it is reached", () => {
    for (const src of sources) {
      const first = ev(src, vars, fns);
      const program = compile(src);
      for (let i = 0; i < 20; i++) {
        expect(ev(src, vars, fns)).toBe(first);
        expect(runProgram(program, createEnv(vars, fns))).toBe(first);
        expect(runProgram(compile(` ${src}  `), createEnv(vars, fns))).toBe(first);
      }
    }
  });

  test("compiling twice gives equal immutable trees; evaluating does not mutate them", () => {
    const a = compile(sources[3]);
    const before = JSON.stringify(a);
    runProgram(a, createEnv(vars, fns), { all: true });
    expect(JSON.stringify(a)).toBe(before);
    expect(JSON.stringify(compile(sources[3]))).toBe(before);
  });

  test("randomness reaches a formula only through an injected generator", () => {
    const run = (seed: string) => {
      const rng = createRng(seed);
      return evaluate("roll(6) + roll(6)", createEnv({}, { roll: (n) => rng.int(1, Number(n)) }));
    };
    expect(run("s1")).toBe(run("s1"));
    const seen = new Set<Value>();
    for (let i = 0; i < 40; i++) seen.add(run(`s${i}`));
    expect(seen.size).toBeGreaterThan(5);
  });
});

describe("parsing once", () => {
  test("a formula compiled again with the default limits is the program parsed the first time", () => {
    const src = "clamp(round(a * 2.5) - b % 4, -12, 12) + parsing_once";
    const first = compile(src);
    expect(compile(src)).toBe(first);
    // Other limits parse it anew, and are held to them.
    expect(compile(src, { maxNodes: 64 })).not.toBe(first);
    thrown(ExprLimitError, () => compile(src, { maxNodes: 3 }));
    expect(runProgram(compile(src), createEnv({ a: 3, b: 7, parsing_once: 1 }))).toBe(6);
  });
});
