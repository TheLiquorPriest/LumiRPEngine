// node_modules/preact/dist/preact.mjs
var n;
var t;
var i;
var r;
var u;
var f;
var o;
var e;
var l;
var c;
var a;
var s;
var h = {};
var p = [];
var v = /^m(i|n|o|s|text|space)$/;
var y = Array.isArray;
var d = p.slice;
var w = Object.assign;
function _(n) {
  n && n.parentNode && n.remove();
}
function b(i, r, u, f, o) {
  var e = { type: i, props: r, key: u, ref: f, __k: null, __: null, __b: 0, __e: null, __c: null, constructor: undefined, __v: o || ++t, __i: -1, __u: 0 };
  return !o && n.vnode && n.vnode(e), e;
}
function M(n) {
  return n.children;
}
function $(n, t) {
  this.props = n, this.context = t, this.__g = 0;
}
function x(n, t) {
  if (t == null)
    return n.__ ? x(n.__, n.__i + 1) : null;
  for (var i;t < n.__k.length; t++)
    if ((i = n.__k[t]) && i.__e)
      return i.__e;
  return typeof n.type != "function" || n.props.__P ? null : x(n);
}
function S(n) {
  if ((n = n.__) && n.__c && !n.props.__P)
    return n.__e = null, n.__k.some(function(t) {
      return t && (n.__e = t.__e);
    }), S(n);
}
function C(t) {
  (8 & t.__g || !(t.__g |= 8) || !r.push(t) || f++) && u == n.debounceRendering || ((u = n.debounceRendering) || queueMicrotask)(j);
}
function j() {
  var t, i, u, e, l, c, a, s, h;
  try {
    for (i = 1;r.length; )
      r.length > i && r.sort(o), t = r.shift(), i = r.length, 8 & t.__g && (e = undefined, l = undefined, c = (l = (u = t).__v).__e, a = [], s = [], (h = u.__P) && ((e = w({ constructor: undefined }, l)).__v = l.__v + 1, n.vnode && n.vnode(e), N(h, e, l, u.__n, h.namespaceURI, 32 & l.__u ? [c] : null, a, c || x(l), 32 & l.__u, s), e.__v = l.__v, e.__.__k[e.__i] = e, z(a, e, s), l.__ = l.__e = null, e.__e != c && S(e)));
  } finally {
    r.length = f = 0;
  }
}
function L(n, t, i, r, u, f, o, e, l, c, a) {
  var s, v, y, d, w, _, g = r.__k || p, k = t.length;
  for (l = H(i, t, g, l, k), s = 0;s < k; s++)
    (y = i.__k[s]) != null && (v = ~y.__i && g[y.__i] || h, y.__i = s, _ = N(n, y, v, u, f, o, e, l, c, a), d = y.__e, (v.ref != y.ref || 8 & v.__u) && (v.ref && D(v.ref, null, y, v), y.ref && a.push(y.ref, y.__c || d, y)), w = w || d, 4 & y.__u ? (l = I(y, l, n, !v.__v), v.__e && (v.__e = null)) : typeof y.type == "function" && _ !== undefined ? l = _ : d && (l = d.nextSibling), y.__u &= -7);
  return i.__e = w, l;
}
function H(n, t, i, r, u) {
  var f, o, e, l, c, a, s, h, p, v, d = i.length, w = d, _ = 0, g = false, k = n.__k = Array(u);
  for (f = 0;f < u; f++)
    (o = t[f]) != null && typeof o != "boolean" && typeof o != "function" ? (typeof o != "object" || o.constructor == String ? o = k[f] = b(null, o) : y(o) ? o = k[f] = b(M, { children: o }) : o.constructor === undefined && o.__b ? o = k[f] = b(o.type, o.props, o.key, o.ref, o.__v) : k[f] = o, l = f + _, o.__ = n, o.__b = n.__b + 1, e = null, ~(c = o.__i = O(o, i, l, w)) && (w--, (e = i[c]) && (e.__u |= 2)), e && e.__v ? (o.__u |= 2, c == l - 1 ? _-- : c == l + 1 ? _++ : c != l && (c > l ? _-- : _++, g = true)) : (~c || (u > d ? _-- : u < d && _++), typeof o.type != "function" && (o.__u |= 4))) : k[f] = null;
  if (g) {
    for (a = [], s = [], f = 0;f < u; f++)
      if ((o = k[f]) && 2 & o.__u) {
        for (h = 0, p = a.length;h < p; )
          a[v = h + p >> 1] < o.__i ? h = v + 1 : p = v;
        a[h] = o.__i, s[f] = h + 1;
      }
    for (_ = a.length;f--; )
      s[f] && (s[f] == _ ? _-- : k[f].__u |= 4);
  }
  if (w)
    for (f = 0;f < d; f++)
      !(e = i[f]) || 2 & e.__u || (e.__e == r && (r = x(e)), E(e, e));
  return r;
}
function I(n, t, i, r) {
  var u, f, o;
  if (typeof n.type == "function") {
    if (n.props.__P)
      return t;
    if (u = n.__k)
      for (f = 0;f < u.length; f++)
        u[f] && (u[f].__ = n, t = I(u[f], t, i, false));
    return t;
  }
  for (t && !t.parentNode && (t = x(n)) && !t.parentNode && (t = null), o = t;o && o.nodeType == 8; )
    o = o.nextSibling;
  for (n.__e != o && (!r && i.moveBefore && n.__e.parentNode ? i.moveBefore(n.__e, t) : i.insertBefore(n.__e, t || null)), t = n.__e;(t = t && t.nextSibling) && t.nodeType == 8; )
    ;
  return t;
}
function O(n, t, i, r) {
  var u, f, o, { key: e, type: l } = n, c = t[i], a = c && !(2 & c.__u);
  if (c === null && e == null || a && e == c.key && l == c.type)
    return i;
  if (r > (a ? 1 : 0)) {
    for (u = i - 1, f = i + 1;u >= 0 || f < t.length; )
      if ((c = t[o = u >= 0 ? u-- : f++]) && !(2 & c.__u) && e == c.key && l == c.type)
        return o;
  }
  return -1;
}
function P(n, t, i) {
  i == null && (i = ""), t[0] == "-" ? n.setProperty(t, i) : n[t] = i;
}
function T(n, t, i, r, u) {
  var f, o;
  n:
    if (t == "style")
      if (typeof i == "string")
        n.style.cssText = i;
      else {
        if (typeof r == "string" && (n.style.cssText = r = ""), r)
          for (t in r)
            i && t in i || P(n.style, t, "");
        if (i)
          for (t in i)
            r && i[t] == r[t] || P(n.style, t, i[t]);
      }
    else if (t[0] == "o" && t[1] == "n")
      (n.__e || (n.__e = {}))[t] = i, i && r || (o = a[t] || (a[t] = q(t)), (n.__a || (n.__a = {}))[t] = c, f = t != (t = t.replace(l, "$1")), (t = t.slice(2))[0] < "a" && (t = t.toLowerCase()), i ? n.addEventListener(t, o, f) : n.removeEventListener(t, o, f));
    else {
      if (u == "http://www.w3.org/2000/svg")
        t = t.replace(/xlink(H|:h)/, "h").replace(/sName$/, "s");
      else if (t != "width" && t != "height" && t != "href" && t != "list" && t != "form" && t != "tabIndex" && t != "download" && t != "rowSpan" && t != "colSpan" && t != "role" && t != "popover" && t in n)
        try {
          n[t] = i == null ? "" : i;
          break n;
        } catch (n) {}
      typeof i == "function" || (i == null || i === false && t[4] != "-" ? n.removeAttribute(t) : n.setAttribute(t, t == "popover" && i == 1 ? "" : i));
    }
}
function q(t) {
  return function(i) {
    if (this.__e) {
      var r = this.__e[t];
      if (i[e] == null)
        i[e] = c++;
      else if (i[e] < this.__a[t])
        return;
      return r(n.event ? n.event(i) : i);
    }
  };
}
function N(t, i, r, u, f, o, e, l, c, a) {
  var s, h, v, d, g, k, b, m, S, C, j, H, I, A, O, P, T, q, N, z, D = i.type;
  if (i.constructor !== undefined)
    return null;
  if (128 & r.__u && (c = 32 & r.__u, s = r.__c.__z)) {
    if (i.__u |= c, h = o = [], s.nodeType == 8)
      for (v = 1, d = s.nextSibling;d; d = d.nextSibling) {
        if (d.nodeType == 8) {
          if (d.data.startsWith("$s"))
            v++;
          else if (d.data.startsWith("/$s") && !--v)
            break;
        }
        o.push(d);
      }
    else
      o.push(s);
    l = o[0];
  }
  (s = n.__b) && s(i);
  n:
    if (typeof D == "function") {
      g = e.length;
      try {
        if (C = i.props, j = (s = D.prototype) && s.render, H = (s = D.contextType) && u[s.__c], I = s ? H ? H.props.value : s.__ : u, r.__c ? 2 & (k = i.__c = r.__c).__g && (k.__g |= 1) : (j ? i.__c = k = new D(C, I) : (i.__c = k = new $(C, I), k.constructor = D, k.render = F), H && H.sub(k), k.state || (k.state = {}), k.__n = u, k.__g |= 8, k.__h = [], k.__k = []), j && (k.__s || (k.__s = k.state), D.getDerivedStateFromProps && (k.__s == k.state && (k.__s = w({}, k.__s)), w(k.__s, D.getDerivedStateFromProps(C, k.__s)))), b = k.props, m = k.state, k.__v = i, r.__c) {
          if (j && !D.getDerivedStateFromProps && C !== b && k.componentWillReceiveProps && k.componentWillReceiveProps(C, I), i.__v == r.__v && !(8 & k.__g) || !(4 & k.__g) && k.shouldComponentUpdate && k.shouldComponentUpdate(C, k.__s, I) === false) {
            i.__v != r.__v && (k.props = C, k.state = k.__s, k.__g &= -9), i.__e = r.__e, i.__k = r.__k, i.__k.some(function(n) {
              n && (n.__ = i);
            }), p.push.apply(k.__h, k.__k), k.__k = [], k.__h.length && e.push(k), l = x(r);
            break n;
          }
          k.componentWillUpdate && k.componentWillUpdate(C, k.__s, I), j && k.componentDidUpdate && k.__h.push(function() {
            k.componentDidUpdate(b, m, S);
          });
        } else
          j && !D.getDerivedStateFromProps && k.componentWillMount && k.componentWillMount(), j && k.componentDidMount && k.__h.push(k.componentDidMount);
        if (k.context = I, k.props = C, k.__P = t, k.__g &= -5, A = n.__r, O = 0, j)
          k.state = k.__s, k.__g &= -9, A && A(i), s = k.render(k.props, k.state, k.context), p.push.apply(k.__h, k.__k), k.__k = [];
        else
          do {
            k.__g &= -9, A && A(i), s = k.render(k.props, k.state, k.context), k.state = k.__s;
          } while (8 & k.__g && ++O < 25);
        k.state = k.__s, k.getChildContext && (u = w({}, u, k.getChildContext())), j && r.__c && k.getSnapshotBeforeUpdate && (S = k.getSnapshotBeforeUpdate(b, m)), P = s && s.type === M && s.key == null ? s.props.children : s, C.__P && (s = l, f = (t = C.__P).namespaceURI, c = o = null, r.props && r.props.__P != t && (r.__k.some(function(n) {
          n && E(n, n);
        }), r.__k = null), l = r.__k ? x(r, 0) : null), l = L(t, y(P) ? P : [P], i, r, u, f, o, e, l, c, a), C.__P && (i.__e = null, l = s), i.__u &= -161, 128 & r.__u && (k.__z = null), h && h.some(_), k.__h.length && e.push(k), 1 & k.__g && (k.__g &= -4);
      } catch (t) {
        if (e.length = g, i.__v = null, c || o)
          if (t.then) {
            if (T = 0, i.__u |= c ? 160 : 128, o) {
              for (~(N = o.indexOf(l || undefined)) || (N = o.length);(z = o[N - 1]) && z.nodeType == 8; )
                N--;
              for (;N < o.length; N++)
                if (z = o[N]) {
                  if (o[N] = null, z.nodeType == 8) {
                    if (z.data.startsWith("$s"))
                      T++ || (q = z);
                    else if (T && z.data.startsWith("/$s") && !--T) {
                      l = z;
                      break;
                    }
                  } else if (!T)
                    break;
                }
            }
            if (!q) {
              for (;l && l.nodeType == 8 && l.nextSibling; )
                l = l.nextSibling;
              q = l;
            }
            i.__c.__z || (i.__c.__z = q), i.__e = l;
          } else
            o && o.some(_);
        else
          i.__e = r.__e;
        i.__k || (i.__k = r.__k || []), t.then || V(i), n.__e(t, i, r);
      }
    } else
      l = i.__e = B(r.__e, i, r, u, f, o, e, c, a, t);
  return (s = n.diffed) && s(i), 128 & i.__u ? undefined : l;
}
function V(n) {
  n && (n.__c && (n.__c.__g |= 4), n.__k && n.__k.some(V));
}
function z(t, i, r) {
  for (var u = 0;u < r.length; )
    D(r[u++], r[u++], r[u++]);
  n.__c && n.__c(i, t), t.some(function(i) {
    try {
      t = i.__h, i.__h = [], t.some(function(n) {
        n.call(i);
      });
    } catch (t) {
      n.__e(t, i.__v);
    }
  });
}
function B(t, i, r, u, f, o, e, l, c, a) {
  var s, p, w, g, k, b, m, M, $, S = r.props || h, { props: C, type: j } = i;
  if (j == "svg" ? f = "http://www.w3.org/2000/svg" : j == "math" ? f = "http://www.w3.org/1998/Math/MathML" : f || (f = "http://www.w3.org/1999/xhtml"), o) {
    for (s = 0;s < o.length; s++)
      if ((k = o[s]) && (j ? k.localName == j : k.nodeType == 3)) {
        t = k, o[s] = null;
        break;
      }
  }
  if (!t) {
    if (M = a.ownerDocument || document, !j)
      return M.createTextNode(C);
    t = M.createElementNS(f, j, C.is && C), l && (n.__m && n.__m(i, o), l = false), o = null;
  }
  if (j) {
    if (a = j == "template" ? t.content : t, o = j == "textarea" && C.defaultValue != null ? null : o && d.call(a.childNodes), !l && o)
      for (S = {}, s = 0;s < t.attributes.length; s++)
        S[(k = t.attributes[s]).name] = k.value;
    for (s in S)
      k = S[s], s == "dangerouslySetInnerHTML" ? w = k : s == "children" || (s in C) || s == "value" && ("defaultValue" in C) || s == "checked" && ("defaultChecked" in C) || T(t, s, null, k, f);
    for (s in $ = 1 & r.__u, C)
      k = C[s], s == "children" ? g = k : s == "dangerouslySetInnerHTML" ? p = k : s == "value" ? b = k : s == "checked" ? m = k : l && typeof k != "function" || !(S[s] !== k || $ && k != null) || T(t, s, k, S[s], f);
    p ? (l || w && (p.__html == w.__html || p.__html == t.innerHTML) || (t.innerHTML = p.__html), i.__k = []) : (w && (t.textContent = ""), (j == "foreignObject" || f == "http://www.w3.org/1998/Math/MathML" && v.test(j)) && (f = "http://www.w3.org/1999/xhtml"), L(a, y(g) ? g : [g], i, r, u, f, o, e, o ? o[0] : r.__k && x(r, 0), l, c), o && o.some(_)), l && j != "textarea" || (s = "value", j == "progress" && b == null ? t.removeAttribute(s) : b == null || b === t[s] && (j != "progress" || b) || T(t, s, b, S[s], f), s = "checked", m != null && m != t[s] && T(t, s, m, S[s], f));
  } else
    S === C || l && t.data == C || (t.data = C);
  return t;
}
function D(t, i, r, u) {
  try {
    typeof t == "function" ? i ? i.__x = t(i) || 1 : u && (u = u.__c || u.__e) && (i = u.__x) && (u.__x = null, typeof i == "function" ? i() : t(null)) : t.current = i;
  } catch (t) {
    n.__e(t, r);
  }
}
function E(t, i, r) {
  var u, f;
  if (n.unmount && n.unmount(t), !(u = t.ref) || u.current && u.current != t.__e || D(u, null, i, t), u = t.__c) {
    if (u.componentWillUnmount)
      try {
        u.componentWillUnmount();
      } catch (t) {
        n.__e(t, i);
      }
    u.__P = u.__n = null;
  }
  if (u = t.__k)
    for (f = 0;f < u.length; f++)
      u[f] && E(u[f], i, typeof t.type != "function" || r && !t.props.__P);
  (u = t.__e) && (r || _(u), u.__e && (u.__e = null)), t.__e = t.__c = t.__ = null;
}
function F(n, t, i) {
  return this.constructor(n, i);
}
function G(t, i) {
  var r, u, f, o;
  n.__ && n.__(t, i), i.nodeType == 9 && (i = i.documentElement), u = (r = t && 32 & t.__u) ? null : i.__k, i.__k = b(M, { children: [t] }), f = [], o = [], N(i, i.__k, u || h, h, i.namespaceURI, u ? null : i.firstChild ? d.call(i.childNodes) : null, f, u ? u.__e : i.firstChild, r, o), z(f, i.__k, o), i.__k.props.children = null;
}
function K(n) {
  function t(n) {
    var i, r;
    return this.getChildContext || (i = new Set, (r = {})[t.__c] = this, this.getChildContext = function() {
      return r;
    }, this.shouldComponentUpdate = function(n) {
      this.props.value != n.value && i.forEach(function(n) {
        n.__g |= 4, C(n);
      });
    }, this.sub = function(n) {
      i.add(n);
      var t = n.componentWillUnmount;
      n.componentWillUnmount = function() {
        i.delete(n), t && t.call(n);
      };
    }), n.children;
  }
  return t.__c = "__cC" + s++, t.__ = n, t.Provider = (t.Consumer = function(n, t) {
    return n.children(t);
  }).contextType = t, t;
}
n = { __e: function(n, t, i, r) {
  for (var u, o, e;t = t.__; )
    if ((u = t.__c) && !(1 & u.__g)) {
      u.__g |= 4;
      try {
        if ((o = u.constructor) && o.getDerivedStateFromError && (u.setState(o.getDerivedStateFromError(n)), e = 8 & u.__g), u.componentDidCatch && (u.componentDidCatch(n, r || {}), e = 8 & u.__g), e)
          return void (u.__g |= 2);
      } catch (t) {
        n = t, e = 0;
      }
    }
  throw f = 0, n;
} }, t = 0, i = function(n) {
  return n != null && n.constructor === undefined;
}, $.prototype.setState = function(n, t) {
  var i = this.__s;
  i && i != this.state || (i = this.__s = w({}, this.state)), typeof n == "function" && (n = n(w({}, i), this.props)), n && (w(i, n), this.__v && (t && this.__k.push(t), C(this)));
}, $.prototype.forceUpdate = function(n) {
  this.__v && (this.__g |= 4, n && this.__h.push(n), C(this));
}, $.prototype.render = M, r = [], f = 0, o = function(n, t) {
  return n.__v.__b - t.__v.__b;
}, e = Symbol(), l = /(PointerCapture)$|Capture$/i, c = 0, a = {}, s = 0;

// node_modules/preact/hooks/dist/hooks.mjs
var t2;
var r2;
var u2;
var i2;
var o2 = Object.is;
var f2 = 0;
var c2 = [];
var e2 = [];
var a2 = n;
var v2 = a2.__b;
var l2 = a2.__r;
var m = a2.diffed;
var s2 = a2.__c;
var h2 = a2.unmount;
var p2 = a2.__;
function y2(n, t) {
  a2.__h && a2.__h(r2, n, f2 || t), f2 = 0;
  var u = r2.__H || (r2.__H = { __: [], __h: [] });
  return n >= u.__.length && u.__.push({}), u.__[n];
}
function d2(n) {
  return f2 = 1, _2(G2, n);
}
function _2(n, u, i) {
  var f = y2(t2++, 2);
  if (f.t = n, !f.__c && (f.__ = [i ? i(u) : G2(undefined, u), function(n) {
    var t = f.__N ? f.__N[0] : f.__[0], r = f.t(t, n);
    o2(t, r) || (f.__N = [r, f.__[1]], f.__c.setState({}));
  }], f.__c = r2, !r2.__f)) {
    r2.__f = true;
    var c = r2.shouldComponentUpdate;
    r2.shouldComponentUpdate = function(n, t, r) {
      var u = this.__H;
      if (!u)
        return true;
      var i = false, f = this.props != n;
      if (u.__.some(function(n) {
        n.__N && (i = true, o2(n.__[0], n.__N[0]) || (f = true));
      }), c) {
        var e = c.call(this, n, t, r);
        return i ? e || f : e;
      }
      return !i || f;
    };
  }
  return f.__;
}
function A(n, u) {
  var i = y2(t2++, 3);
  !a2.__s && E2(i.__H, u) && (i.__P = true, i.__ = n, i.u = u, r2.__H.__h.push(i));
}
function T2(n) {
  return f2 = 5, b2(function() {
    return { current: n };
  }, []);
}
function b2(n, r) {
  var u = y2(t2++, 7);
  return E2(u.__H, r) && (u.__ = n(), u.__H = r), u.__;
}
function w2(n) {
  var u = r2.context[n.__c], i = y2(t2++, 9);
  return i.c = n, u ? (i.__ == null && (i.__ = true, u.sub(r2)), u.props.value) : n.__;
}
function P2() {
  var n = y2(t2++, 11);
  if (!n.__) {
    for (var u = r2.__v;!u.__m && u.__; )
      u = u.__;
    var i = u.__m || (u.__m = [0, 0]);
    n.__ = "P" + i[0] + "-" + i[1]++;
  }
  return n.__;
}
function g() {
  var n;
  do {
    for (;n = e2.shift(); )
      try {
        C2(n);
      } catch (t) {
        a2.__e(t, { __: (n = n.__P) && n.__v });
      }
    for (;n = c2.shift(); ) {
      var t = n.__H;
      if (n.__P && t)
        try {
          t.__h.some(C2), t.__h.some(D2), t.__h = [];
        } catch (r) {
          t.__h = [], a2.__e(r, n.__v);
        }
    }
  } while (e2.length);
}
a2.__b = function(n) {
  r2 = null, v2 && v2(n);
}, a2.__ = function(n, t) {
  n && t.__k && t.__k.__m && (n.__m = t.__k.__m), p2 && p2(n, t);
}, a2.__r = function(n) {
  l2 && l2(n), t2 = 0;
  var i = (r2 = n.__c).__H;
  i && (u2 == r2 ? r2.__h = [] : (i.__h.some(C2), i.__h.some(D2), t2 = 0), i.__h = [], i.__.some(function(n) {
    n.__N && (n.__ = n.__N), n.u = n.__N = undefined;
  })), u2 = r2;
}, a2.diffed = function(n) {
  m && m(n);
  var t = n.__c;
  t && t.__H && (t.__H.__h.length && B2(c2.push(t)), t.__H.__.some(function(n) {
    n.u && (n.__H = n.u);
  })), u2 = r2 = null;
}, a2.__c = function(n, t) {
  t.some(function(n) {
    try {
      n.__h.some(C2), n.__h = n.__h.filter(function(n) {
        return !n.__ || D2(n);
      });
    } catch (r) {
      t.some(function(n) {
        n.__h && (n.__h = []);
      }), t = [], a2.__e(r, n.__v);
    }
  }), s2 && s2(n, t);
}, a2.unmount = function(n) {
  h2 && h2(n);
  var t, r, u = n.__c;
  u && u.__H && (u.__H.__.some(function(u) {
    try {
      if (u.__P && u.__c) {
        if (r === undefined) {
          for (r = n.__;r && (!r.__c || !r.__c.__P); )
            r = r.__;
          r = r && r.__c;
        }
        u.__P = r, B2(e2.push(u));
      } else
        C2(u);
    } catch (n) {
      t = n;
    }
  }), u.__H = undefined, t && a2.__e(t, u.__v));
};
var k = typeof requestAnimationFrame == "function";
function z2(n) {
  var t, r = function() {
    clearTimeout(u), k && cancelAnimationFrame(t), setTimeout(n);
  }, u = setTimeout(r, 35);
  k && (t = requestAnimationFrame(r));
}
function B2(n) {
  n != 1 && i2 == a2.requestAnimationFrame || ((i2 = a2.requestAnimationFrame) || z2)(g);
}
function C2(n) {
  var t = r2, u = n.__c;
  typeof u == "function" && (n.__c = undefined, u()), r2 = t;
}
function D2(n) {
  var t = r2;
  n.__c = n.__(), r2 = t;
}
function E2(n, t) {
  return !n || n.length != t.length || t.some(function(t, r) {
    return !o2(t, n[r]);
  });
}
function G2(n, t) {
  return typeof t == "function" ? t(n) : t;
}

// src/frontend/store.ts
function createStore(initial) {
  let value = initial;
  const listeners = new Set;
  const set = (next) => {
    if (Object.is(next, value))
      return;
    value = next;
    for (const listener of [...listeners])
      listener(value);
  };
  return {
    get: () => value,
    set,
    update: (fn) => set(fn(value)),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
}
function useSelect(source, select) {
  const [selected, setSelected] = d2(() => select(source.get()));
  A(() => {
    setSelected(() => select(source.get()));
    return source.subscribe((value) => setSelected(() => select(value)));
  }, [source]);
  return selected;
}

// src/frontend/app.ts
var AppContext = K(null);
function useApp() {
  const app = w2(AppContext);
  if (!app)
    throw new Error("LumiRPEngine component rendered outside its app");
  return app;
}
function useView() {
  return useSelect(useApp().sync, (state) => state.view);
}
function useUi(select) {
  return useSelect(useApp().ui, select);
}
function makeRequest(send, toast) {
  return async (body) => {
    const message = await send(body);
    if (message.type === "lre.error") {
      toast(message.lint && message.lint.length > 0 ? `${message.message} (${message.lint.length} issue${message.lint.length === 1 ? "" : "s"})` : message.message, "error");
      return null;
    }
    return message.body;
  };
}

// src/shared/json.ts
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function hasOwn(o, key) {
  return Object.prototype.hasOwnProperty.call(o, key);
}
var UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

// src/shared/world.ts
var WORLD_FORMAT = "lre-world-v1";
var ENGINE_VERSION = "0.1.0";
var BUILTIN_RELATIONS = ["in", "owns", "uses", "worn_by", "equipped", "knows", "member_of", "regard", "route"];
var DEFAULT_CURRENCY = { code: "USD", symbol: "$", minorUnit: "cent", decimals: 2, format: "{sign}{symbol}{amount}" };
function grouped(n) {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
function formatMoney(minorUnits, currency) {
  const units = BigInt(Math.trunc(minorUnits));
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const decimals = Math.max(0, Math.min(6, Math.trunc(currency.decimals)));
  const scale = 10n ** BigInt(decimals);
  const major = abs / scale;
  const minor = abs % scale;
  const amount = decimals > 0 ? `${grouped(major)}.${minor.toString().padStart(decimals, "0")}` : grouped(major);
  const values = { sign: negative ? "-" : "", symbol: currency.symbol, code: currency.code, amount, major: grouped(major), minor: minor.toString() };
  return currency.format.replace(/\{(sign|symbol|code|amount|major|minor)\}/g, (_, key) => values[key] ?? "");
}

// src/frontend/format.ts
var current = DEFAULT_CURRENCY;
function setCurrency(currency) {
  current = currency ?? DEFAULT_CURRENCY;
}
function formatCents(cents) {
  return formatMoney(cents, current);
}
function formatMinutes(minutes) {
  if (minutes < 1)
    return `${Math.round(minutes * 60)} s`;
  const total = Math.round(minutes);
  if (total < 60)
    return `${total} min`;
  const days = Math.floor(total / 1440);
  const hours = Math.floor(total % 1440 / 60);
  const rest = total % 60;
  if (days > 0)
    return hours > 0 ? `${days} d ${hours} h` : `${days} d`;
  return rest > 0 ? `${hours} h ${rest} min` : `${hours} h`;
}
function formatOdds(p) {
  if (p <= 0)
    return "0%";
  if (p >= 1)
    return "100%";
  if (p < 0.001)
    return "<0.1%";
  if (p > 0.999)
    return ">99.9%";
  return `${(p * 100).toFixed(1)}%`;
}
function humanize(id) {
  const words = id.replace(/[_.]+/g, " ").trim();
  return words.length === 0 ? id : words[0]?.toUpperCase() + words.slice(1);
}
// node_modules/preact/jsx-runtime/dist/jsxRuntime.mjs
var o3 = 0;
function u3(t, e, n2, f, u, i) {
  e || (e = {});
  var a, c, l = e;
  if ("ref" in l && typeof t != "function")
    for (c in l = {}, e)
      c == "ref" ? a = e[c] : l[c] = e[c];
  var p = { type: t, props: l, key: n2, ref: a, __k: null, __: null, __b: 0, __e: null, __c: null, constructor: undefined, __v: --o3, __i: -1, __u: 0 };
  return (u || i) && (p.__source = u, p.__self = i), n.vnode && n.vnode(p), p;
}

// src/frontend/components.tsx
function Seg(props) {
  return /* @__PURE__ */ u3("div", {
    class: "lre-seg",
    role: "group",
    "aria-label": props.label,
    children: props.options.map((option) => /* @__PURE__ */ u3("button", {
      type: "button",
      "aria-pressed": option.value === props.value,
      title: option.title,
      disabled: props.disabled,
      onClick: () => props.onChange(option.value),
      children: option.label
    }, String(option.value), false, undefined, this))
  }, undefined, false, undefined, this);
}
function Tabs(props) {
  const list = T2(null);
  const selected = Math.max(0, props.tabs.findIndex((tab) => tab.id === props.value));
  const onKeyDown = (event, index) => {
    const last = props.tabs.length - 1;
    const next = event.key === "ArrowRight" ? index === last ? 0 : index + 1 : event.key === "ArrowLeft" ? index === 0 ? last : index - 1 : event.key === "Home" ? 0 : event.key === "End" ? last : -1;
    const tab = props.tabs[next];
    if (!tab)
      return;
    event.preventDefault();
    props.onChange(tab.id);
    list.current?.querySelectorAll('[role="tab"]')[next]?.focus();
  };
  return /* @__PURE__ */ u3("div", {
    ref: list,
    class: "lre-tabs",
    role: "tablist",
    "aria-label": props.label,
    children: props.tabs.map((tab, index) => /* @__PURE__ */ u3("button", {
      type: "button",
      role: "tab",
      id: `${props.panelId}-tab-${tab.id}`,
      "aria-selected": tab.id === props.value,
      "aria-controls": tab.id === props.value ? props.panelId : undefined,
      tabIndex: index === selected ? 0 : -1,
      onClick: () => props.onChange(tab.id),
      onKeyDown: (event) => onKeyDown(event, index),
      children: [
        tab.label,
        tab.dot ? /* @__PURE__ */ u3("span", {
          class: "lre-dot",
          role: "img",
          "aria-label": "pending"
        }, undefined, false, undefined, this) : null
      ]
    }, tab.id, true, undefined, this))
  }, undefined, false, undefined, this);
}
function tabPanel(panelId, tab) {
  return { id: panelId, role: "tabpanel", "aria-labelledby": tab === null ? undefined : `${panelId}-tab-${tab}` };
}
function Card(props) {
  return /* @__PURE__ */ u3("section", {
    class: props.preview ? "lre-card preview" : "lre-card",
    children: [
      props.title !== undefined || props.aside !== undefined ? /* @__PURE__ */ u3("div", {
        class: "lre-h",
        children: [
          /* @__PURE__ */ u3("span", {
            children: props.title
          }, undefined, false, undefined, this),
          props.aside
        ]
      }, undefined, true, undefined, this) : null,
      props.preview ? /* @__PURE__ */ u3("div", {
        class: "lre-preview-label",
        children: "Preview — not recorded"
      }, undefined, false, undefined, this) : null,
      props.children
    ]
  }, undefined, true, undefined, this);
}
function Row(props) {
  return /* @__PURE__ */ u3("div", {
    class: "lre-row",
    children: [
      /* @__PURE__ */ u3("span", {
        class: "k",
        children: [
          props.k,
          props.sub !== undefined ? /* @__PURE__ */ u3("span", {
            class: "sub",
            children: props.sub
          }, undefined, false, undefined, this) : null
        ]
      }, undefined, true, undefined, this),
      props.v !== undefined ? /* @__PURE__ */ u3("span", {
        class: props.tone ? `v lre-${props.tone}` : "v",
        children: props.v
      }, undefined, false, undefined, this) : null
    ]
  }, undefined, true, undefined, this);
}
function Empty(props) {
  return /* @__PURE__ */ u3("div", {
    class: "lre-empty",
    children: props.children
  }, undefined, false, undefined, this);
}
var ODDS_COLORS = ["#7fe0a0", "#7c6cff", "#f2c46b", "#ff8a8a", "#6bc5f2", "#c58af2"];
function OddsBar(props) {
  return /* @__PURE__ */ u3("div", {
    children: [
      /* @__PURE__ */ u3("div", {
        class: "lre-odds",
        role: "img",
        "aria-label": props.odds.map((o) => `${o.outcome} ${formatOdds(o.p)}`).join(", "),
        children: props.odds.map((o, i) => /* @__PURE__ */ u3("span", {
          style: { width: `${Math.max(0, o.p) * 100}%`, background: ODDS_COLORS[i % ODDS_COLORS.length] }
        }, o.outcome, false, undefined, this))
      }, undefined, false, undefined, this),
      /* @__PURE__ */ u3("div", {
        class: "lre-odds-legend",
        children: props.odds.map((o, i) => /* @__PURE__ */ u3("span", {
          children: [
            /* @__PURE__ */ u3("i", {
              style: { background: ODDS_COLORS[i % ODDS_COLORS.length] }
            }, undefined, false, undefined, this),
            o.outcome,
            " ",
            formatOdds(o.p)
          ]
        }, o.outcome, true, undefined, this))
      }, undefined, false, undefined, this)
    ]
  }, undefined, true, undefined, this);
}
function JsonView(props) {
  const depth = props.depth ?? 0;
  const value = props.value;
  if (Array.isArray(value)) {
    if (value.length === 0)
      return /* @__PURE__ */ u3("span", {
        class: "lre-dim",
        children: "none"
      }, undefined, false, undefined, this);
    return /* @__PURE__ */ u3("div", {
      class: depth > 0 ? "lre-tree" : undefined,
      children: value.map((entry, i) => /* @__PURE__ */ u3("div", {
        class: "lre-row",
        children: /* @__PURE__ */ u3("span", {
          class: "k",
          children: /* @__PURE__ */ u3(JsonView, {
            value: entry,
            depth: depth + 1
          }, undefined, false, undefined, this)
        }, undefined, false, undefined, this)
      }, i, false, undefined, this))
    }, undefined, false, undefined, this);
  }
  if (isRecord(value)) {
    return /* @__PURE__ */ u3("div", {
      class: depth > 0 ? "lre-tree" : undefined,
      children: Object.entries(value).map(([key, entry]) => isRecord(entry) || Array.isArray(entry) ? /* @__PURE__ */ u3("div", {
        children: [
          /* @__PURE__ */ u3("div", {
            class: "lre-h",
            children: key
          }, undefined, false, undefined, this),
          /* @__PURE__ */ u3(JsonView, {
            value: entry,
            depth: depth + 1
          }, undefined, false, undefined, this)
        ]
      }, key, true, undefined, this) : /* @__PURE__ */ u3(Row, {
        k: key,
        v: /* @__PURE__ */ u3(JsonView, {
          value: entry,
          depth: depth + 1
        }, undefined, false, undefined, this)
      }, key, false, undefined, this))
    }, undefined, false, undefined, this);
  }
  if (value === null || value === undefined)
    return /* @__PURE__ */ u3("span", {
      class: "lre-dim",
      children: "—"
    }, undefined, false, undefined, this);
  return /* @__PURE__ */ u3("span", {
    children: String(value)
  }, undefined, false, undefined, this);
}
function Toasts(props) {
  const app = useApp();
  const list = useSelect(app.toasts, (all) => all);
  const overlay = useSelect(app.ui, (ui) => ui.overlay);
  const drawerOpen = useSelect(app.host.drawer, (drawer) => drawer.open);
  const active = overlay ?? (drawerOpen ? "drawer" : "chat");
  if (list.length === 0 || active !== props.surface)
    return null;
  const toasts = app.toasts;
  return /* @__PURE__ */ u3("div", {
    class: props.surface === "chat" ? "lre lre-toasts inline" : "lre lre-toasts",
    "aria-live": "polite",
    "data-lre-toasts": props.surface,
    children: list.map((toast) => /* @__PURE__ */ u3("div", {
      class: toast.tone === "error" ? "lre-toast error" : "lre-toast",
      role: toast.tone === "error" ? "alert" : "status",
      children: [
        /* @__PURE__ */ u3("span", {
          style: { flex: 1 },
          children: toast.text
        }, undefined, false, undefined, this),
        /* @__PURE__ */ u3("button", {
          type: "button",
          class: "lre-btn ghost small",
          "aria-label": "Dismiss",
          onClick: () => toasts.update((all) => all.filter((entry) => entry.id !== toast.id)),
          children: "✕"
        }, undefined, false, undefined, this)
      ]
    }, toast.id, true, undefined, this))
  }, undefined, false, undefined, this);
}
function useBusy() {
  const [busy, setBusy] = d2(false);
  const live = T2(true);
  A(() => () => {
    live.current = false;
  }, []);
  return [
    busy,
    (run) => {
      if (busy)
        return;
      setBusy(true);
      run().finally(() => {
        if (live.current)
          setBusy(false);
      });
    }
  ];
}
function HostSlider(props) {
  const { host } = useApp();
  const slot = T2(null);
  const callbacks = T2(props);
  callbacks.current = props;
  const handle = T2(null);
  A(() => {
    const el = slot.current;
    if (!el)
      return;
    handle.current = host.components.mountRangeSlider(el, {
      min: props.min,
      max: props.max,
      step: props.step,
      integer: props.integer,
      value: props.value,
      label: props.label,
      hint: props.hint,
      format: props.suffix ? { suffix: props.suffix } : undefined,
      disabled: props.disabled,
      onCommit: (value) => callbacks.current.onCommit(value),
      onDragValue: (value) => callbacks.current.onDrag?.(value)
    });
    return () => {
      handle.current?.destroy();
      handle.current = null;
    };
  }, []);
  A(() => {
    handle.current?.update({ value: props.value, disabled: props.disabled, min: props.min, max: props.max, label: props.label, hint: props.hint });
  }, [props.value, props.disabled, props.min, props.max, props.label, props.hint]);
  return /* @__PURE__ */ u3("div", {
    ref: slot,
    class: "lre-host-slot"
  }, undefined, false, undefined, this);
}
function HostSwitch(props) {
  const { host } = useApp();
  const slot = T2(null);
  const callbacks = T2(props);
  callbacks.current = props;
  const handle = T2(null);
  A(() => {
    const el = slot.current;
    if (!el)
      return;
    handle.current = host.components.mountSwitch(el, { checked: props.checked, ariaLabel: props.label, disabled: props.disabled, onChange: (checked) => callbacks.current.onChange(checked) });
    return () => {
      handle.current?.destroy();
      handle.current = null;
    };
  }, []);
  A(() => {
    handle.current?.update({ checked: props.checked, disabled: props.disabled });
  }, [props.checked, props.disabled]);
  return /* @__PURE__ */ u3("label", {
    class: "lre-row",
    children: [
      /* @__PURE__ */ u3("span", {
        class: "k",
        children: props.label
      }, undefined, false, undefined, this),
      /* @__PURE__ */ u3("span", {
        ref: slot
      }, undefined, false, undefined, this)
    ]
  }, undefined, true, undefined, this);
}
function NumberStepper(props) {
  const id = P2();
  const shown = props.value === null ? "" : String(props.value);
  const [text, setText] = d2(shown);
  A(() => setText(shown), [shown]);
  const step = props.step ?? 1;
  const current = props.value ?? props.min ?? 0;
  const commit = (raw) => {
    const rounded = props.integer ? Math.round(raw) : Number(raw.toFixed(6));
    const next = Math.min(props.max ?? Number.POSITIVE_INFINITY, Math.max(props.min ?? Number.NEGATIVE_INFINITY, rounded));
    setText(String(next));
    if (next !== props.value)
      props.onChange(next);
  };
  return /* @__PURE__ */ u3("div", {
    class: "lre-row",
    children: [
      /* @__PURE__ */ u3("label", {
        class: "k",
        for: id,
        children: props.label
      }, undefined, false, undefined, this),
      /* @__PURE__ */ u3("span", {
        class: "lre-stepper",
        role: "group",
        "aria-label": props.label,
        children: [
          /* @__PURE__ */ u3("button", {
            type: "button",
            class: "lre-btn",
            "aria-label": `Decrease ${props.label}`,
            disabled: props.disabled || props.min !== undefined && current <= props.min,
            onClick: () => commit(current - step),
            children: /* @__PURE__ */ u3("span", {
              "aria-hidden": "true",
              children: "−"
            }, undefined, false, undefined, this)
          }, undefined, false, undefined, this),
          /* @__PURE__ */ u3("input", {
            id,
            class: "lre-input",
            inputMode: props.integer ? "numeric" : "decimal",
            value: text,
            disabled: props.disabled,
            onInput: (event) => setText(event.currentTarget.value),
            onBlur: () => {
              const parsed = Number(text);
              if (text.trim() !== "" && Number.isFinite(parsed))
                commit(parsed);
              else
                setText(shown);
            },
            onKeyDown: (event) => {
              if (event.key === "Enter")
                event.currentTarget.blur();
            }
          }, undefined, false, undefined, this),
          /* @__PURE__ */ u3("button", {
            type: "button",
            class: "lre-btn",
            "aria-label": `Increase ${props.label}`,
            disabled: props.disabled || props.max !== undefined && current >= props.max,
            onClick: () => commit(current + step),
            children: /* @__PURE__ */ u3("span", {
              "aria-hidden": "true",
              children: "+"
            }, undefined, false, undefined, this)
          }, undefined, false, undefined, this)
        ]
      }, undefined, true, undefined, this)
    ]
  }, undefined, true, undefined, this);
}
function HostModelPicker(props) {
  const { host } = useApp();
  const slot = T2(null);
  const callbacks = T2(props);
  callbacks.current = props;
  A(() => {
    const el = slot.current;
    if (!el)
      return;
    const handle = host.components.mountModelCombobox(el, {
      value: props.value,
      connection: { kind: "llm", id: props.connectionId },
      onChange: (model) => callbacks.current.onChange(model)
    });
    return () => handle.destroy();
  }, [props.connectionId]);
  return /* @__PURE__ */ u3("div", {
    class: "lre-field",
    children: [
      /* @__PURE__ */ u3("span", {
        class: "label",
        children: props.label
      }, undefined, false, undefined, this),
      /* @__PURE__ */ u3("div", {
        ref: slot,
        class: "lre-host-slot",
        role: "group",
        "aria-label": props.label
      }, undefined, false, undefined, this)
    ]
  }, undefined, true, undefined, this);
}

// src/frontend/decode.ts
function str(value, fallback = "") {
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : fallback;
}
function optStr(value) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
function num(value, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
function optNum(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
function oneOf(value, values, fallback) {
  return values.find((candidate) => candidate === value) ?? fallback;
}
function list(value, item) {
  if (!Array.isArray(value))
    return [];
  const out = [];
  for (const entry of value) {
    if (!isRecord(entry))
      continue;
    const mapped = item(entry);
    if (mapped !== null)
      out.push(mapped);
  }
  return out;
}
function strings(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === "string") : [];
}
function obj(value) {
  return isRecord(value) ? value : null;
}

// src/frontend/build/check.tsx
var COLLECTIONS = ["kinds", "relations", "entities", "places", "routes", "grids", "rules", "actions", "checks", "schedules", "tracks", "tables", "sections", "steps", "packs", "lore"];
function issueTarget(path) {
  const [head, id] = path.split(".");
  const collection = COLLECTIONS.find((c) => c === head);
  return collection && id ? { collection, id } : null;
}
function CheckView(props) {
  const app = useApp();
  const [issues, setIssues] = d2(null);
  const [severity, setSeverity] = d2("all");
  const [busy, run] = useBusy();
  const check = () => run(async () => {
    const result = await app.request({ type: "lre.world", op: "lint", worldId: props.worldId });
    setIssues(result?.lint ?? []);
  });
  A(check, [props.worldId]);
  const count = (s) => issues?.filter((i) => i.severity === s).length ?? 0;
  const shown = (issues ?? []).filter((i) => severity === "all" || i.severity === severity);
  return /* @__PURE__ */ u3("div", {
    class: "lre-stack",
    "data-lre-check": true,
    children: [
      /* @__PURE__ */ u3("div", {
        class: "lre-spread",
        children: [
          /* @__PURE__ */ u3("span", {
            class: "lre-h2",
            children: "Problems"
          }, undefined, false, undefined, this),
          /* @__PURE__ */ u3("button", {
            type: "button",
            class: "lre-btn small",
            disabled: busy,
            onClick: check,
            children: busy ? "Checking…" : "Check again"
          }, undefined, false, undefined, this)
        ]
      }, undefined, true, undefined, this),
      issues === null ? /* @__PURE__ */ u3(Empty, {
        children: "Checking…"
      }, undefined, false, undefined, this) : issues.length === 0 ? /* @__PURE__ */ u3("div", {
        class: "lre-banner info",
        children: "No issues. The world is ready to play."
      }, undefined, false, undefined, this) : /* @__PURE__ */ u3(M, {
        children: [
          /* @__PURE__ */ u3(Seg, {
            label: "Severity",
            value: severity,
            options: [
              { value: "all", label: `All ${issues.length}` },
              { value: "error", label: `Errors ${count("error")}` },
              { value: "warning", label: `Warnings ${count("warning")}` },
              { value: "info", label: `Info ${count("info")}` }
            ],
            onChange: (next) => setSeverity(next)
          }, undefined, false, undefined, this),
          /* @__PURE__ */ u3(Card, {
            children: shown.map((issue, i) => {
              const target = issueTarget(issue.path);
              return /* @__PURE__ */ u3("div", {
                class: "lre-lint",
                children: [
                  /* @__PURE__ */ u3("span", {
                    class: issue.severity === "error" ? "lre-badge neg" : issue.severity === "warning" ? "lre-badge warn" : "lre-badge",
                    children: issue.severity
                  }, undefined, false, undefined, this),
                  /* @__PURE__ */ u3("span", {
                    style: { flex: 1, minWidth: 0 },
                    children: [
                      /* @__PURE__ */ u3("span", {
                        children: issue.message
                      }, undefined, false, undefined, this),
                      /* @__PURE__ */ u3("span", {
                        class: "path",
                        style: { display: "block" },
                        children: [
                          issue.path,
                          " · ",
                          issue.code
                        ]
                      }, undefined, true, undefined, this)
                    ]
                  }, undefined, true, undefined, this),
                  target ? /* @__PURE__ */ u3("button", {
                    type: "button",
                    class: "lre-btn small",
                    "aria-label": `Open ${issue.path}`,
                    onClick: () => app.ui.update((ui) => ({ ...ui, build: { view: "item", worldId: props.worldId, collection: target.collection, id: target.id } })),
                    children: "Open"
                  }, undefined, false, undefined, this) : null
                ]
              }, `${issue.path}:${issue.code}:${i}`, true, undefined, this);
            })
          }, undefined, false, undefined, this)
        ]
      }, undefined, true, undefined, this)
    ]
  }, undefined, true, undefined, this);
}

// src/frontend/build/draft.ts
async function loadDraft(app, worldId) {
  const [got, world] = await Promise.all([app.request({ type: "lre.editor", worldId, base: null, op: "get" }), app.request({ type: "lre.world", op: "get", worldId })]);
  if (!got)
    return null;
  const draft = { worldId, base: got.base, doc: got.draft, lint: got.lint, dirty: got.stored, packKinds: world?.packKinds ?? {} };
  app.drafts.set(draft);
  return draft;
}
function draftSend(app) {
  return async (body) => {
    const draft = app.drafts.get();
    const request = body.type === "lre.editor" && draft ? { ...body, worldId: draft.worldId, base: draft.base } : body;
    const message = await app.send(request);
    if (message.type === "lre.error") {
      app.toast(message.code === "conflict" ? "This world changed elsewhere. Reloaded the latest revision." : message.message, "error");
      if (message.code === "conflict" && draft)
        await loadDraft(app, draft.worldId);
    } else if (message.request === "lre.editor") {
      const current = app.drafts.get();
      if (current)
        app.drafts.set({ ...current, doc: message.body.draft, lint: message.body.lint, base: message.body.base, dirty: message.body.stored });
    }
    return message;
  };
}
async function commitDraft(app) {
  const draft = app.drafts.get();
  if (!draft)
    return false;
  const message = await app.send({ type: "lre.world", op: "commit", worldId: draft.worldId, base: draft.base });
  if (message.type === "lre.error") {
    app.toast(message.code === "validation" ? `Fix ${message.lint?.length ?? 0} error(s) before committing.` : message.message, "error");
    if (message.lint)
      app.drafts.set({ ...draft, lint: message.lint });
    if (message.code === "conflict")
      await loadDraft(app, draft.worldId);
    return false;
  }
  if (message.request !== "lre.world")
    return false;
  app.drafts.set({ ...draft, base: message.body.revision ?? draft.base, lint: message.body.lint ?? draft.lint, dirty: false });
  app.toast("Committed a new revision.", "info");
  return true;
}
async function discardDraft(app) {
  const draft = app.drafts.get();
  if (!draft)
    return;
  if (!await app.host.confirm("Discard draft", "Throw away every uncommitted change to this world?", "danger", "Discard"))
    return;
  const result = await app.request({ type: "lre.editor", worldId: draft.worldId, base: draft.base, op: "discard" });
  if (result)
    app.drafts.set({ ...draft, base: result.base, doc: result.draft, lint: result.lint, dirty: result.stored });
}

// src/frontend/build/jobs.tsx
var jobStore = createStore({});
function trackJobs(client) {
  return client.onJob((update) => {
    jobStore.update((all) => {
      const entry = Object.entries(all).find(([, job]) => job.jobId === update.jobId);
      if (!entry)
        return all;
      const [key, job] = entry;
      return { ...all, [key]: { ...job, status: update.status, progress: update.progress, message: update.message, result: update.result ?? job.result } };
    });
  });
}
function proposalWrites(worldId, proposals, accepted) {
  return proposals.filter((p) => accepted.has(p.id)).map((p) => ({ type: "lre.editor", worldId, base: null, op: "put", collection: p.collection, id: p.key, value: p.value }));
}
var TITLE = { import_lore: "Import from lore", refine: "Build / Refine with AI", playtest: "Playtest", check_world: "Check world" };
var CHECK_DAYS = [1, 3, 7].map((days) => ({ value: days, label: `${days} day${days === 1 ? "" : "s"}` }));
var STATUS_TONE = { running: "accent", done: "pos", failed: "neg", cancelled: "" };
function JobInput(props) {
  const app = useApp();
  const [books, setBooks] = d2(null);
  const [picked, setPicked] = d2([]);
  const [text, setText] = d2("");
  const [days, setDays] = d2(3);
  A(() => {
    if (props.kind === "import_lore")
      app.host.worldBooks().then(setBooks, () => setBooks([]));
  }, [props.kind]);
  if (props.kind === "import_lore") {
    return /* @__PURE__ */ u3("div", {
      class: "lre-stack",
      children: [
        /* @__PURE__ */ u3("span", {
          class: "lre-small lre-muted",
          children: "Choose lore books. Every entry becomes a reviewable proposal; nothing changes until you apply it."
        }, undefined, false, undefined, this),
        books === null ? /* @__PURE__ */ u3(Empty, {
          children: "Loading lore books…"
        }, undefined, false, undefined, this) : books.length === 0 ? /* @__PURE__ */ u3(Empty, {
          children: "No lore books."
        }, undefined, false, undefined, this) : /* @__PURE__ */ u3("div", {
          class: "lre-list",
          children: books.map((book) => /* @__PURE__ */ u3("label", {
            class: "lre-item",
            children: [
              /* @__PURE__ */ u3("span", {
                class: "lre-check",
                children: /* @__PURE__ */ u3("input", {
                  type: "checkbox",
                  checked: picked.includes(book.id),
                  onChange: () => setPicked(picked.includes(book.id) ? picked.filter((id) => id !== book.id) : [...picked, book.id])
                }, undefined, false, undefined, this)
              }, undefined, false, undefined, this),
              /* @__PURE__ */ u3("span", {
                class: "grow",
                children: book.name
              }, undefined, false, undefined, this)
            ]
          }, book.id, true, undefined, this))
        }, undefined, false, undefined, this),
        /* @__PURE__ */ u3("button", {
          type: "button",
          class: "lre-btn primary",
          disabled: picked.length === 0 || props.busy,
          onClick: () => props.onStart({ bookIds: picked }),
          children: [
            "Import ",
            picked.length > 0 ? `${picked.length} book${picked.length === 1 ? "" : "s"}` : ""
          ]
        }, undefined, true, undefined, this)
      ]
    }, undefined, true, undefined, this);
  }
  if (props.kind === "refine") {
    return /* @__PURE__ */ u3("div", {
      class: "lre-stack",
      children: [
        /* @__PURE__ */ u3("label", {
          class: "lre-field",
          children: [
            /* @__PURE__ */ u3("span", {
              class: "label",
              children: "What should change?"
            }, undefined, false, undefined, this),
            /* @__PURE__ */ u3("textarea", {
              class: "lre-input",
              rows: 4,
              style: { fontFamily: "inherit" },
              placeholder: "Add a night-shift nurse who knows Dev; give the diner a weekly schedule…",
              value: text,
              onInput: (event) => setText(event.currentTarget.value)
            }, undefined, false, undefined, this)
          ]
        }, undefined, true, undefined, this),
        /* @__PURE__ */ u3("button", {
          type: "button",
          class: "lre-btn primary",
          disabled: !text.trim() || props.busy,
          onClick: () => props.onStart({ instructions: text.trim() }),
          children: "Propose changes"
        }, undefined, false, undefined, this)
      ]
    }, undefined, true, undefined, this);
  }
  if (props.kind === "check_world") {
    return /* @__PURE__ */ u3("div", {
      class: "lre-stack",
      children: [
        /* @__PURE__ */ u3("span", {
          class: "lre-small lre-muted",
          children: "Runs the world forward one day per turn with no player input and reports what happened, dropped events, failures and leaks. Nothing is saved."
        }, undefined, false, undefined, this),
        /* @__PURE__ */ u3(Seg, {
          label: "Days",
          value: days,
          options: CHECK_DAYS,
          onChange: (next) => setDays(next)
        }, undefined, false, undefined, this),
        /* @__PURE__ */ u3("button", {
          type: "button",
          class: "lre-btn primary",
          disabled: props.busy,
          onClick: () => props.onStart({ days }),
          children: "Run check"
        }, undefined, false, undefined, this)
      ]
    }, undefined, true, undefined, this);
  }
  const script = text.split(`
`).map((line) => line.trim()).filter((line) => line.length > 0).slice(0, 50);
  return /* @__PURE__ */ u3("div", {
    class: "lre-stack",
    children: [
      /* @__PURE__ */ u3("label", {
        class: "lre-field",
        children: [
          /* @__PURE__ */ u3("span", {
            class: "label",
            children: "Player turns (one per line, up to 50)"
          }, undefined, false, undefined, this),
          /* @__PURE__ */ u3("textarea", {
            class: "lre-input",
            rows: 5,
            style: { fontFamily: "inherit" },
            placeholder: `I walk to the diner.
I order a coffee.
I ask Rosie about the night shift.`,
            value: text,
            onInput: (event) => setText(event.currentTarget.value)
          }, undefined, false, undefined, this)
        ]
      }, undefined, true, undefined, this),
      /* @__PURE__ */ u3("button", {
        type: "button",
        class: "lre-btn primary",
        disabled: script.length === 0 || props.busy,
        onClick: () => props.onStart({ turns: script }),
        children: [
          "Run playtest",
          script.length > 0 ? ` (${script.length} turn${script.length === 1 ? "" : "s"})` : ""
        ]
      }, undefined, true, undefined, this)
    ]
  }, undefined, true, undefined, this);
}
function proposalGroups(proposals) {
  const groups = new Map;
  for (const p of proposals) {
    const pack = p.pack ?? "other";
    groups.set(pack, [...groups.get(pack) ?? [], p]);
  }
  return [...groups].map(([pack, list]) => ({ pack, proposals: list }));
}
function shownValue(p, bookNames) {
  if (!isRecord(p.value) || !Array.isArray(p.value.sources))
    return p.value;
  const sources = p.value.sources.map((link) => {
    if (typeof link !== "string")
      return link;
    const [bookId = link, entryId = ""] = link.split("/");
    const title = p.sourceNames && hasOwn(p.sourceNames, link) ? p.sourceNames[link] : undefined;
    const book = hasOwn(bookNames, bookId) ? bookNames[bookId] : undefined;
    return title || book ? [title || entryId, book || bookId].filter((part) => part).join(" · ") : link;
  });
  return { ...p.value, sources };
}
function startTicked(proposals) {
  return new Set(proposals.filter((p) => p.confidence >= 0.7 && !strings(isRecord(p.value) ? p.value.assumed : undefined).includes("kind")).map((p) => p.id));
}
function ProposalReview(props) {
  const [accepted, setAccepted] = d2(() => startTicked(props.proposals));
  const [open, setOpen] = d2(null);
  const [applied, setApplied] = d2(false);
  const [busy, run] = useBusy();
  const send = b2(() => draftSend(props.app), [props.app]);
  const [bookNames, setBookNames] = d2({});
  A(() => {
    props.app.host.worldBooks().then((books) => setBookNames(Object.fromEntries(books.map((book) => [book.id, book.name]))), () => setBookNames({}));
  }, [props.app]);
  const toggle = (id) => {
    const next = new Set(accepted);
    if (next.has(id))
      next.delete(id);
    else
      next.add(id);
    setAccepted(next);
  };
  return /* @__PURE__ */ u3(Card, {
    title: "Proposals",
    aside: /* @__PURE__ */ u3("span", {
      class: "lre-badge",
      children: [
        accepted.size,
        " / ",
        props.proposals.length
      ]
    }, undefined, true, undefined, this),
    children: [
      /* @__PURE__ */ u3("div", {
        class: "lre-inline",
        style: { marginBottom: "8px" },
        children: [
          /* @__PURE__ */ u3("button", {
            type: "button",
            class: "lre-btn small",
            onClick: () => setAccepted(new Set(props.proposals.map((p) => p.id))),
            children: "Select all"
          }, undefined, false, undefined, this),
          /* @__PURE__ */ u3("button", {
            type: "button",
            class: "lre-btn small",
            onClick: () => setAccepted(new Set),
            children: "None"
          }, undefined, false, undefined, this)
        ]
      }, undefined, true, undefined, this),
      proposalGroups(props.proposals).map((group) => /* @__PURE__ */ u3("div", {
        "data-lre-proposal-pack": group.pack,
        style: { marginTop: "6px" },
        children: [
          /* @__PURE__ */ u3("div", {
            class: "lre-spread",
            children: [
              /* @__PURE__ */ u3("span", {
                class: "lre-small lre-muted",
                style: { textTransform: "uppercase", letterSpacing: ".06em" },
                children: group.pack
              }, undefined, false, undefined, this),
              /* @__PURE__ */ u3("span", {
                class: "lre-small lre-muted",
                children: [
                  group.proposals.filter((p) => accepted.has(p.id)).length,
                  " / ",
                  group.proposals.length
                ]
              }, undefined, true, undefined, this)
            ]
          }, undefined, true, undefined, this),
          group.proposals.map((p) => {
            const value = isRecord(p.value) ? p.value : {};
            const from = [...new Set(strings(value.sources).map((link) => link.split("/")[0] ?? link))].map((id) => bookNames[id] ?? id);
            const assumed = strings(value.assumed);
            const tableFields = assumed.filter((f) => f !== "kind");
            return /* @__PURE__ */ u3("div", {
              class: "lre-lint",
              "data-lre-proposal": p.id,
              children: [
                /* @__PURE__ */ u3("label", {
                  class: "lre-check",
                  children: /* @__PURE__ */ u3("input", {
                    type: "checkbox",
                    "aria-label": `Accept ${p.collection}.${p.key}`,
                    checked: accepted.has(p.id),
                    onChange: () => toggle(p.id)
                  }, undefined, false, undefined, this)
                }, undefined, false, undefined, this),
                /* @__PURE__ */ u3("span", {
                  style: { flex: 1, minWidth: 0 },
                  children: [
                    /* @__PURE__ */ u3("span", {
                      class: "lre-spread",
                      children: [
                        /* @__PURE__ */ u3("code", {
                          children: [
                            p.collection,
                            ".",
                            p.key
                          ]
                        }, undefined, true, undefined, this),
                        /* @__PURE__ */ u3("span", {
                          class: p.confidence >= 0.8 ? "lre-badge pos" : p.confidence >= 0.5 ? "lre-badge warn" : "lre-badge neg",
                          children: [
                            Math.round(p.confidence * 100),
                            "%"
                          ]
                        }, undefined, true, undefined, this)
                      ]
                    }, undefined, true, undefined, this),
                    from.length === 0 || p.note ? /* @__PURE__ */ u3("span", {
                      class: "lre-small lre-muted",
                      style: { display: "block" },
                      children: [from.length === 0 ? p.source : null, p.note].filter((part) => part).join(" — ")
                    }, undefined, false, undefined, this) : null,
                    from.length > 0 ? /* @__PURE__ */ u3("span", {
                      class: "lre-small",
                      style: { display: "block" },
                      "data-lre-proposal-from": true,
                      children: [
                        "From lore: ",
                        from.join(", ")
                      ]
                    }, undefined, true, undefined, this) : null,
                    assumed.includes("kind") ? /* @__PURE__ */ u3("span", {
                      class: "lre-small lre-warn",
                      style: { display: "block" },
                      "data-lre-proposal-assumed-kind": true,
                      children: [
                        "Assumed kind: ",
                        String(value.kind),
                        " (the lore named none)"
                      ]
                    }, undefined, true, undefined, this) : null,
                    tableFields.length > 0 ? /* @__PURE__ */ u3("span", {
                      class: "lre-small lre-warn",
                      style: { display: "block" },
                      "data-lre-proposal-assumed": true,
                      children: [
                        "Assumed from a table: ",
                        tableFields.join(", ")
                      ]
                    }, undefined, true, undefined, this) : null,
                    /* @__PURE__ */ u3("button", {
                      type: "button",
                      class: "lre-btn small ghost",
                      "aria-expanded": open === p.id,
                      onClick: () => setOpen(open === p.id ? null : p.id),
                      children: open === p.id ? "Hide value" : "Show value"
                    }, undefined, false, undefined, this),
                    open === p.id ? /* @__PURE__ */ u3(JsonView, {
                      value: shownValue(p, bookNames)
                    }, undefined, false, undefined, this) : null
                  ]
                }, undefined, true, undefined, this)
              ]
            }, p.id, true, undefined, this);
          })
        ]
      }, group.pack, true, undefined, this)),
      /* @__PURE__ */ u3("button", {
        type: "button",
        class: "lre-btn primary block",
        style: { marginTop: "8px" },
        disabled: accepted.size === 0 || busy || applied,
        onClick: () => run(async () => {
          let ok = 0;
          for (const write of proposalWrites(props.worldId, props.proposals, accepted)) {
            const message = await send(write);
            if (message.type === "lre.result")
              ok += 1;
          }
          props.app.toast(`Applied ${ok} of ${accepted.size} to the draft. Commit when ready.`, ok === accepted.size ? "info" : "error");
          setApplied(true);
        }),
        children: applied ? "Applied to the draft" : `Apply ${accepted.size} to the draft`
      }, undefined, false, undefined, this)
    ]
  }, undefined, true, undefined, this);
}
function JobView(props) {
  const app = useApp();
  const key = `${props.worldId}:${props.kind}`;
  const job = useSelect(jobStore, (all) => all[key] ?? null);
  const [busy, run] = useBusy();
  const start = (input) => run(async () => {
    const result = await app.request({ type: "lre.job", op: "start", kind: props.kind, worldId: props.worldId, input });
    if (result)
      jobStore.update((all) => ({ ...all, [key]: { jobId: result.jobId, kind: props.kind, worldId: props.worldId, status: "running", progress: 0 } }));
  });
  const result = job?.result;
  return /* @__PURE__ */ u3("div", {
    class: "lre-stack",
    "data-lre-job": props.kind,
    children: [
      /* @__PURE__ */ u3("div", {
        class: "lre-h2",
        children: TITLE[props.kind]
      }, undefined, false, undefined, this),
      !job || job.status !== "running" ? /* @__PURE__ */ u3(Card, {
        title: job ? "Run again" : "Start",
        children: /* @__PURE__ */ u3(JobInput, {
          kind: props.kind,
          onStart: start,
          busy
        }, undefined, false, undefined, this)
      }, undefined, false, undefined, this) : null,
      job ? /* @__PURE__ */ u3(Card, {
        title: "Status",
        aside: /* @__PURE__ */ u3("span", {
          class: `lre-badge ${STATUS_TONE[job.status]}`,
          children: job.status
        }, undefined, false, undefined, this),
        children: [
          /* @__PURE__ */ u3("div", {
            class: "lre-progress",
            role: "progressbar",
            "aria-label": `${TITLE[props.kind]} progress`,
            "aria-valuemin": 0,
            "aria-valuemax": 100,
            "aria-valuenow": Math.round(job.progress * 100),
            children: /* @__PURE__ */ u3("span", {
              style: { width: `${Math.round(job.progress * 100)}%` }
            }, undefined, false, undefined, this)
          }, undefined, false, undefined, this),
          job.message ? /* @__PURE__ */ u3("div", {
            class: "lre-small lre-muted",
            style: { marginTop: "6px" },
            children: job.message
          }, undefined, false, undefined, this) : null,
          job.status === "running" ? /* @__PURE__ */ u3("button", {
            type: "button",
            class: "lre-btn small",
            style: { marginTop: "8px" },
            disabled: busy,
            onClick: () => run(async () => {
              await app.request({ type: "lre.job", op: "cancel", jobId: job.jobId });
            }),
            children: "Cancel"
          }, undefined, false, undefined, this) : null
        ]
      }, undefined, true, undefined, this) : null,
      result && "proposals" in result ? result.proposals.length === 0 ? /* @__PURE__ */ u3(Empty, {
        children: "No proposals."
      }, undefined, false, undefined, this) : /* @__PURE__ */ u3(ProposalReview, {
        app,
        worldId: props.worldId,
        proposals: result.proposals
      }, job?.jobId, false, undefined, this) : null,
      result && "turns" in result ? /* @__PURE__ */ u3(M, {
        children: [
          /* @__PURE__ */ u3(Card, {
            title: "Transcript",
            children: result.turns.map((turn, i) => /* @__PURE__ */ u3("div", {
              class: "lre-stack",
              style: { padding: "8px 0", borderBottom: "1px solid rgba(127,127,127,.15)" },
              children: [
                /* @__PURE__ */ u3("span", {
                  children: [
                    /* @__PURE__ */ u3("strong", {
                      children: "You:"
                    }, undefined, false, undefined, this),
                    " ",
                    turn.user
                  ]
                }, undefined, true, undefined, this),
                /* @__PURE__ */ u3("span", {
                  style: { whiteSpace: "pre-wrap" },
                  children: turn.reply
                }, undefined, false, undefined, this),
                turn.notes.map((note) => /* @__PURE__ */ u3("span", {
                  class: "lre-small lre-muted",
                  children: [
                    "• ",
                    note
                  ]
                }, note, true, undefined, this))
              ]
            }, i, true, undefined, this))
          }, undefined, false, undefined, this),
          /* @__PURE__ */ u3(Card, {
            title: "Issues found",
            aside: /* @__PURE__ */ u3("span", {
              class: "lre-badge",
              children: result.lint.length
            }, undefined, false, undefined, this),
            children: result.lint.length === 0 ? /* @__PURE__ */ u3(Empty, {
              children: "None."
            }, undefined, false, undefined, this) : result.lint.map((issue, i) => {
              const target = issueTarget(issue.path);
              return /* @__PURE__ */ u3(Row, {
                k: issue.message,
                sub: issue.path,
                v: target ? /* @__PURE__ */ u3("button", {
                  type: "button",
                  class: "lre-btn small",
                  onClick: () => app.ui.update((ui) => ({ ...ui, build: { view: "item", worldId: props.worldId, collection: target.collection, id: target.id } })),
                  children: "Open"
                }, undefined, false, undefined, this) : undefined
              }, i, false, undefined, this);
            })
          }, undefined, false, undefined, this)
        ]
      }, undefined, true, undefined, this) : null
    ]
  }, undefined, true, undefined, this);
}

// src/frontend/requests.ts
function chipIntent(chip, choice, chatId, payload) {
  if (choice === "regenerate")
    return { request: null, regenerate: true };
  const request = payload ? { type: "lre.chip", chatId, chip: chip.id, choice, payload } : { type: "lre.chip", chatId, chip: chip.id, choice };
  return { request, regenerate: chip.kind === "swipe_option" && (choice === "renarrate" || choice === "rerun") || chip.kind === "contradiction" && choice === "renarrate" };
}
function convertRequest(line, chatId) {
  if ("marker" in line.ref)
    return null;
  return { type: "lre.keep", chatId, choice: "convert", messageId: line.messageId, parentPath: line.parentPath, refs: [line.ref] };
}
function paletteRequest(entry, picks, chatId, amountCents, count) {
  const params = Object.assign({}, ...picks.map((pick) => pick.params));
  if (entry.amount && amountCents !== undefined)
    params[entry.amount.param] = Math.round(amountCents);
  if (entry.number && count !== undefined)
    params[entry.number.param] = count;
  return { type: "lre.action", chatId, action: entry.action, params, source: "palette" };
}
function timelapseRequest(view, target, overrides, chatId, source = "palette") {
  const changed = {};
  for (const [cls, policy] of Object.entries(overrides)) {
    if (policy !== undefined && view.interrupts[cls] !== policy)
      changed[cls] = policy;
  }
  return { type: "lre.action", chatId, action: view.action, params: { target: { ...target }, overrides: changed }, source };
}
function travelRequest(action, params, chatId) {
  return { type: "lre.action", chatId, action, params: { ...params }, source: "map" };
}
function fixRequest(target, value, chatId) {
  return { type: "lre.fix", chatId, entity: target.entity, field: target.field, value };
}
function timeMarker(chatId, control, scope, to, preview = false) {
  return preview ? { type: "lre.marker", chatId, kind: "time", control, scope, to, preview: true } : { type: "lre.marker", chatId, kind: "time", control, scope, to };
}
function resolveMarker(chatId, domain, scope, to, preview = false) {
  return preview ? { type: "lre.marker", chatId, kind: "resolve", domain, scope, to, preview: true } : { type: "lre.marker", chatId, kind: "resolve", domain, scope, to };
}

// src/frontend/chips.tsx
var CHIP_ICON = {
  change: "✦",
  elapsed: "⏱",
  roll: "\uD83C\uDFB2",
  price: "\uD83D\uDCB3",
  confirm: "❓",
  decline: "⛔",
  undo: "↺",
  retry_read: "↻",
  not_action: "\uD83D\uDCAC",
  swipe_option: "⇄",
  overdue: "⏰",
  timelapse_offer: "⏩",
  continue_timelapse: "⏩",
  retry_timelapse: "↻",
  keep_report: "⚑",
  reread: "\uD83D\uDC41",
  retry: "↻",
  degraded: "⚠",
  pending: "⋯",
  mode_change: "⚙",
  choice: "➜",
  contradiction: "≠"
};
function messageIdFromScope(scope) {
  const match = /^message:([^:]+):/.exec(scope);
  return match?.[1] ?? null;
}
function MessageChips(props) {
  const app = useApp();
  const view = useView();
  if (!view || view.status === "not_world")
    return null;
  const chips = view.chips.filter((chip) => chip.messageId === props.messageId);
  if (chips.length === 0)
    return null;
  return /* @__PURE__ */ u3("div", {
    class: "lre-chips",
    "data-lre-chips": props.messageId,
    children: chips.map((chip) => {
      const Custom = app.catalog.chips.get(chip.kind);
      if (Custom)
        return /* @__PURE__ */ u3(Custom, {
          chip,
          chatId: view.chatId,
          send: app.send
        }, chip.id, false, undefined, this);
      if (chip.kind === "keep_report")
        return /* @__PURE__ */ u3(KeepReportChip, {
          chip,
          chatId: view.chatId,
          send: app.send
        }, chip.id, false, undefined, this);
      return /* @__PURE__ */ u3(DefaultChip, {
        chip,
        chatId: view.chatId,
        send: app.send
      }, chip.id, false, undefined, this);
    })
  }, undefined, false, undefined, this);
}
function useChipAction(chip, chatId) {
  const app = useApp();
  const [busy, run] = useBusy();
  return [
    busy,
    (choice) => run(async () => {
      const intent = chipIntent(chip, choice, chatId);
      if (intent.request) {
        const message = await app.send(intent.request);
        if (message.type === "lre.error") {
          app.toast(message.message, "error");
          return;
        }
        if (message.request === "lre.chip" && message.body.pending && !intent.regenerate)
          app.toast("Saved — it applies when the reply finishes.", "info");
      }
      if (intent.regenerate && !await app.host.regenerate())
        app.toast("Couldn't start Regenerate here; use the message's Regenerate button.", "error");
    })
  ];
}
function DefaultChip(props) {
  const { chip } = props;
  const [busy, choose] = useChipAction(chip, props.chatId);
  const info = chip.actions.length === 0;
  return /* @__PURE__ */ u3("div", {
    class: `lre-chip${info ? " info" : ""}${busy ? " busy" : ""}`,
    "data-kind": chip.kind,
    title: chip.detail,
    children: [
      /* @__PURE__ */ u3("span", {
        class: "lab",
        children: [
          /* @__PURE__ */ u3("span", {
            "aria-hidden": "true",
            children: [
              CHIP_ICON[chip.kind],
              " "
            ]
          }, undefined, true, undefined, this),
          chip.label,
          chip.detail ? /* @__PURE__ */ u3("span", {
            class: "det",
            children: [
              " · ",
              chip.detail
            ]
          }, undefined, true, undefined, this) : null
        ]
      }, undefined, true, undefined, this),
      chip.actions.map((action) => /* @__PURE__ */ u3("button", {
        type: "button",
        class: action.style,
        disabled: busy,
        onClick: () => choose(action.id),
        children: action.label
      }, action.id, false, undefined, this))
    ]
  }, undefined, true, undefined, this);
}
var KEEP_STATUS = {
  dropped: "no longer valid here",
  inert: "made on another branch",
  converted: "kept"
};
function keepRows(lines) {
  const rows = [];
  for (const line of lines) {
    const key = `${line.messageId}\x00${line.status}\x00${line.group !== undefined ? `g:${line.group}` : `t:${line.text}`}`;
    const row = rows.find((r) => r.key === key);
    if (row)
      row.count += 1;
    else
      rows.push({ key, line, count: 1 });
  }
  return rows.map(({ line, count }) => ({ line, count }));
}
function KeepReportChip(props) {
  const app = useApp();
  const view = useView();
  const { chip } = props;
  const [busy, choose] = useChipAction(chip, props.chatId);
  const [converting, runConvert] = useBusy();
  const lines = keepRows(view?.keepReport ?? []);
  return /* @__PURE__ */ u3("div", {
    class: "lre-keep",
    "data-kind": "keep_report",
    children: [
      /* @__PURE__ */ u3("div", {
        class: "lre-spread",
        children: [
          /* @__PURE__ */ u3("strong", {
            children: [
              /* @__PURE__ */ u3("span", {
                "aria-hidden": "true",
                children: CHIP_ICON.keep_report
              }, undefined, false, undefined, this),
              " ",
              chip.label
            ]
          }, undefined, true, undefined, this),
          /* @__PURE__ */ u3("span", {
            class: "lre-badge warn",
            children: [
              lines.length,
              " entr",
              lines.length === 1 ? "y" : "ies"
            ]
          }, undefined, true, undefined, this)
        ]
      }, undefined, true, undefined, this),
      chip.detail ? /* @__PURE__ */ u3("div", {
        class: "lre-small lre-muted",
        children: chip.detail
      }, undefined, false, undefined, this) : null,
      lines.map(({ line, count }) => {
        const convert = convertRequest(line, props.chatId);
        const key = "marker" in line.ref ? `${line.messageId}:m${line.ref.marker}` : `${line.messageId}:${line.ref.in}:${"seq" in line.ref ? line.ref.seq : 0}:${line.ref.index}`;
        return /* @__PURE__ */ u3("div", {
          class: "lre-row",
          children: [
            /* @__PURE__ */ u3("span", {
              class: "k",
              children: [
                line.text,
                /* @__PURE__ */ u3("span", {
                  class: "sub",
                  children: [
                    KEEP_STATUS[line.status],
                    count > 1 ? ` · ${count} linked changes` : ""
                  ]
                }, undefined, true, undefined, this)
              ]
            }, undefined, true, undefined, this),
            convert && line.status !== "converted" ? /* @__PURE__ */ u3("button", {
              type: "button",
              class: "lre-btn small",
              disabled: converting,
              onClick: () => runConvert(async () => {
                await app.request(convert);
              }),
              children: "Convert"
            }, undefined, false, undefined, this) : null
          ]
        }, key, true, undefined, this);
      }),
      /* @__PURE__ */ u3("div", {
        class: "lre-inline",
        style: { marginTop: "6px" },
        children: chip.actions.map((action) => /* @__PURE__ */ u3("button", {
          type: "button",
          class: `lre-btn small ${action.id === "discard" ? "danger" : action.style ?? ""}`,
          disabled: busy,
          onClick: () => choose(action.id),
          children: action.label
        }, action.id, false, undefined, this))
      }, undefined, false, undefined, this)
    ]
  }, undefined, true, undefined, this);
}

// src/shared/ids.ts
var DOMAINS = ["money", "gear", "vehicles", "castlife", "relationships", "space", "calendar", "weather", "sheets"];
var TIERS = ["pov", "principal", "supporting", "background"];
var INTERRUPT_CLASSES = ["invitation", "bill", "decline", "incident", "quest", "rule", "arrival", "overdue", "needs", "weather"];

// src/frontend/build/schema.ts
var FIELD_TYPES = ["number", "text", "bool", "enum", "ref", "list", "dice", "money", "date", "duration"];
var BOUND_MODES = ["auto", "confirm", "never"];
var VISIBILITY = ["public", "known_by", "secret"];
var TRAVEL_MODES = ["walk", "road", "offroad", "water"];
var BAND = {
  kind: "object",
  key: "",
  label: "Band",
  fields: [
    { kind: "text", key: "label", label: "Label" },
    { kind: "number", key: "min", label: "From (inclusive)", optional: true },
    { kind: "number", key: "max", label: "To (exclusive)", optional: true }
  ]
};
var FIELD_DEF = {
  kind: "object",
  key: "",
  label: "Field",
  fields: [
    { kind: "enum", key: "type", label: "Type", values: FIELD_TYPES },
    { kind: "text", key: "label", label: "Label", optional: true },
    { kind: "json", key: "default", label: "Default", optional: true },
    { kind: "number", key: "min", label: "Min", optional: true },
    { kind: "number", key: "max", label: "Max", optional: true },
    { kind: "tags", key: "values", label: "Enum values" },
    { kind: "ref", key: "ref", label: "Ref kind", collection: "kinds", optional: true },
    { kind: "enum", key: "of", label: "List of", values: FIELD_TYPES.filter((t) => t !== "list"), optional: true },
    { kind: "list", key: "bands", label: "Bands (shown as words)", item: BAND, title: "label" },
    { kind: "expr", key: "derived", label: "Derived formula", optional: true },
    { kind: "bool", key: "locked", label: "Locked (never offered to a model)" },
    {
      kind: "object",
      key: "bound",
      label: "Bound on model changes",
      optional: true,
      fields: [
        { kind: "enum", key: "mode", label: "Mode", values: BOUND_MODES },
        { kind: "number", key: "maxDelta", label: "Largest change per turn", optional: true }
      ]
    },
    { kind: "enum", key: "visibility", label: "Visibility", values: VISIBILITY, optional: true },
    { kind: "enum", key: "domain", label: "Realism domain", values: DOMAINS, optional: true },
    { kind: "number", key: "level", label: "Live from level", min: 0, max: 4, step: 1, optional: true }
  ]
};
var EFFECT = {
  kind: "object",
  key: "",
  label: "Effect",
  fields: [
    { kind: "text", key: "type", label: "Effect type", hint: "e.g. set, add, economy.charge" },
    { kind: "json", key: "args", label: "Arguments (values or formulas)" }
  ]
};
var COLLECTION_SPECS = {
  kinds: [
    { kind: "text", key: "label", label: "Label" },
    { kind: "ref", key: "extends", label: "Extends", collection: "kinds", optional: true },
    { kind: "record", key: "fields", label: "Fields", item: FIELD_DEF, keyLabel: "Field id" },
    { kind: "text", key: "pack", label: "Pack", optional: true, readonly: true }
  ],
  relations: [
    { kind: "text", key: "label", label: "Label" },
    { kind: "ref", key: "from", label: "From kind", collection: "kinds", any: true },
    { kind: "ref", key: "to", label: "To kind", collection: "kinds", any: true },
    { kind: "enum", key: "cardinality", label: "Cardinality", values: ["one_one", "one_many", "many_one", "many_many"] },
    { kind: "bool", key: "symmetric", label: "Symmetric" },
    { kind: "record", key: "fields", label: "Fields", item: FIELD_DEF, keyLabel: "Field id" }
  ],
  entities: [
    { kind: "text", key: "name", label: "Name" },
    { kind: "ref", key: "kind", label: "Kind", collection: "kinds" },
    { kind: "enum", key: "tier", label: "Tier", values: TIERS },
    { kind: "kindFields", key: "fields", label: "Fields" },
    {
      kind: "list",
      key: "relations",
      label: "Relations",
      title: "type",
      item: {
        kind: "object",
        key: "",
        label: "Relation",
        fields: [
          { kind: "ref", key: "type", label: "Type", collection: "relations" },
          { kind: "ref", key: "to", label: "To", collection: "entities" },
          { kind: "json", key: "fields", label: "Fields", optional: true },
          { kind: "number", key: "until", label: "Until (game minutes)", optional: true }
        ]
      }
    },
    { kind: "levels", key: "levels", label: "Level overrides" },
    { kind: "bool", key: "agent", label: "LOD1 agent (runs agendas and the planner)" },
    { kind: "text", key: "characterId", label: "Lumiverse character id", optional: true },
    { kind: "enum", key: "visibility", label: "Visibility", values: VISIBILITY, optional: true },
    { kind: "tags", key: "tags", label: "Tags" }
  ],
  places: [
    { kind: "text", key: "name", label: "Name" },
    { kind: "ref", key: "parent", label: "Inside", collection: "places", optional: true },
    { kind: "text", key: "timeZone", label: "Time zone (IANA)", optional: true, hint: "Inherited from the parent when empty" },
    { kind: "text", key: "sceneType", label: "Default scene type", optional: true },
    { kind: "ref", key: "grid", label: "Grid", collection: "grids", optional: true },
    {
      kind: "object",
      key: "cell",
      label: "Cell on the parent's grid",
      optional: true,
      fields: [
        { kind: "number", key: "x", label: "x", min: 0, step: 1 },
        { kind: "number", key: "y", label: "y", min: 0, step: 1 }
      ]
    },
    { kind: "json", key: "fields", label: "Fields" },
    { kind: "enum", key: "visibility", label: "Visibility", values: VISIBILITY, optional: true }
  ],
  routes: [
    { kind: "ref", key: "from", label: "From", collection: "places" },
    { kind: "ref", key: "to", label: "To", collection: "places" },
    {
      kind: "record",
      key: "modes",
      label: "Modes",
      keyLabel: "Mode",
      keys: TRAVEL_MODES,
      item: {
        kind: "object",
        key: "",
        label: "Leg",
        fields: [
          { kind: "number", key: "minutes", label: "Minutes", min: 0 },
          { kind: "number", key: "distanceKm", label: "Distance (km)", min: 0, optional: true },
          { kind: "text", key: "terrain", label: "Terrain", optional: true }
        ]
      }
    },
    { kind: "bool", key: "bidirectional", label: "Both directions" }
  ],
  grids: [
    { kind: "number", key: "width", label: "Width", min: 1, step: 1 },
    { kind: "number", key: "height", label: "Height", min: 1, step: 1 },
    { kind: "number", key: "cellMeters", label: "Cell size (m)", optional: true },
    { kind: "json", key: "terrain", label: "Terrain (row-major)" },
    { kind: "json", key: "blocked", label: "Blocked cells" },
    { kind: "json", key: "zones", label: "Zones" }
  ],
  rules: [
    { kind: "json", key: "on", label: "Trigger", hint: '{"event": "…"} · {"tick": "turn|slot|day"} · {"enter": "place"} · {"at": "formula"}' },
    { kind: "expr", key: "when", label: "When", optional: true },
    { kind: "list", key: "do", label: "Do", item: EFFECT, title: "type" },
    { kind: "bool", key: "once", label: "Once" },
    { kind: "number", key: "cooldownMinutes", label: "Cooldown (min)", optional: true },
    { kind: "bool", key: "interrupt", label: "Interrupts a timelapse" },
    {
      kind: "object",
      key: "beat",
      label: "Storylet beat",
      optional: true,
      fields: [
        { kind: "text", key: "hint", label: "Outline hint" },
        { kind: "number", key: "weight", label: "Weight", optional: true }
      ]
    }
  ],
  actions: [
    { kind: "text", key: "label", label: "Label" },
    {
      kind: "record",
      key: "params",
      label: "Parameters",
      keyLabel: "Parameter",
      item: {
        kind: "object",
        key: "",
        label: "Parameter",
        fields: [
          { kind: "enum", key: "type", label: "Type", values: FIELD_TYPES },
          { kind: "text", key: "label", label: "Label", optional: true },
          { kind: "ref", key: "ref", label: "Ref kind", collection: "kinds", optional: true },
          { kind: "bool", key: "optional", label: "Optional" }
        ]
      }
    },
    { kind: "list", key: "requires", label: "Requires", item: { kind: "expr", key: "", label: "Requirement" } },
    { kind: "ref", key: "check", label: "Check", collection: "checks", optional: true, inline: true },
    { kind: "json", key: "outcomes", label: "Effects per outcome" },
    { kind: "expr", key: "duration", label: "Duration (minutes)" },
    {
      kind: "object",
      key: "activity",
      label: "Starts an activity",
      optional: true,
      fields: [
        { kind: "text", key: "type", label: "Activity", hint: "sleep, work_shift, travel, waiting, …" },
        { kind: "expr", key: "until", label: "Until" }
      ]
    },
    { kind: "tags", key: "lexicon", label: "Verbs and phrases" },
    { kind: "text", key: "observable", label: "Observable label", optional: true }
  ],
  checks: [
    { kind: "dice", key: "dice", label: "Dice" },
    { kind: "expr", key: "modifier", label: "Modifier", optional: true },
    {
      kind: "list",
      key: "bands",
      label: "Outcome bands",
      title: "outcome",
      item: {
        kind: "object",
        key: "",
        label: "Band",
        fields: [
          { kind: "text", key: "outcome", label: "Outcome" },
          { kind: "number", key: "min", label: "Min total", optional: true },
          { kind: "number", key: "max", label: "Max total", optional: true }
        ]
      }
    }
  ],
  schedules: [
    { kind: "text", key: "owner", label: "Owner (entity or kind)", optional: true },
    { kind: "text", key: "target", label: "Sets" },
    { kind: "json", key: "recurrence", label: "Recurrence" },
    { kind: "json", key: "slots", label: "Slots" }
  ],
  tracks: [
    { kind: "enum", key: "kind", label: "Kind", values: ["quest", "secret", "puzzle", "agenda"] },
    { kind: "text", key: "label", label: "Label" },
    { kind: "ref", key: "owner", label: "Owner", collection: "entities", optional: true },
    { kind: "text", key: "start", label: "Start stage" },
    { kind: "json", key: "stages", label: "Stages" },
    { kind: "enum", key: "visibility", label: "Visibility", values: VISIBILITY }
  ],
  tables: [{ kind: "json", key: "rows", label: "Rows" }],
  sections: [
    { kind: "text", key: "label", label: "Label" },
    { kind: "number", key: "rank", label: "Rank (lower is reserved first)", step: 1 },
    { kind: "text", key: "template", label: "Template", multiline: true },
    { kind: "json", key: "position", label: "Position", hint: '{"type":"native"} · {"type":"outlet","name":"…"} · {"type":"chat_depth",…}' }
  ],
  steps: [
    { kind: "enum", key: "purpose", label: "Purpose", values: ["interpret", "select", "npc.choose", "contradiction", "puzzle.answer", "brief", "outline", "extract", "choices"] },
    { kind: "text", key: "template", label: "Template", multiline: true },
    { kind: "enum", key: "output", label: "Output", values: ["text", "effects", "decision"] },
    { kind: "tags", key: "signals", label: "Signals" }
  ],
  packs: [
    { kind: "number", key: "version", label: "Format version", step: 1 },
    { kind: "json", key: "config", label: "Config" }
  ],
  lore: [
    { kind: "text", key: "title", label: "Title" },
    { kind: "text", key: "content", label: "Content", multiline: true },
    { kind: "tags", key: "keys", label: "Keys" },
    { kind: "refs", key: "links", label: "Links (entities and places)", collections: ["entities", "places"] },
    { kind: "text", key: "group", label: "Group", optional: true, hint: "At most one entry of a group is selected per turn" },
    { kind: "number", key: "priority", label: "Priority", optional: true, step: 1, hint: "Higher comes first among equal hits" },
    { kind: "bool", key: "secret", label: "Secret", hint: "A candidate only while the gate holds" },
    { kind: "expr", key: "gate", label: "Gate", optional: true }
  ]
};
var PART_SPECS = {
  calendar: [
    { kind: "enum", key: "system", label: "System", values: ["gregorian", "custom"] },
    { kind: "text", key: "epoch", label: "Epoch (local ISO, e.g. 2026-10-16T06:00)" },
    { kind: "text", key: "timeZone", label: "Time zone (IANA)" },
    {
      kind: "list",
      key: "dayParts",
      label: "Day parts",
      title: "label",
      item: {
        kind: "object",
        key: "",
        label: "Day part",
        fields: [
          { kind: "text", key: "id", label: "Id" },
          { kind: "text", key: "label", label: "Label" },
          { kind: "text", key: "start", label: "Starts (HH:MM)" }
        ]
      }
    },
    {
      kind: "list",
      key: "holidays",
      label: "Holidays",
      title: "label",
      item: {
        kind: "object",
        key: "",
        label: "Holiday",
        fields: [
          { kind: "text", key: "id", label: "Id" },
          { kind: "text", key: "label", label: "Label" },
          { kind: "json", key: "rule", label: "Date rule" },
          { kind: "bool", key: "dayOff", label: "Day off" }
        ]
      }
    },
    { kind: "json", key: "custom", label: "Custom calendar (month lengths and names)", optional: true }
  ],
  realism: [
    { kind: "enum", key: "preset", label: "Preset", values: ["story", "grounded", "simulation", "custom"] },
    { kind: "levels", key: "levels", label: "Domain levels" },
    { kind: "json", key: "tierCaps", label: "Tier caps" }
  ],
  time: [
    { kind: "record", key: "sceneTicks", label: "Default tick per scene type (min)", keyLabel: "Scene type", item: { kind: "number", key: "", label: "Minutes", min: 0, step: 0.5 } },
    { kind: "json", key: "interrupts", label: "Interrupt policy" },
    { kind: "json", key: "speedThrough", label: "Speed through" },
    { kind: "enum", key: "montage", label: "Montage", values: ["key", "day", "week"] },
    {
      kind: "object",
      key: "unitCap",
      label: "Unit cap",
      fields: [
        { kind: "number", key: "agentDays", label: "Agent-days", min: 1, step: 1 },
        { kind: "number", key: "events", label: "Events", min: 1, step: 1 }
      ]
    }
  ],
  meta: [
    { kind: "text", key: "name", label: "World name" },
    { kind: "ref", key: "pov", label: "Point of view", collection: "entities" },
    {
      kind: "object",
      key: "start",
      label: "Start",
      fields: [
        { kind: "ref", key: "place", label: "Place", collection: "places" },
        { kind: "text", key: "at", label: "At (local ISO)" }
      ]
    },
    { kind: "enum", key: "seedMode", label: "Re-run rolls", values: ["fresh", "same_roll"] },
    { kind: "bool", key: "lenientPricing", label: "Lenient pricing (accept narrated prices inside the band)" },
    {
      kind: "object",
      key: "currency",
      label: "Currency",
      fields: [
        { kind: "text", key: "code", label: "Code (ISO 4217 or your own, e.g. GP)" },
        { kind: "text", key: "symbol", label: "Symbol" },
        { kind: "text", key: "minorUnit", label: "Minor unit (cent, copper…)" },
        { kind: "number", key: "decimals", label: "Decimals (2 → 100 minor units per major)", min: 0, max: 6, step: 1 },
        { kind: "text", key: "format", label: "Format", hint: "{sign}{symbol}{amount} · {sign}{major} sp {minor} cp" }
      ]
    }
  ]
};
function newItem(collection, id) {
  switch (collection) {
    case "kinds":
      return { id, label: id, fields: {} };
    case "relations":
      return { id, label: id, from: "*", to: "*", cardinality: "many_many", symmetric: false, fields: {} };
    case "entities":
      return { id, kind: "", name: id, tier: "background", fields: {}, relations: [] };
    case "places":
      return { id, name: id, fields: {} };
    case "routes":
      return { id, from: "", to: "", modes: { walk: { minutes: 10 } }, bidirectional: true };
    case "grids":
      return { id, width: 16, height: 16, terrain: Array.from({ length: 256 }, () => "grass"), blocked: [], zones: {} };
    case "rules":
      return { id, on: { tick: "turn" }, do: [] };
    case "actions":
      return { id, label: id, params: {}, requires: [], outcomes: { default: [] }, duration: "1" };
    case "checks":
      return { id, dice: "2d6", bands: [{ outcome: "fail", max: 6 }, { outcome: "success", min: 7 }] };
    case "schedules":
      return { id, target: "place", recurrence: { every: "day" }, slots: [{ start: "09:00", end: "17:00", value: null }] };
    case "tracks":
      return { id, kind: "quest", label: id, start: "start", stages: { start: { label: "Start", next: [] } }, visibility: "public" };
    case "tables":
      return { id, pack: "", schema: `lre-table/${id}/v1`, revision: "", label: id, columns: {}, rows: {} };
    case "sections":
      return { id, label: id, rank: 50, template: "", position: { type: "native" } };
    case "steps":
      return { id, purpose: "brief", template: "", output: "text", signals: [] };
    case "packs":
      return { version: 1, config: {} };
    case "lore":
      return { id, title: id, content: "", keys: [], links: [] };
  }
}

// src/frontend/build/expr-editor.tsx
var OPERATORS = ["+", "-", "*", "/", "%", "==", "!=", "<", "<=", ">", ">=", "and", "or", "not", "(", ")", "?", ":"];
var FUNCTIONS = ["min(", "max(", "abs(", "round(", "floor(", "clamp(", "roll(", "wealth(", "can_afford(", "has_item(", "fuel_ok(", "regard_band(", "knows(", "stage(", "at(", "now()"];
function checkBalance(text) {
  const stack = [];
  const pairs = { ")": "(", "]": "[", "}": "{" };
  let quote = null;
  for (let i = 0;i < text.length; i += 1) {
    const ch = text[i] ?? "";
    if (quote) {
      if (ch === "\\")
        i += 1;
      else if (ch === quote)
        quote = null;
      continue;
    }
    if (ch === '"' || ch === "'")
      quote = ch;
    else if (ch === "(" || ch === "[" || ch === "{")
      stack.push(ch);
    else if (ch === ")" || ch === "]" || ch === "}") {
      if (stack.pop() !== pairs[ch])
        return { ok: false, message: `Unexpected ${ch} at ${i + 1}` };
    }
  }
  if (quote)
    return { ok: false, message: "Unclosed string" };
  if (stack.length > 0)
    return { ok: false, message: `${stack.length} unclosed ${stack.at(-1)}` };
  return { ok: true, message: null };
}
function ExprEditor(props) {
  const input = T2(null);
  const [tools, setTools] = d2(false);
  const balance = checkBalance(props.value);
  const word = /[A-Za-z_][\w.]*$/.exec(props.value)?.[0] ?? "";
  const suggestions = word.length >= 1 ? props.identifiers.filter((id) => id.startsWith(word) && id !== word).slice(0, 8) : [];
  const insert = (text, replace = 0) => {
    const el = input.current;
    const start = el?.selectionStart ?? props.value.length;
    const end = el?.selectionEnd ?? props.value.length;
    const before = props.value.slice(0, start - replace);
    const spaced = /^[a-z]+$/.test(text) ? ` ${text} ` : text;
    props.onChange(before + spaced + props.value.slice(end));
    queueMicrotask(() => {
      el?.focus();
      const caret = before.length + spaced.length;
      el?.setSelectionRange(caret, caret);
    });
  };
  return /* @__PURE__ */ u3("div", {
    class: "lre-field",
    "data-lre-expr": true,
    children: [
      /* @__PURE__ */ u3("span", {
        class: "label lre-spread",
        children: [
          /* @__PURE__ */ u3("span", {
            children: [
              props.label,
              props.optional ? " (optional)" : ""
            ]
          }, undefined, true, undefined, this),
          /* @__PURE__ */ u3("button", {
            type: "button",
            class: "lre-btn small ghost",
            "aria-label": "Operators and functions",
            "aria-expanded": tools,
            onClick: () => setTools(!tools),
            children: /* @__PURE__ */ u3("span", {
              "aria-hidden": "true",
              children: "ƒx"
            }, undefined, false, undefined, this)
          }, undefined, false, undefined, this)
        ]
      }, undefined, true, undefined, this),
      /* @__PURE__ */ u3("textarea", {
        ref: input,
        class: balance.ok && props.lint.length === 0 ? "lre-input" : "lre-input invalid",
        rows: 2,
        spellcheck: false,
        "aria-label": props.label,
        value: props.value,
        onInput: (event) => props.onChange(event.currentTarget.value)
      }, undefined, false, undefined, this),
      suggestions.length > 0 ? /* @__PURE__ */ u3("div", {
        class: "lre-expr-tools",
        children: suggestions.map((id) => /* @__PURE__ */ u3("button", {
          type: "button",
          onClick: () => insert(id, word.length),
          children: id
        }, id, false, undefined, this))
      }, undefined, false, undefined, this) : null,
      tools ? /* @__PURE__ */ u3("div", {
        class: "lre-expr-tools",
        children: [...OPERATORS, ...FUNCTIONS].map((token) => /* @__PURE__ */ u3("button", {
          type: "button",
          onClick: () => insert(token),
          children: token
        }, token, false, undefined, this))
      }, undefined, false, undefined, this) : null,
      balance.message ? /* @__PURE__ */ u3("span", {
        class: "lre-small lre-neg",
        children: balance.message
      }, undefined, false, undefined, this) : null,
      props.lint.map((issue) => /* @__PURE__ */ u3("span", {
        class: issue.severity === "error" ? "lre-small lre-neg" : "lre-small lre-warn",
        children: issue.message
      }, `${issue.code}:${issue.message}`, false, undefined, this))
    ]
  }, undefined, true, undefined, this);
}

// src/frontend/build/schema-form.tsx
function lintAt(lint, path) {
  return lint.filter((issue) => issue.path === path || issue.path.startsWith(`${path}.`));
}
function refOptions(doc, collection) {
  const source = doc[collection];
  const options = Object.entries(source).map(([id, entry]) => {
    const label = isRecord(entry) ? typeof entry.name === "string" ? entry.name : typeof entry.label === "string" ? entry.label : id : id;
    const pack = collection === "kinds" && isRecord(entry) && typeof entry.pack === "string" ? `, ${entry.pack} pack` : "";
    return { value: id, label: label === id && pack === "" ? id : `${label} (${id}${pack})` };
  });
  if (collection === "relations") {
    for (const id of BUILTIN_RELATIONS)
      if (!(id in source))
        options.push({ value: id, label: `${id} (built-in)` });
  }
  return options.sort((a, b) => a.label.localeCompare(b.label));
}
function kindFields(doc, kindId) {
  const chain = [];
  for (let id = kindId;id && !chain.includes(id); id = doc.kinds[id]?.extends)
    chain.push(id);
  const out = {};
  for (const id of chain.reverse())
    Object.assign(out, doc.kinds[id]?.fields ?? {});
  return out;
}
function kindIs(doc, kindId, ancestor) {
  const seen = [];
  for (let id = kindId;id && !seen.includes(id); id = doc.kinds[id]?.extends) {
    if (id === ancestor)
      return true;
    seen.push(id);
  }
  return false;
}
function Issues(props) {
  return /* @__PURE__ */ u3(M, {
    children: props.issues.map((issue) => /* @__PURE__ */ u3("span", {
      class: issue.severity === "error" ? "lre-small lre-neg" : "lre-small lre-warn",
      children: issue.message
    }, `${issue.path}:${issue.code}`, false, undefined, this))
  }, undefined, false, undefined, this);
}
function JsonInput(props) {
  const [text, setText] = d2(() => props.value === undefined ? "" : JSON.stringify(props.value, null, 2));
  const [error, setError] = d2(null);
  A(() => {
    setText(props.value === undefined ? "" : JSON.stringify(props.value, null, 2));
    setError(null);
  }, [JSON.stringify(props.value)]);
  return /* @__PURE__ */ u3("label", {
    class: "lre-field",
    children: [
      /* @__PURE__ */ u3("span", {
        class: "label",
        children: [
          props.label,
          props.optional ? " (optional)" : ""
        ]
      }, undefined, true, undefined, this),
      /* @__PURE__ */ u3("textarea", {
        class: error ? "lre-input invalid" : "lre-input",
        rows: Math.min(8, Math.max(2, text.split(`
`).length)),
        spellcheck: false,
        value: text,
        onInput: (event) => setText(event.currentTarget.value),
        onBlur: () => {
          if (text.trim() === "") {
            setError(null);
            props.onChange(props.optional ? undefined : null);
            return;
          }
          try {
            props.onChange(JSON.parse(text));
            setError(null);
          } catch (e) {
            setError(e instanceof Error ? e.message : "Not valid JSON");
          }
        }
      }, undefined, false, undefined, this),
      props.hint ? /* @__PURE__ */ u3("span", {
        class: "lre-small lre-dim",
        children: props.hint
      }, undefined, false, undefined, this) : null,
      error ? /* @__PURE__ */ u3("span", {
        class: "lre-small lre-neg",
        children: error
      }, undefined, false, undefined, this) : null,
      /* @__PURE__ */ u3(Issues, {
        issues: props.issues
      }, undefined, false, undefined, this)
    ]
  }, undefined, true, undefined, this);
}
function NumberInput(props) {
  const [text, setText] = d2(typeof props.value === "number" ? String(props.value) : "");
  A(() => setText(typeof props.value === "number" ? String(props.value) : ""), [props.value]);
  const parsed = text.trim() === "" ? null : Number(text);
  const invalid = parsed === null && !props.optional || parsed !== null && (!Number.isFinite(parsed) || props.min !== undefined && parsed < props.min || props.max !== undefined && parsed > props.max);
  return /* @__PURE__ */ u3("label", {
    class: "lre-field",
    children: [
      /* @__PURE__ */ u3("span", {
        class: "label",
        children: [
          props.label,
          props.optional ? " (optional)" : ""
        ]
      }, undefined, true, undefined, this),
      /* @__PURE__ */ u3("input", {
        class: invalid ? "lre-input invalid" : "lre-input",
        inputMode: "decimal",
        value: text,
        onInput: (event) => setText(event.currentTarget.value),
        onBlur: () => {
          if (invalid)
            return;
          props.onChange(parsed === null ? undefined : parsed);
        }
      }, undefined, false, undefined, this),
      props.hint ? /* @__PURE__ */ u3("span", {
        class: "lre-small lre-dim",
        children: props.hint
      }, undefined, false, undefined, this) : null,
      /* @__PURE__ */ u3(Issues, {
        issues: props.issues
      }, undefined, false, undefined, this)
    ]
  }, undefined, true, undefined, this);
}
function TextInput(props) {
  const [text, setText] = d2(typeof props.value === "string" ? props.value : "");
  A(() => setText(typeof props.value === "string" ? props.value : ""), [props.value]);
  const commit = () => props.onChange(text === "" && props.optional ? undefined : text);
  return /* @__PURE__ */ u3("label", {
    class: "lre-field",
    children: [
      /* @__PURE__ */ u3("span", {
        class: "label",
        children: [
          props.label,
          props.optional ? " (optional)" : ""
        ]
      }, undefined, true, undefined, this),
      props.multiline ? /* @__PURE__ */ u3("textarea", {
        class: "lre-input",
        rows: 6,
        readOnly: props.readonly,
        value: text,
        onInput: (event) => setText(event.currentTarget.value),
        onBlur: commit
      }, undefined, false, undefined, this) : /* @__PURE__ */ u3("input", {
        class: "lre-input",
        readOnly: props.readonly,
        style: props.mono ? { fontFamily: "ui-monospace, Menlo, monospace" } : undefined,
        value: text,
        onInput: (event) => setText(event.currentTarget.value),
        onBlur: commit
      }, undefined, false, undefined, this),
      props.hint ? /* @__PURE__ */ u3("span", {
        class: "lre-small lre-dim",
        children: props.hint
      }, undefined, false, undefined, this) : null,
      /* @__PURE__ */ u3(Issues, {
        issues: props.issues
      }, undefined, false, undefined, this)
    ]
  }, undefined, true, undefined, this);
}
function SelectInput(props) {
  const current = typeof props.value === "string" ? props.value : "";
  const options = current && !props.options.some((o) => o.value === current) ? [...props.options, { value: current, label: `${current} (missing)` }] : props.options;
  return /* @__PURE__ */ u3("label", {
    class: "lre-field",
    children: [
      /* @__PURE__ */ u3("span", {
        class: "label",
        children: props.label
      }, undefined, false, undefined, this),
      /* @__PURE__ */ u3("select", {
        class: "lre-input",
        value: current,
        onChange: (event) => props.onChange(event.currentTarget.value === "" ? props.optional ? undefined : "" : event.currentTarget.value),
        children: [
          /* @__PURE__ */ u3("option", {
            value: "",
            children: props.optional ? "— none —" : "— choose —"
          }, undefined, false, undefined, this),
          options.map((o) => /* @__PURE__ */ u3("option", {
            value: o.value,
            children: o.label
          }, o.value, false, undefined, this))
        ]
      }, undefined, true, undefined, this),
      /* @__PURE__ */ u3(Issues, {
        issues: props.issues
      }, undefined, false, undefined, this)
    ]
  }, undefined, true, undefined, this);
}
function itemTitle(value, key, index) {
  if (isRecord(value) && key && typeof value[key] === "string" && value[key] !== "")
    return String(value[key]);
  if (typeof value === "string" && value !== "")
    return value;
  return `#${index + 1}`;
}
function ListInput(props) {
  const items = Array.isArray(props.value) ? props.value : [];
  const [open, setOpen] = d2(null);
  const blank = props.spec.item.kind === "object" ? {} : props.spec.item.kind === "number" ? 0 : "";
  const scalar = props.spec.item.kind !== "object";
  return /* @__PURE__ */ u3("div", {
    class: "lre-field",
    children: [
      /* @__PURE__ */ u3("span", {
        class: "label lre-spread",
        children: [
          /* @__PURE__ */ u3("span", {
            children: [
              props.spec.label,
              " ",
              /* @__PURE__ */ u3("span", {
                class: "lre-badge",
                children: items.length
              }, undefined, false, undefined, this)
            ]
          }, undefined, true, undefined, this),
          /* @__PURE__ */ u3("button", {
            type: "button",
            class: "lre-btn small",
            onClick: () => {
              props.onChange([...items, blank]);
              setOpen(items.length);
            },
            children: "+ Add"
          }, undefined, false, undefined, this)
        ]
      }, undefined, true, undefined, this),
      items.map((item, index) => /* @__PURE__ */ u3("div", {
        class: "lre-card",
        style: { padding: "6px 8px" },
        children: scalar ? /* @__PURE__ */ u3("div", {
          class: "lre-spread",
          style: { alignItems: "flex-start" },
          children: [
            /* @__PURE__ */ u3("div", {
              style: { flex: 1, minWidth: 0 },
              children: /* @__PURE__ */ u3(FieldInput, {
                spec: { ...props.spec.item, label: `${props.spec.item.label} ${index + 1}` },
                value: item,
                ctx: props.ctx,
                path: `${props.path}.${index}`,
                parent: {},
                onChange: (next) => props.onChange(items.map((entry, i) => i === index ? next ?? blank : entry))
              }, undefined, false, undefined, this)
            }, undefined, false, undefined, this),
            /* @__PURE__ */ u3("button", {
              type: "button",
              class: "lre-btn small ghost",
              "aria-label": `Remove ${props.spec.item.label} ${index + 1}`,
              onClick: () => props.onChange(items.filter((_, i) => i !== index)),
              children: "✕"
            }, undefined, false, undefined, this)
          ]
        }, undefined, true, undefined, this) : /* @__PURE__ */ u3(M, {
          children: [
            /* @__PURE__ */ u3("div", {
              class: "lre-spread",
              children: [
                /* @__PURE__ */ u3("button", {
                  type: "button",
                  class: "lre-btn small ghost",
                  "aria-expanded": open === index,
                  onClick: () => setOpen(open === index ? null : index),
                  children: [
                    /* @__PURE__ */ u3("span", {
                      "aria-hidden": "true",
                      children: open === index ? "▾" : "▸"
                    }, undefined, false, undefined, this),
                    " ",
                    itemTitle(item, props.spec.title, index)
                  ]
                }, undefined, true, undefined, this),
                /* @__PURE__ */ u3("span", {
                  class: "lre-inline",
                  children: [
                    /* @__PURE__ */ u3("button", {
                      type: "button",
                      class: "lre-btn small ghost",
                      "aria-label": `Move ${itemTitle(item, props.spec.title, index)} up`,
                      disabled: index === 0,
                      onClick: () => props.onChange(items.map((entry, i) => i === index - 1 ? item : i === index ? items[index - 1] ?? entry : entry)),
                      children: "↑"
                    }, undefined, false, undefined, this),
                    /* @__PURE__ */ u3("button", {
                      type: "button",
                      class: "lre-btn small ghost",
                      "aria-label": `Remove ${itemTitle(item, props.spec.title, index)}`,
                      onClick: () => props.onChange(items.filter((_, i) => i !== index)),
                      children: "✕"
                    }, undefined, false, undefined, this)
                  ]
                }, undefined, true, undefined, this)
              ]
            }, undefined, true, undefined, this),
            open === index ? /* @__PURE__ */ u3(FieldInput, {
              spec: props.spec.item,
              value: item,
              ctx: props.ctx,
              path: `${props.path}.${index}`,
              parent: {},
              onChange: (next) => props.onChange(items.map((entry, i) => i === index ? next ?? blank : entry))
            }, undefined, false, undefined, this) : null
          ]
        }, undefined, true, undefined, this)
      }, index, false, undefined, this))
    ]
  }, undefined, true, undefined, this);
}
function RecordInput(props) {
  const record = isRecord(props.value) ? props.value : {};
  const [open, setOpen] = d2(null);
  const [newKey, setNewKey] = d2("");
  const blank = props.spec.item.kind === "object" ? {} : props.spec.item.kind === "number" ? 0 : "";
  const available = props.spec.keys ? props.spec.keys.filter((key) => !(key in record)) : null;
  const add = (key) => {
    if (!key || key in record)
      return;
    props.onChange({ ...record, [key]: blank });
    setOpen(key);
    setNewKey("");
  };
  return /* @__PURE__ */ u3("div", {
    class: "lre-field",
    children: [
      /* @__PURE__ */ u3("span", {
        class: "label",
        children: [
          props.spec.label,
          " ",
          /* @__PURE__ */ u3("span", {
            class: "lre-badge",
            children: Object.keys(record).length
          }, undefined, false, undefined, this)
        ]
      }, undefined, true, undefined, this),
      Object.entries(record).map(([key, entry]) => /* @__PURE__ */ u3("div", {
        class: "lre-card",
        style: { padding: "6px 8px" },
        children: [
          /* @__PURE__ */ u3("div", {
            class: "lre-spread",
            children: [
              /* @__PURE__ */ u3("button", {
                type: "button",
                class: "lre-btn small ghost",
                "aria-expanded": open === key,
                onClick: () => setOpen(open === key ? null : key),
                children: [
                  /* @__PURE__ */ u3("span", {
                    "aria-hidden": "true",
                    children: open === key ? "▾" : "▸"
                  }, undefined, false, undefined, this),
                  " ",
                  /* @__PURE__ */ u3("code", {
                    children: key
                  }, undefined, false, undefined, this),
                  isRecord(entry) && typeof entry.type === "string" ? /* @__PURE__ */ u3("span", {
                    class: "lre-dim",
                    children: [
                      " · ",
                      entry.type
                    ]
                  }, undefined, true, undefined, this) : null
                ]
              }, undefined, true, undefined, this),
              /* @__PURE__ */ u3("button", {
                type: "button",
                class: "lre-btn small ghost",
                "aria-label": `Remove ${key}`,
                onClick: () => {
                  const next = { ...record };
                  delete next[key];
                  props.onChange(next);
                },
                children: "✕"
              }, undefined, false, undefined, this)
            ]
          }, undefined, true, undefined, this),
          open === key ? /* @__PURE__ */ u3(FieldInput, {
            spec: props.spec.item,
            value: entry,
            ctx: props.ctx,
            path: `${props.path}.${key}`,
            parent: {},
            onChange: (next) => props.onChange({ ...record, [key]: next ?? blank })
          }, undefined, false, undefined, this) : null
        ]
      }, key, true, undefined, this)),
      available ? available.length > 0 ? /* @__PURE__ */ u3("div", {
        class: "lre-inline",
        children: available.map((key) => /* @__PURE__ */ u3("button", {
          type: "button",
          class: "lre-btn small",
          onClick: () => add(key),
          children: [
            "+ ",
            key
          ]
        }, key, true, undefined, this))
      }, undefined, false, undefined, this) : null : /* @__PURE__ */ u3("form", {
        class: "lre-inline",
        onSubmit: (event) => {
          event.preventDefault();
          add(newKey.trim());
        },
        children: [
          /* @__PURE__ */ u3("input", {
            class: "lre-input",
            style: { flex: 1 },
            placeholder: props.spec.keyLabel,
            "aria-label": props.spec.keyLabel,
            value: newKey,
            onInput: (event) => setNewKey(event.currentTarget.value.replace(/\s+/g, "_"))
          }, undefined, false, undefined, this),
          /* @__PURE__ */ u3("button", {
            type: "submit",
            class: "lre-btn small",
            disabled: !newKey.trim() || newKey.trim() in record,
            children: "+ Add"
          }, undefined, false, undefined, this)
        ]
      }, undefined, true, undefined, this)
    ]
  }, undefined, true, undefined, this);
}
function KindFieldsInput(props) {
  const values = isRecord(props.value) ? props.value : {};
  const defs = props.kind ? kindFields(props.ctx.doc, props.kind) : {};
  const extra = Object.keys(values).filter((key) => !(key in defs));
  if (!props.kind)
    return /* @__PURE__ */ u3("span", {
      class: "lre-small lre-muted",
      children: "Choose a kind to edit its fields."
    }, undefined, false, undefined, this);
  const set = (key, next) => {
    const out = { ...values };
    if (next === undefined)
      delete out[key];
    else
      out[key] = next;
    props.onChange(out);
  };
  return /* @__PURE__ */ u3("div", {
    class: "lre-stack",
    children: [
      /* @__PURE__ */ u3("span", {
        class: "lre-small lre-muted",
        children: [
          "Fields of ",
          props.ctx.doc.kinds[props.kind]?.label ?? props.kind
        ]
      }, undefined, true, undefined, this),
      Object.entries(defs).map(([key, def]) => {
        const label = `${def.label ?? key}${def.domain ? ` · ${def.domain} ≥${def.level ?? 0}` : ""}`;
        const issues = lintAt(props.ctx.lint, `${props.path}.${key}`);
        if (def.derived)
          return /* @__PURE__ */ u3(TextInput, {
            label: `${label} (derived)`,
            value: def.derived,
            readonly: true,
            mono: true,
            issues,
            onChange: () => {}
          }, key, false, undefined, this);
        switch (def.type) {
          case "number":
          case "duration":
            return /* @__PURE__ */ u3(NumberInput, {
              label: def.type === "duration" ? `${label} (min)` : label,
              value: values[key],
              min: def.min,
              max: def.max,
              optional: true,
              issues,
              onChange: (next) => set(key, next)
            }, key, false, undefined, this);
          case "money":
            return /* @__PURE__ */ u3(NumberInput, {
              label: `${label} (cents)`,
              value: values[key],
              min: def.min,
              max: def.max,
              step: 1,
              optional: true,
              issues,
              onChange: (next) => set(key, typeof next === "number" ? Math.round(next) : next)
            }, key, false, undefined, this);
          case "bool":
            return /* @__PURE__ */ u3("label", {
              class: "lre-row",
              children: [
                /* @__PURE__ */ u3("span", {
                  class: "k",
                  children: label
                }, undefined, false, undefined, this),
                /* @__PURE__ */ u3("span", {
                  class: "lre-check",
                  children: /* @__PURE__ */ u3("input", {
                    type: "checkbox",
                    checked: values[key] === true,
                    onChange: (event) => set(key, event.currentTarget.checked)
                  }, undefined, false, undefined, this)
                }, undefined, false, undefined, this)
              ]
            }, key, true, undefined, this);
          case "enum":
            return /* @__PURE__ */ u3(SelectInput, {
              label,
              value: values[key],
              options: (def.values ?? []).map((v) => ({ value: v, label: v })),
              optional: true,
              issues,
              onChange: (next) => set(key, next)
            }, key, false, undefined, this);
          case "ref":
            return /* @__PURE__ */ u3(SelectInput, {
              label,
              value: values[key],
              options: def.ref ? refOptions(props.ctx.doc, "entities").filter((o) => kindIs(props.ctx.doc, props.ctx.doc.entities[o.value]?.kind ?? "", def.ref ?? "")) : [...refOptions(props.ctx.doc, "places"), ...refOptions(props.ctx.doc, "entities")],
              optional: true,
              issues,
              onChange: (next) => set(key, next)
            }, key, false, undefined, this);
          case "list":
            return /* @__PURE__ */ u3(JsonInput, {
              label: `${label} (list)`,
              value: values[key],
              optional: true,
              issues,
              onChange: (next) => set(key, next)
            }, key, false, undefined, this);
          default:
            return /* @__PURE__ */ u3(TextInput, {
              label,
              value: values[key],
              optional: true,
              mono: def.type === "dice",
              issues,
              onChange: (next) => set(key, next)
            }, key, false, undefined, this);
        }
      }),
      extra.length > 0 ? /* @__PURE__ */ u3(JsonInput, {
        label: `Other values (${extra.join(", ")})`,
        value: Object.fromEntries(extra.map((key) => [key, values[key] ?? null])),
        issues: [],
        onChange: (next) => props.onChange({ ...Object.fromEntries(Object.entries(values).filter(([key]) => (key in defs))), ...isRecord(next) ? next : {} })
      }, undefined, false, undefined, this) : null
    ]
  }, undefined, true, undefined, this);
}
function LevelsInput(props) {
  const values = isRecord(props.value) ? props.value : {};
  return /* @__PURE__ */ u3("div", {
    class: "lre-field",
    children: [
      /* @__PURE__ */ u3("span", {
        class: "label",
        children: props.label
      }, undefined, false, undefined, this),
      /* @__PURE__ */ u3("div", {
        class: "lre-tier-grid",
        style: { gridTemplateColumns: "minmax(90px,1fr) minmax(64px,90px)" },
        children: DOMAINS.map((domain) => /* @__PURE__ */ u3(M, {
          children: [
            /* @__PURE__ */ u3("span", {
              children: domain
            }, `${domain}:l`, false, undefined, this),
            /* @__PURE__ */ u3("select", {
              class: "lre-input",
              "aria-label": `${domain} level`,
              value: typeof values[domain] === "number" ? String(values[domain]) : "",
              onChange: (event) => {
                const out = { ...values };
                if (event.currentTarget.value === "")
                  delete out[domain];
                else
                  out[domain] = Number(event.currentTarget.value);
                props.onChange(Object.keys(out).length > 0 ? out : undefined);
              },
              children: [
                /* @__PURE__ */ u3("option", {
                  value: "",
                  children: "—"
                }, undefined, false, undefined, this),
                [0, 1, 2, 3, 4].map((level) => /* @__PURE__ */ u3("option", {
                  value: String(level),
                  children: level
                }, level, false, undefined, this))
              ]
            }, `${domain}:s`, true, undefined, this)
          ]
        }, undefined, true, undefined, this))
      }, undefined, false, undefined, this)
    ]
  }, undefined, true, undefined, this);
}
function FieldInput(props) {
  const { spec, ctx } = props;
  const path = spec.key ? `${props.path}.${spec.key}` : props.path;
  const issues = lintAt(ctx.lint, path);
  switch (spec.kind) {
    case "text":
      return /* @__PURE__ */ u3(TextInput, {
        label: spec.label,
        value: props.value,
        multiline: spec.multiline,
        optional: spec.optional,
        readonly: spec.readonly,
        hint: spec.hint,
        issues,
        onChange: props.onChange
      }, undefined, false, undefined, this);
    case "dice":
      return /* @__PURE__ */ u3(TextInput, {
        label: spec.label,
        value: props.value,
        optional: spec.optional,
        hint: "Dice notation, e.g. 2d6+1",
        mono: true,
        issues,
        onChange: props.onChange
      }, undefined, false, undefined, this);
    case "number":
      return /* @__PURE__ */ u3(NumberInput, {
        label: spec.label,
        value: props.value,
        min: spec.min,
        max: spec.max,
        step: spec.step,
        optional: spec.optional,
        hint: spec.hint,
        issues,
        onChange: props.onChange
      }, undefined, false, undefined, this);
    case "bool":
      return /* @__PURE__ */ u3("label", {
        class: "lre-row",
        children: [
          /* @__PURE__ */ u3("span", {
            class: "k",
            children: [
              spec.label,
              spec.hint ? /* @__PURE__ */ u3("span", {
                class: "sub",
                children: spec.hint
              }, undefined, false, undefined, this) : null
            ]
          }, undefined, true, undefined, this),
          /* @__PURE__ */ u3("span", {
            class: "lre-check",
            children: /* @__PURE__ */ u3("input", {
              type: "checkbox",
              checked: props.value === true,
              onChange: (event) => props.onChange(event.currentTarget.checked)
            }, undefined, false, undefined, this)
          }, undefined, false, undefined, this)
        ]
      }, undefined, true, undefined, this);
    case "enum":
      return /* @__PURE__ */ u3(SelectInput, {
        label: spec.label,
        value: props.value,
        options: spec.values.map((v) => ({ value: v, label: v })),
        optional: spec.optional,
        issues,
        onChange: props.onChange
      }, undefined, false, undefined, this);
    case "ref":
      if (spec.inline && isRecord(props.value))
        return /* @__PURE__ */ u3(JsonInput, {
          label: `${spec.label} (inline)`,
          value: props.value,
          optional: spec.optional,
          issues,
          onChange: props.onChange
        }, undefined, false, undefined, this);
      return /* @__PURE__ */ u3(SelectInput, {
        label: spec.label,
        value: props.value,
        options: spec.any ? [{ value: "*", label: "* (any kind)" }, ...refOptions(ctx.doc, spec.collection)] : refOptions(ctx.doc, spec.collection),
        optional: spec.optional,
        issues,
        onChange: props.onChange
      }, undefined, false, undefined, this);
    case "expr":
      return /* @__PURE__ */ u3(ExprEditor, {
        label: spec.label,
        value: typeof props.value === "string" ? props.value : "",
        identifiers: ctx.identifiers,
        lint: issues,
        optional: spec.optional,
        onChange: (next) => props.onChange(next === "" && spec.optional ? undefined : next)
      }, undefined, false, undefined, this);
    case "tags": {
      const tags = Array.isArray(props.value) ? props.value.filter((t) => typeof t === "string") : [];
      return /* @__PURE__ */ u3(TextInput, {
        label: `${spec.label} (comma separated)`,
        value: tags.join(", "),
        optional: true,
        issues,
        onChange: (next) => {
          const list = typeof next === "string" ? next.split(",").map((t) => t.trim()).filter((t) => t.length > 0) : [];
          props.onChange(list.length > 0 ? list : undefined);
        }
      }, undefined, false, undefined, this);
    }
    case "refs": {
      const ids = Array.isArray(props.value) ? props.value.filter((v) => typeof v === "string") : [];
      const options = spec.collections.flatMap((collection) => refOptions(ctx.doc, collection));
      const name = (id) => options.find((o) => o.value === id)?.label ?? id;
      return /* @__PURE__ */ u3("div", {
        class: "lre-field",
        children: [
          /* @__PURE__ */ u3("span", {
            class: "label",
            children: spec.label
          }, undefined, false, undefined, this),
          ids.length > 0 ? /* @__PURE__ */ u3("div", {
            class: "lre-inline",
            style: { flexWrap: "wrap" },
            children: ids.map((id) => /* @__PURE__ */ u3("button", {
              type: "button",
              class: "lre-btn small",
              "aria-label": `Remove ${name(id)}`,
              onClick: () => props.onChange(ids.filter((other) => other !== id)),
              children: [
                name(id),
                " ✕"
              ]
            }, id, true, undefined, this))
          }, undefined, false, undefined, this) : null,
          /* @__PURE__ */ u3("select", {
            class: "lre-input",
            value: "",
            "aria-label": `Add to ${spec.label}`,
            onChange: (event) => event.currentTarget.value ? props.onChange([...ids, event.currentTarget.value]) : undefined,
            children: [
              /* @__PURE__ */ u3("option", {
                value: "",
                children: "+ Add…"
              }, undefined, false, undefined, this),
              options.filter((o) => !ids.includes(o.value)).map((o) => /* @__PURE__ */ u3("option", {
                value: o.value,
                children: o.label
              }, o.value, false, undefined, this))
            ]
          }, undefined, true, undefined, this)
        ]
      }, undefined, true, undefined, this);
    }
    case "json":
      return /* @__PURE__ */ u3(JsonInput, {
        label: spec.label,
        value: props.value,
        optional: spec.optional,
        hint: spec.hint,
        issues,
        onChange: props.onChange
      }, undefined, false, undefined, this);
    case "list":
      return /* @__PURE__ */ u3(ListInput, {
        spec,
        value: props.value,
        ctx,
        path,
        onChange: props.onChange
      }, undefined, false, undefined, this);
    case "record":
      return /* @__PURE__ */ u3(RecordInput, {
        spec,
        value: props.value,
        ctx,
        path,
        onChange: props.onChange
      }, undefined, false, undefined, this);
    case "kindFields":
      return /* @__PURE__ */ u3(KindFieldsInput, {
        value: props.value,
        kind: typeof props.parent.kind === "string" ? props.parent.kind : "",
        ctx,
        path,
        onChange: props.onChange
      }, undefined, false, undefined, this);
    case "levels":
      return /* @__PURE__ */ u3(LevelsInput, {
        label: spec.label,
        value: props.value,
        onChange: props.onChange
      }, undefined, false, undefined, this);
    case "object": {
      if (spec.optional && !isRecord(props.value)) {
        return /* @__PURE__ */ u3("div", {
          class: "lre-spread",
          children: [
            /* @__PURE__ */ u3("span", {
              class: "lre-muted",
              children: spec.label
            }, undefined, false, undefined, this),
            /* @__PURE__ */ u3("button", {
              type: "button",
              class: "lre-btn small",
              onClick: () => props.onChange({}),
              children: "+ Add"
            }, undefined, false, undefined, this)
          ]
        }, undefined, true, undefined, this);
      }
      const value = isRecord(props.value) ? props.value : {};
      return /* @__PURE__ */ u3("div", {
        class: "lre-stack",
        children: [
          spec.key ? /* @__PURE__ */ u3("div", {
            class: "lre-spread",
            children: [
              /* @__PURE__ */ u3("span", {
                class: "lre-small lre-muted",
                children: spec.label
              }, undefined, false, undefined, this),
              spec.optional ? /* @__PURE__ */ u3("button", {
                type: "button",
                class: "lre-btn small ghost",
                onClick: () => props.onChange(undefined),
                children: "Remove"
              }, undefined, false, undefined, this) : null
            ]
          }, undefined, true, undefined, this) : null,
          /* @__PURE__ */ u3(SchemaFields, {
            specs: spec.fields,
            value,
            ctx: { ...ctx, path },
            onChange: props.onChange
          }, undefined, false, undefined, this)
        ]
      }, undefined, true, undefined, this);
    }
  }
}
function SchemaFields(props) {
  return /* @__PURE__ */ u3("div", {
    class: "lre-stack",
    children: props.specs.map((spec) => /* @__PURE__ */ u3(FieldInput, {
      spec,
      value: props.value[spec.key],
      ctx: props.ctx,
      path: props.ctx.path,
      parent: props.value,
      onChange: (next) => {
        const out = { ...props.value };
        if (next === undefined)
          delete out[spec.key];
        else
          out[spec.key] = next;
        props.onChange(out);
      }
    }, spec.key, false, undefined, this))
  }, undefined, false, undefined, this);
}
function worldIdentifiers(doc) {
  const out = new Set([...Object.keys(doc.entities), ...Object.keys(doc.places), ...Object.keys(doc.tracks), ...Object.keys(doc.checks), "pov", "scene", "now"]);
  for (const kind of Object.values(doc.kinds))
    for (const field of Object.keys(kind.fields))
      out.add(field);
  return [...out].sort();
}

// src/frontend/build/table-editor.tsx
var PAGE = 40;
function cellProblem(column, value) {
  if (value === undefined || value === null)
    return column.optional ? null : "Required";
  switch (column.type) {
    case "int":
      return typeof value === "number" && Number.isInteger(value) ? null : "Whole number";
    case "number":
      return typeof value === "number" && Number.isFinite(value) ? null : "Number";
    case "text":
      return typeof value === "string" ? null : "Text";
    case "bool":
      return typeof value === "boolean" ? null : "Yes or no";
    case "enum":
      return typeof value === "string" && (column.values ?? []).includes(value) ? null : `One of ${(column.values ?? []).join(", ")}`;
    case "ref":
      return typeof value === "string" ? null : "Row id";
    case "band":
      if (!isRecord(value) || typeof value.min !== "number" || typeof value.typical !== "number" || typeof value.max !== "number")
        return "min, typical and max";
      return value.min <= value.typical && value.typical <= value.max ? null : "min ≤ typical ≤ max";
    case "list":
      return Array.isArray(value) ? null : "List";
    case "json":
      return null;
  }
}
function CellInput(props) {
  const { column } = props;
  const label = `${props.name}${column.unit ? ` (${column.unit})` : ""}${column.optional ? " (optional)" : ""}`;
  const problem = cellProblem(column, props.value);
  const numberText = (v) => typeof v === "number" ? String(v) : "";
  const toNumber = (text) => text.trim() === "" ? undefined : Number.isFinite(Number(text)) ? column.type === "int" ? Math.round(Number(text)) : Number(text) : undefined;
  let input;
  switch (column.type) {
    case "int":
    case "number":
      input = /* @__PURE__ */ u3("input", {
        class: "lre-input",
        inputMode: "decimal",
        value: numberText(props.value),
        onChange: (event) => props.onChange(toNumber(event.currentTarget.value))
      }, undefined, false, undefined, this);
      break;
    case "bool":
      input = /* @__PURE__ */ u3("span", {
        class: "lre-check",
        children: /* @__PURE__ */ u3("input", {
          type: "checkbox",
          checked: props.value === true,
          onChange: (event) => props.onChange(event.currentTarget.checked)
        }, undefined, false, undefined, this)
      }, undefined, false, undefined, this);
      break;
    case "enum":
    case "ref": {
      const options = column.type === "enum" ? column.values ?? [] : props.refRows;
      input = /* @__PURE__ */ u3("select", {
        class: "lre-input",
        value: typeof props.value === "string" ? props.value : "",
        onChange: (event) => props.onChange(event.currentTarget.value || undefined),
        children: [
          /* @__PURE__ */ u3("option", {
            value: "",
            children: "—"
          }, undefined, false, undefined, this),
          options.map((o) => /* @__PURE__ */ u3("option", {
            value: o,
            children: o
          }, o, false, undefined, this))
        ]
      }, undefined, true, undefined, this);
      break;
    }
    case "band": {
      const band = isRecord(props.value) ? props.value : {};
      const part = (key) => /* @__PURE__ */ u3("input", {
        class: "lre-input",
        inputMode: "decimal",
        "aria-label": `${props.name} ${key}`,
        placeholder: key,
        value: typeof band[key] === "number" ? String(band[key]) : "",
        onChange: (event) => {
          const n = Number(event.currentTarget.value);
          props.onChange({ min: typeof band.min === "number" ? band.min : 0, typical: typeof band.typical === "number" ? band.typical : 0, max: typeof band.max === "number" ? band.max : 0, [key]: Number.isFinite(n) ? n : 0 });
        }
      }, undefined, false, undefined, this);
      input = /* @__PURE__ */ u3("div", {
        class: "lre-inline",
        style: { flexWrap: "nowrap" },
        children: [
          part("min"),
          part("typical"),
          part("max")
        ]
      }, undefined, true, undefined, this);
      break;
    }
    case "list":
      input = /* @__PURE__ */ u3("input", {
        class: "lre-input",
        value: Array.isArray(props.value) ? props.value.join(", ") : "",
        onChange: (event) => {
          const parts = event.currentTarget.value.split(",").map((p) => p.trim()).filter((p) => p.length > 0);
          const numeric = column.of === "int" || column.of === "number";
          props.onChange(parts.length === 0 ? column.optional ? undefined : [] : parts.map((p) => numeric && Number.isFinite(Number(p)) ? Number(p) : p));
        }
      }, undefined, false, undefined, this);
      break;
    case "json":
      input = /* @__PURE__ */ u3("textarea", {
        class: "lre-input",
        rows: 3,
        value: props.value === undefined ? "" : JSON.stringify(props.value),
        onChange: (event) => {
          try {
            props.onChange(event.currentTarget.value.trim() === "" ? undefined : JSON.parse(event.currentTarget.value));
          } catch {}
        }
      }, undefined, false, undefined, this);
      break;
    default:
      input = /* @__PURE__ */ u3("input", {
        class: "lre-input",
        value: typeof props.value === "string" ? props.value : "",
        onChange: (event) => props.onChange(event.currentTarget.value === "" && column.optional ? undefined : event.currentTarget.value)
      }, undefined, false, undefined, this);
  }
  return /* @__PURE__ */ u3("label", {
    class: "lre-field",
    children: [
      /* @__PURE__ */ u3("span", {
        class: "label",
        children: label
      }, undefined, false, undefined, this),
      input,
      column.doc ? /* @__PURE__ */ u3("span", {
        class: "lre-small lre-dim",
        children: column.doc
      }, undefined, false, undefined, this) : null,
      problem ? /* @__PURE__ */ u3("span", {
        class: "lre-small lre-neg",
        children: problem
      }, undefined, false, undefined, this) : null
    ]
  }, undefined, true, undefined, this);
}
function TableList(props) {
  const app = useApp();
  const tables = Object.values(props.world.tables);
  if (tables.length === 0)
    return /* @__PURE__ */ u3(Empty, {
      children: "No data tables. Packs copy theirs in when a world is created."
    }, undefined, false, undefined, this);
  return /* @__PURE__ */ u3("div", {
    class: "lre-list",
    children: tables.map((t) => /* @__PURE__ */ u3("button", {
      type: "button",
      class: "lre-item",
      onClick: () => app.ui.update((ui) => ({ ...ui, build: { view: "item", worldId: props.world.id, collection: "tables", id: t.id } })),
      children: [
        /* @__PURE__ */ u3("span", {
          class: "grow",
          children: [
            /* @__PURE__ */ u3("span", {
              class: "title",
              children: t.label
            }, undefined, false, undefined, this),
            /* @__PURE__ */ u3("span", {
              class: "sub",
              children: [
                t.pack,
                " · ",
                Object.keys(t.rows).length,
                " rows · ",
                t.source?.approximate ? "approximate" : "authored"
              ]
            }, undefined, true, undefined, this)
          ]
        }, undefined, true, undefined, this),
        /* @__PURE__ */ u3("code", {
          class: "lre-small lre-dim",
          children: t.revision.slice(0, 6)
        }, undefined, false, undefined, this)
      ]
    }, t.id, true, undefined, this))
  }, undefined, false, undefined, this);
}
function TableEditor(props) {
  const app = useApp();
  const id = props.id?.startsWith("new:") ? props.id.slice(4) : props.id;
  const stored = id ? props.world.tables[id] : undefined;
  const [table, setTable] = d2(stored ? structuredClone(stored) : null);
  const [rowId, setRowId] = d2(null);
  const [query, setQuery] = d2("");
  const [page, setPage] = d2(0);
  const [newRow, setNewRow] = d2("");
  const [busy, run] = useBusy();
  A(() => setTable(stored ? structuredClone(stored) : null), [stored?.revision, id]);
  if (!id)
    return /* @__PURE__ */ u3(TableList, {
      ...props
    }, undefined, false, undefined, this);
  if (!table)
    return /* @__PURE__ */ u3(Empty, {
      children: "New tables come from packs; edit an existing table's copy instead."
    }, undefined, false, undefined, this);
  const columns = Object.entries(table.columns);
  const q = query.trim().toLowerCase();
  const rows = Object.entries(table.rows).filter(([rid, r]) => !q || rid.toLowerCase().includes(q) || Object.values(r).some((v) => typeof v === "string" && v.toLowerCase().includes(q)));
  const pageRows = rows.slice(page * PAGE, page * PAGE + PAGE);
  const changed = JSON.stringify(table) !== JSON.stringify(stored);
  const problems = Object.values(table.rows).reduce((n, r) => n + columns.filter(([name, c]) => cellProblem(c, r[name]) !== null).length, 0);
  const setRow = (rid, next) => setTable({ ...table, rows: { ...table.rows, [rid]: next } });
  const editing = rowId ? table.rows[rowId] : undefined;
  return /* @__PURE__ */ u3("div", {
    class: "lre-stack",
    "data-lre-editor": "tables",
    children: [
      /* @__PURE__ */ u3(Card, {
        title: table.label,
        aside: /* @__PURE__ */ u3("span", {
          class: "lre-badge",
          children: table.pack
        }, undefined, false, undefined, this),
        children: [
          /* @__PURE__ */ u3(Row, {
            k: "Schema",
            v: /* @__PURE__ */ u3("code", {
              children: table.schema
            }, undefined, false, undefined, this)
          }, undefined, false, undefined, this),
          /* @__PURE__ */ u3(Row, {
            k: "Revision",
            v: /* @__PURE__ */ u3("code", {
              children: table.revision.slice(0, 12)
            }, undefined, false, undefined, this),
            sub: changed ? "A new revision is computed when you save" : undefined
          }, undefined, false, undefined, this),
          table.source ? /* @__PURE__ */ u3(Row, {
            k: "Source",
            v: table.source.dataPack,
            sub: `${table.source.file} · ${table.source.reflectsPeriod}${table.source.approximate ? " · approximate" : ""}`
          }, undefined, false, undefined, this) : null
        ]
      }, undefined, true, undefined, this),
      editing && rowId ? /* @__PURE__ */ u3(Card, {
        title: /* @__PURE__ */ u3("code", {
          children: rowId
        }, undefined, false, undefined, this),
        aside: /* @__PURE__ */ u3("button", {
          type: "button",
          class: "lre-btn small",
          onClick: () => setRowId(null),
          children: "Done"
        }, undefined, false, undefined, this),
        children: /* @__PURE__ */ u3("div", {
          class: "lre-stack",
          children: [
            columns.map(([name, column]) => /* @__PURE__ */ u3(CellInput, {
              name,
              column,
              value: editing[name],
              refRows: column.ref ? Object.keys(props.world.tables[column.ref]?.rows ?? {}) : [],
              onChange: (value) => {
                const next = { ...editing };
                if (value === undefined)
                  delete next[name];
                else
                  next[name] = value;
                setRow(rowId, next);
              }
            }, name, false, undefined, this)),
            /* @__PURE__ */ u3("button", {
              type: "button",
              class: "lre-btn danger",
              onClick: () => {
                const next = { ...table.rows };
                delete next[rowId];
                setTable({ ...table, rows: next });
                setRowId(null);
              },
              children: "Delete row"
            }, undefined, false, undefined, this)
          ]
        }, undefined, true, undefined, this)
      }, undefined, false, undefined, this) : /* @__PURE__ */ u3(Card, {
        title: "Rows",
        aside: /* @__PURE__ */ u3("span", {
          class: "lre-badge",
          children: rows.length
        }, undefined, false, undefined, this),
        children: [
          /* @__PURE__ */ u3("input", {
            class: "lre-input",
            placeholder: "Search rows",
            "aria-label": "Search rows",
            value: query,
            onInput: (event) => {
              setQuery(event.currentTarget.value);
              setPage(0);
            }
          }, undefined, false, undefined, this),
          /* @__PURE__ */ u3("div", {
            class: "lre-list",
            style: { marginTop: "8px" },
            children: pageRows.map(([rid, r]) => {
              const bad = columns.filter(([name, c]) => cellProblem(c, r[name]) !== null).length;
              const label = typeof r.label === "string" ? r.label : typeof r.name === "string" ? r.name : rid;
              return /* @__PURE__ */ u3("button", {
                type: "button",
                class: "lre-item",
                onClick: () => setRowId(rid),
                children: [
                  /* @__PURE__ */ u3("span", {
                    class: "grow",
                    children: [
                      /* @__PURE__ */ u3("span", {
                        class: "title",
                        children: label
                      }, undefined, false, undefined, this),
                      /* @__PURE__ */ u3("span", {
                        class: "sub",
                        children: /* @__PURE__ */ u3("code", {
                          children: rid
                        }, undefined, false, undefined, this)
                      }, undefined, false, undefined, this)
                    ]
                  }, undefined, true, undefined, this),
                  bad > 0 ? /* @__PURE__ */ u3("span", {
                    class: "lre-badge neg",
                    children: bad
                  }, undefined, false, undefined, this) : null
                ]
              }, rid, true, undefined, this);
            })
          }, undefined, false, undefined, this),
          rows.length > PAGE ? /* @__PURE__ */ u3("div", {
            class: "lre-spread",
            style: { marginTop: "8px" },
            children: [
              /* @__PURE__ */ u3("button", {
                type: "button",
                class: "lre-btn small",
                disabled: page === 0,
                onClick: () => setPage(page - 1),
                children: [
                  /* @__PURE__ */ u3("span", {
                    "aria-hidden": "true",
                    children: "‹"
                  }, undefined, false, undefined, this),
                  " Prev"
                ]
              }, undefined, true, undefined, this),
              /* @__PURE__ */ u3("span", {
                class: "lre-small lre-muted",
                children: [
                  page * PAGE + 1,
                  "–",
                  Math.min(rows.length, page * PAGE + PAGE),
                  " of ",
                  rows.length
                ]
              }, undefined, true, undefined, this),
              /* @__PURE__ */ u3("button", {
                type: "button",
                class: "lre-btn small",
                disabled: (page + 1) * PAGE >= rows.length,
                onClick: () => setPage(page + 1),
                children: [
                  "Next ",
                  /* @__PURE__ */ u3("span", {
                    "aria-hidden": "true",
                    children: "›"
                  }, undefined, false, undefined, this)
                ]
              }, undefined, true, undefined, this)
            ]
          }, undefined, true, undefined, this) : null,
          /* @__PURE__ */ u3("form", {
            class: "lre-inline",
            style: { marginTop: "8px" },
            onSubmit: (event) => {
              event.preventDefault();
              const rid = newRow.trim();
              if (!rid || rid in table.rows)
                return;
              setRow(rid, {});
              setRowId(rid);
              setNewRow("");
            },
            children: [
              /* @__PURE__ */ u3("input", {
                class: "lre-input",
                style: { flex: 1 },
                placeholder: "New row id",
                "aria-label": "New row id",
                value: newRow,
                onInput: (event) => setNewRow(event.currentTarget.value.replace(/\s+/g, "_"))
              }, undefined, false, undefined, this),
              /* @__PURE__ */ u3("button", {
                type: "submit",
                class: "lre-btn small",
                disabled: !newRow.trim() || newRow.trim() in table.rows,
                children: "+ Row"
              }, undefined, false, undefined, this)
            ]
          }, undefined, true, undefined, this)
        ]
      }, undefined, true, undefined, this),
      /* @__PURE__ */ u3("div", {
        class: "lre-inline",
        children: [
          /* @__PURE__ */ u3("button", {
            type: "button",
            class: "lre-btn primary",
            disabled: !changed || busy,
            title: problems > 0 ? `${problems} cell(s) break the column contract` : undefined,
            "aria-label": problems > 0 ? `Save table, ${problems} cell(s) break the column contract` : undefined,
            onClick: () => run(async () => {
              const message = await props.send({ type: "lre.editor", worldId: props.world.id, base: null, op: "put", collection: "tables", id, value: table });
              if (message.type === "lre.result")
                app.toast("Table saved to the draft.", "info");
            }),
            children: [
              "Save table",
              problems > 0 ? ` (${problems}⚠)` : ""
            ]
          }, undefined, true, undefined, this),
          /* @__PURE__ */ u3("button", {
            type: "button",
            class: "lre-btn ghost",
            disabled: !changed || busy,
            onClick: () => setTable(stored ? structuredClone(stored) : null),
            children: "Revert"
          }, undefined, false, undefined, this)
        ]
      }, undefined, true, undefined, this)
    ]
  }, undefined, true, undefined, this);
}

// src/frontend/build/build.tsx
var COLLECTIONS2 = [
  { id: "entities", label: "Entities", hint: "People, things, vehicles" },
  { id: "places", label: "Places", hint: "Where things happen" },
  { id: "routes", label: "Routes", hint: "Travel between places" },
  { id: "grids", label: "Grids", hint: "Maps inside places" },
  { id: "kinds", label: "Kinds", hint: "Types and their fields" },
  { id: "relations", label: "Relations", hint: "How entities connect" },
  { id: "actions", label: "Actions", hint: "What the player can do" },
  { id: "checks", label: "Checks", hint: "Dice and outcome bands" },
  { id: "rules", label: "Rules", hint: "When this, do that" },
  { id: "schedules", label: "Schedules", hint: "Routines, shifts, weather" },
  { id: "tracks", label: "Tracks", hint: "Quests, secrets, puzzles, agendas" },
  { id: "lore", label: "Lore", hint: "What the world knows; synced to the engine's book" },
  { id: "tables", label: "Data tables", hint: "Prices, jobs, regions…" },
  { id: "sections", label: "Sections", hint: "What the narrator reads" },
  { id: "steps", label: "Step templates", hint: "Prompted model steps" },
  { id: "packs", label: "Packs", hint: "Enabled domain packs" }
];
var PARTS = [
  { id: "meta", label: "World" },
  { id: "calendar", label: "Calendar" },
  { id: "realism", label: "Realism defaults" },
  { id: "time", label: "Time defaults" }
];
var TEMPLATES = [
  { id: null, label: "Blank" },
  { id: "fantasy_town", label: "Fantasy town" },
  { id: "mystery_manor", label: "Mystery manor" },
  { id: "modern_slice_of_life", label: "Modern slice-of-life (Simulation)" }
];
function go(app, build) {
  app.ui.update((ui) => ({ ...ui, build }));
}
function Build() {
  const route = useUi((ui) => ui.build);
  switch (route.view) {
    case "worlds":
      return /* @__PURE__ */ u3(Worlds, {}, undefined, false, undefined, this);
    case "check":
      return /* @__PURE__ */ u3(WithDraft, {
        worldId: route.worldId,
        children: /* @__PURE__ */ u3(CheckView, {
          worldId: route.worldId
        }, undefined, false, undefined, this)
      }, undefined, false, undefined, this);
    case "job":
      return /* @__PURE__ */ u3(WithDraft, {
        worldId: route.worldId,
        children: /* @__PURE__ */ u3(JobView, {
          worldId: route.worldId,
          kind: route.kind
        }, undefined, false, undefined, this)
      }, undefined, false, undefined, this);
    case "world":
      return /* @__PURE__ */ u3(WithDraft, {
        worldId: route.worldId,
        children: /* @__PURE__ */ u3(WorldOverview, {}, undefined, false, undefined, this)
      }, undefined, false, undefined, this);
    case "collection":
      return /* @__PURE__ */ u3(WithDraft, {
        worldId: route.worldId,
        children: /* @__PURE__ */ u3(CollectionView, {
          collection: route.collection
        }, undefined, false, undefined, this)
      }, undefined, false, undefined, this);
    case "item":
      return /* @__PURE__ */ u3(WithDraft, {
        worldId: route.worldId,
        children: /* @__PURE__ */ u3(ItemView, {
          collection: route.collection,
          id: route.id
        }, undefined, false, undefined, this)
      }, undefined, false, undefined, this);
    case "part":
      return /* @__PURE__ */ u3(WithDraft, {
        worldId: route.worldId,
        children: /* @__PURE__ */ u3(PartView, {
          part: route.part
        }, undefined, false, undefined, this)
      }, undefined, false, undefined, this);
  }
}
function WithDraft(props) {
  const app = useApp();
  const draft = useSelect(app.drafts, (d) => d);
  const route = useUi((ui) => ui.build);
  const [failed, setFailed] = d2(false);
  const [busy, run] = useBusy();
  A(() => {
    if (draft?.worldId === props.worldId)
      return;
    loadDraft(app, props.worldId).then((loaded) => setFailed(loaded === null));
  }, [props.worldId]);
  if (!draft || draft.worldId !== props.worldId)
    return failed ? /* @__PURE__ */ u3(Empty, {
      children: "This world could not be loaded."
    }, undefined, false, undefined, this) : /* @__PURE__ */ u3(Empty, {
      children: "Loading the world…"
    }, undefined, false, undefined, this);
  const errors = draft.lint.filter((issue) => issue.severity === "error").length;
  const back = route.view === "world" ? { view: "worlds" } : route.view === "item" ? { view: "collection", worldId: props.worldId, collection: route.collection } : { view: "world", worldId: props.worldId };
  return /* @__PURE__ */ u3("div", {
    class: "lre-stack",
    "data-lre-section": "build",
    children: [
      /* @__PURE__ */ u3("div", {
        class: "lre-spread",
        children: [
          /* @__PURE__ */ u3("button", {
            type: "button",
            class: "lre-btn small",
            onClick: () => go(app, back),
            children: [
              /* @__PURE__ */ u3("span", {
                "aria-hidden": "true",
                children: "‹"
              }, undefined, false, undefined, this),
              " Back"
            ]
          }, undefined, true, undefined, this),
          /* @__PURE__ */ u3("span", {
            class: "lre-small lre-muted",
            style: { minWidth: 0, overflowWrap: "anywhere" },
            children: [
              draft.doc.name,
              draft.dirty ? " · unsaved draft" : ""
            ]
          }, undefined, true, undefined, this),
          draft.dirty ? /* @__PURE__ */ u3("button", {
            type: "button",
            class: "lre-btn small ghost",
            disabled: busy,
            onClick: () => run(async () => {
              await discardDraft(app);
            }),
            children: "Discard"
          }, undefined, false, undefined, this) : null,
          /* @__PURE__ */ u3("button", {
            type: "button",
            class: draft.dirty ? "lre-btn small primary" : "lre-btn small",
            disabled: !draft.dirty || busy,
            title: errors > 0 ? `${errors} error(s) block the commit` : undefined,
            "aria-label": errors > 0 ? `Commit, ${errors} error(s) block the commit` : undefined,
            onClick: () => run(async () => {
              await commitDraft(app);
            }),
            children: [
              "Commit",
              errors > 0 ? ` (${errors}⚠)` : ""
            ]
          }, undefined, true, undefined, this)
        ]
      }, undefined, true, undefined, this),
      props.children
    ]
  }, undefined, true, undefined, this);
}
function Worlds() {
  const app = useApp();
  const view = useView();
  const [worlds, setWorlds] = d2(null);
  const [name, setName] = d2("");
  const [template, setTemplate] = d2(null);
  const [busy, run] = useBusy();
  const fileInput = T2(null);
  const [review, setReview] = d2(null);
  const refresh = () => void app.request({ type: "lre.world", op: "list" }).then((result) => setWorlds(result?.worlds ?? []));
  A(refresh, []);
  const importFile = (file) => run(async () => {
    let parsed;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      app.toast("That file isn't JSON.", "error");
      return;
    }
    const result = await app.request({ type: "lre.world", op: "import", file: parsed });
    if (result) {
      const issues = result.lint ?? [];
      app.toast(issues.length > 0 ? `Imported “${result.world?.name ?? "world"}”. Review ${issues.length} item(s) below before playing.` : `Imported “${result.world?.name ?? "world"}”.`, "info");
      setReview(result.world && issues.length > 0 ? { worldId: result.world.id, name: result.world.name, issues } : null);
      refresh();
    }
  });
  return /* @__PURE__ */ u3("div", {
    class: "lre-stack",
    "data-lre-section": "build",
    children: [
      review ? /* @__PURE__ */ u3(Card, {
        title: "Review before playing",
        aside: /* @__PURE__ */ u3("span", {
          class: "lre-badge warn",
          children: review.issues.length
        }, undefined, false, undefined, this),
        children: [
          /* @__PURE__ */ u3("div", {
            class: "lre-banner warn",
            children: [
              "“",
              review.name,
              "” came from a file. Its lore and templates contain macros that Lumiverse runs when it builds a prompt; open each one and check it before you play."
            ]
          }, undefined, true, undefined, this),
          /* @__PURE__ */ u3("div", {
            class: "lre-list",
            "data-lre-import-review": true,
            children: review.issues.map((issue, i) => {
              const target = issueTarget(issue.path);
              return /* @__PURE__ */ u3("div", {
                class: "lre-item",
                style: { flexWrap: "wrap" },
                children: [
                  /* @__PURE__ */ u3("span", {
                    class: "grow",
                    style: { flexBasis: "180px", minWidth: 0 },
                    children: [
                      /* @__PURE__ */ u3("span", {
                        class: "title",
                        style: { overflowWrap: "anywhere" },
                        children: issue.message
                      }, undefined, false, undefined, this),
                      /* @__PURE__ */ u3("span", {
                        class: "sub",
                        children: issue.path
                      }, undefined, false, undefined, this)
                    ]
                  }, undefined, true, undefined, this),
                  target ? /* @__PURE__ */ u3("button", {
                    type: "button",
                    class: "lre-btn small",
                    onClick: () => go(app, { view: "item", worldId: review.worldId, collection: target.collection, id: target.id }),
                    children: "Open"
                  }, undefined, false, undefined, this) : null
                ]
              }, i, true, undefined, this);
            })
          }, undefined, false, undefined, this),
          /* @__PURE__ */ u3("button", {
            type: "button",
            class: "lre-btn small ghost",
            onClick: () => setReview(null),
            children: "Done reviewing"
          }, undefined, false, undefined, this)
        ]
      }, undefined, true, undefined, this) : null,
      /* @__PURE__ */ u3(Card, {
        title: "Worlds",
        aside: worlds ? /* @__PURE__ */ u3("span", {
          class: "lre-badge",
          children: worlds.length
        }, undefined, false, undefined, this) : null,
        children: worlds === null ? /* @__PURE__ */ u3(Empty, {
          children: "Loading…"
        }, undefined, false, undefined, this) : worlds.length === 0 ? /* @__PURE__ */ u3(Empty, {
          children: "No worlds yet."
        }, undefined, false, undefined, this) : /* @__PURE__ */ u3("div", {
          class: "lre-list",
          children: worlds.map((world) => /* @__PURE__ */ u3("div", {
            class: "lre-item",
            style: { flexWrap: "wrap" },
            children: [
              /* @__PURE__ */ u3("button", {
                type: "button",
                class: "grow",
                style: { border: 0, background: "transparent", textAlign: "left", minHeight: "40px", padding: 0, flexBasis: "140px" },
                onClick: () => go(app, { view: "world", worldId: world.id }),
                children: [
                  /* @__PURE__ */ u3("span", {
                    class: "title",
                    children: world.name
                  }, undefined, false, undefined, this),
                  /* @__PURE__ */ u3("span", {
                    class: "sub",
                    children: [
                      world.revisions.length,
                      " revision",
                      world.revisions.length === 1 ? "" : "s",
                      view?.worldId === world.id ? " · this chat" : ""
                    ]
                  }, undefined, true, undefined, this)
                ]
              }, undefined, true, undefined, this),
              /* @__PURE__ */ u3("button", {
                type: "button",
                class: "lre-btn small",
                "aria-label": `Export ${world.name}`,
                disabled: busy,
                onClick: () => run(async () => {
                  const result = await app.request({ type: "lre.world", op: "export", worldId: world.id });
                  if (result?.file !== undefined)
                    app.host.download(`${world.name.replace(/[^\w-]+/g, "_") || "world"}.lre-world.json`, JSON.stringify(result.file, null, 2));
                }),
                children: "Export"
              }, undefined, false, undefined, this),
              /* @__PURE__ */ u3("button", {
                type: "button",
                class: "lre-btn small danger",
                "aria-label": `Delete ${world.name}`,
                disabled: busy,
                onClick: () => run(async () => {
                  if (!await app.host.confirm("Delete world", `Delete “${world.name}” and all its revisions? Chats attached to it stop simulating.`, "danger", "Delete"))
                    return;
                  if (await app.request({ type: "lre.world", op: "delete", worldId: world.id }))
                    refresh();
                }),
                children: "Delete"
              }, undefined, false, undefined, this)
            ]
          }, world.id, true, undefined, this))
        }, undefined, false, undefined, this)
      }, undefined, false, undefined, this),
      /* @__PURE__ */ u3(Card, {
        title: "New world",
        children: /* @__PURE__ */ u3("form", {
          class: "lre-stack",
          onSubmit: (event) => {
            event.preventDefault();
            if (!name.trim())
              return;
            run(async () => {
              const result = await app.request({ type: "lre.world", op: "create", name: name.trim(), template });
              if (result?.world) {
                setName("");
                go(app, { view: "world", worldId: result.world.id });
              }
            });
          },
          children: [
            /* @__PURE__ */ u3("input", {
              class: "lre-input",
              placeholder: "World name",
              "aria-label": "World name",
              value: name,
              onInput: (event) => setName(event.currentTarget.value)
            }, undefined, false, undefined, this),
            /* @__PURE__ */ u3("select", {
              class: "lre-input",
              "aria-label": "Template",
              value: template ?? "",
              onChange: (event) => setTemplate(event.currentTarget.value || null),
              children: TEMPLATES.map((t) => /* @__PURE__ */ u3("option", {
                value: t.id ?? "",
                children: t.label
              }, t.label, false, undefined, this))
            }, undefined, false, undefined, this),
            /* @__PURE__ */ u3("button", {
              type: "submit",
              class: "lre-btn primary",
              disabled: !name.trim() || busy,
              children: "Create world"
            }, undefined, false, undefined, this)
          ]
        }, undefined, true, undefined, this)
      }, undefined, false, undefined, this),
      /* @__PURE__ */ u3(Card, {
        title: "Import",
        children: [
          /* @__PURE__ */ u3("button", {
            type: "button",
            class: "lre-btn block",
            onClick: () => fileInput.current?.click(),
            children: "Import an lre-world-v1 file…"
          }, undefined, false, undefined, this),
          /* @__PURE__ */ u3("input", {
            ref: fileInput,
            type: "file",
            accept: "application/json,.json",
            hidden: true,
            onChange: (event) => {
              const file = event.currentTarget.files?.[0];
              if (file)
                importFile(file);
              event.currentTarget.value = "";
            }
          }, undefined, false, undefined, this)
        ]
      }, undefined, true, undefined, this)
    ]
  }, undefined, true, undefined, this);
}
function WorldOverview() {
  const app = useApp();
  const draft = useSelect(app.drafts, (d) => d);
  const view = useView();
  const [busy, run] = useBusy();
  if (!draft)
    return null;
  const doc = draft.doc;
  const errors = draft.lint.filter((i) => i.severity === "error").length;
  const warnings = draft.lint.length - errors;
  return /* @__PURE__ */ u3("div", {
    class: "lre-stack",
    children: [
      /* @__PURE__ */ u3(Card, {
        title: "World",
        aside: /* @__PURE__ */ u3("span", {
          class: "lre-badge",
          children: doc.format
        }, undefined, false, undefined, this),
        children: /* @__PURE__ */ u3("div", {
          class: "lre-list",
          children: PARTS.map((part) => /* @__PURE__ */ u3("button", {
            type: "button",
            class: "lre-item",
            onClick: () => go(app, { view: "part", worldId: draft.worldId, part: part.id }),
            children: [
              /* @__PURE__ */ u3("span", {
                class: "grow",
                children: part.label
              }, undefined, false, undefined, this),
              /* @__PURE__ */ u3("span", {
                class: "lre-dim",
                "aria-hidden": "true",
                children: "›"
              }, undefined, false, undefined, this)
            ]
          }, part.id, true, undefined, this))
        }, undefined, false, undefined, this)
      }, undefined, false, undefined, this),
      /* @__PURE__ */ u3(Card, {
        title: "Content",
        children: /* @__PURE__ */ u3("div", {
          class: "lre-list",
          children: COLLECTIONS2.map((c) => {
            const count = Object.keys(doc[c.id]).length;
            const issues = lintAt(draft.lint, c.id).length;
            return /* @__PURE__ */ u3("button", {
              type: "button",
              class: "lre-item",
              onClick: () => go(app, { view: "collection", worldId: draft.worldId, collection: c.id }),
              children: [
                /* @__PURE__ */ u3("span", {
                  class: "grow",
                  children: [
                    /* @__PURE__ */ u3("span", {
                      class: "title",
                      children: c.label
                    }, undefined, false, undefined, this),
                    /* @__PURE__ */ u3("span", {
                      class: "sub",
                      children: c.hint
                    }, undefined, false, undefined, this)
                  ]
                }, undefined, true, undefined, this),
                issues > 0 ? /* @__PURE__ */ u3("span", {
                  class: "lre-badge warn",
                  children: issues
                }, undefined, false, undefined, this) : null,
                /* @__PURE__ */ u3("span", {
                  class: "lre-badge",
                  children: count
                }, undefined, false, undefined, this)
              ]
            }, c.id, true, undefined, this);
          })
        }, undefined, false, undefined, this)
      }, undefined, false, undefined, this),
      /* @__PURE__ */ u3(Card, {
        title: "Tools",
        children: /* @__PURE__ */ u3("div", {
          class: "lre-list",
          children: [
            /* @__PURE__ */ u3("button", {
              type: "button",
              class: "lre-item",
              onClick: () => go(app, { view: "check", worldId: draft.worldId }),
              children: /* @__PURE__ */ u3("span", {
                class: "grow",
                children: [
                  /* @__PURE__ */ u3("span", {
                    class: "title",
                    children: "Problems"
                  }, undefined, false, undefined, this),
                  /* @__PURE__ */ u3("span", {
                    class: "sub",
                    children: draft.lint.length === 0 ? "No issues in the draft" : `${errors} error(s), ${warnings} warning(s)`
                  }, undefined, false, undefined, this)
                ]
              }, undefined, true, undefined, this)
            }, undefined, false, undefined, this),
            /* @__PURE__ */ u3("button", {
              type: "button",
              class: "lre-item",
              onClick: () => go(app, { view: "job", worldId: draft.worldId, kind: "import_lore" }),
              children: /* @__PURE__ */ u3("span", {
                class: "grow",
                children: [
                  /* @__PURE__ */ u3("span", {
                    class: "title",
                    children: "Import from lore"
                  }, undefined, false, undefined, this),
                  /* @__PURE__ */ u3("span", {
                    class: "sub",
                    children: "Turn lore-book entries into entities, places and facts"
                  }, undefined, false, undefined, this)
                ]
              }, undefined, true, undefined, this)
            }, undefined, false, undefined, this),
            /* @__PURE__ */ u3("button", {
              type: "button",
              class: "lre-item",
              onClick: () => go(app, { view: "job", worldId: draft.worldId, kind: "refine" }),
              children: /* @__PURE__ */ u3("span", {
                class: "grow",
                children: [
                  /* @__PURE__ */ u3("span", {
                    class: "title",
                    children: "Build / Refine with AI"
                  }, undefined, false, undefined, this),
                  /* @__PURE__ */ u3("span", {
                    class: "sub",
                    children: "Describe changes; review every proposal"
                  }, undefined, false, undefined, this)
                ]
              }, undefined, true, undefined, this)
            }, undefined, false, undefined, this),
            /* @__PURE__ */ u3("button", {
              type: "button",
              class: "lre-item",
              onClick: () => go(app, { view: "job", worldId: draft.worldId, kind: "playtest" }),
              children: /* @__PURE__ */ u3("span", {
                class: "grow",
                children: [
                  /* @__PURE__ */ u3("span", {
                    class: "title",
                    children: "Playtest"
                  }, undefined, false, undefined, this),
                  /* @__PURE__ */ u3("span", {
                    class: "sub",
                    children: "Run scripted turns on the background lane"
                  }, undefined, false, undefined, this)
                ]
              }, undefined, true, undefined, this)
            }, undefined, false, undefined, this),
            /* @__PURE__ */ u3("button", {
              type: "button",
              class: "lre-item",
              onClick: () => go(app, { view: "job", worldId: draft.worldId, kind: "check_world" }),
              children: /* @__PURE__ */ u3("span", {
                class: "grow",
                children: [
                  /* @__PURE__ */ u3("span", {
                    class: "title",
                    children: "Check world"
                  }, undefined, false, undefined, this),
                  /* @__PURE__ */ u3("span", {
                    class: "sub",
                    children: "Simulate days on the background lane; report drops, failures and leaks"
                  }, undefined, false, undefined, this)
                ]
              }, undefined, true, undefined, this)
            }, undefined, false, undefined, this),
            view && view.status !== "not_world" ? null : view ? /* @__PURE__ */ u3("button", {
              type: "button",
              class: "lre-item",
              disabled: busy,
              onClick: () => run(async () => {
                if (!await app.host.confirm("Attach world", `Attach “${doc.name}” to the open chat?`, "info", "Attach"))
                  return;
                if (await app.request({ type: "lre.world", op: "attach", worldId: draft.worldId, chatId: view.chatId }))
                  app.client.open(view.chatId);
              }),
              children: /* @__PURE__ */ u3("span", {
                class: "grow",
                children: /* @__PURE__ */ u3("span", {
                  class: "title",
                  children: "Attach to this chat"
                }, undefined, false, undefined, this)
              }, undefined, false, undefined, this)
            }, undefined, false, undefined, this) : null
          ]
        }, undefined, true, undefined, this)
      }, undefined, false, undefined, this)
    ]
  }, undefined, true, undefined, this);
}
function itemLabel(collection, id, value) {
  if (!isRecord(value))
    return id;
  if (typeof value.name === "string" && value.name)
    return value.name;
  if (typeof value.label === "string" && value.label)
    return value.label;
  if (typeof value.title === "string" && value.title)
    return value.title;
  if (collection === "routes" && typeof value.from === "string")
    return `${value.from} → ${String(value.to)}`;
  return id;
}
function CollectionView(props) {
  const app = useApp();
  const draft = useSelect(app.drafts, (d) => d);
  const [query, setQuery] = d2("");
  const [newId, setNewId] = d2("");
  if (!draft)
    return null;
  const entries = Object.entries(draft.doc[props.collection]);
  const q = query.trim().toLowerCase();
  const shown = entries.filter(([id, value]) => !q || id.toLowerCase().includes(q) || itemLabel(props.collection, id, value).toLowerCase().includes(q));
  const meta = COLLECTIONS2.find((c) => c.id === props.collection);
  const create = () => {
    const id = newId.trim();
    if (!id || id in draft.doc[props.collection])
      return;
    go(app, { view: "item", worldId: draft.worldId, collection: props.collection, id: `new:${id}` });
    setNewId("");
  };
  return /* @__PURE__ */ u3("div", {
    class: "lre-stack",
    children: [
      /* @__PURE__ */ u3("div", {
        class: "lre-h2",
        children: meta?.label ?? props.collection
      }, undefined, false, undefined, this),
      entries.length > 8 ? /* @__PURE__ */ u3("input", {
        class: "lre-input",
        placeholder: "Search",
        "aria-label": "Search",
        value: query,
        onInput: (event) => setQuery(event.currentTarget.value)
      }, undefined, false, undefined, this) : null,
      /* @__PURE__ */ u3("div", {
        class: "lre-list",
        children: [
          shown.map(([id, value]) => {
            const issues = lintAt(draft.lint, `${props.collection}.${id}`).length;
            return /* @__PURE__ */ u3("button", {
              type: "button",
              class: "lre-item",
              onClick: () => go(app, { view: "item", worldId: draft.worldId, collection: props.collection, id }),
              children: [
                /* @__PURE__ */ u3("span", {
                  class: "grow",
                  children: [
                    /* @__PURE__ */ u3("span", {
                      class: "title",
                      children: itemLabel(props.collection, id, value)
                    }, undefined, false, undefined, this),
                    /* @__PURE__ */ u3("span", {
                      class: "sub",
                      children: [
                        /* @__PURE__ */ u3("code", {
                          children: id
                        }, undefined, false, undefined, this),
                        isRecord(value) && typeof value.kind === "string" ? ` · ${value.kind}` : "",
                        isRecord(value) && typeof value.pack === "string" && value.pack ? ` · ${value.pack}` : ""
                      ]
                    }, undefined, true, undefined, this)
                  ]
                }, undefined, true, undefined, this),
                issues > 0 ? /* @__PURE__ */ u3("span", {
                  class: "lre-badge warn",
                  children: issues
                }, undefined, false, undefined, this) : null
              ]
            }, id, true, undefined, this);
          }),
          shown.length === 0 ? /* @__PURE__ */ u3(Empty, {
            children: entries.length === 0 ? "None yet." : "No matches."
          }, undefined, false, undefined, this) : null
        ]
      }, undefined, true, undefined, this),
      /* @__PURE__ */ u3("form", {
        class: "lre-inline",
        onSubmit: (event) => {
          event.preventDefault();
          create();
        },
        children: [
          /* @__PURE__ */ u3("input", {
            class: "lre-input",
            style: { flex: 1 },
            placeholder: "New id (letters, digits, _)",
            "aria-label": "New id",
            value: newId,
            onInput: (event) => setNewId(event.currentTarget.value.replace(/[^\w.-]/g, "_"))
          }, undefined, false, undefined, this),
          /* @__PURE__ */ u3("button", {
            type: "submit",
            class: "lre-btn primary",
            disabled: !newId.trim() || newId.trim() in draft.doc[props.collection],
            children: "+ New"
          }, undefined, false, undefined, this)
        ]
      }, undefined, true, undefined, this)
    ]
  }, undefined, true, undefined, this);
}
function SchemaEditor(props) {
  const app = useApp();
  const draft = useSelect(app.drafts, (d) => d);
  const isNew = props.id?.startsWith("new:") ?? false;
  const id = isNew ? (props.id ?? "").slice(4) : props.id ?? "";
  const stored = props.world[props.collection][id];
  const initial = isRecord(stored) ? stored : newItem(props.collection, id);
  const [value, setValue] = d2(initial);
  const [busy, run] = useBusy();
  A(() => setValue(initial), [JSON.stringify(stored)]);
  const identifiers = b2(() => worldIdentifiers(props.world), [props.world]);
  const formDoc = b2(() => ({ ...props.world, kinds: { ...draft?.packKinds, ...props.world.kinds } }), [props.world, draft?.packKinds]);
  const path = `${props.collection}.${id}`;
  const changed = JSON.stringify(value) !== JSON.stringify(isRecord(stored) ? stored : null);
  const save = () => run(async () => {
    const message = await props.send({ type: "lre.editor", worldId: props.world.id, base: null, op: "put", collection: props.collection, id, value });
    if (message.type === "lre.result" && isNew)
      go(app, { view: "item", worldId: props.world.id, collection: props.collection, id });
  });
  const remove = () => run(async () => {
    if (!await app.host.confirm("Delete", `Delete ${props.collection} “${id}”? References to it will show in Problems.`, "danger", "Delete"))
      return;
    const message = await props.send({ type: "lre.editor", worldId: props.world.id, base: null, op: "remove", collection: props.collection, id });
    if (message.type === "lre.result")
      go(app, { view: "collection", worldId: props.world.id, collection: props.collection });
  });
  return /* @__PURE__ */ u3("div", {
    class: "lre-stack",
    "data-lre-editor": props.collection,
    children: [
      /* @__PURE__ */ u3("div", {
        class: "lre-spread",
        children: [
          /* @__PURE__ */ u3("span", {
            class: "lre-h2",
            children: /* @__PURE__ */ u3("code", {
              children: id
            }, undefined, false, undefined, this)
          }, undefined, false, undefined, this),
          !isNew ? /* @__PURE__ */ u3("button", {
            type: "button",
            class: "lre-btn small danger",
            disabled: busy,
            onClick: remove,
            children: "Delete"
          }, undefined, false, undefined, this) : null
        ]
      }, undefined, true, undefined, this),
      lintAt(draft?.lint ?? [], path).filter((issue) => issue.path === path).map((issue) => /* @__PURE__ */ u3("div", {
        class: issue.severity === "error" ? "lre-banner warn" : "lre-banner info",
        children: issue.message
      }, issue.code, false, undefined, this)),
      /* @__PURE__ */ u3(SchemaFields, {
        specs: COLLECTION_SPECS[props.collection],
        value,
        ctx: { doc: formDoc, lint: draft?.lint ?? [], path, identifiers },
        onChange: setValue
      }, undefined, false, undefined, this),
      /* @__PURE__ */ u3("div", {
        class: "lre-inline",
        style: { position: "sticky", bottom: 0, padding: "8px 0", background: "var(--lre-fill)" },
        children: [
          /* @__PURE__ */ u3("button", {
            type: "button",
            class: "lre-btn primary",
            disabled: busy || !changed && !isNew,
            onClick: save,
            children: isNew ? "Create" : "Save to draft"
          }, undefined, false, undefined, this),
          /* @__PURE__ */ u3("button", {
            type: "button",
            class: "lre-btn ghost",
            disabled: busy || !changed,
            onClick: () => setValue(initial),
            children: "Revert"
          }, undefined, false, undefined, this)
        ]
      }, undefined, true, undefined, this)
    ]
  }, undefined, true, undefined, this);
}
function ItemView(props) {
  const app = useApp();
  const draft = useSelect(app.drafts, (d) => d);
  const send = b2(() => draftSend(app), [app]);
  if (!draft)
    return null;
  const registered = app.catalog.editors.get(props.collection);
  const Editor = registered ? registered.component : props.collection === "tables" ? TableEditor : SchemaEditor;
  return /* @__PURE__ */ u3(Editor, {
    world: draft.doc,
    collection: props.collection,
    id: props.id,
    send
  }, undefined, false, undefined, this);
}
function partValue(doc, part) {
  switch (part) {
    case "calendar":
      return doc.calendar;
    case "realism":
      return doc.realism;
    case "time":
      return doc.time;
    case "meta":
      return { name: doc.name, pov: doc.pov, start: { ...doc.start }, seedMode: doc.seedMode, lenientPricing: doc.lenientPricing, currency: { ...doc.currency } };
  }
}
function PartView(props) {
  const app = useApp();
  const draft = useSelect(app.drafts, (d) => d);
  const send = b2(() => draftSend(app), [app]);
  const initial = draft ? partValue(draft.doc, props.part) : {};
  const [value, setValue] = d2(initial);
  const [busy, run] = useBusy();
  A(() => setValue(initial), [JSON.stringify(initial)]);
  const identifiers = b2(() => draft ? worldIdentifiers(draft.doc) : [], [draft?.doc]);
  if (!draft)
    return null;
  const changed = JSON.stringify(value) !== JSON.stringify(initial);
  return /* @__PURE__ */ u3("div", {
    class: "lre-stack",
    "data-lre-editor": `part:${props.part}`,
    children: [
      /* @__PURE__ */ u3("div", {
        class: "lre-h2",
        children: PARTS.find((p) => p.id === props.part)?.label
      }, undefined, false, undefined, this),
      /* @__PURE__ */ u3(SchemaFields, {
        specs: PART_SPECS[props.part],
        value,
        ctx: { doc: draft.doc, lint: draft.lint, path: props.part, identifiers },
        onChange: setValue
      }, undefined, false, undefined, this),
      /* @__PURE__ */ u3("div", {
        class: "lre-inline",
        children: [
          /* @__PURE__ */ u3("button", {
            type: "button",
            class: "lre-btn primary",
            disabled: !changed || busy,
            onClick: () => run(async () => {
              await send({ type: "lre.editor", worldId: draft.worldId, base: draft.base, op: "set", part: props.part, value });
            }),
            children: "Save to draft"
          }, undefined, false, undefined, this),
          /* @__PURE__ */ u3("button", {
            type: "button",
            class: "lre-btn ghost",
            disabled: !changed || busy,
            onClick: () => setValue(initial),
            children: "Revert"
          }, undefined, false, undefined, this)
        ]
      }, undefined, true, undefined, this)
    ]
  }, undefined, true, undefined, this);
}

// src/frontend/layout.ts
var HUD_COLLAPSE_BELOW = 760;
var HOST_MOBILE_MAX = 600;
var CHAT_HEAD_GUTTER = 64;
function isMobile(viewport) {
  return viewport.coarse || viewport.width <= HOST_MOBILE_MAX;
}
function hudMode(viewport) {
  return viewport.width < HUD_COLLAPSE_BELOW ? "collapsed" : "full";
}
function overlayPlan(viewport, drawerOpen) {
  const mobile = isMobile(viewport);
  return { closeDrawer: mobile && drawerOpen, fullscreen: mobile };
}
function rightGutter(panel, viewport) {
  if (!isMobile(viewport))
    return 0;
  const right = Math.min(panel.x + panel.width, viewport.width);
  return Math.min(CHAT_HEAD_GUTTER, Math.max(0, Math.ceil(right - (viewport.width - CHAT_HEAD_GUTTER))));
}
function sheetRect(viewport, heightFraction) {
  const height = Math.round(Math.min(viewport.height * heightFraction, viewport.height - 24));
  if (isMobile(viewport))
    return { x: 0, y: viewport.height - height, width: viewport.width - CHAT_HEAD_GUTTER, height };
  const width = Math.min(440, viewport.width - 24);
  return { x: Math.round((viewport.width - width) / 2), y: viewport.height - height - 12, width, height };
}
function mapFloatRect(viewport) {
  const width = Math.min(480, viewport.width - 24);
  const height = Math.min(520, viewport.height - 120);
  return { x: Math.max(12, viewport.width - width - 24), y: 72, width, height, key: isMobile(viewport) ? "lre-map-phone" : "lre-map-desk" };
}
function hudCentreX(viewport, width) {
  return Math.max(8, Math.round((viewport.width - width) / 2));
}
function hudFloatRect(viewport) {
  return { x: hudCentreX(viewport, 220), y: 64, width: 220, height: 44, key: isMobile(viewport) ? "lre-hud-phone" : "lre-hud-desk" };
}

// src/frontend/play/play.tsx
function visiblePanels(catalog, view) {
  return catalog.panels.filter((panel) => panel.id.startsWith("core.") || view.panels[panel.id] !== undefined);
}
function Play() {
  const app = useApp();
  const sync = useSelect(app.sync, (state) => state);
  const selected = useUi((ui) => ui.playPanel);
  const mapInDrawer = useUi((ui) => ui.mapInDrawer);
  const view = sync.view;
  const panelId = P2();
  if (sync.chatId === null)
    return /* @__PURE__ */ u3(Empty, {
      children: "Open a chat to play."
    }, undefined, false, undefined, this);
  if (!view)
    return sync.status === "closed" ? /* @__PURE__ */ u3(NotWorld, {
      chatId: sync.chatId
    }, undefined, false, undefined, this) : /* @__PURE__ */ u3(Empty, {
      children: "Connecting to the engine…"
    }, undefined, false, undefined, this);
  if (view.status === "not_world")
    return /* @__PURE__ */ u3(NotWorld, {
      chatId: view.chatId
    }, undefined, false, undefined, this);
  const panels = visiblePanels(app.catalog, view);
  const current = (mapInDrawer && panels.some((p) => p.id === "space.map") ? "space.map" : selected && panels.some((p) => p.id === selected) ? selected : panels[0]?.id) ?? null;
  const panel = panels.find((p) => p.id === current);
  const keep = view.chips.find((chip) => chip.kind === "keep_report");
  const select = (id) => app.ui.update((ui) => ({ ...ui, playPanel: id, mapInDrawer: id === "space.map" ? ui.mapInDrawer : false }));
  return /* @__PURE__ */ u3("div", {
    class: "lre-stack",
    "data-lre-section": "play",
    children: [
      view.status === "paused" ? /* @__PURE__ */ u3("div", {
        class: "lre-banner warn",
        role: "status",
        children: [
          /* @__PURE__ */ u3("strong", {
            children: "Paused"
          }, undefined, false, undefined, this),
          /* @__PURE__ */ u3("span", {
            children: "A user message was edited. Later turns don't change the world until you Keep or Discard."
          }, undefined, false, undefined, this),
          keep ? /* @__PURE__ */ u3(KeepReportChip, {
            chip: keep,
            chatId: view.chatId,
            send: app.send
          }, undefined, false, undefined, this) : null
        ]
      }, undefined, true, undefined, this) : null,
      view.status === "in_flight" ? /* @__PURE__ */ u3("div", {
        class: "lre-banner info",
        role: "status",
        children: "A turn is running. Changes you make now apply when it finishes."
      }, undefined, false, undefined, this) : null,
      /* @__PURE__ */ u3(Tabs, {
        label: "Play sections",
        panelId,
        value: current,
        tabs: panels.map((p) => ({ id: p.id, label: p.label, dot: view.pending.some((mark) => mark.panel === p.id) })),
        onChange: select
      }, undefined, false, undefined, this),
      mapInDrawer && current === "space.map" ? /* @__PURE__ */ u3("div", {
        class: "lre-spread lre-small lre-muted",
        children: [
          /* @__PURE__ */ u3("span", {
            children: "The map opened here because the drawer couldn't close."
          }, undefined, false, undefined, this),
          /* @__PURE__ */ u3("button", {
            type: "button",
            class: "lre-btn small",
            onClick: () => app.ui.update((ui) => ({ ...ui, mapInDrawer: false })),
            children: "Done"
          }, undefined, false, undefined, this)
        ]
      }, undefined, true, undefined, this) : null,
      panel ? /* @__PURE__ */ u3("div", {
        ...tabPanel(panelId, current),
        style: panel.id === "space.map" ? { height: "min(70vh, 560px)" } : undefined,
        children: /* @__PURE__ */ u3(panel.component, {
          chatId: view.chatId,
          view: view.panels[panel.id] ?? null,
          state: view,
          send: app.send
        }, undefined, false, undefined, this)
      }, undefined, false, undefined, this) : /* @__PURE__ */ u3(Card, {
        children: /* @__PURE__ */ u3(JsonView, {
          value: view.panels
        }, undefined, false, undefined, this)
      }, undefined, false, undefined, this)
    ]
  }, undefined, true, undefined, this);
}
function NotWorld(props) {
  const app = useApp();
  const [worlds, setWorlds] = d2(null);
  const [busy, run] = useBusy();
  A(() => {
    app.request({ type: "lre.world", op: "list" }).then((result) => setWorlds(result?.worlds ?? []));
  }, []);
  return /* @__PURE__ */ u3("div", {
    class: "lre-stack",
    "data-lre-section": "play-not-world",
    children: /* @__PURE__ */ u3(Card, {
      title: "Not a world chat",
      children: [
        /* @__PURE__ */ u3("p", {
          class: "lre-muted",
          style: { margin: "0 0 8px" },
          children: "Attach a world to this chat to track time, places, money and everyone in it."
        }, undefined, false, undefined, this),
        worlds === null ? /* @__PURE__ */ u3(Empty, {
          children: "Loading worlds…"
        }, undefined, false, undefined, this) : worlds.length === 0 ? /* @__PURE__ */ u3(Empty, {
          children: "No worlds yet. Create one in Build."
        }, undefined, false, undefined, this) : /* @__PURE__ */ u3("div", {
          class: "lre-list",
          children: worlds.map((world) => /* @__PURE__ */ u3("button", {
            type: "button",
            class: "lre-item",
            disabled: busy,
            onClick: () => run(async () => {
              const ok = await app.host.confirm("Attach world", `Attach “${world.name}” to this chat? The world starts at its current revision.`, "info", "Attach");
              if (!ok)
                return;
              const result = await app.request({ type: "lre.world", op: "attach", worldId: world.id, chatId: props.chatId });
              if (result)
                app.client.open(props.chatId);
            }),
            children: [
              /* @__PURE__ */ u3("span", {
                class: "grow",
                children: [
                  /* @__PURE__ */ u3("span", {
                    class: "title",
                    children: world.name
                  }, undefined, false, undefined, this),
                  /* @__PURE__ */ u3("span", {
                    class: "sub",
                    children: [
                      world.revisions.length,
                      " revision",
                      world.revisions.length === 1 ? "" : "s"
                    ]
                  }, undefined, true, undefined, this)
                ]
              }, undefined, true, undefined, this),
              /* @__PURE__ */ u3("span", {
                class: "lre-dim",
                children: "Attach"
              }, undefined, false, undefined, this)
            ]
          }, world.id, true, undefined, this))
        }, undefined, false, undefined, this),
        /* @__PURE__ */ u3("button", {
          type: "button",
          class: "lre-btn block",
          style: { marginTop: "8px" },
          onClick: () => app.ui.update((ui) => ({ ...ui, section: "build", build: { view: "worlds" } })),
          children: "Open Build"
        }, undefined, false, undefined, this)
      ]
    }, undefined, true, undefined, this)
  }, undefined, false, undefined, this);
}

// src/shared/settings.ts
var EXTRACTION_TYPES = ["time_advance", "location", "condition", "knows", "give", "purchase", "transfer", "regard", "quantity", "spawn"];
var EXTRACTION_DEFAULTS = Object.freeze({
  time_advance: "auto",
  location: "auto",
  condition: "auto",
  regard: "auto",
  transfer: "auto",
  spawn: "auto",
  knows: "confirm",
  give: "confirm",
  purchase: "confirm"
});
var EXTRACTION_LEARNING = Object.freeze({
  promoteAt: 0.9,
  minProposals: 30,
  window: 30,
  demoteUndoRate: 0.1
});

// src/frontend/time-controls.tsx
var SPEED_ACTIVITIES = ["sleep", "work_shift", "travel", "waiting"];
var SPEED_DEFAULT = { mode: "offer", thresholdMinutes: 30 };
function settingsTimePatch(change) {
  const scope = change.scope;
  switch (change.control) {
    case "tick":
      return "sceneType" in scope ? { time: { sceneTicks: { [scope.sceneType]: change.to } } } : {};
    case "scale":
      return { time: { scale: change.to } };
    case "interrupt":
      return "interrupt" in scope ? { time: { interrupts: { [scope.interrupt]: change.to } } } : {};
    case "speed_through":
      return "activity" in scope ? { time: { speedThrough: { [scope.activity]: change.to } } } : {};
    case "montage":
      return { time: { montage: change.to } };
    case "unit_cap":
      return { time: { unitCap: change.to } };
    case "npc_calls":
      return { time: { npcCallsPerTimelapse: change.to } };
    case "pause":
      return {};
  }
}
var POLICY_OPTIONS = [
  { value: "stop", label: "Stop" },
  { value: "note", label: "Note" },
  { value: "ignore", label: "Ignore" }
];
function TimeControlsEditor(props) {
  const { values } = props;
  const activities = [...new Set([...SPEED_ACTIVITIES, ...Object.keys(values.speedThrough)])];
  return /* @__PURE__ */ u3("div", {
    class: "lre-stack",
    "data-lre-time-controls": true,
    children: [
      /* @__PURE__ */ u3("section", {
        class: "lre-card",
        children: [
          /* @__PURE__ */ u3("div", {
            class: "lre-h",
            children: "Default tick per scene type"
          }, undefined, false, undefined, this),
          Object.entries(values.sceneTicks).map(([sceneType, minutes]) => /* @__PURE__ */ u3(NumberStepper, {
            label: `${humanize(sceneType)}${sceneType === props.currentSceneType ? " (now)" : ""} · ${formatMinutes(minutes)}`,
            value: minutes,
            min: 0,
            max: 1440,
            step: 0.5,
            disabled: props.disabled,
            onChange: (to) => props.onChange({ control: "tick", scope: { sceneType }, to })
          }, sceneType, false, undefined, this)),
          /* @__PURE__ */ u3(HostSlider, {
            label: "Time scale",
            hint: "Multiplies default ticks only; actions, travel and timelapses stay exact.",
            min: 0.25,
            max: 10,
            step: 0.25,
            suffix: "×",
            value: values.scale,
            disabled: props.disabled,
            onCommit: (to) => props.onChange({ control: "scale", scope: { all: true }, to })
          }, undefined, false, undefined, this)
        ]
      }, undefined, true, undefined, this),
      /* @__PURE__ */ u3("section", {
        class: "lre-card",
        children: [
          /* @__PURE__ */ u3("div", {
            class: "lre-h",
            children: "Timelapse interrupts"
          }, undefined, false, undefined, this),
          INTERRUPT_CLASSES.map((cls) => /* @__PURE__ */ u3("div", {
            class: "lre-field",
            style: { marginBottom: "6px" },
            children: [
              /* @__PURE__ */ u3("span", {
                class: "label",
                children: humanize(cls)
              }, undefined, false, undefined, this),
              /* @__PURE__ */ u3(Seg, {
                label: humanize(cls),
                value: values.interrupts[cls],
                options: POLICY_OPTIONS,
                disabled: props.disabled,
                onChange: (to) => props.onChange({ control: "interrupt", scope: { interrupt: cls }, to })
              }, undefined, false, undefined, this)
            ]
          }, cls, true, undefined, this))
        ]
      }, undefined, true, undefined, this),
      /* @__PURE__ */ u3("section", {
        class: "lre-card",
        children: [
          /* @__PURE__ */ u3("div", {
            class: "lre-h",
            children: "Speed through"
          }, undefined, false, undefined, this),
          activities.map((activity) => {
            const current = values.speedThrough[activity] ?? SPEED_DEFAULT;
            return /* @__PURE__ */ u3("div", {
              class: "lre-stack",
              style: { marginBottom: "8px" },
              children: [
                /* @__PURE__ */ u3("span", {
                  class: "lre-small lre-muted",
                  children: humanize(activity)
                }, undefined, false, undefined, this),
                /* @__PURE__ */ u3(Seg, {
                  label: `${humanize(activity)} mode`,
                  value: current.mode,
                  options: [
                    { value: "offer", label: "Offer a timelapse" },
                    { value: "auto", label: "Run it" }
                  ],
                  disabled: props.disabled,
                  onChange: (mode) => props.onChange({ control: "speed_through", scope: { activity }, to: { mode, thresholdMinutes: current.thresholdMinutes } })
                }, undefined, false, undefined, this),
                /* @__PURE__ */ u3(NumberStepper, {
                  label: "When longer than (min)",
                  value: current.thresholdMinutes,
                  min: 0,
                  max: 1440,
                  step: 5,
                  integer: true,
                  disabled: props.disabled,
                  onChange: (thresholdMinutes) => props.onChange({ control: "speed_through", scope: { activity }, to: { mode: current.mode, thresholdMinutes } })
                }, undefined, false, undefined, this)
              ]
            }, activity, true, undefined, this);
          })
        ]
      }, undefined, true, undefined, this),
      /* @__PURE__ */ u3("section", {
        class: "lre-card",
        children: [
          /* @__PURE__ */ u3("div", {
            class: "lre-h",
            children: "Montage and limits"
          }, undefined, false, undefined, this),
          /* @__PURE__ */ u3("div", {
            class: "lre-field",
            children: [
              /* @__PURE__ */ u3("span", {
                class: "label",
                children: "Montage granularity"
              }, undefined, false, undefined, this),
              /* @__PURE__ */ u3(Seg, {
                label: "Montage granularity",
                value: values.montage,
                options: [
                  { value: "key", label: "Key events" },
                  { value: "day", label: "Per day" },
                  { value: "week", label: "Per week" }
                ],
                disabled: props.disabled,
                onChange: (to) => props.onChange({ control: "montage", scope: { all: true }, to })
              }, undefined, false, undefined, this)
            ]
          }, undefined, true, undefined, this),
          /* @__PURE__ */ u3(NumberStepper, {
            label: "Unit cap: agent-days per segment",
            value: values.unitCap.agentDays,
            min: 1,
            max: 1e5,
            step: 50,
            integer: true,
            disabled: props.disabled,
            onChange: (agentDays) => props.onChange({ control: "unit_cap", scope: { all: true }, to: { agentDays, events: values.unitCap.events } })
          }, undefined, false, undefined, this),
          /* @__PURE__ */ u3(NumberStepper, {
            label: "Unit cap: events per segment",
            value: values.unitCap.events,
            min: 1,
            max: 1e6,
            step: 500,
            integer: true,
            disabled: props.disabled,
            onChange: (events) => props.onChange({ control: "unit_cap", scope: { all: true }, to: { agentDays: values.unitCap.agentDays, events } })
          }, undefined, false, undefined, this),
          /* @__PURE__ */ u3(NumberStepper, {
            label: "NPC model calls per timelapse (Custom)",
            value: values.npcCalls,
            min: 0,
            max: 50,
            integer: true,
            disabled: props.disabled,
            onChange: (to) => props.onChange({ control: "npc_calls", scope: { all: true }, to })
          }, undefined, false, undefined, this)
        ]
      }, undefined, true, undefined, this)
    ]
  }, undefined, true, undefined, this);
}

// src/frontend/settings/realism.tsx
var DOMAIN_LABEL = {
  money: "Money",
  gear: "Gear",
  vehicles: "Vehicles",
  castlife: "Cast life",
  relationships: "Relationships",
  space: "Space & travel",
  calendar: "Calendar & time",
  weather: "Weather",
  sheets: "Sheets & checks"
};
var LEVEL_LABEL = { 0: "Off", 1: "Narrative", 2: "Simple", 3: "Detailed", 4: "Simulation" };
var PRESETS = [
  { value: "story", label: "Story" },
  { value: "grounded", label: "Grounded" },
  { value: "simulation", label: "Simulation" },
  { value: "custom", label: "Custom" }
];
var CAPPED_TIERS = ["principal", "supporting", "background"];
function asLevel(value) {
  const rounded = Math.max(0, Math.min(4, Math.round(value)));
  return rounded === 0 ? 0 : rounded === 1 ? 1 : rounded === 2 ? 2 : rounded === 3 ? 3 : 4;
}
function LevelSlider(props) {
  const [drag, setDrag] = d2(null);
  const shown = asLevel(drag ?? props.value);
  return /* @__PURE__ */ u3("div", {
    class: "lre-field",
    style: { marginBottom: "4px" },
    "data-lre-domain": props.domain,
    role: "group",
    "aria-label": `${DOMAIN_LABEL[props.domain]} level`,
    children: [
      /* @__PURE__ */ u3("div", {
        class: "lre-spread",
        children: [
          /* @__PURE__ */ u3("span", {
            children: DOMAIN_LABEL[props.domain]
          }, undefined, false, undefined, this),
          /* @__PURE__ */ u3("span", {
            class: shown === 0 ? "lre-dim" : "lre-muted",
            children: [
              shown,
              " · ",
              LEVEL_LABEL[shown]
            ]
          }, undefined, true, undefined, this)
        ]
      }, undefined, true, undefined, this),
      /* @__PURE__ */ u3(HostSlider, {
        min: 0,
        max: 4,
        step: 1,
        integer: true,
        value: props.value,
        disabled: props.disabled,
        onDrag: setDrag,
        onCommit: (value) => props.onCommit(asLevel(value))
      }, undefined, false, undefined, this)
    ]
  }, undefined, true, undefined, this);
}
function RealismSeed(props) {
  const { realism } = props;
  return /* @__PURE__ */ u3("div", {
    class: "lre-stack",
    children: [
      /* @__PURE__ */ u3(Seg, {
        label: "Realism preset",
        value: realism.preset,
        options: PRESETS,
        disabled: props.busy,
        onChange: (preset) => props.patch({ realism: { preset } })
      }, undefined, false, undefined, this),
      /* @__PURE__ */ u3("p", {
        class: "lre-small lre-muted",
        style: { margin: 0 },
        children: "Seeds new chats. Story is the default; any change makes it Custom."
      }, undefined, false, undefined, this),
      DOMAINS.map((domain) => /* @__PURE__ */ u3(LevelSlider, {
        domain,
        value: realism.levels[domain],
        disabled: props.busy,
        onCommit: (level) => props.patch({ realism: { preset: "custom", levels: { [domain]: level } } })
      }, domain, false, undefined, this)),
      /* @__PURE__ */ u3("div", {
        class: "lre-h",
        children: "Tier caps"
      }, undefined, false, undefined, this),
      /* @__PURE__ */ u3("div", {
        class: "lre-tier-wrap",
        children: /* @__PURE__ */ u3("div", {
          class: "lre-tier-grid",
          role: "table",
          "aria-label": "Tier caps",
          lang: "en",
          children: [
            /* @__PURE__ */ u3("div", {
              role: "row",
              style: { display: "contents" },
              children: [
                /* @__PURE__ */ u3("span", {
                  role: "columnheader",
                  children: /* @__PURE__ */ u3("span", {
                    class: "lre-sr",
                    children: "Domain"
                  }, undefined, false, undefined, this)
                }, undefined, false, undefined, this),
                CAPPED_TIERS.map((tier) => /* @__PURE__ */ u3("span", {
                  class: "lre-muted",
                  role: "columnheader",
                  children: [
                    tier[0]?.toUpperCase(),
                    tier.slice(1)
                  ]
                }, tier, true, undefined, this))
              ]
            }, undefined, true, undefined, this),
            DOMAINS.map((domain) => /* @__PURE__ */ u3("div", {
              role: "row",
              style: { display: "contents" },
              children: [
                /* @__PURE__ */ u3("span", {
                  role: "rowheader",
                  children: DOMAIN_LABEL[domain]
                }, undefined, false, undefined, this),
                CAPPED_TIERS.map((tier) => {
                  const cap = realism.tierCaps[tier]?.[domain];
                  return /* @__PURE__ */ u3("span", {
                    role: "cell",
                    style: { display: "contents" },
                    children: /* @__PURE__ */ u3("select", {
                      class: "lre-input",
                      "aria-label": `${DOMAIN_LABEL[domain]} cap for ${tier}`,
                      value: cap === undefined ? "" : String(cap),
                      disabled: props.busy,
                      onChange: (event) => {
                        const raw = event.currentTarget.value;
                        props.patch({ realism: { preset: "custom", tierCaps: { [tier]: { [domain]: raw === "" ? null : Number(raw) } } } });
                      },
                      children: [
                        /* @__PURE__ */ u3("option", {
                          value: "",
                          children: "—"
                        }, undefined, false, undefined, this),
                        [0, 1, 2, 3, 4].map((level) => /* @__PURE__ */ u3("option", {
                          value: String(level),
                          children: level
                        }, level, false, undefined, this))
                      ]
                    }, undefined, true, undefined, this)
                  }, tier, false, undefined, this);
                })
              ]
            }, domain, true, undefined, this))
          ]
        }, undefined, true, undefined, this)
      }, undefined, false, undefined, this)
    ]
  }, undefined, true, undefined, this);
}
var TONE_ICON = { freeze: "❄", promote: "⬆", materialize: "✦", info: "ℹ" };
function RealismThisChat(props) {
  const app = useApp();
  const [scope, setScope] = d2("all");
  const [pending, setPending] = d2(null);
  const [busy, run] = useBusy();
  if (!props.controls)
    return /* @__PURE__ */ u3(Empty, {
      children: "Open a world chat to change its realism."
    }, undefined, false, undefined, this);
  const realism = props.controls.realism;
  const levelFor = (domain) => scope === "all" ? realism.levels[domain] : realism.tierCaps[scope]?.[domain] ?? realism.levels[domain];
  const resolveScope = scope === "all" ? { all: true } : { tier: scope };
  const ask = (domain, to) => run(async () => {
    const result = await app.request(resolveMarker(props.chatId, domain, resolveScope, to, true));
    if (result)
      setPending({ domain, to, scope: resolveScope, preview: result.preview ?? null });
  });
  const apply = () => run(async () => {
    if (!pending)
      return;
    const result = await app.request(resolveMarker(props.chatId, pending.domain, pending.scope, pending.to));
    if (result) {
      app.toast(result.pending ? "Saved — the change applies when the reply finishes." : `${DOMAIN_LABEL[pending.domain]} is now ${LEVEL_LABEL[pending.to]}.`, "info");
      setPending(null);
    }
  });
  return /* @__PURE__ */ u3("div", {
    class: "lre-stack",
    "data-lre-realism": "chat",
    children: [
      /* @__PURE__ */ u3(Seg, {
        label: "Applies to",
        value: scope,
        options: [
          { value: "all", label: "Everyone" },
          { value: "principal", label: "Principal" },
          { value: "supporting", label: "Supporting" },
          { value: "background", label: "Background" }
        ],
        onChange: (next) => setScope(next)
      }, undefined, false, undefined, this),
      pending ? /* @__PURE__ */ u3("div", {
        class: "lre-banner info",
        "data-lre-migration-preview": true,
        children: [
          /* @__PURE__ */ u3("strong", {
            children: [
              DOMAIN_LABEL[pending.domain],
              ": ",
              LEVEL_LABEL[levelFor(pending.domain)],
              " → ",
              LEVEL_LABEL[pending.to]
            ]
          }, undefined, true, undefined, this),
          pending.preview && pending.preview.lines.length > 0 ? pending.preview.lines.map((line, i) => /* @__PURE__ */ u3("div", {
            class: "lre-row",
            children: /* @__PURE__ */ u3("span", {
              class: "k",
              children: [
                /* @__PURE__ */ u3("span", {
                  "aria-hidden": "true",
                  children: TONE_ICON[line.tone]
                }, undefined, false, undefined, this),
                " ",
                line.text
              ]
            }, undefined, true, undefined, this)
          }, i, false, undefined, this)) : /* @__PURE__ */ u3("span", {
            class: "lre-muted",
            children: "Nothing freezes, promotes or materializes."
          }, undefined, false, undefined, this),
          /* @__PURE__ */ u3("div", {
            class: "lre-inline",
            children: [
              /* @__PURE__ */ u3("button", {
                type: "button",
                class: "lre-btn primary",
                disabled: busy,
                onClick: apply,
                children: "Apply to this chat"
              }, undefined, false, undefined, this),
              /* @__PURE__ */ u3("button", {
                type: "button",
                class: "lre-btn ghost",
                disabled: busy,
                onClick: () => setPending(null),
                children: "Cancel"
              }, undefined, false, undefined, this)
            ]
          }, undefined, true, undefined, this)
        ]
      }, undefined, true, undefined, this) : null,
      DOMAINS.map((domain) => /* @__PURE__ */ u3(LevelSlider, {
        domain,
        value: levelFor(domain),
        disabled: busy || pending !== null,
        onCommit: (to) => to === levelFor(domain) ? undefined : ask(domain, to)
      }, `${scope}:${domain}`, false, undefined, this))
    ]
  }, undefined, true, undefined, this);
}

// src/frontend/settings/steps.tsx
var PRESETS2 = [
  { value: "lean", label: "Lean" },
  { value: "standard", label: "Standard" },
  { value: "full", label: "Full" },
  { value: "custom", label: "Custom" }
];
var PRESET_NOTE = {
  lean: "Narrator + up to 2 model steps a turn (2 calls on a typical turn). The floor; doesn't meet “a model decides” on its own.",
  standard: "Narrator + up to 5 model steps a turn (3 calls on a typical turn). The default.",
  full: "Narrator + up to 9 model steps a turn (6 calls on a typical turn).",
  custom: "Your own steps, signals, providers and budgets. The count depends on the steps you enable; the call meter shows it live."
};
var STEP_LABEL = {
  interpret: "Interpret typed input",
  select: "Select lore",
  "npc.choose": "NPC choices",
  contradiction: "Contradiction check",
  "puzzle.answer": "Puzzle answers",
  brief: "Scene brief",
  outline: "Prose outline",
  extract: "Extract changes",
  choices: "Suggested choices"
};
var PHASES = ["pre", "select", "post"];
var PHASE_LABEL = { pre: "Before the reply", select: "Lore selection", post: "After the reply" };
function ModelUseSection(props) {
  const { modelUse } = props;
  return /* @__PURE__ */ u3("div", {
    class: "lre-stack",
    children: [
      /* @__PURE__ */ u3(Seg, {
        label: "Model use preset",
        value: modelUse.preset,
        options: PRESETS2,
        disabled: props.busy,
        onChange: (preset) => props.patch({ modelUse: { preset } })
      }, undefined, false, undefined, this),
      /* @__PURE__ */ u3("p", {
        class: "lre-small lre-muted",
        style: { margin: 0 },
        children: PRESET_NOTE[modelUse.preset]
      }, undefined, false, undefined, this),
      /* @__PURE__ */ u3("div", {
        class: "lre-h",
        children: "Budgets per phase"
      }, undefined, false, undefined, this),
      PHASES.map((phase) => /* @__PURE__ */ u3("div", {
        children: [
          /* @__PURE__ */ u3("div", {
            class: "lre-small lre-muted",
            children: PHASE_LABEL[phase]
          }, undefined, false, undefined, this),
          /* @__PURE__ */ u3(NumberStepper, {
            label: "Calls",
            value: modelUse.budgets[phase].calls,
            min: 0,
            max: 20,
            integer: true,
            disabled: props.busy,
            onChange: (calls) => props.patch({ modelUse: { preset: "custom", budgets: { [phase]: { calls } } } })
          }, undefined, false, undefined, this),
          /* @__PURE__ */ u3(NumberStepper, {
            label: "Wall clock (ms)",
            value: modelUse.budgets[phase].ms,
            min: 500,
            max: 120000,
            step: 500,
            integer: true,
            disabled: props.busy,
            onChange: (ms) => props.patch({ modelUse: { preset: "custom", budgets: { [phase]: { ms } } } })
          }, undefined, false, undefined, this)
        ]
      }, phase, true, undefined, this)),
      /* @__PURE__ */ u3("div", {
        class: "lre-h",
        children: "Engine budget (tokens)"
      }, undefined, false, undefined, this),
      /* @__PURE__ */ u3(NumberStepper, {
        label: "Sections",
        value: modelUse.tokens.sections,
        min: 100,
        max: 8000,
        step: 50,
        integer: true,
        disabled: props.busy,
        onChange: (sections) => props.patch({ modelUse: { preset: "custom", tokens: { sections } } })
      }, undefined, false, undefined, this),
      /* @__PURE__ */ u3(NumberStepper, {
        label: "Lore",
        value: modelUse.tokens.lore,
        min: 0,
        max: 16000,
        step: 100,
        integer: true,
        disabled: props.busy,
        onChange: (lore) => props.patch({ modelUse: { preset: "custom", tokens: { lore } } })
      }, undefined, false, undefined, this),
      props.meter ? /* @__PURE__ */ u3(Meter, {
        meter: props.meter
      }, undefined, false, undefined, this) : null
    ]
  }, undefined, true, undefined, this);
}
function Meter(props) {
  const rows = [
    ["This turn", props.meter.turn],
    ["Average", props.meter.average],
    ["95th pct", props.meter.p95]
  ];
  return /* @__PURE__ */ u3("div", {
    children: [
      /* @__PURE__ */ u3("div", {
        class: "lre-h",
        children: "Call meter"
      }, undefined, false, undefined, this),
      /* @__PURE__ */ u3("div", {
        class: "lre-meter",
        role: "table",
        "aria-label": "Call meter",
        children: [
          /* @__PURE__ */ u3("div", {
            role: "row",
            style: { display: "contents" },
            children: [
              /* @__PURE__ */ u3("span", {
                class: "hd",
                role: "columnheader",
                children: /* @__PURE__ */ u3("span", {
                  class: "lre-sr",
                  children: "Measure"
                }, undefined, false, undefined, this)
              }, undefined, false, undefined, this),
              /* @__PURE__ */ u3("span", {
                class: "hd",
                role: "columnheader",
                children: "Calls"
              }, undefined, false, undefined, this),
              /* @__PURE__ */ u3("span", {
                class: "hd",
                role: "columnheader",
                children: "Tokens"
              }, undefined, false, undefined, this),
              /* @__PURE__ */ u3("span", {
                class: "hd",
                role: "columnheader",
                children: "Time"
              }, undefined, false, undefined, this)
            ]
          }, undefined, true, undefined, this),
          rows.map(([label, m]) => /* @__PURE__ */ u3("div", {
            role: "row",
            style: { display: "contents" },
            children: [
              /* @__PURE__ */ u3("span", {
                role: "rowheader",
                children: label
              }, undefined, false, undefined, this),
              /* @__PURE__ */ u3("span", {
                role: "cell",
                children: m.calls.toFixed(m.calls % 1 === 0 ? 0 : 1)
              }, undefined, false, undefined, this),
              /* @__PURE__ */ u3("span", {
                role: "cell",
                children: Math.round(m.tokens)
              }, undefined, false, undefined, this),
              /* @__PURE__ */ u3("span", {
                role: "cell",
                children: [
                  (m.ms / 1000).toFixed(1),
                  " s"
                ]
              }, undefined, true, undefined, this)
            ]
          }, label, true, undefined, this))
        ]
      }, undefined, true, undefined, this)
    ]
  }, undefined, true, undefined, this);
}
function stepPatch(config) {
  const out = { enabled: config.enabled, signals: [...config.signals] };
  if (config.route)
    out.route = { provider: config.route.provider, connectionId: config.route.connectionId, model: config.route.model };
  if (config.template !== undefined)
    out.template = config.template;
  if (config.maxTokens !== undefined)
    out.maxTokens = config.maxTokens;
  return out;
}
function StepsSection(props) {
  const app = useApp();
  const [connections, setConnections] = d2([]);
  const [open, setOpen] = d2(null);
  A(() => {
    app.host.connections().then(setConnections);
  }, []);
  const update = (purpose, next) => props.patch({ modelUse: { preset: "custom", steps: { [purpose]: stepPatch(next) } } });
  return /* @__PURE__ */ u3("div", {
    class: "lre-list",
    children: Object.keys(STEP_LABEL).map((purpose) => {
      const config = props.modelUse.steps[purpose] ?? { enabled: false, signals: [] };
      const route = config.route ?? { provider: purpose === "select" || purpose === "npc.choose" ? "decision" : "helper", connectionId: null, model: null };
      const lowTokens = config.maxTokens !== undefined && config.maxTokens < 1500;
      return /* @__PURE__ */ u3("div", {
        class: "lre-card",
        "data-lre-step": purpose,
        children: [
          /* @__PURE__ */ u3("button", {
            type: "button",
            class: "lre-item",
            style: { border: 0, background: "transparent", padding: "0" },
            "aria-expanded": open === purpose,
            onClick: () => setOpen(open === purpose ? null : purpose),
            children: [
              /* @__PURE__ */ u3("span", {
                class: "grow",
                children: [
                  /* @__PURE__ */ u3("span", {
                    class: "title",
                    children: STEP_LABEL[purpose]
                  }, undefined, false, undefined, this),
                  /* @__PURE__ */ u3("span", {
                    class: "sub",
                    children: config.enabled ? `${route.provider === "decision" ? "Decision" : "Helper"}${route.connectionId ? ` · ${connections.find((c) => c.id === route.connectionId)?.name ?? route.connectionId}` : " · default connection"}` : "Off"
                  }, undefined, false, undefined, this)
                ]
              }, undefined, true, undefined, this),
              lowTokens ? /* @__PURE__ */ u3("span", {
                class: "lre-badge warn",
                children: "max tokens"
              }, undefined, false, undefined, this) : null,
              /* @__PURE__ */ u3("span", {
                class: "lre-dim",
                "aria-hidden": "true",
                children: open === purpose ? "▴" : "▾"
              }, undefined, false, undefined, this)
            ]
          }, undefined, true, undefined, this),
          open === purpose ? /* @__PURE__ */ u3("div", {
            class: "lre-stack",
            style: { marginTop: "8px" },
            children: [
              /* @__PURE__ */ u3(HostSwitch, {
                label: "Enabled",
                checked: config.enabled,
                disabled: props.busy,
                onChange: (enabled) => update(purpose, { ...config, enabled })
              }, undefined, false, undefined, this),
              /* @__PURE__ */ u3(Seg, {
                label: "Provider",
                value: route.provider,
                options: [
                  { value: "decision", label: "Decision" },
                  { value: "helper", label: "Helper" }
                ],
                disabled: props.busy,
                onChange: (provider) => update(purpose, { ...config, route: { ...route, provider } })
              }, undefined, false, undefined, this),
              /* @__PURE__ */ u3("label", {
                class: "lre-field",
                children: [
                  /* @__PURE__ */ u3("span", {
                    class: "label",
                    children: "Connection"
                  }, undefined, false, undefined, this),
                  /* @__PURE__ */ u3("select", {
                    class: "lre-input",
                    value: route.connectionId ?? "",
                    disabled: props.busy,
                    onChange: (event) => update(purpose, { ...config, route: { ...route, connectionId: event.currentTarget.value || null, model: null } }),
                    children: [
                      /* @__PURE__ */ u3("option", {
                        value: "",
                        children: "Default (the chat's helper)"
                      }, undefined, false, undefined, this),
                      connections.map((c) => /* @__PURE__ */ u3("option", {
                        value: c.id,
                        children: [
                          c.name,
                          c.model ? ` — ${c.model}` : ""
                        ]
                      }, c.id, true, undefined, this))
                    ]
                  }, undefined, true, undefined, this)
                ]
              }, undefined, true, undefined, this),
              route.connectionId ? /* @__PURE__ */ u3(HostModelPicker, {
                connectionId: route.connectionId,
                value: route.model ?? "",
                label: "Model",
                onChange: (model) => update(purpose, { ...config, route: { ...route, model: model || null } })
              }, undefined, false, undefined, this) : null,
              /* @__PURE__ */ u3(NumberStepper, {
                label: "Max tokens",
                value: config.maxTokens ?? null,
                min: 64,
                max: 32000,
                step: 100,
                integer: true,
                disabled: props.busy,
                onChange: (maxTokens) => update(purpose, { ...config, maxTokens })
              }, undefined, false, undefined, this),
              lowTokens ? /* @__PURE__ */ u3("div", {
                class: "lre-small lre-warn",
                children: "Reasoning models need about 1,500 or more; below that, calls can come back empty."
              }, undefined, false, undefined, this) : null,
              /* @__PURE__ */ u3("label", {
                class: "lre-field",
                children: [
                  /* @__PURE__ */ u3("span", {
                    class: "label",
                    children: "Signals (comma separated)"
                  }, undefined, false, undefined, this),
                  /* @__PURE__ */ u3("input", {
                    class: "lre-input",
                    value: config.signals.join(", "),
                    disabled: props.busy,
                    onChange: (event) => update(purpose, {
                      ...config,
                      signals: event.currentTarget.value.split(",").map((s) => s.trim()).filter((s) => s.length > 0)
                    })
                  }, undefined, false, undefined, this)
                ]
              }, undefined, true, undefined, this)
            ]
          }, undefined, true, undefined, this) : null
        ]
      }, purpose, true, undefined, this);
    })
  }, undefined, false, undefined, this);
}

// src/frontend/settings/settings.tsx
function Fold(props) {
  const expanded = props.open === props.id;
  return /* @__PURE__ */ u3("section", {
    class: "lre-card",
    "data-lre-settings": props.id,
    children: [
      /* @__PURE__ */ u3("button", {
        type: "button",
        class: "lre-item",
        style: { border: 0, background: "transparent", padding: 0 },
        "aria-expanded": expanded,
        onClick: () => props.setOpen(expanded ? null : props.id),
        children: [
          /* @__PURE__ */ u3("span", {
            class: "grow",
            children: [
              /* @__PURE__ */ u3("span", {
                class: "title",
                children: props.title
              }, undefined, false, undefined, this),
              props.summary ? /* @__PURE__ */ u3("span", {
                class: "sub",
                children: props.summary
              }, undefined, false, undefined, this) : null
            ]
          }, undefined, true, undefined, this),
          /* @__PURE__ */ u3("span", {
            class: "lre-dim",
            "aria-hidden": "true",
            children: expanded ? "▴" : "▾"
          }, undefined, false, undefined, this)
        ]
      }, undefined, true, undefined, this),
      expanded ? /* @__PURE__ */ u3("div", {
        style: { marginTop: "10px" },
        children: props.children
      }, undefined, false, undefined, this) : null
    ]
  }, undefined, true, undefined, this);
}
var EXTRACTION_LABEL = {
  time_advance: "Time passing",
  location: "Moving somewhere",
  condition: "Conditions (hurt, tired…)",
  knows: "Learning a fact",
  give: "Giving things",
  purchase: "Purchases",
  transfer: "Money transfers",
  regard: "Feelings toward others",
  quantity: "Quantities",
  spawn: "New people and things"
};
var MODE_OPTIONS = [
  { value: "auto", label: "Auto" },
  { value: "confirm", label: "Confirm" },
  { value: "never", label: "Never" }
];
function modeSource(view) {
  switch (view.source) {
    case "pinned":
      return "Pinned by you";
    case "learned":
      return `Learned on ${view.connection?.name ?? "this connection"} (${view.accepted} kept, ${view.rejected} rejected)`;
    case "default":
      return view.accepted + view.rejected > 0 ? `Default · learning (${view.accepted} kept, ${view.rejected} rejected)` : "Default";
    case "bound":
      return "From the field's bound";
  }
}
function ExtractionSection(props) {
  return /* @__PURE__ */ u3("div", {
    class: "lre-stack",
    children: [
      /* @__PURE__ */ u3("p", {
        class: "lre-small lre-muted",
        style: { margin: 0 },
        children: "What the engine may change from the reply's text. Setting a mode pins it; unpinned types learn from your confirms and undos on each connection."
      }, undefined, false, undefined, this),
      EXTRACTION_TYPES.map((type) => {
        const view = props.data.extraction[type];
        if (!view)
          return null;
        return /* @__PURE__ */ u3("div", {
          class: "lre-field",
          "data-lre-extraction": type,
          style: { paddingBottom: "6px", borderBottom: "1px solid rgba(127,127,127,.15)" },
          children: [
            /* @__PURE__ */ u3("div", {
              class: "lre-spread",
              children: [
                /* @__PURE__ */ u3("span", {
                  children: EXTRACTION_LABEL[type]
                }, undefined, false, undefined, this),
                view.source === "pinned" ? /* @__PURE__ */ u3("button", {
                  type: "button",
                  class: "lre-btn small ghost",
                  "aria-label": `Unpin ${EXTRACTION_LABEL[type]} and let it learn`,
                  disabled: props.busy,
                  onClick: () => props.patch({ extraction: { [type]: null } }),
                  children: "Unpin · let it learn"
                }, undefined, false, undefined, this) : null
              ]
            }, undefined, true, undefined, this),
            /* @__PURE__ */ u3(Seg, {
              label: EXTRACTION_LABEL[type],
              value: view.mode,
              options: MODE_OPTIONS,
              disabled: props.busy,
              onChange: (mode) => props.patch({ extraction: { [type]: { mode } } })
            }, undefined, false, undefined, this),
            /* @__PURE__ */ u3("span", {
              class: view.source === "learned" ? "lre-small lre-pos" : "lre-small lre-muted",
              children: modeSource(view)
            }, undefined, false, undefined, this)
          ]
        }, type, true, undefined, this);
      })
    ]
  }, undefined, true, undefined, this);
}
function BooksSection(props) {
  const app = useApp();
  const [books, setBooks] = d2(null);
  A(() => {
    app.host.worldBooks().then(setBooks, () => setBooks([]));
  }, []);
  const toggle = (id) => {
    const next = props.selected.includes(id) ? props.selected.filter((entry) => entry !== id) : [...props.selected, id];
    props.patch({ passThroughBooks: next });
  };
  return /* @__PURE__ */ u3("div", {
    class: "lre-stack",
    children: [
      /* @__PURE__ */ u3("p", {
        class: "lre-small lre-muted",
        style: { margin: 0 },
        children: "In world chats the engine decides what lore enters the context. Books checked here still activate natively."
      }, undefined, false, undefined, this),
      books === null ? /* @__PURE__ */ u3(Empty, {
        children: "Loading lore books…"
      }, undefined, false, undefined, this) : books.length === 0 ? /* @__PURE__ */ u3(Empty, {
        children: "No lore books."
      }, undefined, false, undefined, this) : /* @__PURE__ */ u3("div", {
        class: "lre-list",
        children: books.map((book) => /* @__PURE__ */ u3("label", {
          class: "lre-item",
          children: [
            /* @__PURE__ */ u3("span", {
              class: "lre-check",
              children: /* @__PURE__ */ u3("input", {
                type: "checkbox",
                checked: props.selected.includes(book.id),
                disabled: props.busy,
                onChange: () => toggle(book.id)
              }, undefined, false, undefined, this)
            }, undefined, false, undefined, this),
            /* @__PURE__ */ u3("span", {
              class: "grow",
              children: book.name
            }, undefined, false, undefined, this)
          ]
        }, book.id, true, undefined, this))
      }, undefined, false, undefined, this)
    ]
  }, undefined, true, undefined, this);
}
function PinsSection() {
  const app = useApp();
  const view = useView();
  const [world, setWorld] = d2(null);
  const [index, setIndex] = d2(null);
  const [busy, run] = useBusy();
  const worldId = view?.worldId ?? null;
  A(() => {
    if (!worldId)
      return;
    app.request({ type: "lre.world", op: "get", worldId, revision: view?.revision ?? undefined }).then((result) => setWorld(result?.world ?? null));
    app.request({ type: "lre.world", op: "list" }).then((result) => setIndex(result?.worlds?.find((w) => w.id === worldId) ?? null));
  }, [worldId, view?.revision]);
  if (!view || !worldId)
    return /* @__PURE__ */ u3(Empty, {
      children: "Open a world chat to see its pins."
    }, undefined, false, undefined, this);
  const behind = index !== null && view.revision !== null && index.head !== view.revision;
  return /* @__PURE__ */ u3("div", {
    class: "lre-stack",
    children: [
      /* @__PURE__ */ u3(Row, {
        k: "World",
        v: index?.name ?? world?.name ?? worldId
      }, undefined, false, undefined, this),
      /* @__PURE__ */ u3(Row, {
        k: "This chat's revision",
        v: /* @__PURE__ */ u3("code", {
          children: view.revision?.slice(0, 8) ?? "—"
        }, undefined, false, undefined, this),
        sub: behind ? "A newer revision exists." : "Up to date.",
        tone: behind ? "warn" : undefined
      }, undefined, false, undefined, this),
      behind && index ? /* @__PURE__ */ u3("button", {
        type: "button",
        class: "lre-btn primary",
        disabled: busy,
        onClick: () => run(async () => {
          const ok = await app.host.confirm("Upgrade world", "Upgrade this chat to the latest world revision? New tables and generators apply from here on; earlier turns keep what they showed.", "warning", "Upgrade");
          if (ok)
            await app.request({ type: "lre.world", op: "upgrade", chatId: view.chatId, to: index.head });
        }),
        children: "Upgrade to the latest revision"
      }, undefined, false, undefined, this) : null,
      world ? /* @__PURE__ */ u3(M, {
        children: [
          /* @__PURE__ */ u3("div", {
            class: "lre-h",
            children: "Generators"
          }, undefined, false, undefined, this),
          Object.keys(world.pins.generators).length === 0 ? /* @__PURE__ */ u3(Empty, {
            children: "None pinned."
          }, undefined, false, undefined, this) : Object.entries(world.pins.generators).map(([id, version]) => /* @__PURE__ */ u3(Row, {
            k: id,
            v: `v${version}`
          }, id, false, undefined, this)),
          /* @__PURE__ */ u3("div", {
            class: "lre-h",
            children: "Tables"
          }, undefined, false, undefined, this),
          Object.keys(world.pins.tables).length === 0 ? /* @__PURE__ */ u3(Empty, {
            children: "None pinned."
          }, undefined, false, undefined, this) : Object.entries(world.pins.tables).map(([id, revision]) => /* @__PURE__ */ u3(Row, {
            k: id,
            v: /* @__PURE__ */ u3("code", {
              children: revision.slice(0, 8)
            }, undefined, false, undefined, this)
          }, id, false, undefined, this))
        ]
      }, undefined, true, undefined, this) : null
    ]
  }, undefined, true, undefined, this);
}
var STATIC_CAVEATS = [
  "Other extensions' World Info interceptors still run; entries they force count as pins.",
  "If Council's own World Info is on, Council activates lore natively over your books in world chats.",
  "Settings seed new chats only. Change a running chat from Play (Calendar, realism for this chat).",
  "Undo covers the latest reply; earlier changes go through Keep or Discard."
];
function Settings() {
  const app = useApp();
  const view = useView();
  const [data, setData] = d2(null);
  const [failed, setFailed] = d2(false);
  const [open, setOpen] = d2("model");
  const [realismScope, setRealismScope] = d2("seed");
  const [busy, run] = useBusy();
  A(() => {
    app.request({ type: "lre.settings.get" }).then((result) => {
      if (result)
        setData(result);
      else
        setFailed(true);
    });
  }, []);
  const patch = (body) => run(async () => {
    const result = await app.request({ type: "lre.settings.set", patch: body });
    if (result)
      setData(result);
  });
  if (!data)
    return failed ? /* @__PURE__ */ u3(Empty, {
      children: "Settings could not be loaded."
    }, undefined, false, undefined, this) : /* @__PURE__ */ u3(Empty, {
      children: "Loading settings…"
    }, undefined, false, undefined, this);
  const { settings } = data;
  const fold = { open, setOpen };
  return /* @__PURE__ */ u3("div", {
    class: "lre-stack",
    "data-lre-section": "settings",
    children: [
      /* @__PURE__ */ u3(Fold, {
        id: "model",
        title: "Model use",
        summary: `${humanize(settings.modelUse.preset)} preset`,
        ...fold,
        children: /* @__PURE__ */ u3(ModelUseSection, {
          modelUse: settings.modelUse,
          meter: view?.meter ?? null,
          patch,
          busy
        }, undefined, false, undefined, this)
      }, undefined, false, undefined, this),
      /* @__PURE__ */ u3(Fold, {
        id: "realism",
        title: "Realism",
        summary: `${humanize(settings.realism.preset)} for new chats`,
        ...fold,
        children: /* @__PURE__ */ u3("div", {
          class: "lre-stack",
          children: [
            /* @__PURE__ */ u3(Seg, {
              label: "Realism scope",
              value: realismScope,
              options: [
                { value: "seed", label: "New chats" },
                { value: "chat", label: "This chat" }
              ],
              onChange: (next) => setRealismScope(next)
            }, undefined, false, undefined, this),
            realismScope === "seed" ? /* @__PURE__ */ u3(RealismSeed, {
              realism: settings.realism,
              patch,
              busy
            }, undefined, false, undefined, this) : /* @__PURE__ */ u3(RealismThisChat, {
              chatId: view?.chatId ?? "",
              controls: view?.status === "not_world" ? null : view?.controls ?? null
            }, undefined, false, undefined, this)
          ]
        }, undefined, true, undefined, this)
      }, undefined, false, undefined, this),
      /* @__PURE__ */ u3(Fold, {
        id: "time",
        title: "Time",
        summary: `${settings.time.scale}× · montage ${settings.time.montage}`,
        ...fold,
        children: [
          /* @__PURE__ */ u3("p", {
            class: "lre-small lre-muted",
            style: { margin: "0 0 8px" },
            children: "Seeds new chats. Pause the clock from the HUD or Play → Calendar (this chat only)."
          }, undefined, false, undefined, this),
          /* @__PURE__ */ u3(TimeControlsEditor, {
            values: { sceneTicks: settings.time.sceneTicks, scale: settings.time.scale, interrupts: settings.time.interrupts, speedThrough: settings.time.speedThrough, montage: settings.time.montage, unitCap: settings.time.unitCap, npcCalls: settings.time.npcCallsPerTimelapse },
            disabled: busy,
            onChange: (change) => {
              const body = settingsTimePatch(change);
              if (Object.keys(body).length > 0)
                patch(body);
            }
          }, undefined, false, undefined, this)
        ]
      }, undefined, true, undefined, this),
      /* @__PURE__ */ u3(Fold, {
        id: "extraction",
        title: "Changes from the reply",
        summary: "Auto, confirm or never, per type",
        ...fold,
        children: /* @__PURE__ */ u3(ExtractionSection, {
          data,
          patch,
          busy
        }, undefined, false, undefined, this)
      }, undefined, false, undefined, this),
      /* @__PURE__ */ u3(Fold, {
        id: "steps",
        title: "Steps and connections",
        summary: "Which model runs each step",
        ...fold,
        children: /* @__PURE__ */ u3(StepsSection, {
          modelUse: settings.modelUse,
          patch,
          busy
        }, undefined, false, undefined, this)
      }, undefined, false, undefined, this),
      /* @__PURE__ */ u3(Fold, {
        id: "books",
        title: "Pass-through lore books",
        summary: `${settings.passThroughBooks.length} selected`,
        ...fold,
        children: /* @__PURE__ */ u3(BooksSection, {
          selected: settings.passThroughBooks,
          patch,
          busy
        }, undefined, false, undefined, this)
      }, undefined, false, undefined, this),
      /* @__PURE__ */ u3(Fold, {
        id: "pins",
        title: "Pins and upgrade",
        summary: "World revision, tables and generators",
        ...fold,
        children: /* @__PURE__ */ u3(PinsSection, {}, undefined, false, undefined, this)
      }, undefined, false, undefined, this),
      /* @__PURE__ */ u3(Fold, {
        id: "swipes",
        title: "Swipes",
        summary: settings.swipeDefault === "rerun" ? "Re-run by default" : "Re-narrate by default",
        ...fold,
        children: /* @__PURE__ */ u3(Seg, {
          label: "Swipe default",
          value: settings.swipeDefault,
          options: [
            { value: "rerun", label: "Re-run (new roll)" },
            { value: "renarrate", label: "Re-narrate (same outcome)" }
          ],
          disabled: busy,
          onChange: (swipeDefault) => patch({ swipeDefault })
        }, undefined, false, undefined, this)
      }, undefined, false, undefined, this),
      /* @__PURE__ */ u3(Fold, {
        id: "caveats",
        title: "Caveats",
        summary: data.caveats.length > 0 ? `${data.caveats.length} active warning${data.caveats.length === 1 ? "" : "s"}` : undefined,
        ...fold,
        children: /* @__PURE__ */ u3("div", {
          class: "lre-stack",
          children: [
            data.caveats.map((caveat) => /* @__PURE__ */ u3("div", {
              class: "lre-banner warn",
              children: caveat.message
            }, caveat.code, false, undefined, this)),
            STATIC_CAVEATS.map((text) => /* @__PURE__ */ u3(Row, {
              k: text
            }, text, false, undefined, this))
          ]
        }, undefined, true, undefined, this)
      }, undefined, false, undefined, this)
    ]
  }, undefined, true, undefined, this);
}

// src/frontend/drawer.tsx
function Drawer(props) {
  const app = useApp();
  const section = useUi((ui) => ui.section);
  const viewport = useSelect(app.host.viewport, (vp) => vp);
  const root = T2(null);
  A(() => {
    const el = root.current;
    if (!el)
      return;
    const apply = () => el.style.setProperty("--lre-gutter", `${rightGutter(props.measure(el), viewport)}px`);
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(el);
    document.addEventListener("transitionend", apply, true);
    return () => {
      observer.disconnect();
      document.removeEventListener("transitionend", apply, true);
    };
  }, [viewport]);
  return /* @__PURE__ */ u3("div", {
    ref: root,
    class: "lre lre-drawer",
    "data-lre-panel": "drawer",
    "data-lre-active": section,
    children: [
      /* @__PURE__ */ u3("div", {
        class: "lre-top",
        children: /* @__PURE__ */ u3(Seg, {
          label: "LumiRPEngine sections",
          value: section,
          options: [
            { value: "play", label: "Play" },
            { value: "build", label: "Build" },
            { value: "settings", label: "Settings" }
          ],
          onChange: (next) => app.ui.update((ui) => ({ ...ui, section: next }))
        }, undefined, false, undefined, this)
      }, undefined, false, undefined, this),
      section === "play" ? /* @__PURE__ */ u3(Play, {}, undefined, false, undefined, this) : section === "build" ? /* @__PURE__ */ u3(Build, {}, undefined, false, undefined, this) : /* @__PURE__ */ u3(Settings, {}, undefined, false, undefined, this)
    ]
  }, undefined, true, undefined, this);
}

// src/frontend/host.ts
function readViewport(ui) {
  const size = ui.geometry ? ui.geometry.layoutViewportSize() : { width: window.innerWidth, height: window.innerHeight };
  return { width: Math.round(size.width), height: Math.round(size.height), coarse: window.matchMedia?.("(pointer: coarse)").matches === true };
}
function createHost(ctx) {
  const ui = ctx.ui;
  const viewport = createStore(readViewport(ui));
  const drawer = createStore({ open: ui.events.getDrawerState().open });
  const syncViewport = () => {
    const next = readViewport(ui);
    const current = viewport.get();
    if (next.width !== current.width || next.height !== current.height || next.coarse !== current.coarse)
      viewport.set(next);
  };
  window.addEventListener("resize", syncViewport);
  const coarse = window.matchMedia?.("(pointer: coarse)");
  coarse?.addEventListener("change", syncViewport);
  const offDrawer = ui.events.onDrawerChange((state) => {
    if (state.open !== drawer.get().open)
      drawer.set({ open: state.open });
  });
  return {
    ui,
    viewport,
    drawer,
    components: ctx.components,
    async confirm(title, message, variant, confirmLabel) {
      const result = await ui.showConfirm({ title, message, variant, confirmLabel });
      return result.confirmed;
    },
    async worldBooks() {
      if (!ctx.worldBooks)
        return [];
      const result = await ctx.worldBooks.list({ limit: 500 });
      const books = Array.isArray(result) ? result : isRecord(result) && Array.isArray(result.data) ? result.data : [];
      return books.flatMap((book) => isRecord(book) && typeof book.id === "string" ? [{ id: book.id, name: typeof book.name === "string" ? book.name : book.id }] : []);
    },
    async connections() {
      if (!ctx.connections)
        return [];
      const profiles = await ctx.connections.list();
      return profiles.map((profile) => ({ id: profile.id, name: profile.name, model: profile.model || null }));
    },
    download(fileName, text) {
      const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      anchor.style.display = "none";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
    activeChat: () => ctx.getActiveChat().chatId,
    async regenerate() {
      const surfaces = ctx.host.surfaces;
      if (!surfaces)
        return false;
      try {
        await surfaces.invoke({ kind: "command", id: "action-regenerate" });
        return true;
      } catch (error) {
        console.warn("[LumiRPEngine] regenerate failed", error);
        return false;
      }
    },
    dispose() {
      window.removeEventListener("resize", syncViewport);
      coarse?.removeEventListener("change", syncViewport);
      offDrawer();
    }
  };
}

// src/frontend/fix-editor.tsx
function initialText(target) {
  if (target.type === "money" && typeof target.value === "number")
    return (target.value / 100).toFixed(2);
  if (target.value === null || target.value === undefined)
    return "";
  return typeof target.value === "string" ? target.value : JSON.stringify(target.value);
}
function parseFixValue(target, text) {
  const trimmed = text.trim();
  if (target.type === "money") {
    if (!/^-?\d+(\.\d{0,2})?$/.test(trimmed))
      return null;
    return Math.round(Number(trimmed) * 100);
  }
  if (target.type === "number" || target.type === "duration") {
    if (trimmed === "" || !Number.isFinite(Number(trimmed)))
      return null;
    const value = Number(trimmed);
    if (target.min !== undefined && value < target.min || target.max !== undefined && value > target.max)
      return null;
    return value;
  }
  if (target.type === "bool")
    return trimmed === "true" ? true : trimmed === "false" ? false : null;
  if (target.type === "list") {
    try {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return trimmed;
}
function FixEditor(props) {
  const app = useApp();
  const view = useView();
  const { target } = props;
  const [text, setText] = d2(() => initialText(target));
  const [busy, run] = useBusy();
  const chatId = view?.chatId;
  if (!chatId)
    return null;
  const save = (value) => run(async () => {
    const result = await app.request(fixRequest(target, value, chatId));
    if (result) {
      if (result.pending)
        app.toast("Fix saved — it applies when the reply finishes.", "info");
      props.onDone();
    }
  });
  if (target.options && target.options.length > 0) {
    return /* @__PURE__ */ u3("div", {
      class: "lre-stack",
      "data-lre-fix": target.field,
      children: [
        /* @__PURE__ */ u3("div", {
          class: "lre-small lre-muted",
          children: [
            /* @__PURE__ */ u3("span", {
              "aria-hidden": "true",
              children: "✎"
            }, undefined, false, undefined, this),
            " Fix ",
            props.label.toLowerCase()
          ]
        }, undefined, true, undefined, this),
        /* @__PURE__ */ u3("div", {
          class: "lre-list",
          children: target.options.map((option) => /* @__PURE__ */ u3("button", {
            type: "button",
            class: "lre-item",
            "aria-current": JSON.stringify(option.value) === JSON.stringify(target.value),
            disabled: busy,
            onClick: () => save(option.value),
            children: /* @__PURE__ */ u3("span", {
              class: "grow",
              children: option.label
            }, undefined, false, undefined, this)
          }, JSON.stringify(option.value), false, undefined, this))
        }, undefined, false, undefined, this),
        /* @__PURE__ */ u3("button", {
          type: "button",
          class: "lre-btn ghost",
          onClick: props.onDone,
          children: "Cancel"
        }, undefined, false, undefined, this)
      ]
    }, undefined, true, undefined, this);
  }
  const parsed = parseFixValue(target, text);
  return /* @__PURE__ */ u3("form", {
    class: "lre-stack",
    "data-lre-fix": target.field,
    onSubmit: (event) => {
      event.preventDefault();
      if (parsed !== null)
        save(parsed);
    },
    children: [
      /* @__PURE__ */ u3("label", {
        class: "lre-field",
        children: [
          /* @__PURE__ */ u3("span", {
            class: "label",
            children: [
              /* @__PURE__ */ u3("span", {
                "aria-hidden": "true",
                children: "✎"
              }, undefined, false, undefined, this),
              " Fix ",
              props.label.toLowerCase()
            ]
          }, undefined, true, undefined, this),
          target.type === "bool" ? /* @__PURE__ */ u3("select", {
            class: "lre-input",
            value: text,
            onChange: (event) => setText(event.currentTarget.value),
            children: [
              /* @__PURE__ */ u3("option", {
                value: "true",
                children: "Yes"
              }, undefined, false, undefined, this),
              /* @__PURE__ */ u3("option", {
                value: "false",
                children: "No"
              }, undefined, false, undefined, this)
            ]
          }, undefined, true, undefined, this) : /* @__PURE__ */ u3("input", {
            class: parsed === null ? "lre-input invalid" : "lre-input",
            inputMode: target.type === "money" || target.type === "number" || target.type === "duration" ? "decimal" : "text",
            value: text,
            onInput: (event) => setText(event.currentTarget.value)
          }, undefined, false, undefined, this)
        ]
      }, undefined, true, undefined, this),
      /* @__PURE__ */ u3("div", {
        class: "lre-inline",
        children: [
          /* @__PURE__ */ u3("button", {
            type: "submit",
            class: "lre-btn primary",
            disabled: busy || parsed === null,
            children: "Save fix"
          }, undefined, false, undefined, this),
          /* @__PURE__ */ u3("button", {
            type: "button",
            class: "lre-btn ghost",
            onClick: props.onDone,
            children: "Cancel"
          }, undefined, false, undefined, this)
        ]
      }, undefined, true, undefined, this)
    ]
  }, undefined, true, undefined, this);
}

// src/frontend/hud.tsx
var FIX_LABEL = { place: "Place", weather: "Weather", cash: "Cash", scene: "Scene type" };
function cashText(cash) {
  if (!cash)
    return null;
  return "cents" in cash ? formatCents(cash.cents) : cash.band;
}
function clockText(hud) {
  const scale = hud.clock.scale !== 1 ? ` ${hud.clock.scale}×` : "";
  return `${hud.clock.paused ? "⏸ " : ""}${hud.clock.label}${scale}`;
}
function Hud(props) {
  const app = useApp();
  const view = useView();
  const viewport = useSelect(app.host.viewport, (vp) => vp);
  const [open, setOpen] = d2(false);
  const pill = T2(null);
  const pop = T2(null);
  const refocus = T2(false);
  const hud = view?.hud ?? null;
  const mode = hudMode(viewport);
  A(() => {
    const target = open ? pop.current : pill.current;
    if (!target)
      return;
    const measure = () => {
      const width = open ? Math.min(340, viewport.width - 24) : Math.ceil(target.scrollWidth) + 2;
      const height = open ? Math.min(Math.ceil(target.scrollHeight) + 2, viewport.height - 80) : 44;
      props.resize({ width, height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(target);
    return () => observer.disconnect();
  }, [open, mode, viewport.width, viewport.height, hud]);
  A(() => {
    if (open || !refocus.current)
      return;
    refocus.current = false;
    pill.current?.querySelector("button")?.focus();
  }, [open]);
  if (!view || !hud || view.status === "not_world")
    return null;
  if (open)
    return /* @__PURE__ */ u3(HudDetails, {
      view,
      hud,
      popRef: pop,
      onClose: () => {
        refocus.current = true;
        setOpen(false);
      }
    }, undefined, false, undefined, this);
  const cash = cashText(hud.cash);
  return /* @__PURE__ */ u3("div", {
    ref: pill,
    class: "lre-hud",
    "data-lre-hud": mode,
    role: "toolbar",
    "aria-label": "World status",
    children: [
      /* @__PURE__ */ u3("button", {
        type: "button",
        "aria-haspopup": "dialog",
        onClick: () => setOpen(true),
        "aria-label": `Time ${hud.clock.label}${hud.clock.paused ? ", clock paused" : ""}`,
        children: [
          /* @__PURE__ */ u3("span", {
            "aria-hidden": "true",
            children: "\uD83D\uDD50"
          }, undefined, false, undefined, this),
          " ",
          /* @__PURE__ */ u3("span", {
            class: "lre-num",
            children: clockText(hud)
          }, undefined, false, undefined, this)
        ]
      }, undefined, true, undefined, this),
      mode === "full" ? /* @__PURE__ */ u3(M, {
        children: [
          hud.place ? /* @__PURE__ */ u3("span", {
            class: "sep"
          }, undefined, false, undefined, this) : null,
          hud.place ? /* @__PURE__ */ u3("button", {
            type: "button",
            "aria-haspopup": "dialog",
            onClick: () => setOpen(true),
            children: [
              /* @__PURE__ */ u3("span", {
                "aria-hidden": "true",
                children: "\uD83D\uDCCD"
              }, undefined, false, undefined, this),
              " ",
              hud.place.name
            ]
          }, undefined, true, undefined, this) : null,
          hud.weather ? /* @__PURE__ */ u3("span", {
            class: "sep"
          }, undefined, false, undefined, this) : null,
          hud.weather ? /* @__PURE__ */ u3("button", {
            type: "button",
            "aria-haspopup": "dialog",
            "aria-label": `Weather ${hud.weather}`,
            onClick: () => setOpen(true),
            children: hud.weather
          }, undefined, false, undefined, this) : null,
          cash ? /* @__PURE__ */ u3("span", {
            class: "sep"
          }, undefined, false, undefined, this) : null,
          cash ? /* @__PURE__ */ u3("button", {
            type: "button",
            class: "lre-num",
            "aria-haspopup": "dialog",
            "aria-label": `Cash ${cash}`,
            onClick: () => setOpen(true),
            children: cash
          }, undefined, false, undefined, this) : null,
          Object.keys(hud.fixes).length > 0 ? /* @__PURE__ */ u3("button", {
            type: "button",
            "aria-haspopup": "dialog",
            "aria-label": "Fix a value",
            onClick: () => setOpen(true),
            children: "✎"
          }, undefined, false, undefined, this) : null
        ]
      }, undefined, true, undefined, this) : /* @__PURE__ */ u3("button", {
        type: "button",
        "aria-haspopup": "dialog",
        "aria-label": "Show place, weather and cash",
        onClick: () => setOpen(true),
        children: "▾"
      }, undefined, false, undefined, this),
      view.status === "in_flight" ? /* @__PURE__ */ u3("span", {
        class: "lre-badge accent",
        role: "img",
        "aria-label": "A turn is in progress",
        title: "A turn is in progress",
        children: "⋯"
      }, undefined, false, undefined, this) : null,
      view.status === "paused" ? /* @__PURE__ */ u3("span", {
        class: "lre-badge warn",
        children: "Paused"
      }, undefined, false, undefined, this) : null
    ]
  }, undefined, true, undefined, this);
}
function HudDetails(props) {
  const app = useApp();
  const { view, hud } = props;
  const [fixing, setFixing] = d2(null);
  const [busy, run] = useBusy();
  const fixes = hud.fixes;
  const fixButton = (key) => fixes[key] ? /* @__PURE__ */ u3("button", {
    type: "button",
    class: "lre-btn small ghost",
    "aria-label": `Fix ${FIX_LABEL[key]}`,
    onClick: () => setFixing(key),
    children: "✎"
  }, undefined, false, undefined, this) : null;
  const target = fixing ? fixes[fixing] : undefined;
  A(() => props.popRef.current?.focus(), []);
  return /* @__PURE__ */ u3("div", {
    ref: props.popRef,
    class: "lre-hud-pop",
    "data-lre-hud": "details",
    role: "dialog",
    "aria-label": "World details",
    tabIndex: -1,
    onKeyDown: (event) => {
      if (event.key !== "Escape")
        return;
      event.stopPropagation();
      props.onClose();
    },
    children: [
      /* @__PURE__ */ u3("div", {
        class: "lre-spread",
        children: [
          /* @__PURE__ */ u3("strong", {
            children: "World"
          }, undefined, false, undefined, this),
          /* @__PURE__ */ u3("button", {
            type: "button",
            class: "lre-btn small ghost",
            "aria-label": "Close world details",
            onClick: props.onClose,
            children: "✕"
          }, undefined, false, undefined, this)
        ]
      }, undefined, true, undefined, this),
      fixing && target ? /* @__PURE__ */ u3(FixEditor, {
        label: FIX_LABEL[fixing],
        target,
        onDone: () => setFixing(null)
      }, undefined, false, undefined, this) : /* @__PURE__ */ u3(M, {
        children: [
          /* @__PURE__ */ u3(Row, {
            k: "Time",
            sub: hud.clock.dayPart,
            v: /* @__PURE__ */ u3("span", {
              class: "lre-num",
              children: clockText(hud)
            }, undefined, false, undefined, this)
          }, undefined, false, undefined, this),
          /* @__PURE__ */ u3(Row, {
            k: "Place",
            v: /* @__PURE__ */ u3("span", {
              class: "lre-inline",
              children: [
                hud.place?.name ?? "—",
                fixButton("place")
              ]
            }, undefined, true, undefined, this)
          }, undefined, false, undefined, this),
          view.scene ? /* @__PURE__ */ u3(Row, {
            k: "Scene",
            sub: view.scene.elapsed > 0 ? `last turn ${formatMinutes(view.scene.elapsed)}` : undefined,
            v: /* @__PURE__ */ u3("span", {
              class: "lre-inline",
              children: [
                view.scene.sceneType,
                fixButton("scene")
              ]
            }, undefined, true, undefined, this)
          }, undefined, false, undefined, this) : null,
          /* @__PURE__ */ u3(Row, {
            k: "Weather",
            v: /* @__PURE__ */ u3("span", {
              class: "lre-inline",
              children: [
                hud.weather ?? "—",
                fixButton("weather")
              ]
            }, undefined, true, undefined, this)
          }, undefined, false, undefined, this),
          /* @__PURE__ */ u3(Row, {
            k: "Cash",
            v: /* @__PURE__ */ u3("span", {
              class: "lre-inline lre-num",
              children: [
                cashText(hud.cash) ?? "—",
                fixButton("cash")
              ]
            }, undefined, true, undefined, this)
          }, undefined, false, undefined, this),
          view.meter ? /* @__PURE__ */ u3(Row, {
            k: "This turn",
            v: `${view.meter.turn.calls} calls · ${(view.meter.turn.ms / 1000).toFixed(1)} s`,
            sub: `${view.meter.turn.tokens} tokens`
          }, undefined, false, undefined, this) : null,
          /* @__PURE__ */ u3("div", {
            class: "lre-inline",
            style: { marginTop: "8px" },
            children: [
              /* @__PURE__ */ u3("button", {
                type: "button",
                class: "lre-btn small",
                disabled: busy,
                onClick: () => run(async () => {
                  await app.request(timeMarker(view.chatId, "pause", { all: true }, !hud.clock.paused));
                }),
                children: [
                  /* @__PURE__ */ u3("span", {
                    "aria-hidden": "true",
                    children: hud.clock.paused ? "▶" : "⏸"
                  }, undefined, false, undefined, this),
                  " ",
                  hud.clock.paused ? "Resume clock" : "Pause clock"
                ]
              }, undefined, true, undefined, this),
              /* @__PURE__ */ u3("button", {
                type: "button",
                class: "lre-btn small",
                onClick: () => void app.overlays.openMap(),
                children: [
                  /* @__PURE__ */ u3("span", {
                    "aria-hidden": "true",
                    children: "\uD83D\uDDFA"
                  }, undefined, false, undefined, this),
                  " Map"
                ]
              }, undefined, true, undefined, this),
              /* @__PURE__ */ u3("button", {
                type: "button",
                class: "lre-btn small",
                onClick: () => void app.overlays.openPalette("actions"),
                children: [
                  /* @__PURE__ */ u3("span", {
                    "aria-hidden": "true",
                    children: "⚡"
                  }, undefined, false, undefined, this),
                  " Actions"
                ]
              }, undefined, true, undefined, this)
            ]
          }, undefined, true, undefined, this)
        ]
      }, undefined, true, undefined, this)
    ]
  }, undefined, true, undefined, this);
}

// src/frontend/overlay-controller.ts
class OverlayController {
  deps;
  constructor(deps) {
    this.deps = deps;
  }
  async open() {
    const plan = overlayPlan(this.deps.viewport(), this.deps.drawerOpen());
    if (plan.closeDrawer && !await this.deps.closeDrawer()) {
      this.deps.inDrawer();
      return "drawer";
    }
    this.deps.surface.show(plan.fullscreen);
    return "float";
  }
  close() {
    this.deps.surface.hide();
  }
  toggle() {
    if (!this.deps.surface.isVisible())
      return this.open();
    this.close();
    return Promise.resolve(null);
  }
}

// src/frontend/palette.tsx
var GROUP_LABEL = { action: "Actions", buy: "Buy", pay: "Pay", transfer: "Transfer", drive: "Drive", lend: "Lend" };
var GROUP_TAB = { action: "actions", buy: "buy", pay: "pay", transfer: "transfer", drive: "drive", lend: "lend" };
function paletteTabs(palette) {
  const tabs = [];
  for (const group of Object.keys(GROUP_LABEL)) {
    if (palette.entries.some((entry) => entry.group === group))
      tabs.push({ id: GROUP_TAB[group], label: GROUP_LABEL[group] });
  }
  if (palette.timelapse)
    tabs.push({ id: "timelapse", label: "Timelapse" });
  return tabs;
}
function PaletteSheet(props) {
  const view = useView();
  const [tab, setTab] = d2(props.tab);
  const panelId = P2();
  const palette = view?.palette ?? null;
  const tabs = palette ? paletteTabs(palette) : [];
  const active = tabs.some((entry) => entry.id === tab) ? tab : tabs[0]?.id ?? tab;
  return /* @__PURE__ */ u3("div", {
    class: props.desk ? "lre lre-sheet desk" : "lre lre-sheet",
    "data-lre-sheet": "palette",
    role: "dialog",
    "aria-label": "Actions",
    tabIndex: -1,
    onKeyDown: (event) => {
      if (event.key !== "Escape")
        return;
      event.stopPropagation();
      props.onClose();
    },
    children: [
      /* @__PURE__ */ u3("header", {
        children: [
          /* @__PURE__ */ u3("span", {
            class: "title",
            children: active === "timelapse" ? "Timelapse" : "Actions"
          }, undefined, false, undefined, this),
          /* @__PURE__ */ u3(ClockToggle, {
            view
          }, undefined, false, undefined, this),
          /* @__PURE__ */ u3("button", {
            type: "button",
            class: "lre-btn ghost",
            "aria-label": "Close actions",
            onClick: props.onClose,
            children: "✕"
          }, undefined, false, undefined, this)
        ]
      }, undefined, true, undefined, this),
      !view || view.status === "not_world" ? /* @__PURE__ */ u3("div", {
        class: "body",
        children: /* @__PURE__ */ u3(Empty, {
          children: "Open a world chat to use actions."
        }, undefined, false, undefined, this)
      }, undefined, false, undefined, this) : !palette || tabs.length === 0 ? /* @__PURE__ */ u3("div", {
        class: "body",
        children: /* @__PURE__ */ u3(Empty, {
          children: "No actions are available here right now."
        }, undefined, false, undefined, this)
      }, undefined, false, undefined, this) : /* @__PURE__ */ u3(M, {
        children: [
          /* @__PURE__ */ u3("div", {
            style: { padding: "8px 12px 0" },
            children: /* @__PURE__ */ u3(Tabs, {
              label: "Action groups",
              panelId,
              value: active,
              tabs,
              onChange: (id) => setTab(id)
            }, undefined, false, undefined, this)
          }, undefined, false, undefined, this),
          active === "timelapse" && palette.timelapse ? /* @__PURE__ */ u3(TimelapsePanel, {
            view,
            timelapse: palette.timelapse,
            panel: tabPanel(panelId, active),
            onSent: props.onClose
          }, undefined, false, undefined, this) : /* @__PURE__ */ u3(ActionList, {
            view,
            entries: palette.entries.filter((entry) => GROUP_TAB[entry.group] === active),
            panel: tabPanel(panelId, active),
            onSent: props.onClose
          }, active, false, undefined, this)
        ]
      }, undefined, true, undefined, this)
    ]
  }, undefined, true, undefined, this);
}
function ClockToggle(props) {
  const app = useApp();
  const [busy, run] = useBusy();
  const hud = props.view?.hud;
  const chatId = props.view?.chatId;
  if (!hud || !chatId)
    return null;
  return /* @__PURE__ */ u3("button", {
    type: "button",
    class: "lre-btn small",
    disabled: busy,
    onClick: () => run(async () => {
      await app.request(timeMarker(chatId, "pause", { all: true }, !hud.clock.paused));
    }),
    children: [
      /* @__PURE__ */ u3("span", {
        "aria-hidden": "true",
        children: hud.clock.paused ? "▶" : "⏸"
      }, undefined, false, undefined, this),
      " ",
      hud.clock.paused ? "Resume clock" : "Pause clock"
    ]
  }, undefined, true, undefined, this);
}
function OptionButton(props) {
  const { option } = props;
  return /* @__PURE__ */ u3("button", {
    type: "button",
    class: "lre-item",
    "aria-current": props.current,
    disabled: option.disabled !== undefined,
    title: option.disabled,
    onClick: props.onPick,
    children: [
      /* @__PURE__ */ u3("span", {
        class: "grow",
        children: [
          /* @__PURE__ */ u3("span", {
            class: "title",
            children: option.label
          }, undefined, false, undefined, this),
          /* @__PURE__ */ u3("span", {
            class: "sub",
            children: [option.detail, option.minutes !== undefined ? formatMinutes(option.minutes) : null, option.disabled].filter((part) => part).join(" · ")
          }, undefined, false, undefined, this),
          option.odds && option.odds.length > 0 ? /* @__PURE__ */ u3(OddsBar, {
            odds: option.odds
          }, undefined, false, undefined, this) : null
        ]
      }, undefined, true, undefined, this),
      option.cents !== undefined ? /* @__PURE__ */ u3("span", {
        class: "lre-num",
        children: formatCents(option.cents)
      }, undefined, false, undefined, this) : null
    ]
  }, undefined, true, undefined, this);
}
function samePick(a, b) {
  return a !== undefined && b !== undefined && JSON.stringify(a.params) === JSON.stringify(b.params);
}
function NextStep(props) {
  const ref = T2(null);
  const after = JSON.stringify(props.after.params);
  A(() => ref.current?.scrollIntoView({ block: "nearest", behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }), [after]);
  return /* @__PURE__ */ u3("div", {
    ref,
    class: "lre-stack",
    "data-lre-palette-step": props.step.param,
    style: { marginTop: "8px" },
    children: [
      /* @__PURE__ */ u3("div", {
        class: "lre-small lre-muted",
        children: [
          props.after.label,
          " → ",
          props.step.label
        ]
      }, undefined, true, undefined, this),
      props.step.options.length === 0 ? /* @__PURE__ */ u3(Empty, {
        children: [
          "No ",
          props.step.label.toLowerCase(),
          " available."
        ]
      }, undefined, true, undefined, this) : /* @__PURE__ */ u3("div", {
        class: "lre-list",
        children: props.step.options.map((option) => /* @__PURE__ */ u3(OptionButton, {
          option,
          current: samePick(props.chosen, option),
          onPick: () => props.onPick(option)
        }, JSON.stringify(option.params), false, undefined, this))
      }, undefined, false, undefined, this)
    ]
  }, undefined, true, undefined, this);
}
function ActionList(props) {
  const app = useApp();
  const [selected, setSelected] = d2(null);
  const [amount, setAmount] = d2("");
  const [count, setCount] = d2(null);
  const [busy, run] = useBusy();
  const amountCents = /^\d+(\.\d{0,2})?$/.test(amount.trim()) ? Math.round(Number(amount) * 100) : null;
  const range = selected?.entry.amount;
  const amountOk = !range || amountCents !== null && amountCents >= range.min && (range.max === null || amountCents <= range.max);
  const number = selected?.entry.number;
  const countValue = !number ? null : count === null ? number.default : /^\d+$/.test(count.trim()) ? Number(count) : null;
  const countOk = !number || countValue !== null && countValue >= number.min && (number.max === null || countValue <= number.max);
  const last = selected?.picks.at(-1);
  const pending = last?.next;
  const pick = (entry, depth, option) => {
    const same = selected?.entry.action === entry.action;
    const picks = same ? selected.picks.slice(0, depth) : [];
    const again = same && samePick(selected.picks[depth], option);
    if (!same)
      setCount(null);
    setSelected(again ? depth === 0 ? null : { entry, picks } : { entry, picks: [...picks, option] });
  };
  const go = () => {
    if (!selected || pending || !amountOk || !countOk)
      return;
    run(async () => {
      const result = await app.request(paletteRequest(selected.entry, selected.picks, props.view.chatId, range ? amountCents ?? undefined : undefined, countValue ?? undefined));
      if (result)
        props.onSent();
    });
  };
  const chain = selected ? selected.picks.map((p) => p.label).filter((part) => part !== selected.entry.label) : [];
  const label = !selected ? "Choose an action" : pending ? `Choose ${pending.label.toLowerCase()}` : chain.length > 0 ? `${selected.entry.label}: ${chain.join(" → ")}` : selected.entry.label;
  return /* @__PURE__ */ u3(M, {
    children: [
      /* @__PURE__ */ u3("div", {
        ...props.panel,
        class: "body",
        "data-lre-palette-list": true,
        children: props.entries.map((entry) => /* @__PURE__ */ u3("section", {
          class: "lre-card",
          children: [
            /* @__PURE__ */ u3("div", {
              class: "lre-h",
              children: [
                /* @__PURE__ */ u3("span", {
                  children: entry.label
                }, undefined, false, undefined, this),
                entry.amount ? /* @__PURE__ */ u3("span", {
                  class: "lre-badge",
                  children: "amount"
                }, undefined, false, undefined, this) : null
              ]
            }, undefined, true, undefined, this),
            /* @__PURE__ */ u3("div", {
              class: "lre-list",
              children: entry.options.map((option) => /* @__PURE__ */ u3(OptionButton, {
                option,
                current: selected?.entry.action === entry.action && samePick(selected.picks[0], option),
                onPick: () => pick(entry, 0, option)
              }, JSON.stringify(option.params), false, undefined, this))
            }, undefined, false, undefined, this),
            selected?.entry.action === entry.action ? selected.picks.map((chosen, depth) => chosen.next ? /* @__PURE__ */ u3(NextStep, {
              after: chosen,
              step: chosen.next,
              chosen: selected.picks[depth + 1],
              onPick: (option) => pick(entry, depth + 1, option)
            }, `${depth}:${JSON.stringify(chosen.params)}`, false, undefined, this) : null) : null
          ]
        }, entry.action, true, undefined, this))
      }, undefined, false, undefined, this),
      /* @__PURE__ */ u3("footer", {
        children: [
          range ? /* @__PURE__ */ u3("input", {
            class: amountOk ? "lre-input" : "lre-input invalid",
            style: { flex: 1 },
            inputMode: "decimal",
            placeholder: `Amount ($${(range.min / 100).toFixed(2)}${range.max !== null ? `–$${(range.max / 100).toFixed(2)}` : "+"})`,
            "aria-label": "Amount in dollars",
            value: amount,
            onInput: (event) => setAmount(event.currentTarget.value)
          }, undefined, false, undefined, this) : null,
          number ? /* @__PURE__ */ u3("label", {
            class: "lre-inline",
            style: { flex: "0 0 auto", gap: "6px" },
            children: [
              /* @__PURE__ */ u3("input", {
                class: countOk ? "lre-input" : "lre-input invalid",
                style: { width: "64px" },
                inputMode: "numeric",
                "aria-label": `Number of ${number.label}`,
                value: count ?? String(number.default),
                onInput: (event) => setCount(event.currentTarget.value)
              }, undefined, false, undefined, this),
              /* @__PURE__ */ u3("span", {
                class: "lre-small",
                children: number.label
              }, undefined, false, undefined, this)
            ]
          }, undefined, true, undefined, this) : null,
          /* @__PURE__ */ u3("button", {
            type: "button",
            class: "lre-btn primary",
            style: { flex: range ? "0 0 auto" : 1 },
            disabled: !selected || pending !== undefined || !amountOk || !countOk || busy,
            onClick: go,
            "data-lre-go": true,
            children: label
          }, undefined, false, undefined, this)
        ]
      }, undefined, true, undefined, this)
    ]
  }, undefined, true, undefined, this);
}
var UNIT_MINUTES = { min: 1, h: 60, d: 1440, w: 10080 };
var POLICY_OPTIONS2 = [
  { value: "stop", label: "Stop" },
  { value: "note", label: "Note" },
  { value: "ignore", label: "Ignore" }
];
function TimelapsePanel(props) {
  const app = useApp();
  const { timelapse } = props;
  const [target, setTarget] = d2(null);
  const [custom, setCustom] = d2("");
  const [unit, setUnit] = d2("h");
  const [overrides, setOverrides] = d2({});
  const [showPolicy, setShowPolicy] = d2(false);
  const [busy, run] = useBusy();
  const customMinutes = /^\d+(\.\d+)?$/.test(custom.trim()) ? Number(custom) * UNIT_MINUTES[unit] : null;
  const chosen = customMinutes !== null && customMinutes > 0 ? { type: "duration", minutes: customMinutes } : target;
  const sameTarget = (a, b) => a !== null && JSON.stringify(a) === JSON.stringify(b);
  const changed = Object.entries(overrides).filter(([cls, policy]) => timelapse.interrupts[cls] !== policy).length;
  return /* @__PURE__ */ u3(M, {
    children: [
      /* @__PURE__ */ u3("div", {
        ...props.panel,
        class: "body",
        "data-lre-timelapse": true,
        children: [
          timelapse.blocked ? /* @__PURE__ */ u3("div", {
            class: "lre-banner warn",
            children: /* @__PURE__ */ u3("span", {
              children: timelapse.blocked
            }, undefined, false, undefined, this)
          }, undefined, false, undefined, this) : null,
          /* @__PURE__ */ u3("section", {
            class: "lre-card",
            children: [
              /* @__PURE__ */ u3("div", {
                class: "lre-h",
                children: "For"
              }, undefined, false, undefined, this),
              /* @__PURE__ */ u3("div", {
                class: "lre-inline",
                children: timelapse.durations.map((minutes) => {
                  const t = { type: "duration", minutes };
                  return /* @__PURE__ */ u3("button", {
                    type: "button",
                    class: sameTarget(chosen, t) ? "lre-btn primary" : "lre-btn",
                    onClick: () => {
                      setCustom("");
                      setTarget(t);
                    },
                    children: formatMinutes(minutes)
                  }, minutes, false, undefined, this);
                })
              }, undefined, false, undefined, this),
              /* @__PURE__ */ u3("div", {
                class: "lre-inline",
                style: { marginTop: "8px" },
                children: [
                  /* @__PURE__ */ u3("input", {
                    class: "lre-input",
                    style: { width: "96px" },
                    inputMode: "decimal",
                    placeholder: "Custom",
                    "aria-label": "Custom duration",
                    value: custom,
                    onInput: (event) => setCustom(event.currentTarget.value)
                  }, undefined, false, undefined, this),
                  /* @__PURE__ */ u3("div", {
                    style: { flex: 1, minWidth: "180px" },
                    children: /* @__PURE__ */ u3(Seg, {
                      label: "Unit",
                      value: unit,
                      options: [
                        { value: "min", label: "min" },
                        { value: "h", label: "hours" },
                        { value: "d", label: "days" },
                        { value: "w", label: "weeks" }
                      ],
                      onChange: (next) => setUnit(next)
                    }, undefined, false, undefined, this)
                  }, undefined, false, undefined, this)
                ]
              }, undefined, true, undefined, this),
              timelapse.dayParts ? /* @__PURE__ */ u3("div", {
                class: "lre-small lre-muted",
                style: { marginTop: "6px" },
                children: "Calendar is at Narrative: times round to day parts."
              }, undefined, false, undefined, this) : null
            ]
          }, undefined, true, undefined, this),
          timelapse.until.length > 0 ? /* @__PURE__ */ u3("section", {
            class: "lre-card",
            children: [
              /* @__PURE__ */ u3("div", {
                class: "lre-h",
                children: "Until"
              }, undefined, false, undefined, this),
              /* @__PURE__ */ u3("div", {
                class: "lre-list",
                children: timelapse.until.map((entry) => /* @__PURE__ */ u3("button", {
                  type: "button",
                  class: "lre-item",
                  "aria-current": customMinutes === null && sameTarget(target, entry.target),
                  onClick: () => {
                    setCustom("");
                    setTarget(entry.target);
                  },
                  children: /* @__PURE__ */ u3("span", {
                    class: "grow",
                    children: [
                      /* @__PURE__ */ u3("span", {
                        class: "title",
                        children: entry.label
                      }, undefined, false, undefined, this),
                      entry.detail ? /* @__PURE__ */ u3("span", {
                        class: "sub",
                        children: entry.detail
                      }, undefined, false, undefined, this) : null
                    ]
                  }, undefined, true, undefined, this)
                }, JSON.stringify(entry.target), false, undefined, this))
              }, undefined, false, undefined, this)
            ]
          }, undefined, true, undefined, this) : null,
          /* @__PURE__ */ u3("section", {
            class: "lre-card",
            children: [
              /* @__PURE__ */ u3("button", {
                type: "button",
                class: "lre-btn ghost block",
                "aria-expanded": showPolicy,
                onClick: () => setShowPolicy(!showPolicy),
                children: [
                  "Interrupts for this run",
                  changed > 0 ? ` · ${changed} changed` : "",
                  " ",
                  /* @__PURE__ */ u3("span", {
                    "aria-hidden": "true",
                    children: showPolicy ? "▴" : "▾"
                  }, undefined, false, undefined, this)
                ]
              }, undefined, true, undefined, this),
              showPolicy ? INTERRUPT_CLASSES.map((cls) => /* @__PURE__ */ u3("div", {
                class: "lre-field",
                style: { marginTop: "8px" },
                children: [
                  /* @__PURE__ */ u3("span", {
                    class: "label",
                    children: humanize(cls)
                  }, undefined, false, undefined, this),
                  /* @__PURE__ */ u3(Seg, {
                    label: humanize(cls),
                    value: overrides[cls] ?? timelapse.interrupts[cls],
                    options: POLICY_OPTIONS2,
                    onChange: (policy) => setOverrides((prev) => ({ ...prev, [cls]: policy }))
                  }, undefined, false, undefined, this)
                ]
              }, cls, true, undefined, this)) : null
            ]
          }, undefined, true, undefined, this)
        ]
      }, undefined, true, undefined, this),
      /* @__PURE__ */ u3("footer", {
        children: /* @__PURE__ */ u3("button", {
          type: "button",
          class: "lre-btn primary block",
          "data-lre-go": true,
          disabled: !chosen || timelapse.blocked !== null || busy,
          onClick: () => {
            if (!chosen)
              return;
            run(async () => {
              const result = await app.request(timelapseRequest(timelapse, chosen, overrides, props.view.chatId));
              if (result)
                props.onSent();
            });
          },
          children: chosen ? `Timelapse ${chosen.type === "duration" ? formatMinutes(chosen.minutes) : (timelapse.until.find((entry) => sameTarget(chosen, entry.target))?.label ?? "").toLowerCase()}` : "Choose how long"
        }, undefined, false, undefined, this)
      }, undefined, false, undefined, this)
    ]
  }, undefined, true, undefined, this);
}

// src/frontend/overlays.tsx
function MapFrame(props) {
  const app = useApp();
  const view = useView();
  const panel = app.catalog.panels.find((p) => p.id === "space.map");
  return /* @__PURE__ */ u3("div", {
    class: props.fullscreen ? "lre lre-overlay-root lre-map full" : "lre lre-overlay-root lre-map",
    "data-lre-overlay": "map",
    role: "dialog",
    "aria-label": "World map",
    tabIndex: -1,
    style: { position: "relative" },
    onKeyDown: (event) => {
      if (event.key !== "Escape")
        return;
      event.stopPropagation();
      props.onClose();
    },
    children: [
      view && panel ? /* @__PURE__ */ u3(panel.component, {
        chatId: view.chatId,
        view: view.panels["space.map"] ?? null,
        state: view,
        send: app.send
      }, undefined, false, undefined, this) : /* @__PURE__ */ u3(Empty, {
        children: "No map for this chat."
      }, undefined, false, undefined, this),
      /* @__PURE__ */ u3("div", {
        class: "bar",
        children: [
          /* @__PURE__ */ u3("span", {
            class: "title",
            children: [
              /* @__PURE__ */ u3("span", {
                "aria-hidden": "true",
                children: "\uD83D\uDDFA"
              }, undefined, false, undefined, this),
              " ",
              view?.hud?.place?.name ?? "Map"
            ]
          }, undefined, true, undefined, this),
          /* @__PURE__ */ u3("button", {
            type: "button",
            class: "lre-btn",
            "aria-label": props.fullscreen ? "Exit fullscreen" : "Fullscreen",
            onClick: props.onToggleFullscreen,
            "data-lre-btn": "fullscreen",
            children: /* @__PURE__ */ u3("span", {
              "aria-hidden": "true",
              children: props.fullscreen ? "⤡" : "⤢"
            }, undefined, false, undefined, this)
          }, undefined, false, undefined, this),
          /* @__PURE__ */ u3("button", {
            type: "button",
            class: "lre-btn",
            "aria-label": "Close map",
            onClick: props.onClose,
            children: "✕"
          }, undefined, false, undefined, this)
        ]
      }, undefined, true, undefined, this),
      /* @__PURE__ */ u3(Toasts, {
        surface: "map"
      }, undefined, false, undefined, this)
    ]
  }, undefined, true, undefined, this);
}

class WidgetSurface {
  create;
  paint;
  onVisible;
  widget = null;
  constructor(create, paint, onVisible) {
    this.create = create;
    this.paint = paint;
    this.onVisible = onVisible;
  }
  show(fullscreen) {
    if (!this.widget) {
      this.widget = this.create();
      this.widget.root.style.width = "100%";
      this.widget.root.style.height = "100%";
    }
    const widget = this.widget;
    widget.setVisible(true);
    if (typeof widget.setFullscreen === "function" && widget.isFullscreen() !== fullscreen)
      widget.setFullscreen(fullscreen);
    this.paint(widget, fullscreen);
    widget.root.querySelector('[role="dialog"]')?.focus();
    this.onVisible(true);
  }
  hide() {
    if (!this.widget)
      return;
    if (typeof this.widget.setFullscreen === "function" && this.widget.isFullscreen())
      this.widget.setFullscreen(false);
    this.widget.setVisible(false);
    this.onVisible(false);
  }
  isVisible() {
    return this.widget?.isVisible() ?? false;
  }
  toggleFullscreen() {
    const widget = this.widget;
    if (!widget || typeof widget.setFullscreen !== "function")
      return;
    const next = !widget.isFullscreen();
    widget.setFullscreen(next);
    this.paint(widget, next);
  }
  destroy() {
    if (!this.widget)
      return;
    G(null, this.widget.root);
    this.widget.destroy();
    this.widget = null;
  }
}
function createOverlays(app, host) {
  let paletteTab = "actions";
  const setOverlay = (kind, visible) => app.ui.update((ui) => ({ ...ui, overlay: visible ? kind : ui.overlay === kind ? null : ui.overlay }));
  const map = new WidgetSurface(() => {
    const rect = mapFloatRect(host.viewport.get());
    return host.ui.createFloatWidget({ width: rect.width, height: rect.height, initialPosition: { x: rect.x, y: rect.y }, chromeless: true, tooltip: "LumiRPEngine map", resizable: true, persistGeometry: rect.key, bounds: { minWidth: 280, minHeight: 240 } });
  }, (widget, fullscreen) => G(/* @__PURE__ */ u3(AppContext.Provider, {
    value: app,
    children: /* @__PURE__ */ u3(MapFrame, {
      fullscreen,
      onToggleFullscreen: () => map.toggleFullscreen(),
      onClose: () => mapControl.close()
    }, undefined, false, undefined, this)
  }, undefined, false, undefined, this), widget.root), (visible) => setOverlay("map", visible));
  const palette = new WidgetSurface(() => {
    const rect = sheetRect(host.viewport.get(), 0.62);
    return host.ui.createFloatWidget({ width: rect.width, height: rect.height, initialPosition: { x: rect.x, y: rect.y }, chromeless: true, tooltip: "LumiRPEngine actions", mobileClamp: false });
  }, (widget) => {
    const vp = host.viewport.get();
    const rect = sheetRect(vp, 0.62);
    widget.setSize(rect.width, rect.height);
    widget.moveTo(rect.x, rect.y);
    G(/* @__PURE__ */ u3(AppContext.Provider, {
      value: app,
      children: /* @__PURE__ */ u3("div", {
        class: "lre-overlay-root",
        "data-lre-overlay": "palette",
        children: [
          /* @__PURE__ */ u3(PaletteSheet, {
            tab: paletteTab,
            desk: rect.width < vp.width,
            onClose: () => paletteControl.close()
          }, `${paletteTab}:${Date.now()}`, false, undefined, this),
          /* @__PURE__ */ u3(Toasts, {
            surface: "palette"
          }, undefined, false, undefined, this)
        ]
      }, undefined, true, undefined, this)
    }, undefined, false, undefined, this), widget.root);
  }, (visible) => setOverlay("palette", visible));
  const closeDrawer = async () => {
    const message = await app.send({ type: "lre.ui", op: "close_drawer" });
    return message.type === "lre.result";
  };
  const mapControl = new OverlayController({
    viewport: () => host.viewport.get(),
    drawerOpen: () => host.drawer.get().open,
    closeDrawer,
    surface: map,
    inDrawer: () => app.ui.update((ui) => ({ ...ui, section: "play", playPanel: "space.map", mapInDrawer: true }))
  });
  const paletteControl = new OverlayController({
    viewport: () => host.viewport.get(),
    drawerOpen: () => host.drawer.get().open,
    closeDrawer,
    surface: { show: () => palette.show(false), hide: () => palette.hide(), isVisible: () => palette.isVisible() },
    inDrawer: () => app.toast("Close the drawer to use the action sheet.", "error")
  });
  return {
    async open(kind, tab) {
      if (kind === "palette") {
        paletteTab = tab ?? "actions";
        map.hide();
        await paletteControl.open();
      } else {
        palette.hide();
        await mapControl.open();
      }
    },
    close(kind) {
      if (kind === "map")
        mapControl.close();
      else
        paletteControl.close();
    },
    destroy() {
      map.destroy();
      palette.destroy();
    }
  };
}

// src/packs/calendar/ui/schedule-editor.tsx
var WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
var TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
function minutesOf(time) {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}
function slotProblems(slots) {
  const problems = [];
  const spans = [];
  slots.forEach((slot, index) => {
    if (!TIME.test(slot.start) || !TIME.test(slot.end)) {
      problems.push(`Slot ${index + 1}: times must be HH:MM`);
      return;
    }
    const start = minutesOf(slot.start);
    const end = minutesOf(slot.end);
    if (end > start)
      spans.push({ start, end, index });
    else {
      spans.push({ start, end: 1440, index });
      if (end > 0)
        spans.push({ start: 0, end, index });
    }
    if (slot.value === undefined && !slot.weighted && !slot.given)
      problems.push(`Slot ${index + 1}: no value`);
    if (slot.weighted && slot.weighted.reduce((sum, w) => sum + w.weight, 0) <= 0)
      problems.push(`Slot ${index + 1}: weights must add up to more than 0`);
  });
  spans.sort((a, b) => a.start - b.start);
  for (let i = 1;i < spans.length; i += 1) {
    const prev = spans[i - 1];
    const cur = spans[i];
    if (prev && cur && cur.start < prev.end && prev.index !== cur.index)
      problems.push(`Slots ${prev.index + 1} and ${cur.index + 1} overlap`);
  }
  return [...new Set(problems)];
}
function slotLabel(slot) {
  if (slot.value !== undefined)
    return typeof slot.value === "string" ? slot.value : JSON.stringify(slot.value);
  if (slot.weighted)
    return slot.weighted.map((w) => typeof w.value === "string" ? w.value : JSON.stringify(w.value)).join(" / ");
  return "given";
}
function JsonField(props) {
  const [text, setText] = d2(props.value === undefined ? "" : JSON.stringify(props.value));
  const [bad, setBad] = d2(false);
  A(() => setText(props.value === undefined ? "" : JSON.stringify(props.value)), [JSON.stringify(props.value)]);
  return /* @__PURE__ */ u3("label", {
    class: "lre-field",
    children: [
      /* @__PURE__ */ u3("span", {
        class: "label",
        children: props.label
      }, undefined, false, undefined, this),
      /* @__PURE__ */ u3("input", {
        class: bad ? "lre-input invalid" : "lre-input",
        value: text,
        onInput: (event) => setText(event.currentTarget.value),
        onBlur: () => {
          if (text.trim() === "") {
            setBad(false);
            props.onChange(undefined);
            return;
          }
          try {
            props.onChange(JSON.parse(text));
            setBad(false);
          } catch {
            props.onChange(text.trim());
            setBad(false);
          }
        }
      }, undefined, false, undefined, this)
    ]
  }, undefined, true, undefined, this);
}
function ScheduleEditor(props) {
  const app = useApp();
  const isNew = props.id?.startsWith("new:") ?? false;
  const id = isNew ? (props.id ?? "").slice(4) : props.id;
  const stored = id ? props.world.schedules[id] : undefined;
  const blank = { id: id ?? "", target: "place", recurrence: { every: "day" }, slots: [{ start: "09:00", end: "17:00", value: "work" }] };
  const [schedule, setSchedule] = d2(stored ? structuredClone(stored) : blank);
  const [selected, setSelected] = d2(0);
  const [busy, run] = useBusy();
  A(() => setSchedule(stored ? structuredClone(stored) : blank), [JSON.stringify(stored)]);
  const problems = b2(() => slotProblems(schedule.slots), [schedule.slots]);
  if (!id)
    return /* @__PURE__ */ u3("span", {
      class: "lre-muted",
      children: "Choose a schedule."
    }, undefined, false, undefined, this);
  const rec = schedule.recurrence;
  const setRec = (next) => setSchedule({ ...schedule, recurrence: next });
  const slot = schedule.slots[selected];
  const setSlot = (next) => setSchedule({ ...schedule, slots: schedule.slots.map((s, i) => i === selected ? next : s) });
  const changed = JSON.stringify(schedule) !== JSON.stringify(stored ?? null);
  const owners = [...Object.keys(props.world.entities), ...Object.keys(props.world.kinds)];
  return /* @__PURE__ */ u3("div", {
    class: "lre-stack",
    "data-lre-editor": "schedules",
    children: [
      /* @__PURE__ */ u3("div", {
        class: "lre-h2",
        children: /* @__PURE__ */ u3("code", {
          children: id
        }, undefined, false, undefined, this)
      }, undefined, false, undefined, this),
      /* @__PURE__ */ u3("label", {
        class: "lre-field",
        children: [
          /* @__PURE__ */ u3("span", {
            class: "label",
            children: "Owner (entity or kind; empty for a world process)"
          }, undefined, false, undefined, this),
          /* @__PURE__ */ u3("input", {
            class: "lre-input",
            list: "lre-schedule-owners",
            value: schedule.owner ?? "",
            onChange: (event) => setSchedule({ ...schedule, owner: event.currentTarget.value || undefined })
          }, undefined, false, undefined, this),
          /* @__PURE__ */ u3("datalist", {
            id: "lre-schedule-owners",
            children: owners.map((o) => /* @__PURE__ */ u3("option", {
              value: o
            }, o, false, undefined, this))
          }, undefined, false, undefined, this)
        ]
      }, undefined, true, undefined, this),
      /* @__PURE__ */ u3("label", {
        class: "lre-field",
        children: [
          /* @__PURE__ */ u3("span", {
            class: "label",
            children: "Sets (place, activity, weather, price…)"
          }, undefined, false, undefined, this),
          /* @__PURE__ */ u3("input", {
            class: "lre-input",
            value: schedule.target,
            onChange: (event) => setSchedule({ ...schedule, target: event.currentTarget.value })
          }, undefined, false, undefined, this)
        ]
      }, undefined, true, undefined, this),
      /* @__PURE__ */ u3("section", {
        class: "lre-card",
        children: [
          /* @__PURE__ */ u3("div", {
            class: "lre-h",
            children: "Repeats"
          }, undefined, false, undefined, this),
          /* @__PURE__ */ u3(Seg, {
            label: "Every",
            value: rec.every,
            options: [
              { value: "day", label: "Daily" },
              { value: "week", label: "Weekly" },
              { value: "month", label: "Monthly" },
              { value: "year", label: "Yearly" }
            ],
            onChange: (every) => setRec({ ...rec, every })
          }, undefined, false, undefined, this),
          rec.every === "week" ? /* @__PURE__ */ u3("div", {
            class: "lre-seg",
            style: { marginTop: "8px" },
            role: "group",
            "aria-label": "Weekdays",
            children: WEEKDAYS.map((day, i) => {
              const on = rec.weekdays?.includes(i) ?? false;
              return /* @__PURE__ */ u3("button", {
                type: "button",
                "aria-pressed": on,
                onClick: () => setRec({ ...rec, weekdays: on ? (rec.weekdays ?? []).filter((d) => d !== i) : [...rec.weekdays ?? [], i].sort() }),
                children: day
              }, day, false, undefined, this);
            })
          }, undefined, false, undefined, this) : null,
          rec.every === "month" ? /* @__PURE__ */ u3("label", {
            class: "lre-field",
            style: { marginTop: "8px" },
            children: [
              /* @__PURE__ */ u3("span", {
                class: "label",
                children: "Days of the month (comma separated)"
              }, undefined, false, undefined, this),
              /* @__PURE__ */ u3("input", {
                class: "lre-input",
                value: (rec.days ?? []).join(", "),
                onChange: (event) => setRec({ ...rec, days: event.currentTarget.value.split(",").map((d) => Number(d.trim())).filter((d) => Number.isInteger(d) && d >= 1 && d <= 31) })
              }, undefined, false, undefined, this)
            ]
          }, undefined, true, undefined, this) : null,
          props.world.calendar.holidays.length > 0 ? /* @__PURE__ */ u3("div", {
            class: "lre-field",
            style: { marginTop: "8px" },
            children: [
              /* @__PURE__ */ u3("span", {
                class: "label",
                children: "Not on"
              }, undefined, false, undefined, this),
              /* @__PURE__ */ u3("div", {
                class: "lre-inline",
                children: props.world.calendar.holidays.map((h) => {
                  const on = rec.except?.includes(h.id) ?? false;
                  return /* @__PURE__ */ u3("button", {
                    type: "button",
                    class: on ? "lre-btn small primary" : "lre-btn small",
                    "aria-pressed": on,
                    onClick: () => setRec({ ...rec, except: on ? (rec.except ?? []).filter((e) => e !== h.id) : [...rec.except ?? [], h.id] }),
                    children: h.label
                  }, h.id, false, undefined, this);
                })
              }, undefined, false, undefined, this)
            ]
          }, undefined, true, undefined, this) : null,
          /* @__PURE__ */ u3("div", {
            class: "lre-inline",
            style: { marginTop: "8px" },
            children: [
              /* @__PURE__ */ u3("label", {
                class: "lre-field",
                style: { flex: 1 },
                children: [
                  /* @__PURE__ */ u3("span", {
                    class: "label",
                    children: "From"
                  }, undefined, false, undefined, this),
                  /* @__PURE__ */ u3("input", {
                    class: "lre-input",
                    type: "date",
                    value: rec.from ?? "",
                    onChange: (event) => setRec({ ...rec, from: event.currentTarget.value || undefined })
                  }, undefined, false, undefined, this)
                ]
              }, undefined, true, undefined, this),
              /* @__PURE__ */ u3("label", {
                class: "lre-field",
                style: { flex: 1 },
                children: [
                  /* @__PURE__ */ u3("span", {
                    class: "label",
                    children: "Until"
                  }, undefined, false, undefined, this),
                  /* @__PURE__ */ u3("input", {
                    class: "lre-input",
                    type: "date",
                    value: rec.until ?? "",
                    onChange: (event) => setRec({ ...rec, until: event.currentTarget.value || undefined })
                  }, undefined, false, undefined, this)
                ]
              }, undefined, true, undefined, this)
            ]
          }, undefined, true, undefined, this)
        ]
      }, undefined, true, undefined, this),
      /* @__PURE__ */ u3("section", {
        class: "lre-card",
        children: [
          /* @__PURE__ */ u3("div", {
            class: "lre-h",
            children: [
              /* @__PURE__ */ u3("span", {
                children: "Day"
              }, undefined, false, undefined, this),
              /* @__PURE__ */ u3("button", {
                type: "button",
                class: "lre-btn small",
                onClick: () => {
                  const last = schedule.slots.at(-1);
                  const start = last && TIME.test(last.end) ? last.end : "00:00";
                  const endMinutes = Math.min(1439, minutesOf(start) + 60);
                  const end = `${String(Math.floor(endMinutes / 60)).padStart(2, "0")}:${String(endMinutes % 60).padStart(2, "0")}`;
                  setSchedule({ ...schedule, slots: [...schedule.slots, { start, end, value: "" }] });
                  setSelected(schedule.slots.length);
                },
                children: "+ Slot"
              }, undefined, false, undefined, this)
            ]
          }, undefined, true, undefined, this),
          /* @__PURE__ */ u3("div", {
            class: "lre-sched",
            "aria-hidden": "true",
            children: schedule.slots.map((s, i) => {
              if (!TIME.test(s.start) || !TIME.test(s.end))
                return null;
              const start = minutesOf(s.start);
              const endRaw = minutesOf(s.end);
              const end = endRaw <= start ? 1440 : endRaw;
              return /* @__PURE__ */ u3("button", {
                type: "button",
                tabIndex: -1,
                "aria-current": i === selected,
                style: { left: `${start / 1440 * 100}%`, width: `${(end - start) / 1440 * 100}%` },
                title: `${s.start}–${s.end} ${slotLabel(s)}`,
                onClick: () => setSelected(i),
                children: slotLabel(s)
              }, i, false, undefined, this);
            })
          }, undefined, false, undefined, this),
          /* @__PURE__ */ u3("div", {
            class: "lre-sched-axis",
            "aria-hidden": "true",
            children: [
              /* @__PURE__ */ u3("span", {
                children: "00"
              }, undefined, false, undefined, this),
              /* @__PURE__ */ u3("span", {
                children: "06"
              }, undefined, false, undefined, this),
              /* @__PURE__ */ u3("span", {
                children: "12"
              }, undefined, false, undefined, this),
              /* @__PURE__ */ u3("span", {
                children: "18"
              }, undefined, false, undefined, this),
              /* @__PURE__ */ u3("span", {
                children: "24"
              }, undefined, false, undefined, this)
            ]
          }, undefined, true, undefined, this),
          schedule.slots.length > 0 ? /* @__PURE__ */ u3("div", {
            class: "lre-inline",
            role: "group",
            "aria-label": "Slots",
            style: { marginTop: "6px" },
            children: schedule.slots.map((s, i) => /* @__PURE__ */ u3("button", {
              type: "button",
              class: i === selected ? "lre-btn small primary" : "lre-btn small",
              "aria-pressed": i === selected,
              onClick: () => setSelected(i),
              children: [
                s.start,
                "–",
                s.end,
                " ",
                slotLabel(s)
              ]
            }, i, true, undefined, this))
          }, undefined, false, undefined, this) : null,
          problems.map((p) => /* @__PURE__ */ u3("div", {
            class: "lre-small lre-neg",
            children: p
          }, p, false, undefined, this)),
          slot ? /* @__PURE__ */ u3("div", {
            class: "lre-stack",
            style: { marginTop: "10px" },
            "data-lre-slot": selected,
            children: [
              /* @__PURE__ */ u3("div", {
                class: "lre-inline",
                children: [
                  /* @__PURE__ */ u3("label", {
                    class: "lre-field",
                    style: { flex: 1 },
                    children: [
                      /* @__PURE__ */ u3("span", {
                        class: "label",
                        children: "Start"
                      }, undefined, false, undefined, this),
                      /* @__PURE__ */ u3("input", {
                        class: "lre-input",
                        type: "time",
                        value: slot.start,
                        onChange: (event) => setSlot({ ...slot, start: event.currentTarget.value })
                      }, undefined, false, undefined, this)
                    ]
                  }, undefined, true, undefined, this),
                  /* @__PURE__ */ u3("label", {
                    class: "lre-field",
                    style: { flex: 1 },
                    children: [
                      /* @__PURE__ */ u3("span", {
                        class: "label",
                        children: "End"
                      }, undefined, false, undefined, this),
                      /* @__PURE__ */ u3("input", {
                        class: "lre-input",
                        type: "time",
                        value: slot.end,
                        onChange: (event) => setSlot({ ...slot, end: event.currentTarget.value })
                      }, undefined, false, undefined, this)
                    ]
                  }, undefined, true, undefined, this)
                ]
              }, undefined, true, undefined, this),
              /* @__PURE__ */ u3(Seg, {
                label: "Slot value",
                value: slot.weighted ? "weighted" : "value",
                options: [
                  { value: "value", label: "Fixed" },
                  { value: "weighted", label: "Weighted" }
                ],
                onChange: (mode) => setSlot(mode === "value" ? { start: slot.start, end: slot.end, value: slot.weighted?.[0]?.value ?? "" } : { start: slot.start, end: slot.end, weighted: [{ value: slot.value ?? "", weight: 1 }] })
              }, undefined, false, undefined, this),
              slot.weighted ? /* @__PURE__ */ u3(M, {
                children: [
                  slot.weighted.map((w, i) => /* @__PURE__ */ u3("div", {
                    class: "lre-inline",
                    style: { alignItems: "flex-end" },
                    children: [
                      /* @__PURE__ */ u3("div", {
                        style: { flex: 2 },
                        children: /* @__PURE__ */ u3(JsonField, {
                          label: `Value ${i + 1}`,
                          value: w.value,
                          onChange: (value) => setSlot({ ...slot, weighted: slot.weighted?.map((x, j) => j === i ? { ...x, value: value ?? "" } : x) })
                        }, undefined, false, undefined, this)
                      }, undefined, false, undefined, this),
                      /* @__PURE__ */ u3("label", {
                        class: "lre-field",
                        style: { flex: 1 },
                        children: [
                          /* @__PURE__ */ u3("span", {
                            class: "label",
                            children: "Weight"
                          }, undefined, false, undefined, this),
                          /* @__PURE__ */ u3("input", {
                            class: "lre-input",
                            inputMode: "decimal",
                            value: String(w.weight),
                            onChange: (event) => setSlot({ ...slot, weighted: slot.weighted?.map((x, j) => j === i ? { ...x, weight: Number(event.currentTarget.value) || 0 } : x) })
                          }, undefined, false, undefined, this)
                        ]
                      }, undefined, true, undefined, this),
                      /* @__PURE__ */ u3("button", {
                        type: "button",
                        class: "lre-btn small ghost",
                        "aria-label": `Remove value ${i + 1}`,
                        onClick: () => setSlot({ ...slot, weighted: slot.weighted?.filter((_, j) => j !== i) }),
                        children: "✕"
                      }, undefined, false, undefined, this)
                    ]
                  }, i, true, undefined, this)),
                  /* @__PURE__ */ u3("button", {
                    type: "button",
                    class: "lre-btn small",
                    onClick: () => setSlot({ ...slot, weighted: [...slot.weighted ?? [], { value: "", weight: 1 }] }),
                    children: "+ Value"
                  }, undefined, false, undefined, this)
                ]
              }, undefined, true, undefined, this) : /* @__PURE__ */ u3(JsonField, {
                label: "Value",
                value: slot.value,
                onChange: (value) => setSlot({ ...slot, value })
              }, undefined, false, undefined, this),
              /* @__PURE__ */ u3(JsonField, {
                label: "Given the previous slot (JSON, optional)",
                value: slot.given,
                onChange: (value) => setSlot({ ...slot, given: value === undefined ? undefined : value })
              }, undefined, false, undefined, this),
              /* @__PURE__ */ u3("button", {
                type: "button",
                class: "lre-btn danger small",
                onClick: () => {
                  setSchedule({ ...schedule, slots: schedule.slots.filter((_, i) => i !== selected) });
                  setSelected(Math.max(0, selected - 1));
                },
                children: "Remove slot"
              }, undefined, false, undefined, this)
            ]
          }, undefined, true, undefined, this) : null
        ]
      }, undefined, true, undefined, this),
      /* @__PURE__ */ u3("div", {
        class: "lre-inline",
        children: [
          /* @__PURE__ */ u3("button", {
            type: "button",
            class: "lre-btn primary",
            disabled: !changed && !isNew || busy,
            onClick: () => run(async () => {
              const message = await props.send({ type: "lre.editor", worldId: props.world.id, base: null, op: "put", collection: "schedules", id, value: { ...schedule, id } });
              if (message.type === "lre.result" && isNew)
                app.ui.update((ui) => ({ ...ui, build: { view: "item", worldId: props.world.id, collection: "schedules", id } }));
            }),
            children: [
              isNew ? "Create schedule" : "Save to draft",
              problems.length > 0 ? ` (${problems.length}⚠)` : ""
            ]
          }, undefined, true, undefined, this),
          /* @__PURE__ */ u3("button", {
            type: "button",
            class: "lre-btn ghost",
            disabled: !changed || busy,
            onClick: () => setSchedule(stored ? structuredClone(stored) : blank),
            children: "Revert"
          }, undefined, false, undefined, this)
        ]
      }, undefined, true, undefined, this)
    ]
  }, undefined, true, undefined, this);
}

// src/packs/calendar/ui/panel.tsx
function decodeCalendarView(value) {
  if (!isRecord(value))
    return null;
  return {
    level: typeof value.level === "number" ? value.level : 2,
    date: str(value.date),
    weekday: str(value.weekday),
    dayPart: str(value.dayPart),
    holidays: strings(value.holidays),
    upcoming: list(value.upcoming, (u) => ({ at: str(u.at), label: str(u.label), kind: u.kind === "holiday" ? "holiday" : "commitment" }))
  };
}
function controlValues(state) {
  const time = state.controls?.time;
  if (!time)
    return null;
  return { sceneTicks: time.sceneTicks, scale: time.scale, interrupts: time.interrupts, speedThrough: time.speedThrough, montage: time.montage, unitCap: time.unitCap, npcCalls: time.npcCalls };
}
function CalendarPanel(props) {
  const app = useApp();
  const { state } = props;
  const calendar = decodeCalendarView(props.view);
  const [busy, run] = useBusy();
  const hud = state.hud;
  const values = controlValues(state);
  const paused = state.controls?.time.paused ?? hud?.clock.paused ?? false;
  return /* @__PURE__ */ u3("div", {
    class: "lre-stack",
    "data-lre-panel": "calendar.calendar",
    children: [
      /* @__PURE__ */ u3(Card, {
        title: "Clock",
        aside: paused ? /* @__PURE__ */ u3("span", {
          class: "lre-badge warn",
          children: "Paused"
        }, undefined, false, undefined, this) : null,
        children: [
          hud ? /* @__PURE__ */ u3(Row, {
            k: /* @__PURE__ */ u3("span", {
              class: "lre-num",
              style: { fontSize: "18px", fontWeight: 600 },
              children: clockText(hud)
            }, undefined, false, undefined, this),
            v: calendar?.dayPart || hud.clock.dayPart
          }, undefined, false, undefined, this) : null,
          calendar ? /* @__PURE__ */ u3(Row, {
            k: `${calendar.weekday} ${calendar.date}`.trim() || "—",
            v: calendar.holidays.join(", ") || undefined
          }, undefined, false, undefined, this) : null,
          /* @__PURE__ */ u3("div", {
            class: "lre-inline",
            style: { marginTop: "8px" },
            children: [
              /* @__PURE__ */ u3("button", {
                type: "button",
                class: "lre-btn",
                disabled: busy,
                onClick: () => run(async () => {
                  await app.request(timeMarker(props.chatId, "pause", { all: true }, !paused));
                }),
                children: [
                  /* @__PURE__ */ u3("span", {
                    "aria-hidden": "true",
                    children: paused ? "▶" : "⏸"
                  }, undefined, false, undefined, this),
                  " ",
                  paused ? "Resume clock" : "Pause clock"
                ]
              }, undefined, true, undefined, this),
              state.palette?.timelapse ? /* @__PURE__ */ u3("button", {
                type: "button",
                class: "lre-btn primary",
                onClick: () => void app.overlays.openPalette("timelapse"),
                children: [
                  /* @__PURE__ */ u3("span", {
                    "aria-hidden": "true",
                    children: "⏩"
                  }, undefined, false, undefined, this),
                  " Timelapse…"
                ]
              }, undefined, true, undefined, this) : null
            ]
          }, undefined, true, undefined, this)
        ]
      }, undefined, true, undefined, this),
      /* @__PURE__ */ u3(Card, {
        title: "Coming up",
        children: !calendar || calendar.upcoming.length === 0 ? /* @__PURE__ */ u3(Empty, {
          children: "Nothing scheduled."
        }, undefined, false, undefined, this) : calendar.upcoming.map((u, i) => /* @__PURE__ */ u3(Row, {
          k: u.label,
          sub: u.kind,
          v: u.at
        }, `${u.at}:${i}`, false, undefined, this))
      }, undefined, false, undefined, this),
      /* @__PURE__ */ u3("div", {
        class: "lre-h",
        children: "This chat's time controls"
      }, undefined, false, undefined, this),
      values ? /* @__PURE__ */ u3(TimeControlsEditor, {
        values,
        currentSceneType: state.controls?.time.sceneType,
        disabled: busy,
        onChange: (change) => run(async () => {
          const result = await app.request(timeMarker(props.chatId, change.control, change.scope, change.to));
          if (result?.pending)
            app.toast("Saved — it applies when the reply finishes.", "info");
        })
      }, undefined, false, undefined, this) : /* @__PURE__ */ u3(Empty, {
        children: "Time controls appear once the chat has started."
      }, undefined, false, undefined, this)
    ]
  }, undefined, true, undefined, this);
}

// src/packs/calendar/ui/index.ts
var calendar = {
  id: "calendar",
  register(r) {
    r.panel({ id: "calendar.calendar", label: "Calendar", order: 70, component: CalendarPanel });
    r.editor({ collection: "schedules", label: "Schedules", component: ScheduleEditor });
  }
};
var ui_default = calendar;

// src/packs/castlife/ui/panel.tsx
var SLOT_KINDS = ["work", "sleep", "free", "travel", "other"];
function decodeCastView(value) {
  if (!isRecord(value) || !Array.isArray(value.people))
    return null;
  return {
    level: typeof value.level === "number" ? value.level : 1,
    people: list(value.people, (p) => typeof p.id === "string" ? {
      id: p.id,
      name: str(p.name, p.id),
      role: str(p.role),
      here: p.here === true,
      activity: optStr(p.activity),
      place: optStr(p.place),
      regard: list(p.regard, (r) => ({ axis: str(r.axis), band: str(r.band), value: optNum(r.value) })),
      timeline: list(p.timeline, (s) => ({ start: str(s.start), end: str(s.end), label: str(s.label), kind: oneOf(s.kind, SLOT_KINDS, "other"), reasons: strings(s.reasons) })),
      agenda: list(p.agenda, (a) => ({ label: str(a.label), stage: str(a.stage) })),
      next: isRecord(p.next) ? { at: str(p.next.at), label: str(p.next.label) } : undefined
    } : null)
  };
}
function clockMinutes(text) {
  const match = /^(\d{1,2}):(\d{2})/.exec(text);
  return match ? Number(match[1]) * 60 + Number(match[2]) : 0;
}
function Timeline(props) {
  const [why, setWhy] = d2(false);
  const spans = props.slots.map((slot) => {
    const start = clockMinutes(slot.start);
    const endRaw = clockMinutes(slot.end);
    const end = endRaw <= start ? 1440 : endRaw;
    return { ...slot, width: (end - start) / 1440 * 100 };
  });
  return /* @__PURE__ */ u3("div", {
    children: [
      /* @__PURE__ */ u3("div", {
        class: "lre-timeline",
        role: "img",
        "aria-label": props.slots.map((s) => `${s.start}–${s.end} ${s.label}`).join(", "),
        children: spans.map((s, i) => /* @__PURE__ */ u3("span", {
          class: `lre-tl-${s.kind}`,
          style: { width: `${s.width}%` },
          title: `${s.start}–${s.end} ${s.label}`
        }, i, false, undefined, this))
      }, undefined, false, undefined, this),
      /* @__PURE__ */ u3("div", {
        class: "lre-sched-axis",
        "aria-hidden": "true",
        children: [
          /* @__PURE__ */ u3("span", {
            children: "00"
          }, undefined, false, undefined, this),
          /* @__PURE__ */ u3("span", {
            children: "06"
          }, undefined, false, undefined, this),
          /* @__PURE__ */ u3("span", {
            children: "12"
          }, undefined, false, undefined, this),
          /* @__PURE__ */ u3("span", {
            children: "18"
          }, undefined, false, undefined, this),
          /* @__PURE__ */ u3("span", {
            children: "24"
          }, undefined, false, undefined, this)
        ]
      }, undefined, true, undefined, this),
      props.slots.some((s) => s.reasons.length > 0) ? /* @__PURE__ */ u3("button", {
        type: "button",
        class: "lre-btn small ghost",
        "aria-expanded": why,
        onClick: () => setWhy(!why),
        children: why ? "Hide reasons" : "Why this plan?"
      }, undefined, false, undefined, this) : null,
      why ? props.slots.map((s, i) => /* @__PURE__ */ u3("div", {
        class: "lre-small",
        "data-lre-plan-block": true,
        children: [
          /* @__PURE__ */ u3("span", {
            class: "lre-num",
            children: [
              s.start,
              "–",
              s.end
            ]
          }, undefined, true, undefined, this),
          " ",
          s.label,
          s.reasons.length > 0 ? /* @__PURE__ */ u3("span", {
            class: "lre-muted",
            children: [
              " · ",
              s.reasons.join(", ")
            ]
          }, undefined, true, undefined, this) : null
        ]
      }, i, true, undefined, this)) : null
    ]
  }, undefined, true, undefined, this);
}
function CastPanel(props) {
  const view = decodeCastView(props.view);
  if (props.view === null || props.view === undefined)
    return /* @__PURE__ */ u3(Empty, {
      children: "No cast yet."
    }, undefined, false, undefined, this);
  if (!view)
    return /* @__PURE__ */ u3(JsonView, {
      value: props.view
    }, undefined, false, undefined, this);
  if (view.people.length === 0)
    return /* @__PURE__ */ u3(Empty, {
      children: "You don't know anyone yet."
    }, undefined, false, undefined, this);
  const people = [...view.people].sort((a, b) => Number(b.here) - Number(a.here));
  return /* @__PURE__ */ u3("div", {
    class: "lre-stack",
    "data-lre-panel": "castlife.cast",
    children: people.map((p) => {
      const pending = props.state.pending.some((mark) => mark.entity === p.id);
      return /* @__PURE__ */ u3(Card, {
        title: p.name,
        aside: /* @__PURE__ */ u3("span", {
          class: "lre-inline",
          children: [
            p.here ? /* @__PURE__ */ u3("span", {
              class: "lre-badge pos",
              children: "here"
            }, undefined, false, undefined, this) : null,
            pending ? /* @__PURE__ */ u3("span", {
              class: "lre-badge warn",
              children: "pending"
            }, undefined, false, undefined, this) : null
          ]
        }, undefined, true, undefined, this),
        children: [
          /* @__PURE__ */ u3("div", {
            class: "lre-muted lre-small",
            children: [p.role, p.activity, p.place].filter((part) => part).join(" · ")
          }, undefined, false, undefined, this),
          p.timeline.length > 0 ? /* @__PURE__ */ u3(Timeline, {
            slots: p.timeline
          }, undefined, false, undefined, this) : null,
          p.regard.map((r) => /* @__PURE__ */ u3(Row, {
            k: r.axis,
            v: r.value !== undefined ? `${r.band} (${r.value})` : r.band
          }, r.axis, false, undefined, this)),
          p.agenda.map((a) => /* @__PURE__ */ u3(Row, {
            k: a.label,
            v: a.stage,
            sub: "agenda"
          }, a.label, false, undefined, this)),
          p.next ? /* @__PURE__ */ u3(Row, {
            k: "Next",
            v: p.next.at,
            sub: p.next.label
          }, undefined, false, undefined, this) : null
        ]
      }, p.id, true, undefined, this);
    })
  }, undefined, false, undefined, this);
}

// src/packs/castlife/ui/index.ts
var castlife = {
  id: "castlife",
  register(r) {
    r.panel({ id: "castlife.cast", label: "Cast", order: 60, component: CastPanel });
  }
};
var ui_default2 = castlife;

// src/engine/events.ts
var EXTERNAL_ACCOUNT_PREFIX = "economy.external:";
var CAP_TIERS = TIERS.filter((t) => t !== "pov");
var TIME_BOUNDS = Object.freeze({ tick: [0, 1440], scale: [0.25, 10], thresholdMinutes: [1, 10080], agentDays: [1, 600], events: [1, 5000], npcCalls: [0, 50] });

// src/engine/calendar.ts
var MINUTES_PER_DAY = 1440;
var cache = new WeakMap;
var NUMBER_WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
var SPAN_MINUTES = { minute: 1, min: 1, hour: 60, hr: 60, day: MINUTES_PER_DAY, week: 7 * MINUTES_PER_DAY };
var SPAN = new RegExp(`\\s(\\d+|${Object.keys(NUMBER_WORDS).join("|")})\\s+(minute|min|hour|hr|day|week)s?(?=\\s)`);

// src/engine/expr.ts
var DEFAULT_LIMITS = Object.freeze({
  maxSourceLength: 4096,
  maxDepth: 64,
  maxNodes: 2048,
  maxSteps: 1e5
});

// src/packs/economy/core/model.ts
var ACCOUNT_TYPES = ["cash", "checking", "savings", "card", "loan", "brokerage"];
var MARKET = `${EXTERNAL_ACCOUNT_PREFIX}market`;

// src/packs/economy/ui/panel.tsx
var KIND_ICON = { cash: "\uD83D\uDCB5", checking: "\uD83C\uDFE6", savings: "\uD83D\uDC16", card: "\uD83D\uDCB3", loan: "\uD83D\uDCC4", brokerage: "\uD83D\uDCC8" };
function decodeMoneyView(value) {
  if (!isRecord(value) || !Array.isArray(value.accounts) && typeof value.band !== "string")
    return null;
  return {
    level: num(value.level, 1),
    band: typeof value.band === "string" ? value.band : null,
    netWorthCents: typeof value.netWorthCents === "number" ? value.netWorthCents : null,
    cash: isRecord(value.cash) ? typeof value.cash.cents === "number" ? { cents: value.cash.cents } : { band: str(value.cash.band) } : null,
    accounts: list(value.accounts, (a) => {
      const due = isRecord(a.due) ? { label: str(a.due.label), cents: num(a.due.cents) } : undefined;
      return typeof a.id === "string" ? { id: a.id, name: str(a.name, a.id), kind: oneOf(a.kind, ACCOUNT_TYPES, "checking"), cents: num(a.cents), limitCents: optNum(a.limitCents), aprPct: optNum(a.aprPct), due } : null;
    }),
    recent: list(value.recent, (t) => ({ at: str(t.at), memo: str(t.memo), cents: num(t.cents), account: str(t.account) })),
    upcoming: list(value.upcoming, (u) => ({ at: str(u.at), label: str(u.label), cents: num(u.cents) }))
  };
}
function MoneyPanel(props) {
  const view = decodeMoneyView(props.view);
  if (props.view === null || props.view === undefined)
    return /* @__PURE__ */ u3(Empty, {
      children: "Money is off in this world."
    }, undefined, false, undefined, this);
  if (!view)
    return /* @__PURE__ */ u3(JsonView, {
      value: props.view
    }, undefined, false, undefined, this);
  return /* @__PURE__ */ u3("div", {
    class: "lre-stack",
    "data-lre-panel": "economy.money",
    children: [
      /* @__PURE__ */ u3(Card, {
        title: "Overview",
        aside: /* @__PURE__ */ u3("span", {
          class: "lre-badge",
          children: [
            "Money ",
            view.level
          ]
        }, undefined, true, undefined, this),
        children: [
          view.band ? /* @__PURE__ */ u3(Row, {
            k: "Wealth",
            v: view.band
          }, undefined, false, undefined, this) : null,
          view.netWorthCents !== null ? /* @__PURE__ */ u3(Row, {
            k: "Net worth",
            v: formatCents(view.netWorthCents),
            tone: view.netWorthCents < 0 ? "neg" : undefined
          }, undefined, false, undefined, this) : null
        ]
      }, undefined, true, undefined, this),
      view.accounts.length > 0 ? /* @__PURE__ */ u3(Card, {
        title: "Accounts",
        children: view.accounts.map((a) => {
          const subs = [
            a.limitCents !== undefined ? `limit ${formatCents(a.limitCents)}` : null,
            a.aprPct !== undefined ? `${a.aprPct}% APR` : null,
            a.due ? `${a.due.label} ${formatCents(a.due.cents)}` : null
          ].filter((part) => part);
          return /* @__PURE__ */ u3(Row, {
            k: /* @__PURE__ */ u3(M, {
              children: [
                /* @__PURE__ */ u3("span", {
                  "aria-hidden": "true",
                  children: KIND_ICON[a.kind]
                }, undefined, false, undefined, this),
                " ",
                a.name
              ]
            }, undefined, true, undefined, this),
            sub: subs.length > 0 ? subs.join(" · ") : undefined,
            v: formatCents(a.cents),
            tone: a.cents < 0 ? "neg" : undefined
          }, a.id, false, undefined, this);
        })
      }, undefined, false, undefined, this) : null,
      view.upcoming.length > 0 ? /* @__PURE__ */ u3(Card, {
        title: "Coming up",
        children: view.upcoming.map((u, i) => /* @__PURE__ */ u3(Row, {
          k: u.label,
          sub: u.at,
          v: formatCents(u.cents),
          tone: u.cents < 0 ? "neg" : "pos"
        }, `${u.at}:${i}`, false, undefined, this))
      }, undefined, false, undefined, this) : null,
      /* @__PURE__ */ u3(Card, {
        title: "Recent",
        children: view.recent.length === 0 ? /* @__PURE__ */ u3(Empty, {
          children: "No transactions yet."
        }, undefined, false, undefined, this) : view.recent.map((t, i) => /* @__PURE__ */ u3(Row, {
          k: t.memo,
          sub: `${t.at} · ${t.account}`,
          v: `${t.cents > 0 ? "+" : ""}${formatCents(t.cents)}`,
          tone: t.cents < 0 ? "neg" : "pos"
        }, `${t.at}:${i}`, false, undefined, this))
      }, undefined, false, undefined, this)
    ]
  }, undefined, true, undefined, this);
}

// src/packs/economy/ui/index.ts
var economy = {
  id: "economy",
  register(r) {
    r.panel({ id: "economy.money", label: "Money", order: 30, component: MoneyPanel });
  }
};
var ui_default3 = economy;

// src/packs/gear/ui/panel.tsx
var SECTIONS = ["owned", "worn", "carried", "stored"];
function decodeItem(entry) {
  if (typeof entry.id !== "string")
    return null;
  const load = obj(entry.load);
  const kit = obj(entry.kit);
  const lent = obj(entry.lent);
  const children = list(entry.children, decodeItem);
  return {
    id: entry.id,
    name: str(entry.name, entry.id),
    qty: optNum(entry.qty),
    condition: optNum(entry.condition),
    slot: optStr(entry.slot),
    load: load ? { used: num(load.used), capacity: num(load.capacity), unit: "l" } : undefined,
    kit: kit ? { complete: kit.complete === true, present: num(kit.present), total: num(kit.total), missing: strings(kit.missing) } : undefined,
    lent: lent ? { to: str(lent.to), until: optStr(lent.until), overdue: lent.overdue === true } : undefined,
    children: children.length > 0 ? children : undefined
  };
}
function decodeGearView(value) {
  if (!isRecord(value) || !SECTIONS.some((section) => Array.isArray(value[section])))
    return null;
  return { level: num(value.level, 1), owned: list(value.owned, decodeItem), worn: list(value.worn, decodeItem), carried: list(value.carried, decodeItem), stored: list(value.stored, decodeItem) };
}
function ItemRow(props) {
  const { item } = props;
  const app = useApp();
  const [busy, run] = useBusy();
  const children = item.children ?? [];
  const [open, setOpen] = d2(props.depth === 0 && children.length > 0 && children.length <= 6);
  const lookInside = () => run(async () => {
    const result = await app.request({ type: "lre.view.open", chatId: props.chatId, panel: "gear.gear", entity: item.id });
    if (result?.pending)
      app.toast("The contents appear when the reply finishes.", "info");
    else if (result && !result.materialized)
      app.toast(`Nothing more inside ${item.name}.`, "info");
    setOpen(true);
  });
  const subs = [
    item.slot,
    item.condition !== undefined ? `condition ${Math.round(item.condition)}%` : null,
    item.kit ? item.kit.complete ? `kit complete (${item.kit.total})` : `kit ${item.kit.present}/${item.kit.total}${item.kit.missing.length > 0 ? ` · missing ${item.kit.missing.join(", ")}` : ""}` : null,
    item.lent ? `lent to ${item.lent.to}${item.lent.until ? ` until ${item.lent.until}` : ""}` : null
  ].filter((part) => part);
  return /* @__PURE__ */ u3("div", {
    children: [
      /* @__PURE__ */ u3("div", {
        class: "lre-row",
        children: [
          /* @__PURE__ */ u3("span", {
            class: "k",
            children: [
              children.length > 0 ? /* @__PURE__ */ u3("button", {
                type: "button",
                class: "lre-btn small ghost",
                "aria-expanded": open,
                "aria-label": `Contents of ${item.name}`,
                onClick: () => setOpen(!open),
                children: /* @__PURE__ */ u3("span", {
                  "aria-hidden": "true",
                  children: open ? "▾" : "▸"
                }, undefined, false, undefined, this)
              }, undefined, false, undefined, this) : null,
              item.name,
              item.qty !== undefined && item.qty !== 1 ? /* @__PURE__ */ u3("span", {
                class: "lre-muted",
                children: [
                  " ×",
                  item.qty
                ]
              }, undefined, true, undefined, this) : null,
              subs.length > 0 ? /* @__PURE__ */ u3("span", {
                class: "sub",
                children: subs.join(" · ")
              }, undefined, false, undefined, this) : null,
              item.load ? /* @__PURE__ */ u3("span", {
                class: "sub",
                children: [
                  /* @__PURE__ */ u3("span", {
                    class: item.load.used > item.load.capacity ? "lre-bar low" : "lre-bar",
                    style: { display: "block", marginTop: "4px" },
                    children: /* @__PURE__ */ u3("span", {
                      style: { width: `${item.load.capacity > 0 ? Math.min(100, item.load.used / item.load.capacity * 100) : 0}%` }
                    }, undefined, false, undefined, this)
                  }, undefined, false, undefined, this),
                  item.load.used,
                  " / ",
                  item.load.capacity,
                  " ",
                  item.load.unit
                ]
              }, undefined, true, undefined, this) : null
            ]
          }, undefined, true, undefined, this),
          item.lent?.overdue ? /* @__PURE__ */ u3("span", {
            class: "lre-badge warn",
            children: "overdue"
          }, undefined, false, undefined, this) : item.kit && !item.kit.complete ? /* @__PURE__ */ u3("span", {
            class: "lre-badge warn",
            children: "incomplete"
          }, undefined, false, undefined, this) : null,
          item.load && children.length === 0 ? /* @__PURE__ */ u3("button", {
            type: "button",
            class: "lre-btn small",
            disabled: busy,
            onClick: lookInside,
            children: "Look inside"
          }, undefined, false, undefined, this) : null
        ]
      }, undefined, true, undefined, this),
      open && children.length > 0 ? /* @__PURE__ */ u3("div", {
        class: "lre-tree",
        children: children.map((child) => /* @__PURE__ */ u3(ItemRow, {
          item: child,
          depth: props.depth + 1,
          chatId: props.chatId
        }, child.id, false, undefined, this))
      }, undefined, false, undefined, this) : null
    ]
  }, undefined, true, undefined, this);
}
var SECTION_LABEL = { owned: "Owned", worn: "Worn", carried: "Carried", stored: "Stored" };
function GearPanel(props) {
  const view = decodeGearView(props.view);
  const [section, setSection] = d2("carried");
  if (props.view === null || props.view === undefined)
    return /* @__PURE__ */ u3(Empty, {
      children: "Gear is off in this world."
    }, undefined, false, undefined, this);
  if (!view)
    return /* @__PURE__ */ u3(JsonView, {
      value: props.view
    }, undefined, false, undefined, this);
  const items = view[section];
  return /* @__PURE__ */ u3("div", {
    class: "lre-stack",
    "data-lre-panel": "gear.gear",
    children: [
      /* @__PURE__ */ u3(Seg, {
        label: "Gear section",
        value: section,
        options: SECTIONS.map((s) => ({ value: s, label: `${SECTION_LABEL[s]} ${view[s].length}` })),
        onChange: (next) => setSection(next)
      }, undefined, false, undefined, this),
      /* @__PURE__ */ u3("section", {
        class: "lre-card",
        children: items.length === 0 ? /* @__PURE__ */ u3(Empty, {
          children: [
            "Nothing ",
            SECTION_LABEL[section].toLowerCase(),
            "."
          ]
        }, undefined, true, undefined, this) : items.map((item) => /* @__PURE__ */ u3(ItemRow, {
          item,
          depth: 0,
          chatId: props.chatId
        }, item.id, false, undefined, this))
      }, undefined, false, undefined, this)
    ]
  }, undefined, true, undefined, this);
}

// src/packs/gear/ui/index.ts
var gear = {
  id: "gear",
  register(r) {
    r.panel({ id: "gear.gear", label: "Gear", order: 50, component: GearPanel });
  }
};
var ui_default4 = gear;

// src/packs/sheets/ui/panel.tsx
var FIELD_TYPES2 = ["number", "text", "bool", "enum", "ref", "list", "dice", "money", "date", "duration"];
function decodeFix(value) {
  const fix = obj(value);
  if (!fix || typeof fix.entity !== "string" || typeof fix.field !== "string")
    return;
  const type = FIELD_TYPES2.find((candidate) => candidate === fix.type) ?? "text";
  const options = list(fix.options, (o) => typeof o.label === "string" ? { label: o.label, value: o.value ?? null } : null);
  return {
    entity: fix.entity,
    field: fix.field,
    type,
    value: fix.value ?? null,
    options: options.length > 0 ? options : undefined,
    min: typeof fix.min === "number" ? fix.min : undefined,
    max: typeof fix.max === "number" ? fix.max : undefined
  };
}
function decodeYouView(value) {
  if (!isRecord(value) || typeof value.name !== "string")
    return null;
  return {
    name: value.name,
    tier: str(value.tier, "pov"),
    place: optStr(value.place),
    activity: optStr(value.activity),
    conditions: strings(value.conditions),
    sections: list(value.sections, (s) => ({
      title: str(s.title),
      rows: list(s.rows, (r) => ({ label: str(r.label), value: str(r.value), detail: optStr(r.detail), fix: decodeFix(r.fix) }))
    }))
  };
}
function YouPanel(props) {
  const view = decodeYouView(props.view);
  const [fixing, setFixing] = d2(null);
  if (props.view === null || props.view === undefined)
    return /* @__PURE__ */ u3(Empty, {
      children: "No character sheet yet."
    }, undefined, false, undefined, this);
  if (!view)
    return /* @__PURE__ */ u3(JsonView, {
      value: props.view
    }, undefined, false, undefined, this);
  return /* @__PURE__ */ u3("div", {
    class: "lre-stack",
    "data-lre-panel": "sheets.you",
    children: [
      /* @__PURE__ */ u3(Card, {
        title: view.name,
        aside: /* @__PURE__ */ u3("span", {
          class: "lre-badge accent",
          children: view.tier
        }, undefined, false, undefined, this),
        children: [
          view.place || view.activity ? /* @__PURE__ */ u3("div", {
            class: "lre-muted",
            children: [view.activity, view.place].filter((part) => part).join(" · ")
          }, undefined, false, undefined, this) : null,
          view.conditions.length > 0 ? /* @__PURE__ */ u3("div", {
            class: "lre-inline",
            style: { marginTop: "6px" },
            children: view.conditions.map((c) => /* @__PURE__ */ u3("span", {
              class: "lre-badge warn",
              children: c
            }, c, false, undefined, this))
          }, undefined, false, undefined, this) : null
        ]
      }, undefined, true, undefined, this),
      view.sections.map((section) => /* @__PURE__ */ u3(Card, {
        title: section.title,
        children: section.rows.map((row) => {
          const key = `${section.title}:${row.label}`;
          if (fixing === key && row.fix)
            return /* @__PURE__ */ u3(FixEditor, {
              label: row.label,
              target: row.fix,
              onDone: () => setFixing(null)
            }, key, false, undefined, this);
          return /* @__PURE__ */ u3("div", {
            class: "lre-row",
            children: [
              /* @__PURE__ */ u3("span", {
                class: "k",
                children: [
                  row.label,
                  row.detail ? /* @__PURE__ */ u3("span", {
                    class: "sub",
                    children: row.detail
                  }, undefined, false, undefined, this) : null
                ]
              }, undefined, true, undefined, this),
              /* @__PURE__ */ u3("span", {
                class: "v lre-inline",
                children: [
                  row.value,
                  row.fix ? /* @__PURE__ */ u3("button", {
                    type: "button",
                    class: "lre-btn small ghost",
                    "aria-label": `Fix ${row.label}`,
                    onClick: () => setFixing(key),
                    children: "✎"
                  }, undefined, false, undefined, this) : null
                ]
              }, undefined, true, undefined, this)
            ]
          }, key, true, undefined, this);
        })
      }, section.title, false, undefined, this))
    ]
  }, undefined, true, undefined, this);
}

// src/packs/sheets/ui/index.ts
var sheets = {
  id: "sheets",
  register(r) {
    r.panel({ id: "sheets.you", label: "You", order: 20, component: YouPanel });
  }
};
var ui_default5 = sheets;

// src/frontend/map-math.ts
var ZOOM_MIN = 0.25;
var ZOOM_MAX = 4;
var TAP_SLOP = 8;
var TAP_MS = 500;
var IDENTITY = { x: 0, y: 0, k: 1 };
function toWorld(t, p) {
  return { x: (p.x - t.x) / t.k, y: (p.y - t.y) / t.k };
}
function toScreen(t, p) {
  return { x: p.x * t.k + t.x, y: p.y * t.k + t.y };
}
function zoomAt(t, focal, factor) {
  const k = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, t.k * factor));
  const ratio = k / t.k;
  return { k, x: focal.x - (focal.x - t.x) * ratio, y: focal.y - (focal.y - t.y) * ratio };
}
function wheelFactor(deltaY, deltaMode) {
  const pixels = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  return Math.exp(-pixels * 0.0015);
}
function pinch(t, before, after) {
  const d0 = Math.hypot(before[0].x - before[1].x, before[0].y - before[1].y);
  const d1 = Math.hypot(after[0].x - after[1].x, after[0].y - after[1].y);
  const m0 = { x: (before[0].x + before[1].x) / 2, y: (before[0].y + before[1].y) / 2 };
  const m1 = { x: (after[0].x + after[1].x) / 2, y: (after[0].y + after[1].y) / 2 };
  const panned = { ...t, x: t.x + m1.x - m0.x, y: t.y + m1.y - m0.y };
  return d0 > 0 ? zoomAt(panned, m1, d1 / d0) : panned;
}
function fit(bounds, width, height, padding) {
  const w = Math.max(1, bounds.maxX - bounds.minX);
  const h = Math.max(1, bounds.maxY - bounds.minY);
  const k = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.min((width - padding * 2) / w, (height - padding * 2) / h)));
  return { k, x: width / 2 - (bounds.minX + w / 2) * k, y: height / 2 - (bounds.minY + h / 2) * k };
}
function hitTest(t, items, screen, radius) {
  let best = null;
  let bestDistance = radius;
  for (const item of items) {
    const p = toScreen(t, item);
    const distance = Math.hypot(p.x - screen.x, p.y - screen.y);
    if (distance <= bestDistance) {
      best = item;
      bestDistance = distance;
    }
  }
  return best;
}

class GestureTracker {
  transform;
  contacts = new Map;
  tapEligible = false;
  constructor(transform = IDENTITY) {
    this.transform = transform;
  }
  down(id, p, at) {
    this.contacts.set(id, { start: p, last: p, at });
    this.tapEligible = this.contacts.size === 1;
    return { transform: this.transform, tap: null };
  }
  move(id, p) {
    const contact = this.contacts.get(id);
    if (!contact)
      return { transform: this.transform, tap: null };
    if (Math.hypot(p.x - contact.start.x, p.y - contact.start.y) > TAP_SLOP)
      this.tapEligible = false;
    if (this.contacts.size === 1) {
      this.transform = { ...this.transform, x: this.transform.x + p.x - contact.last.x, y: this.transform.y + p.y - contact.last.y };
    } else if (this.contacts.size === 2) {
      const other = [...this.contacts.entries()].find(([key]) => key !== id)?.[1];
      if (other)
        this.transform = pinch(this.transform, [contact.last, other.last], [p, other.last]);
    }
    contact.last = p;
    return { transform: this.transform, tap: null };
  }
  up(id, p, at) {
    const contact = this.contacts.get(id);
    if (!contact)
      return { transform: this.transform, tap: null };
    this.contacts.delete(id);
    const tapped = this.tapEligible && this.contacts.size === 0 && at - contact.at <= TAP_MS && Math.hypot(p.x - contact.start.x, p.y - contact.start.y) <= TAP_SLOP;
    if (this.contacts.size === 0)
      this.tapEligible = false;
    return { transform: this.transform, tap: tapped ? p : null };
  }
  cancel(id) {
    this.contacts.delete(id);
    this.tapEligible = false;
  }
  wheel(focal, deltaY, deltaMode) {
    this.transform = zoomAt(this.transform, focal, wheelFactor(deltaY, deltaMode));
    return this.transform;
  }
}

// src/packs/space/ui/editors.tsx
var TERRAINS = ["grass", "road", "building", "water", "forest", "sand", "rock"];
var TERRAIN_COLOR = { road: "#3a3d48", grass: "#1f3326", water: "#1b2c44", building: "#3b2f2a", forest: "#18301f", sand: "#4a422c", rock: "#34343a" };
var ZONE_COLORS = ["rgba(124,108,255,0.45)", "rgba(242,196,107,0.45)", "rgba(127,224,160,0.45)", "rgba(255,138,138,0.45)", "rgba(107,197,242,0.45)"];
function resizeGrid(grid, width, height, fill) {
  const remap = (index) => {
    const x = index % grid.width;
    const y = Math.floor(index / grid.width);
    return x < width && y < height ? y * width + x : null;
  };
  const terrain = [];
  for (let y = 0;y < height; y += 1)
    for (let x = 0;x < width; x += 1)
      terrain.push(x < grid.width && y < grid.height ? grid.terrain[y * grid.width + x] ?? fill : fill);
  const keep = (cells) => cells.map(remap).filter((cell) => cell !== null);
  return { ...grid, width, height, terrain, blocked: keep(grid.blocked), zones: Object.fromEntries(Object.entries(grid.zones).map(([zone, cells]) => [zone, keep(cells)])) };
}
var CELL = 32;
function cellPx(t) {
  return { ...t, k: t.k * CELL };
}
function cellAt(t, grid, screen) {
  const w = toWorld(t, screen);
  const x = Math.floor(w.x);
  const y = Math.floor(w.y);
  return x >= 0 && y >= 0 && x < grid.width && y < grid.height ? y * grid.width + x : null;
}
function paintCell(grid, index, tool, brush, zone, adding) {
  if (tool === "paint") {
    if (grid.terrain[index] === brush)
      return grid;
    const terrain = grid.terrain.slice();
    terrain[index] = brush;
    return { ...grid, terrain };
  }
  if (tool === "block") {
    const has = grid.blocked.includes(index);
    if (has === adding)
      return grid;
    return { ...grid, blocked: adding ? [...grid.blocked, index].sort((a, b) => a - b) : grid.blocked.filter((cell) => cell !== index) };
  }
  const cells = grid.zones[zone] ?? [];
  const has = cells.includes(index);
  if (has === adding || !zone)
    return grid;
  return { ...grid, zones: { ...grid.zones, [zone]: adding ? [...cells, index].sort((a, b) => a - b) : cells.filter((cell) => cell !== index) } };
}
function drawGrid(canvas, grid, view, marker) {
  const t = cellPx(view);
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const g = canvas.getContext("2d");
  if (!g)
    return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = "#0e1015";
  g.fillRect(0, 0, width, height);
  const blocked = new Set(grid.blocked);
  const zoneOf = new Map;
  Object.values(grid.zones).forEach((cells, i) => cells.forEach((cell) => zoneOf.set(cell, i)));
  const size = Math.ceil(t.k);
  for (let y = 0;y < grid.height; y += 1) {
    for (let x = 0;x < grid.width; x += 1) {
      const p = toScreen(t, { x, y });
      if (p.x > width || p.y > height || p.x + t.k < 0 || p.y + t.k < 0)
        continue;
      const index = y * grid.width + x;
      g.fillStyle = TERRAIN_COLOR[grid.terrain[index] ?? ""] ?? "#26293a";
      g.fillRect(p.x, p.y, size, size);
      const zone = zoneOf.get(index);
      if (zone !== undefined) {
        g.fillStyle = ZONE_COLORS[zone % ZONE_COLORS.length] ?? "rgba(255,255,255,0.3)";
        g.fillRect(p.x, p.y, size, size);
      }
      if (blocked.has(index)) {
        g.strokeStyle = "rgba(255,138,138,0.9)";
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(p.x + 2, p.y + 2);
        g.lineTo(p.x + t.k - 2, p.y + t.k - 2);
        g.moveTo(p.x + t.k - 2, p.y + 2);
        g.lineTo(p.x + 2, p.y + t.k - 2);
        g.stroke();
      }
      if (t.k >= 10) {
        g.strokeStyle = "rgba(0,0,0,0.35)";
        g.lineWidth = 1;
        g.strokeRect(p.x + 0.5, p.y + 0.5, t.k, t.k);
      }
    }
  }
  if (marker) {
    const p = toScreen(t, { x: marker.x + 0.5, y: marker.y + 0.5 });
    g.fillStyle = "#f2c46b";
    g.beginPath();
    g.arc(p.x, p.y, Math.max(5, t.k * 0.35), 0, Math.PI * 2);
    g.fill();
  }
}
function local(canvas, event) {
  const rect = canvas.getBoundingClientRect();
  return { x: (event.clientX - rect.left) * (rect.width > 0 ? canvas.clientWidth / rect.width : 1), y: (event.clientY - rect.top) * (rect.height > 0 ? canvas.clientHeight / rect.height : 1) };
}
function GridCanvas(props) {
  const canvas = T2(null);
  const tracker = T2(new GestureTracker(IDENTITY));
  const pointers = T2(new Set);
  const painting = T2(null);
  const [t, setT] = d2(IDENTITY);
  A(() => {
    const el = canvas.current;
    if (!el)
      return;
    const refit = () => {
      if (el.clientWidth === 0 || el.clientHeight === 0)
        return;
      const next = fit({ minX: 0, minY: 0, maxX: props.grid.width * CELL, maxY: props.grid.height * CELL }, el.clientWidth, el.clientHeight, 8);
      tracker.current.transform = next;
      setT(next);
    };
    refit();
    const observer = new ResizeObserver(refit);
    observer.observe(el);
    return () => observer.disconnect();
  }, [props.grid.width, props.grid.height]);
  A(() => {
    if (canvas.current)
      drawGrid(canvas.current, props.grid, t, props.marker);
  }, [props.grid, t, props.marker]);
  const paintAt = (event, first) => {
    const el = canvas.current;
    if (!el)
      return;
    const cell = cellAt(cellPx(tracker.current.transform), props.grid, local(el, event));
    if (cell !== null && cell !== painting.current) {
      painting.current = cell;
      props.onCell(cell, first);
    }
  };
  return /* @__PURE__ */ u3("div", {
    class: "lre-grid-editor",
    children: /* @__PURE__ */ u3("canvas", {
      ref: canvas,
      role: "img",
      "aria-label": "Grid",
      onPointerDown: (event) => {
        const el = canvas.current;
        if (!el)
          return;
        el.setPointerCapture(event.pointerId);
        pointers.current.add(event.pointerId);
        tracker.current.down(event.pointerId, local(el, event), event.timeStamp);
        if (props.tool !== "pan" && pointers.current.size === 1) {
          painting.current = null;
          paintAt(event, true);
        }
      },
      onPointerMove: (event) => {
        const el = canvas.current;
        if (!el || !pointers.current.has(event.pointerId))
          return;
        if (props.tool !== "pan" && pointers.current.size === 1)
          paintAt(event, false);
        else
          setT(tracker.current.move(event.pointerId, local(el, event)).transform);
      },
      onPointerUp: (event) => {
        const el = canvas.current;
        pointers.current.delete(event.pointerId);
        if (el) {
          const result = tracker.current.up(event.pointerId, local(el, event), event.timeStamp);
          if (props.tool === "pan" && result.tap) {
            const cell = cellAt(cellPx(tracker.current.transform), props.grid, result.tap);
            if (cell !== null)
              props.onCell(cell, true);
          }
        }
        painting.current = null;
      },
      onPointerCancel: (event) => {
        pointers.current.delete(event.pointerId);
        tracker.current.cancel(event.pointerId);
        painting.current = null;
      },
      onWheel: (event) => {
        const el = canvas.current;
        if (!el)
          return;
        event.preventDefault();
        setT(tracker.current.wheel(local(el, event), event.deltaY, event.deltaMode));
      }
    }, undefined, false, undefined, this)
  }, undefined, false, undefined, this);
}
function GridEditor(props) {
  const app = useApp();
  const isNew = props.id?.startsWith("new:") ?? false;
  const id = isNew ? (props.id ?? "").slice(4) : props.id;
  const stored = id ? props.world.grids[id] : undefined;
  const blank = { id: id ?? "", width: 16, height: 16, terrain: Array.from({ length: 256 }, () => "grass"), blocked: [], zones: {} };
  const [grid, setGrid] = d2(stored ? structuredClone(stored) : blank);
  const [tool, setTool] = d2("paint");
  const [brush, setBrush] = d2("road");
  const [zone, setZone] = d2(Object.keys(stored?.zones ?? {})[0] ?? "");
  const [newZone, setNewZone] = d2("");
  const adding = T2(true);
  const [busy, run] = useBusy();
  A(() => setGrid(stored ? structuredClone(stored) : blank), [JSON.stringify(stored)]);
  if (!id)
    return /* @__PURE__ */ u3(SchemaEditor, {
      ...props
    }, undefined, false, undefined, this);
  const changed = JSON.stringify(grid) !== JSON.stringify(stored ?? null);
  const palette = [...new Set([...TERRAINS, ...grid.terrain])];
  return /* @__PURE__ */ u3("div", {
    class: "lre-stack",
    "data-lre-editor": "grids",
    children: [
      /* @__PURE__ */ u3("div", {
        class: "lre-h2",
        children: [
          /* @__PURE__ */ u3("code", {
            children: id
          }, undefined, false, undefined, this),
          " · ",
          grid.width,
          "×",
          grid.height
        ]
      }, undefined, true, undefined, this),
      /* @__PURE__ */ u3("div", {
        class: "lre-inline",
        children: [
          /* @__PURE__ */ u3("label", {
            class: "lre-field",
            style: { width: "88px" },
            children: [
              /* @__PURE__ */ u3("span", {
                class: "label",
                children: "Width"
              }, undefined, false, undefined, this),
              /* @__PURE__ */ u3("input", {
                class: "lre-input",
                inputMode: "numeric",
                value: String(grid.width),
                onChange: (event) => setGrid(resizeGrid(grid, Math.max(1, Math.min(256, Number(event.currentTarget.value) || 1)), grid.height, brush))
              }, undefined, false, undefined, this)
            ]
          }, undefined, true, undefined, this),
          /* @__PURE__ */ u3("label", {
            class: "lre-field",
            style: { width: "88px" },
            children: [
              /* @__PURE__ */ u3("span", {
                class: "label",
                children: "Height"
              }, undefined, false, undefined, this),
              /* @__PURE__ */ u3("input", {
                class: "lre-input",
                inputMode: "numeric",
                value: String(grid.height),
                onChange: (event) => setGrid(resizeGrid(grid, grid.width, Math.max(1, Math.min(256, Number(event.currentTarget.value) || 1)), brush))
              }, undefined, false, undefined, this)
            ]
          }, undefined, true, undefined, this),
          /* @__PURE__ */ u3("label", {
            class: "lre-field",
            style: { width: "100px" },
            children: [
              /* @__PURE__ */ u3("span", {
                class: "label",
                children: "Cell (m)"
              }, undefined, false, undefined, this),
              /* @__PURE__ */ u3("input", {
                class: "lre-input",
                inputMode: "decimal",
                value: grid.cellMeters !== undefined ? String(grid.cellMeters) : "",
                onChange: (event) => setGrid({ ...grid, cellMeters: event.currentTarget.value ? Number(event.currentTarget.value) : undefined })
              }, undefined, false, undefined, this)
            ]
          }, undefined, true, undefined, this)
        ]
      }, undefined, true, undefined, this),
      /* @__PURE__ */ u3(Seg, {
        label: "Tool",
        value: tool,
        options: [
          { value: "pan", label: "Pan" },
          { value: "paint", label: "Terrain" },
          { value: "block", label: "Blocked" },
          { value: "zone", label: "Zone" }
        ],
        onChange: (next) => setTool(next)
      }, undefined, false, undefined, this),
      tool === "paint" ? /* @__PURE__ */ u3("div", {
        class: "lre-inline",
        children: palette.map((terrain) => /* @__PURE__ */ u3("button", {
          type: "button",
          class: terrain === brush ? "lre-btn small primary" : "lre-btn small",
          "aria-pressed": terrain === brush,
          onClick: () => setBrush(terrain),
          children: [
            /* @__PURE__ */ u3("span", {
              "aria-hidden": "true",
              style: { display: "inline-block", width: "12px", height: "12px", borderRadius: "3px", background: TERRAIN_COLOR[terrain] ?? "#26293a", border: "1px solid rgba(255,255,255,.3)" }
            }, undefined, false, undefined, this),
            " ",
            terrain
          ]
        }, terrain, true, undefined, this))
      }, undefined, false, undefined, this) : null,
      tool === "zone" ? /* @__PURE__ */ u3("div", {
        class: "lre-inline",
        children: [
          Object.keys(grid.zones).map((name, i) => /* @__PURE__ */ u3("button", {
            type: "button",
            class: name === zone ? "lre-btn small primary" : "lre-btn small",
            "aria-pressed": name === zone,
            onClick: () => setZone(name),
            children: [
              /* @__PURE__ */ u3("span", {
                "aria-hidden": "true",
                style: { display: "inline-block", width: "12px", height: "12px", borderRadius: "3px", background: ZONE_COLORS[i % ZONE_COLORS.length] }
              }, undefined, false, undefined, this),
              " ",
              name,
              " (",
              grid.zones[name]?.length ?? 0,
              ")"
            ]
          }, name, true, undefined, this)),
          /* @__PURE__ */ u3("form", {
            class: "lre-inline",
            onSubmit: (event) => {
              event.preventDefault();
              const name = newZone.trim();
              if (!name || name in grid.zones)
                return;
              setGrid({ ...grid, zones: { ...grid.zones, [name]: [] } });
              setZone(name);
              setNewZone("");
            },
            children: [
              /* @__PURE__ */ u3("input", {
                class: "lre-input",
                style: { width: "120px" },
                placeholder: "New zone",
                "aria-label": "New zone",
                value: newZone,
                onInput: (event) => setNewZone(event.currentTarget.value.replace(/\s+/g, "_"))
              }, undefined, false, undefined, this),
              /* @__PURE__ */ u3("button", {
                type: "submit",
                class: "lre-btn small",
                "aria-label": "Add zone",
                children: "+"
              }, undefined, false, undefined, this)
            ]
          }, undefined, true, undefined, this)
        ]
      }, undefined, true, undefined, this) : null,
      /* @__PURE__ */ u3(GridCanvas, {
        grid,
        tool,
        marker: null,
        onCell: (index, first) => {
          if (tool === "pan")
            return;
          if (first)
            adding.current = tool === "block" ? !grid.blocked.includes(index) : tool === "zone" ? !(grid.zones[zone] ?? []).includes(index) : true;
          setGrid((current) => paintCell(current, index, tool, brush, zone, adding.current));
        }
      }, undefined, false, undefined, this),
      /* @__PURE__ */ u3("span", {
        class: "lre-small lre-muted",
        children: tool === "pan" ? "Drag to pan, pinch or scroll to zoom." : "Drag to paint; two fingers pan and zoom."
      }, undefined, false, undefined, this),
      /* @__PURE__ */ u3("div", {
        class: "lre-inline",
        children: [
          /* @__PURE__ */ u3("button", {
            type: "button",
            class: "lre-btn primary",
            disabled: !changed && !isNew || busy,
            onClick: () => run(async () => {
              const message = await props.send({ type: "lre.editor", worldId: props.world.id, base: null, op: "put", collection: "grids", id, value: { ...grid, id } });
              if (message.type === "lre.result" && isNew)
                app.ui.update((ui) => ({ ...ui, build: { view: "item", worldId: props.world.id, collection: "grids", id } }));
            }),
            children: isNew ? "Create grid" : "Save to draft"
          }, undefined, false, undefined, this),
          /* @__PURE__ */ u3("button", {
            type: "button",
            class: "lre-btn ghost",
            disabled: !changed || busy,
            onClick: () => setGrid(stored ? structuredClone(stored) : blank),
            children: "Revert"
          }, undefined, false, undefined, this)
        ]
      }, undefined, true, undefined, this)
    ]
  }, undefined, true, undefined, this);
}
function PlaceEditor(props) {
  const app = useApp();
  const id = props.id?.startsWith("new:") ? null : props.id;
  const place = id ? props.world.places[id] : undefined;
  const parent = place?.parent ? props.world.places[place.parent] : undefined;
  const grid = parent?.grid ? props.world.grids[parent.grid] : undefined;
  const [busy, run] = useBusy();
  return /* @__PURE__ */ u3("div", {
    class: "lre-stack",
    children: [
      /* @__PURE__ */ u3(SchemaEditor, {
        ...props
      }, undefined, false, undefined, this),
      place && grid ? /* @__PURE__ */ u3("section", {
        class: "lre-card",
        children: [
          /* @__PURE__ */ u3("div", {
            class: "lre-h",
            children: [
              "Position on ",
              parent?.name ?? "parent",
              "'s grid"
            ]
          }, undefined, true, undefined, this),
          /* @__PURE__ */ u3(GridCanvas, {
            grid,
            tool: "pan",
            marker: place.cell ?? null,
            onCell: (index) => {
              if (busy || !id)
                return;
              const cell = { x: index % grid.width, y: Math.floor(index / grid.width) };
              run(async () => {
                const message = await props.send({ type: "lre.editor", worldId: props.world.id, base: null, op: "put", collection: "places", id, value: { ...place, cell } });
                if (message.type === "lre.result")
                  app.toast(`Placed at ${cell.x}, ${cell.y}.`, "info");
              });
            }
          }, undefined, false, undefined, this),
          /* @__PURE__ */ u3("span", {
            class: "lre-small lre-muted",
            children: "Tap a cell to place it."
          }, undefined, false, undefined, this)
        ]
      }, undefined, true, undefined, this) : null
    ]
  }, undefined, true, undefined, this);
}

// src/packs/space/ui/labels.ts
var LABEL_HEIGHT = 20;
var LINE = 16;
var LABEL_PAD = 4;
var GAP = 3;
var EDGE = 4;
var STEP = 16;
var SHORTER = [120, 96, 76, 60, 44];
var READABLE = [120, 96, 76];
var MIN_CHARS = 4;
var FAR = 112;
var HALF_GAP = 2;
var SLIDE = 120;
var SLIDE_STEP = 12;
var MAX_REACH = 240;
var NEAR = 64;
function labelPadding(width, height) {
  return Math.round(Math.max(56, Math.min(width, height) * 0.2));
}
function controlBoxes(width, height) {
  return [
    { x: 0, y: 0, w: width, h: 52 },
    { x: width - 56, y: height - 150, w: 56, h: 150 }
  ];
}
function overlaps(a, b, gap = 0) {
  return a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;
}
function inside(b, width, height) {
  return b.x >= EDGE && b.y >= EDGE && b.x + b.w <= width - EDGE && b.y + b.h <= height - EDGE;
}
function segmentHits(p, q, b) {
  let t0 = 0;
  let t1 = 1;
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const edges = [
    [-dx, p.x - b.x],
    [dx, b.x + b.w - p.x],
    [-dy, p.y - b.y],
    [dy, b.y + b.h - p.y]
  ];
  for (const [d, n] of edges) {
    if (d === 0) {
      if (n < 0)
        return false;
      continue;
    }
    const t = n / d;
    if (d < 0)
      t0 = Math.max(t0, t);
    else
      t1 = Math.min(t1, t);
    if (t0 > t1)
      return false;
  }
  return true;
}
function shorten(text, max, measure) {
  if (measure(text) <= max)
    return text;
  let lo = MIN_CHARS;
  let hi = text.length - 1;
  let best = null;
  while (lo <= hi) {
    const mid = lo + hi >> 1;
    const s = `${text.slice(0, mid).trimEnd()}…`;
    if (measure(s) <= max) {
      best = s;
      lo = mid + 1;
    } else
      hi = mid - 1;
  }
  return best;
}
function wrapTwo(text, max, measure) {
  const words = text.split(/\s+/).filter((w) => w !== "");
  if (words.length < 2)
    return null;
  let first = "";
  let i = 0;
  while (i < words.length - 1) {
    const next = first === "" ? words[i] ?? "" : `${first} ${words[i] ?? ""}`;
    if (measure(next) > max)
      break;
    first = next;
    i++;
  }
  if (first === "")
    return null;
  const second = shorten(words.slice(i).join(" "), max, measure);
  return second ? [first, second] : null;
}
function nearest(b, p) {
  return { x: Math.max(b.x, Math.min(p.x, b.x + b.w)), y: Math.max(b.y, Math.min(p.y, b.y + b.h)) };
}
function sidesFor(dir) {
  const horizontal = dir.x >= 0 ? ["right", "left"] : ["left", "right"];
  const vertical = dir.y < 0 ? ["above", "below"] : ["below", "above"];
  return Math.abs(dir.x) >= 0.45 ? [horizontal[0], vertical[0], vertical[1], horizontal[1]] : [vertical[0], horizontal[0], horizontal[1], vertical[1]];
}
function spotsFor(sides, reach) {
  const out = [];
  sides.forEach((side, rankOfSide) => {
    for (let d = 0;d <= reach; d += STEP) {
      for (let s = 0;s <= SLIDE; s += SLIDE_STEP) {
        for (const slide of s === 0 ? [0] : [s, -s])
          out.push({ side, out: d, slide, cost: d + Math.abs(slide) + rankOfSide * 14 });
      }
    }
  });
  return out.sort((a, b) => a.cost - b.cost);
}
function spotBox(p, r, spot, w, h) {
  const clear = r + GAP + 1 + spot.out;
  switch (spot.side) {
    case "right":
      return { x: p.x + clear, y: p.y - h / 2 + spot.slide, w, h };
    case "left":
      return { x: p.x - clear - w, y: p.y - h / 2 + spot.slide, w, h };
    case "above":
      return { x: p.x - w / 2 + spot.slide, y: p.y - clear - h, w, h };
    case "below":
      return { x: p.x - w / 2 + spot.slide, y: p.y + clear, w, h };
  }
}
function placeLabels(items, opts) {
  const { width, height, measure } = opts;
  const onCanvas = items.filter((i) => i.x >= 0 && i.y >= 0 && i.x <= width && i.y <= height);
  if (onCanvas.length === 0)
    return [];
  const centre = { x: onCanvas.reduce((a, i) => a + i.x, 0) / onCanvas.length, y: onCanvas.reduce((a, i) => a + i.y, 0) / onCanvas.length };
  const angle = (i) => {
    const a = Math.atan2(i.x - centre.x, centre.y - i.y);
    return a < 0 ? a + 2 * Math.PI : a;
  };
  const first = opts.first ?? [];
  const rank = (i) => {
    const at = first.indexOf(i.id);
    return at < 0 ? first.length : at;
  };
  const straightness = (i) => {
    const len = Math.hypot(i.x - centre.x, i.y - centre.y);
    return len < 1 ? 0 : Math.round(Math.abs(Math.abs(i.x - centre.x) / len - Math.SQRT1_2) * 10);
  };
  const order = [...onCanvas].sort((a, b) => rank(a) - rank(b) || straightness(b) - straightness(a) || angle(a) - angle(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const dots = items.map((i) => ({ id: i.id, box: { x: i.x - i.r - 1, y: i.y - i.r - 1, w: 2 * i.r + 2, h: 2 * i.r + 2 } }));
  const avoid = opts.avoid ?? [];
  const placed = [];
  const reach = Math.min(MAX_REACH, Math.max(width, height) / 2);
  const free = (box, id, leader) => {
    if (!inside(box, width, height))
      return false;
    if (avoid.some((b) => overlaps(box, b)))
      return false;
    if (dots.some((d) => overlaps(box, d.box, GAP)))
      return false;
    if (placed.some((l) => overlaps(box, l.box, GAP) || l.leader !== null && segmentHits(l.leader.from, l.leader.to, box)))
      return false;
    if (leader) {
      if (placed.some((l) => segmentHits(leader.from, leader.to, l.box)))
        return false;
      if (dots.some((d) => d.id !== id && segmentHits(leader.from, leader.to, d.box)))
        return false;
    }
    return true;
  };
  for (const item of order) {
    const dx = item.x - centre.x;
    const dy = item.y - centre.y;
    const len = Math.hypot(dx, dy);
    const dir = len < 1 ? { x: 1, y: 0 } : { x: dx / len, y: dy / len };
    const spots = spotsFor(sidesFor(dir), reach);
    const half = Math.abs(dir.x) >= 0.45 ? Math.sign(dir.x) : 0;
    const ownHalf = (box) => half > 0 ? box.x >= centre.x + HALF_GAP : half < 0 ? box.x + box.w <= centre.x - HALF_GAP : true;
    const full = item.text;
    const fullWidth = measure(full);
    const one = (texts) => texts.map((t) => [t]);
    const shortened = (maxima) => {
      const out = [];
      for (const max of maxima) {
        if (max >= fullWidth)
          continue;
        const s = shorten(full, max, measure);
        if (s && !out.some((o) => o[0] === s))
          out.push([s]);
      }
      return out;
    };
    const wrapped = (maxima) => {
      const out = [];
      for (const max of maxima) {
        if (max >= fullWidth)
          continue;
        const w = wrapTwo(full, max, measure);
        if (w && !out.some((o) => o.join(`
`) === w.join(`
`)))
          out.push(w);
      }
      return out;
    };
    const tiers = [
      [one([full]), NEAR, true],
      [wrapped(READABLE), NEAR, true],
      [shortened(READABLE), NEAR, true],
      [one([full]), FAR, true],
      [[...wrapped(SHORTER), ...shortened(SHORTER)], FAR, true],
      [[[full], ...wrapped(SHORTER), ...shortened(SHORTER)], Infinity, false]
    ];
    let done = null;
    search:
      for (const [variants, limit, keepHalf] of tiers) {
        for (const lines of variants) {
          const w = Math.max(...lines.map((l) => measure(l))) + 2 * LABEL_PAD;
          const h = lines.length === 1 ? LABEL_HEIGHT : LABEL_HEIGHT + LINE * (lines.length - 1);
          for (const spot of spots) {
            if (spot.cost > limit)
              break;
            const box = spotBox(item, item.r, spot, w, h);
            if (keepHalf && !ownHalf(box))
              continue;
            const to = nearest(box, item);
            const gap = Math.hypot(to.x - item.x, to.y - item.y);
            const leader = gap > item.r + GAP + 2 ? { from: { x: item.x + (to.x - item.x) / gap * item.r, y: item.y + (to.y - item.y) / gap * item.r }, to } : null;
            if (free(box, item.id, leader)) {
              done = { id: item.id, lines, full, box, leader };
              break search;
            }
          }
        }
      }
    if (done)
      placed.push(done);
  }
  return placed;
}
function labelAt(labels, p) {
  let best = null;
  let bestDistance = Infinity;
  for (const l of labels) {
    const grow = Math.max(0, (40 - l.box.h) / 2);
    const area = { x: l.box.x - 4, y: l.box.y - grow, w: l.box.w + 8, h: l.box.h + 2 * grow };
    if (p.x < area.x || p.x > area.x + area.w || p.y < area.y || p.y > area.y + area.h)
      continue;
    const distance = Math.abs(p.y - (l.box.y + l.box.h / 2));
    if (distance < bestDistance) {
      best = l;
      bestDistance = distance;
    }
  }
  return best;
}

// src/packs/space/ui/view.ts
var TRAVEL_MODES2 = ["walk", "road", "offroad", "water"];
function decodeMapView(value) {
  if (!isRecord(value) || !Array.isArray(value.places))
    return null;
  const scope = obj(value.scope);
  const grid = obj(value.grid);
  const pov = grid ? obj(grid.pov) : null;
  return {
    level: num(value.level, 1),
    scope: { id: scope ? optStr(scope.id) ?? null : null, name: scope ? str(scope.name, "Map") : "Map", width: scope ? num(scope.width, 1000) : 1000, height: scope ? num(scope.height, 1000) : 1000 },
    here: optStr(value.here) ?? null,
    places: list(value.places, (p) => typeof p.id === "string" ? { id: p.id, name: str(p.name, p.id), x: num(p.x), y: num(p.y), kind: optStr(p.kind), known: p.known !== false } : null),
    routes: list(value.routes, (r) => {
      const modes = {};
      const raw = obj(r.modes);
      if (raw) {
        for (const mode of TRAVEL_MODES2) {
          const leg = obj(raw[mode]);
          if (leg)
            modes[mode] = { minutes: num(leg.minutes), distanceKm: optNum(leg.distanceKm) };
        }
      }
      return typeof r.from === "string" && typeof r.to === "string" ? { from: r.from, to: r.to, modes } : null;
    }),
    travel: list(value.travel, (t) => typeof t.to === "string" && typeof t.action === "string" ? { to: t.to, label: str(t.label, t.action), mode: oneOf(t.mode, TRAVEL_MODES2, "walk"), minutes: num(t.minutes), cents: optNum(t.cents), vehicle: optStr(t.vehicle), action: t.action, params: isRecord(t.params) ? t.params : {}, disabled: optStr(t.disabled) } : null),
    grid: grid ? {
      width: num(grid.width, 1),
      height: num(grid.height, 1),
      cellMeters: optNum(grid.cellMeters),
      terrain: strings(grid.terrain),
      blocked: Array.isArray(grid.blocked) ? grid.blocked.filter((n) => typeof n === "number") : [],
      pov: pov ? { x: num(pov.x), y: num(pov.y) } : undefined
    } : undefined
  };
}

// src/packs/space/ui/map.tsx
var MODE_ICON = { walk: "\uD83D\uDEB6", road: "\uD83D\uDE97", offroad: "\uD83D\uDEFB", water: "⛵" };
var TERRAIN_COLOR2 = { road: "#3a3d48", grass: "#1f3326", water: "#1b2c44", building: "#3b2f2a", forest: "#18301f", sand: "#4a422c", rock: "#34343a" };
function boundsOf(view) {
  if (view.grid)
    return { minX: 0, minY: 0, maxX: view.grid.width, maxY: view.grid.height };
  if (view.places.length === 0)
    return { minX: 0, minY: 0, maxX: view.scope.width, maxY: view.scope.height };
  return {
    minX: Math.min(...view.places.map((p) => p.x)),
    minY: Math.min(...view.places.map((p) => p.y)),
    maxX: Math.max(...view.places.map((p) => p.x)),
    maxY: Math.max(...view.places.map((p) => p.y))
  };
}
function draw(canvas, view, t, selected) {
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }
  const g = canvas.getContext("2d");
  if (!g)
    return [];
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = "#12141a";
  g.fillRect(0, 0, width, height);
  if (view.grid) {
    const { grid } = view;
    const blocked = new Set(grid.blocked);
    for (let y = 0;y < grid.height; y += 1) {
      for (let x = 0;x < grid.width; x += 1) {
        const index = y * grid.width + x;
        const p = toScreen(t, { x, y });
        if (p.x > width || p.y > height || p.x + t.k < 0 || p.y + t.k < 0)
          continue;
        g.fillStyle = blocked.has(index) ? "#0a0b0f" : TERRAIN_COLOR2[grid.terrain[index] ?? ""] ?? "#1d2029";
        g.fillRect(p.x, p.y, Math.ceil(t.k), Math.ceil(t.k));
      }
    }
    if (grid.pov) {
      const p = toScreen(t, { x: grid.pov.x + 0.5, y: grid.pov.y + 0.5 });
      g.fillStyle = "#7c6cff";
      g.beginPath();
      g.arc(p.x, p.y, Math.max(5, t.k * 0.35), 0, Math.PI * 2);
      g.fill();
    }
  } else {
    g.strokeStyle = "rgba(255,255,255,0.04)";
    g.lineWidth = 1;
    const step = 100 * t.k;
    if (step > 12) {
      for (let x = t.x % step;x < width; x += step) {
        g.beginPath();
        g.moveTo(x, 0);
        g.lineTo(x, height);
        g.stroke();
      }
      for (let y = t.y % step;y < height; y += step) {
        g.beginPath();
        g.moveTo(0, y);
        g.lineTo(width, y);
        g.stroke();
      }
    }
  }
  const byId = new Map(view.places.map((p) => [p.id, p]));
  for (const route of view.routes) {
    const a = byId.get(route.from);
    const b = byId.get(route.to);
    if (!a || !b)
      continue;
    const pa = toScreen(t, a);
    const pb = toScreen(t, b);
    g.strokeStyle = route.modes.road ? "rgba(200,200,220,0.45)" : route.modes.water ? "rgba(90,150,230,0.5)" : "rgba(200,200,220,0.25)";
    g.lineWidth = route.modes.road ? 3 : 2;
    g.setLineDash(route.modes.road ? [] : [6, 6]);
    g.beginPath();
    g.moveTo(pa.x, pa.y);
    g.lineTo(pb.x, pb.y);
    g.stroke();
  }
  g.setLineDash([]);
  g.font = "13px system-ui, sans-serif";
  for (const place of view.places) {
    const p = toScreen(t, place);
    const here = place.id === view.here;
    const isSelected = place.id === selected;
    g.globalAlpha = place.known ? 1 : 0.45;
    g.fillStyle = here ? "#7c6cff" : "#d8d8e4";
    g.beginPath();
    g.arc(p.x, p.y, here || isSelected ? 9 : 7, 0, Math.PI * 2);
    g.fill();
    if (here || isSelected) {
      g.strokeStyle = isSelected ? "#f2c46b" : "rgba(124,108,255,0.5)";
      g.lineWidth = 3;
      g.beginPath();
      g.arc(p.x, p.y, 15, 0, Math.PI * 2);
      g.stroke();
    }
    g.globalAlpha = 1;
  }
  const known = new Map(view.places.map((place) => [place.id, place.known]));
  const labels = placeLabels(view.places.map((place) => ({ id: place.id, ...toScreen(t, place), r: place.id === view.here || place.id === selected ? 16 : 8, text: place.known ? place.name : `${place.name}?` })), { width, height, measure: (s) => g.measureText(s).width, avoid: controlBoxes(width, height), first: [view.here, selected].filter((id) => id !== null) });
  g.strokeStyle = "rgba(240,240,246,0.45)";
  g.lineWidth = 1;
  for (const label of labels) {
    if (!label.leader)
      continue;
    g.beginPath();
    g.moveTo(label.leader.from.x, label.leader.from.y);
    g.lineTo(label.leader.to.x, label.leader.to.y);
    g.stroke();
  }
  for (const label of labels) {
    g.globalAlpha = known.get(label.id) === false ? 0.45 : 1;
    g.fillStyle = "rgba(0,0,0,0.6)";
    g.fillRect(label.box.x, label.box.y, label.box.w, label.box.h);
    g.fillStyle = "#f0f0f6";
    label.lines.forEach((line, i) => g.fillText(line, label.box.x + LABEL_PAD, label.box.y + 15 + i * LINE));
    g.globalAlpha = 1;
  }
  return labels;
}
function localPoint(canvas, event) {
  const rect = canvas.getBoundingClientRect();
  const sx = rect.width > 0 ? canvas.clientWidth / rect.width : 1;
  const sy = rect.height > 0 ? canvas.clientHeight / rect.height : 1;
  return { x: (event.clientX - rect.left) * sx, y: (event.clientY - rect.top) * sy };
}
function MapPanel(props) {
  const view = b2(() => decodeMapView(props.view), [props.view]);
  if (!view)
    return props.view === undefined || props.view === null ? /* @__PURE__ */ u3(Empty, {
      children: "No map for this world yet."
    }, undefined, false, undefined, this) : /* @__PURE__ */ u3(JsonView, {
      value: props.view
    }, undefined, false, undefined, this);
  return /* @__PURE__ */ u3(MapCanvas, {
    view,
    chatId: props.chatId
  }, undefined, false, undefined, this);
}
function MapCanvas(props) {
  const app = useApp();
  const { view } = props;
  const canvas = T2(null);
  const tracker = T2(new GestureTracker(IDENTITY));
  const fitted = T2(false);
  const [selected, setSelected] = d2(null);
  const [transform, setTransform] = d2(IDENTITY);
  const [busy, run] = useBusy();
  const labels = T2([]);
  const refit = () => {
    const el = canvas.current;
    if (!el || el.clientWidth === 0)
      return;
    const t = fit(boundsOf(view), el.clientWidth, el.clientHeight, view.grid ? 16 : labelPadding(el.clientWidth, el.clientHeight));
    tracker.current.transform = t;
    setTransform(t);
    fitted.current = true;
  };
  A(() => {
    const el = canvas.current;
    if (!el)
      return;
    const observer = new ResizeObserver(() => {
      if (!fitted.current)
        refit();
      else
        labels.current = draw(el, view, tracker.current.transform, selected);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [view]);
  A(() => {
    if (canvas.current)
      labels.current = draw(canvas.current, view, transform, selected);
  }, [view, transform, selected]);
  const placeAt = (p) => {
    const dot = view.grid ? hitTest(tracker.current.transform, view.places.map((place) => ({ ...place, x: place.x + 0.5, y: place.y + 0.5 })), p, 24) : hitTest(tracker.current.transform, view.places, p, 24);
    const id = dot?.id ?? labelAt(labels.current, p)?.id;
    return id ? view.places.find((place) => place.id === id) ?? null : null;
  };
  const onPointerDown = (event) => {
    const el = canvas.current;
    if (!el)
      return;
    el.setPointerCapture(event.pointerId);
    tracker.current.down(event.pointerId, localPoint(el, event), event.timeStamp);
  };
  const onPointerMove = (event) => {
    const el = canvas.current;
    if (!el)
      return;
    const before = tracker.current.transform;
    const after = tracker.current.move(event.pointerId, localPoint(el, event)).transform;
    if (after !== before)
      setTransform(after);
  };
  const onPointerUp = (event) => {
    const el = canvas.current;
    if (!el)
      return;
    const result = tracker.current.up(event.pointerId, localPoint(el, event), event.timeStamp);
    if (result.tap)
      setSelected(placeAt(result.tap)?.id ?? null);
  };
  const onWheel = (event) => {
    const el = canvas.current;
    if (!el)
      return;
    event.preventDefault();
    setTransform(tracker.current.wheel(localPoint(el, event), event.deltaY, event.deltaMode));
  };
  const zoom = (factor) => {
    const el = canvas.current;
    if (!el)
      return;
    const t = zoomAt(tracker.current.transform, { x: el.clientWidth / 2, y: el.clientHeight / 2 }, factor);
    tracker.current.transform = t;
    setTransform(t);
  };
  const place = selected ? view.places.find((p) => p.id === selected) ?? null : null;
  const options = place ? view.travel.filter((t) => t.to === place.id) : [];
  return /* @__PURE__ */ u3("div", {
    class: "lre-map",
    "data-lre-map": true,
    "data-zoom": transform.k.toFixed(2),
    children: [
      /* @__PURE__ */ u3("canvas", {
        ref: canvas,
        "data-lre-canvas": "map",
        role: "img",
        "aria-label": `Map of ${view.scope.name}`,
        onPointerDown,
        onPointerMove,
        onPointerUp,
        onPointerCancel: (event) => tracker.current.cancel(event.pointerId),
        onWheel
      }, undefined, false, undefined, this),
      /* @__PURE__ */ u3("div", {
        class: "zoom",
        style: place ? { display: "none" } : undefined,
        children: [
          /* @__PURE__ */ u3("button", {
            type: "button",
            class: "lre-btn",
            "aria-label": "Zoom in",
            onClick: () => zoom(1.4),
            children: "+"
          }, undefined, false, undefined, this),
          /* @__PURE__ */ u3("button", {
            type: "button",
            class: "lre-btn",
            "aria-label": "Zoom out",
            onClick: () => zoom(1 / 1.4),
            children: "−"
          }, undefined, false, undefined, this),
          /* @__PURE__ */ u3("button", {
            type: "button",
            class: "lre-btn",
            "aria-label": "Fit map",
            onClick: refit,
            children: "⤢"
          }, undefined, false, undefined, this)
        ]
      }, undefined, true, undefined, this),
      place ? /* @__PURE__ */ u3("div", {
        class: "dock",
        "data-lre-map-dock": place.id,
        role: "group",
        "aria-label": place.name,
        onKeyDown: (event) => {
          if (event.key !== "Escape")
            return;
          event.stopPropagation();
          setSelected(null);
        },
        children: [
          /* @__PURE__ */ u3("div", {
            class: "lre-spread",
            children: [
              /* @__PURE__ */ u3("strong", {
                children: place.name
              }, undefined, false, undefined, this),
              /* @__PURE__ */ u3("button", {
                type: "button",
                class: "lre-btn small ghost",
                "aria-label": `Close ${place.name}`,
                onClick: () => setSelected(null),
                children: "✕"
              }, undefined, false, undefined, this)
            ]
          }, undefined, true, undefined, this),
          place.id === view.here ? /* @__PURE__ */ u3("span", {
            class: "lre-muted",
            children: "You are here."
          }, undefined, false, undefined, this) : null,
          place.id !== view.here && options.length === 0 ? /* @__PURE__ */ u3("span", {
            class: "lre-muted",
            children: "No route from here."
          }, undefined, false, undefined, this) : null,
          options.map((option) => /* @__PURE__ */ u3("button", {
            type: "button",
            class: "lre-item",
            disabled: busy || option.disabled !== undefined,
            title: option.disabled,
            onClick: () => run(async () => {
              const result = await app.request(travelRequest(option.action, option.params, props.chatId));
              if (result) {
                setSelected(null);
                app.overlays.closeMap();
              }
            }),
            children: [
              /* @__PURE__ */ u3("span", {
                "aria-hidden": "true",
                children: MODE_ICON[option.mode] ?? "➜"
              }, undefined, false, undefined, this),
              /* @__PURE__ */ u3("span", {
                class: "grow",
                children: [
                  /* @__PURE__ */ u3("span", {
                    class: "title",
                    children: option.label
                  }, undefined, false, undefined, this),
                  /* @__PURE__ */ u3("span", {
                    class: "sub",
                    children: [option.disabled === undefined ? formatMinutes(option.minutes) : null, option.vehicle, option.disabled].filter((part) => part).join(" · ")
                  }, undefined, false, undefined, this)
                ]
              }, undefined, true, undefined, this),
              option.cents !== undefined ? /* @__PURE__ */ u3("span", {
                class: "lre-num",
                children: formatCents(option.cents)
              }, undefined, false, undefined, this) : null
            ]
          }, `${option.action}:${option.mode}:${option.vehicle ?? ""}`, true, undefined, this))
        ]
      }, undefined, true, undefined, this) : null
    ]
  }, undefined, true, undefined, this);
}

// src/packs/space/ui/index.ts
var space = {
  id: "space",
  register(r) {
    r.panel({ id: "space.map", label: "Map", order: 15, component: MapPanel });
    r.editor({ collection: "grids", label: "Grids", component: GridEditor });
    r.editor({ collection: "places", label: "Places", component: PlaceEditor });
  }
};
var ui_default6 = space;

// src/packs/story/ui/panel.tsx
var KINDS = ["quest", "secret", "puzzle", "agenda"];
var STATUSES = ["active", "done", "failed"];
function decodeQuestsView(value) {
  if (!isRecord(value) || !STATUSES.some((status) => Array.isArray(value[status])))
    return null;
  return {
    tracks: STATUSES.flatMap((status) => list(value[status], (t) => typeof t.id === "string" ? {
      id: t.id,
      label: str(t.label, t.id),
      kind: oneOf(t.kind, KINDS, "quest"),
      stage: str(t.stage),
      cue: optStr(t.cue),
      truths: strings(t.truths),
      objectives: list(t.objectives, (o) => ({ label: str(o.label), done: o.done === true })),
      hints: strings(t.hints),
      status
    } : null))
  };
}
function Track(props) {
  const { track } = props;
  const done = track.objectives.filter((o) => o.done).length;
  return /* @__PURE__ */ u3(Card, {
    title: track.label,
    aside: /* @__PURE__ */ u3("span", {
      class: track.status === "done" ? "lre-badge pos" : track.status === "failed" ? "lre-badge neg" : "lre-badge accent",
      children: track.status === "active" ? track.kind : track.status
    }, undefined, false, undefined, this),
    children: [
      track.stage ? /* @__PURE__ */ u3("div", {
        class: "lre-small lre-muted",
        children: track.stage
      }, undefined, false, undefined, this) : null,
      track.cue ? /* @__PURE__ */ u3("p", {
        style: { margin: "6px 0", whiteSpace: "normal", overflowWrap: "anywhere" },
        children: track.cue
      }, undefined, false, undefined, this) : null,
      track.truths.length > 0 ? /* @__PURE__ */ u3("div", {
        "data-lre-quest-truths": true,
        children: [
          /* @__PURE__ */ u3("div", {
            class: "lre-small lre-muted",
            children: "What you've learned"
          }, undefined, false, undefined, this),
          track.truths.map((truth) => /* @__PURE__ */ u3("div", {
            class: "lre-small",
            style: { margin: "2px 0" },
            children: [
              "• ",
              truth
            ]
          }, truth, true, undefined, this))
        ]
      }, undefined, true, undefined, this) : null,
      track.objectives.length > 0 ? /* @__PURE__ */ u3("div", {
        children: [
          /* @__PURE__ */ u3("div", {
            class: "lre-small lre-muted",
            children: [
              done,
              "/",
              track.objectives.length,
              " objectives"
            ]
          }, undefined, true, undefined, this),
          track.objectives.map((o) => /* @__PURE__ */ u3("div", {
            class: "lre-small",
            style: { margin: "4px 0" },
            children: [
              /* @__PURE__ */ u3("span", {
                role: "img",
                "aria-label": o.done ? "Done:" : "To do:",
                children: o.done ? "☑" : "☐"
              }, undefined, false, undefined, this),
              " ",
              o.label
            ]
          }, o.label, true, undefined, this))
        ]
      }, undefined, true, undefined, this) : null,
      track.hints.length > 0 ? /* @__PURE__ */ u3("div", {
        "data-lre-quest-hints": true,
        children: track.hints.map((hint) => /* @__PURE__ */ u3("div", {
          class: "lre-small",
          style: { margin: "4px 0" },
          children: [
            /* @__PURE__ */ u3("span", {
              "aria-hidden": "true",
              children: "\uD83D\uDCA1"
            }, undefined, false, undefined, this),
            " ",
            hint
          ]
        }, hint, true, undefined, this))
      }, undefined, false, undefined, this) : null
    ]
  }, undefined, true, undefined, this);
}
function QuestsPanel(props) {
  const view = decodeQuestsView(props.view);
  const [status, setStatus] = d2("active");
  if (props.view === null || props.view === undefined)
    return /* @__PURE__ */ u3(Empty, {
      children: "No quests."
    }, undefined, false, undefined, this);
  if (!view)
    return /* @__PURE__ */ u3(JsonView, {
      value: props.view
    }, undefined, false, undefined, this);
  const tracks = view.tracks.filter((t) => t.status === status);
  return /* @__PURE__ */ u3("div", {
    class: "lre-stack",
    "data-lre-panel": "story.quests",
    children: [
      /* @__PURE__ */ u3(Seg, {
        label: "Quest status",
        value: status,
        options: STATUSES.map((s) => ({ value: s, label: `${s[0]?.toUpperCase()}${s.slice(1)} ${view.tracks.filter((t) => t.status === s).length}` })),
        onChange: (next) => setStatus(next)
      }, undefined, false, undefined, this),
      tracks.length === 0 ? /* @__PURE__ */ u3(Empty, {
        children: "None."
      }, undefined, false, undefined, this) : tracks.map((t) => /* @__PURE__ */ u3(Track, {
        track: t
      }, t.id, false, undefined, this))
    ]
  }, undefined, true, undefined, this);
}

// src/packs/story/ui/track-editor.tsx
function layoutTrack(track) {
  const edges = [];
  for (const [id, stage] of Object.entries(track.stages)) {
    for (const next of stage.next)
      edges.push({ from: id, to: next.to, fail: false });
    if (stage.fail)
      edges.push({ from: id, to: stage.fail.to, fail: true });
  }
  const layer = new Map;
  if (track.start in track.stages) {
    layer.set(track.start, 0);
    const queue = [track.start];
    while (queue.length > 0) {
      const id = queue.shift() ?? "";
      const depth = layer.get(id) ?? 0;
      for (const edge of edges) {
        if (edge.from === id && edge.to in track.stages && !layer.has(edge.to)) {
          layer.set(edge.to, depth + 1);
          queue.push(edge.to);
        }
      }
    }
  }
  const last = Math.max(-1, ...layer.values()) + 1;
  const rows = new Map;
  const nodes = Object.keys(track.stages).map((id) => {
    const reachable = layer.has(id);
    const l = reachable ? layer.get(id) ?? 0 : last;
    const row = rows.get(l) ?? 0;
    rows.set(l, row + 1);
    return { id, layer: l, row, reachable };
  });
  return { nodes, edges };
}
var NODE_W = 128;
var NODE_H = 44;
var GAP_X = 44;
var GAP_Y = 18;
function TrackGraph(props) {
  const { nodes, edges } = layoutTrack(props.track);
  const pos = new Map(nodes.map((n) => [n.id, { x: 8 + n.layer * (NODE_W + GAP_X), y: 8 + n.row * (NODE_H + GAP_Y) }]));
  const width = 16 + (Math.max(0, ...nodes.map((n) => n.layer)) + 1) * (NODE_W + GAP_X);
  const height = 16 + (Math.max(0, ...nodes.map((n) => n.row)) + 1) * (NODE_H + GAP_Y);
  return /* @__PURE__ */ u3("div", {
    class: "lre-graph",
    "data-lre-track-graph": true,
    children: /* @__PURE__ */ u3("svg", {
      width,
      height,
      role: "group",
      "aria-label": "Stage graph",
      children: [
        /* @__PURE__ */ u3("defs", {
          children: [
            /* @__PURE__ */ u3("marker", {
              id: "lre-arrow",
              viewBox: "0 0 10 10",
              refX: "9",
              refY: "5",
              markerWidth: "7",
              markerHeight: "7",
              orient: "auto-start-reverse",
              children: /* @__PURE__ */ u3("path", {
                d: "M0,0 L10,5 L0,10 z",
                fill: "#a3a3ad"
              }, undefined, false, undefined, this)
            }, undefined, false, undefined, this),
            /* @__PURE__ */ u3("marker", {
              id: "lre-arrow-fail",
              viewBox: "0 0 10 10",
              refX: "9",
              refY: "5",
              markerWidth: "7",
              markerHeight: "7",
              orient: "auto-start-reverse",
              children: /* @__PURE__ */ u3("path", {
                d: "M0,0 L10,5 L0,10 z",
                fill: "#ff8a8a"
              }, undefined, false, undefined, this)
            }, undefined, false, undefined, this)
          ]
        }, undefined, true, undefined, this),
        edges.map((e, i) => {
          const a = pos.get(e.from);
          const b = pos.get(e.to);
          if (!a || !b)
            return null;
          const back = b.x <= a.x;
          const x1 = a.x + NODE_W;
          const y1 = a.y + NODE_H / 2;
          const x2 = back ? b.x + NODE_W / 2 : b.x;
          const y2 = back ? b.y + NODE_H : b.y + NODE_H / 2;
          const mid = (x1 + x2) / 2;
          return /* @__PURE__ */ u3("path", {
            d: back ? `M${x1},${y1} C${x1 + 30},${y1 + 50} ${x2},${y2 + 40} ${x2},${y2}` : `M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`,
            fill: "none",
            stroke: e.fail ? "#ff8a8a" : "#a3a3ad",
            "stroke-width": 1.5,
            "stroke-dasharray": e.fail ? "5 4" : undefined,
            "marker-end": e.fail ? "url(#lre-arrow-fail)" : "url(#lre-arrow)"
          }, i, false, undefined, this);
        }),
        nodes.map((n) => {
          const p = pos.get(n.id);
          if (!p)
            return null;
          const stage = props.track.stages[n.id];
          const isStart = n.id === props.track.start;
          return /* @__PURE__ */ u3("g", {
            transform: `translate(${p.x},${p.y})`,
            style: { cursor: "pointer" },
            role: "button",
            tabIndex: 0,
            "aria-label": `Stage ${stage?.label ?? n.id}`,
            "aria-pressed": n.id === props.selected,
            onClick: () => props.onSelect(n.id),
            onKeyDown: (event) => {
              if (event.key !== "Enter" && event.key !== " ")
                return;
              event.preventDefault();
              props.onSelect(n.id);
            },
            children: [
              /* @__PURE__ */ u3("title", {
                children: stage?.label ?? n.id
              }, undefined, false, undefined, this),
              /* @__PURE__ */ u3("rect", {
                width: NODE_W,
                height: NODE_H,
                rx: 10,
                fill: n.id === props.selected ? "#7c6cff" : "#1d2029",
                stroke: !n.reachable ? "#ff8a8a" : isStart ? "#7fe0a0" : "#3a3d48",
                "stroke-width": 2
              }, undefined, false, undefined, this),
              /* @__PURE__ */ u3("text", {
                x: 10,
                y: 18,
                fill: "#f0f0f6",
                "font-size": "12",
                "font-family": "system-ui",
                children: (stage?.label ?? n.id).slice(0, 18)
              }, undefined, false, undefined, this),
              /* @__PURE__ */ u3("text", {
                x: 10,
                y: 34,
                fill: "#a3a3ad",
                "font-size": "10",
                "font-family": "ui-monospace,Menlo,monospace",
                children: [
                  isStart ? "start · " : "",
                  !n.reachable ? "unreachable · " : "",
                  n.id.slice(0, 14)
                ]
              }, undefined, true, undefined, this)
            ]
          }, n.id, true, undefined, this);
        })
      ]
    }, undefined, true, undefined, this)
  }, undefined, false, undefined, this);
}
function stageSpecs(stageIds) {
  return [
    { kind: "text", key: "label", label: "Label" },
    { kind: "text", key: "cue", label: "Cue (player-facing)", multiline: true, optional: true },
    { kind: "text", key: "truth", label: "Secret truth (GM only until reveal)", multiline: true, optional: true },
    { kind: "list", key: "objectives", label: "Objectives", item: { kind: "expr", key: "", label: "Objective" } },
    {
      kind: "list",
      key: "next",
      label: "Next stages",
      title: "to",
      item: {
        kind: "object",
        key: "",
        label: "Transition",
        fields: [
          { kind: "enum", key: "to", label: "To", values: stageIds },
          { kind: "expr", key: "when", label: "When" }
        ]
      }
    },
    { kind: "expr", key: "gate", label: "Gate", optional: true },
    {
      kind: "object",
      key: "fail",
      label: "Fails",
      optional: true,
      fields: [
        { kind: "expr", key: "when", label: "When" },
        { kind: "enum", key: "to", label: "To", values: stageIds }
      ]
    },
    { kind: "list", key: "hints", label: "Hints", item: { kind: "text", key: "", label: "Hint" } },
    { kind: "number", key: "priority", label: "Planner priority (agendas)", optional: true },
    { kind: "json", key: "effects", label: "Effects on entering", optional: true },
    { kind: "json", key: "rewards", label: "Rewards", optional: true },
    { kind: "json", key: "answer", label: "Puzzle answer", optional: true, hint: '{"expect": ["…"], "normalize": true, "decision": {"threshold": 0.8}}' }
  ];
}
function TrackEditor(props) {
  const app = useApp();
  const isNew = props.id?.startsWith("new:") ?? false;
  const id = isNew ? (props.id ?? "").slice(4) : props.id;
  const stored = id ? props.world.tracks[id] : undefined;
  const blank = { id: id ?? "", kind: "quest", label: id ?? "", start: "start", stages: { start: { label: "Start", next: [] } }, visibility: "public" };
  const [track, setTrack] = d2(stored ? structuredClone(stored) : blank);
  const [selected, setSelected] = d2(track.start);
  const [newStage, setNewStage] = d2("");
  const [busy, run] = useBusy();
  A(() => setTrack(stored ? structuredClone(stored) : blank), [JSON.stringify(stored)]);
  const identifiers = b2(() => worldIdentifiers(props.world), [props.world]);
  if (!id)
    return /* @__PURE__ */ u3("span", {
      class: "lre-muted",
      children: "Choose a track."
    }, undefined, false, undefined, this);
  const stageIds = Object.keys(track.stages);
  const stage = selected ? track.stages[selected] : undefined;
  const changed = JSON.stringify(track) !== JSON.stringify(stored ?? null);
  const unreachable = layoutTrack(track).nodes.filter((n) => !n.reachable).length;
  return /* @__PURE__ */ u3("div", {
    class: "lre-stack",
    "data-lre-editor": "tracks",
    children: [
      /* @__PURE__ */ u3("div", {
        class: "lre-h2",
        children: /* @__PURE__ */ u3("code", {
          children: id
        }, undefined, false, undefined, this)
      }, undefined, false, undefined, this),
      /* @__PURE__ */ u3("label", {
        class: "lre-field",
        children: [
          /* @__PURE__ */ u3("span", {
            class: "label",
            children: "Label"
          }, undefined, false, undefined, this),
          /* @__PURE__ */ u3("input", {
            class: "lre-input",
            value: track.label,
            onChange: (event) => setTrack({ ...track, label: event.currentTarget.value })
          }, undefined, false, undefined, this)
        ]
      }, undefined, true, undefined, this),
      /* @__PURE__ */ u3(Seg, {
        label: "Kind",
        value: track.kind,
        options: [
          { value: "quest", label: "Quest" },
          { value: "secret", label: "Secret" },
          { value: "puzzle", label: "Puzzle" },
          { value: "agenda", label: "Agenda" }
        ],
        onChange: (kind) => setTrack({ ...track, kind })
      }, undefined, false, undefined, this),
      /* @__PURE__ */ u3("div", {
        class: "lre-inline",
        children: [
          /* @__PURE__ */ u3("label", {
            class: "lre-field",
            style: { flex: 1 },
            children: [
              /* @__PURE__ */ u3("span", {
                class: "label",
                children: "Visibility"
              }, undefined, false, undefined, this),
              /* @__PURE__ */ u3("select", {
                class: "lre-input",
                value: track.visibility,
                onChange: (event) => setTrack({ ...track, visibility: event.currentTarget.value === "secret" ? "secret" : event.currentTarget.value === "known_by" ? "known_by" : "public" }),
                children: [
                  /* @__PURE__ */ u3("option", {
                    value: "public",
                    children: "public"
                  }, undefined, false, undefined, this),
                  /* @__PURE__ */ u3("option", {
                    value: "known_by",
                    children: "known_by"
                  }, undefined, false, undefined, this),
                  /* @__PURE__ */ u3("option", {
                    value: "secret",
                    children: "secret"
                  }, undefined, false, undefined, this)
                ]
              }, undefined, true, undefined, this)
            ]
          }, undefined, true, undefined, this),
          /* @__PURE__ */ u3("label", {
            class: "lre-field",
            style: { flex: 1 },
            children: [
              /* @__PURE__ */ u3("span", {
                class: "label",
                children: "Owner"
              }, undefined, false, undefined, this),
              /* @__PURE__ */ u3("select", {
                class: "lre-input",
                value: track.owner ?? "",
                onChange: (event) => setTrack({ ...track, owner: event.currentTarget.value || undefined }),
                children: [
                  /* @__PURE__ */ u3("option", {
                    value: "",
                    children: "—"
                  }, undefined, false, undefined, this),
                  Object.values(props.world.entities).map((e) => /* @__PURE__ */ u3("option", {
                    value: e.id,
                    children: e.name
                  }, e.id, false, undefined, this))
                ]
              }, undefined, true, undefined, this)
            ]
          }, undefined, true, undefined, this)
        ]
      }, undefined, true, undefined, this),
      /* @__PURE__ */ u3(TrackGraph, {
        track,
        selected,
        onSelect: setSelected
      }, undefined, false, undefined, this),
      unreachable > 0 ? /* @__PURE__ */ u3("span", {
        class: "lre-small lre-neg",
        children: [
          unreachable,
          " stage(s) can't be reached from the start."
        ]
      }, undefined, true, undefined, this) : null,
      /* @__PURE__ */ u3("form", {
        class: "lre-inline",
        onSubmit: (event) => {
          event.preventDefault();
          const sid = newStage.trim();
          if (!sid || sid in track.stages)
            return;
          const from = selected && track.stages[selected] ? selected : null;
          const stages = { ...track.stages, [sid]: { label: sid, next: [] } };
          if (from) {
            const source = stages[from];
            if (source)
              stages[from] = { ...source, next: [...source.next, { to: sid, when: "true" }] };
          }
          setTrack({ ...track, stages });
          setSelected(sid);
          setNewStage("");
        },
        children: [
          /* @__PURE__ */ u3("input", {
            class: "lre-input",
            style: { flex: 1 },
            placeholder: selected ? `New stage after ${selected}` : "New stage id",
            "aria-label": "New stage id",
            value: newStage,
            onInput: (event) => setNewStage(event.currentTarget.value.replace(/[^\w.-]/g, "_"))
          }, undefined, false, undefined, this),
          /* @__PURE__ */ u3("button", {
            type: "submit",
            class: "lre-btn small",
            disabled: !newStage.trim() || newStage.trim() in track.stages,
            children: "+ Stage"
          }, undefined, false, undefined, this)
        ]
      }, undefined, true, undefined, this),
      stage && selected ? /* @__PURE__ */ u3("section", {
        class: "lre-card",
        "data-lre-stage": selected,
        children: [
          /* @__PURE__ */ u3("div", {
            class: "lre-h",
            children: [
              /* @__PURE__ */ u3("span", {
                children: [
                  "Stage ",
                  /* @__PURE__ */ u3("code", {
                    children: selected
                  }, undefined, false, undefined, this)
                ]
              }, undefined, true, undefined, this),
              /* @__PURE__ */ u3("span", {
                class: "lre-inline",
                children: [
                  track.start !== selected ? /* @__PURE__ */ u3("button", {
                    type: "button",
                    class: "lre-btn small",
                    onClick: () => setTrack({ ...track, start: selected }),
                    children: "Make start"
                  }, undefined, false, undefined, this) : /* @__PURE__ */ u3("span", {
                    class: "lre-badge pos",
                    children: "start"
                  }, undefined, false, undefined, this),
                  /* @__PURE__ */ u3("button", {
                    type: "button",
                    class: "lre-btn small danger",
                    disabled: track.start === selected,
                    onClick: () => {
                      const stages = {};
                      for (const [sid, s] of Object.entries(track.stages)) {
                        if (sid === selected)
                          continue;
                        stages[sid] = { ...s, next: s.next.filter((n) => n.to !== selected), fail: s.fail?.to === selected ? undefined : s.fail };
                      }
                      setTrack({ ...track, stages });
                      setSelected(track.start);
                    },
                    children: "Delete"
                  }, undefined, false, undefined, this)
                ]
              }, undefined, true, undefined, this)
            ]
          }, undefined, true, undefined, this),
          /* @__PURE__ */ u3(SchemaFields, {
            specs: stageSpecs(stageIds),
            value: stage,
            ctx: { doc: props.world, lint: lintAt(app.drafts.get()?.lint ?? [], `tracks.${id}`), path: `tracks.${id}.stages.${selected}`, identifiers },
            onChange: (next) => setTrack({ ...track, stages: { ...track.stages, [selected]: next } })
          }, undefined, false, undefined, this)
        ]
      }, undefined, true, undefined, this) : null,
      /* @__PURE__ */ u3("div", {
        class: "lre-inline",
        children: [
          /* @__PURE__ */ u3("button", {
            type: "button",
            class: "lre-btn primary",
            disabled: !changed && !isNew || busy,
            onClick: () => run(async () => {
              const message = await props.send({ type: "lre.editor", worldId: props.world.id, base: null, op: "put", collection: "tracks", id, value: { ...track, id } });
              if (message.type === "lre.result" && isNew)
                app.ui.update((ui) => ({ ...ui, build: { view: "item", worldId: props.world.id, collection: "tracks", id } }));
            }),
            children: isNew ? "Create track" : "Save to draft"
          }, undefined, false, undefined, this),
          /* @__PURE__ */ u3("button", {
            type: "button",
            class: "lre-btn ghost",
            disabled: !changed || busy,
            onClick: () => setTrack(stored ? structuredClone(stored) : blank),
            children: "Revert"
          }, undefined, false, undefined, this)
        ]
      }, undefined, true, undefined, this)
    ]
  }, undefined, true, undefined, this);
}

// src/packs/story/ui/index.ts
var story = {
  id: "story",
  register(r) {
    r.panel({ id: "story.quests", label: "Quests", order: 80, component: QuestsPanel });
    r.editor({ collection: "tracks", label: "Tracks", component: TrackEditor });
  }
};
var ui_default7 = story;

// src/packs/vehicles/ui/panel.tsx
function decodeGarageView(value) {
  if (!isRecord(value) || !Array.isArray(value.vehicles))
    return null;
  return {
    level: num(value.level, 1),
    vehicles: list(value.vehicles, (v) => {
      const assigned = obj(v.assignedTo);
      return typeof v.id === "string" ? {
        id: v.id,
        name: str(v.name, v.id),
        kind: str(v.kind),
        status: str(v.status, "runs fine"),
        place: optStr(v.place) ?? null,
        fuelPct: optNum(v.fuelPct),
        rangeLabel: optStr(v.rangeLabel),
        odometerLabel: optStr(v.odometerLabel),
        condition: optNum(v.condition),
        home: optStr(v.home),
        assignedTo: assigned ? { name: str(assigned.name), until: optStr(assigned.until), overdue: assigned.overdue === true } : undefined,
        service: list(v.service, (s) => ({ label: str(s.label), due: str(s.due), overdue: s.overdue === true }))
      } : null;
    })
  };
}
function GaragePanel(props) {
  const view = decodeGarageView(props.view);
  if (props.view === null || props.view === undefined)
    return /* @__PURE__ */ u3(Empty, {
      children: "No vehicles."
    }, undefined, false, undefined, this);
  if (!view)
    return /* @__PURE__ */ u3(JsonView, {
      value: props.view
    }, undefined, false, undefined, this);
  if (view.vehicles.length === 0)
    return /* @__PURE__ */ u3(Empty, {
      children: "No vehicles yet."
    }, undefined, false, undefined, this);
  return /* @__PURE__ */ u3("div", {
    class: "lre-stack",
    "data-lre-panel": "vehicles.garage",
    children: view.vehicles.map((v) => /* @__PURE__ */ u3(Card, {
      title: v.name,
      aside: /* @__PURE__ */ u3("span", {
        class: v.status.toLowerCase().includes("fine") || v.status.toLowerCase() === "ok" ? "lre-badge pos" : "lre-badge warn",
        children: v.status
      }, undefined, false, undefined, this),
      children: [
        v.kind ? /* @__PURE__ */ u3("div", {
          class: "lre-small lre-muted",
          children: v.kind
        }, undefined, false, undefined, this) : null,
        v.fuelPct !== undefined ? /* @__PURE__ */ u3("div", {
          class: "lre-row",
          style: { flexDirection: "column", alignItems: "stretch" },
          children: [
            /* @__PURE__ */ u3("div", {
              class: "lre-spread",
              children: [
                /* @__PURE__ */ u3("span", {
                  children: "Fuel"
                }, undefined, false, undefined, this),
                /* @__PURE__ */ u3("span", {
                  class: "lre-num",
                  children: [
                    Math.round(v.fuelPct),
                    "%",
                    v.rangeLabel ? ` · ${v.rangeLabel}` : ""
                  ]
                }, undefined, true, undefined, this)
              ]
            }, undefined, true, undefined, this),
            /* @__PURE__ */ u3("div", {
              class: v.fuelPct < 15 ? "lre-bar low" : "lre-bar",
              children: /* @__PURE__ */ u3("span", {
                style: { width: `${Math.max(0, Math.min(100, v.fuelPct))}%` }
              }, undefined, false, undefined, this)
            }, undefined, false, undefined, this)
          ]
        }, undefined, true, undefined, this) : null,
        v.place ? /* @__PURE__ */ u3(Row, {
          k: "Location",
          v: v.place,
          sub: v.home && v.home !== v.place ? `home: ${v.home}` : undefined
        }, undefined, false, undefined, this) : null,
        v.odometerLabel ? /* @__PURE__ */ u3(Row, {
          k: "Odometer",
          v: v.odometerLabel
        }, undefined, false, undefined, this) : null,
        v.condition !== undefined ? /* @__PURE__ */ u3(Row, {
          k: "Condition",
          v: `${Math.round(v.condition)}%`
        }, undefined, false, undefined, this) : null,
        v.assignedTo ? /* @__PURE__ */ u3(Row, {
          k: "Assigned to",
          v: v.assignedTo.name,
          sub: v.assignedTo.overdue ? `overdue since ${v.assignedTo.until ?? "—"}` : v.assignedTo.until ? `until ${v.assignedTo.until}` : undefined,
          tone: v.assignedTo.overdue ? "warn" : undefined
        }, undefined, false, undefined, this) : null,
        (v.service ?? []).map((s) => /* @__PURE__ */ u3(Row, {
          k: s.label,
          v: s.due,
          tone: s.overdue ? "warn" : undefined,
          sub: s.overdue ? "overdue" : undefined
        }, s.label, false, undefined, this))
      ]
    }, v.id, true, undefined, this))
  }, undefined, false, undefined, this);
}

// src/packs/vehicles/ui/index.ts
var vehicles = {
  id: "vehicles",
  register(r) {
    r.panel({ id: "vehicles.garage", label: "Garage", order: 40, component: GaragePanel });
  }
};
var ui_default8 = vehicles;

// src/frontend/play/context.tsx
var DELIVERY = ["verified", "unverified", "unchecked"];
var DELIVERY_BADGE = {
  verified: { text: "delivered", tone: "pos" },
  unverified: { text: "not delivered", tone: "neg" },
  unchecked: { text: "unchecked", tone: "" }
};
var STATUSES2 = ["included", "pinned", "dropped", "unverified"];
function decodeContextView(value) {
  if (!isRecord(value) || !Array.isArray(value.generations))
    return null;
  return {
    warnings: strings(value.warnings),
    generations: list(value.generations, (g) => {
      const budget = isRecord(g.budget) ? g.budget : {};
      return {
        id: str(g.id),
        at: num(g.at),
        activation: oneOf(g.activation, ["confirmed", "unconfirmed", "stalled"], "unconfirmed"),
        candidates: list(g.candidates, (c) => ({ title: str(c.title, "Untitled"), book: str(c.book), bookName: str(c.bookName, str(c.book)), status: oneOf(c.status, STATUSES2, "unverified"), reason: str(c.reason) })),
        sections: list(g.sections, (s) => ({ slot: str(s.slot), label: str(s.label, str(s.slot)), tokens: num(s.tokens), clipped: s.clipped === true, delivery: oneOf(s.delivery, DELIVERY, "unchecked") })),
        budget: { sections: num(budget.sections), lore: num(budget.lore), used: num(budget.used) }
      };
    })
  };
}
var ACTIVATION = {
  confirmed: { text: "Activation confirmed", tone: "pos" },
  unconfirmed: { text: "Not confirmed", tone: "warn" },
  stalled: { text: "Worker stalled: world lore absent", tone: "neg" }
};
var STATUS_TONE2 = { included: "pos", pinned: "accent", dropped: "", unverified: "warn" };
function ContextPanel(props) {
  const view = decodeContextView(props.view);
  const [index, setIndex] = d2(0);
  const [status, setStatus] = d2("all");
  const app = useApp();
  A(() => {
    app.request({ type: "lre.view.open", chatId: props.chatId, panel: "core.context", entity: null });
  }, [props.chatId]);
  if (props.view === undefined || props.view === null)
    return /* @__PURE__ */ u3(Empty, {
      children: "The inspector fills in after the first reply."
    }, undefined, false, undefined, this);
  if (!view)
    return /* @__PURE__ */ u3(JsonView, {
      value: props.view
    }, undefined, false, undefined, this);
  const generations = [...view.generations].sort((a, b) => b.at - a.at);
  const generation = generations[Math.min(index, generations.length - 1)];
  const total = generation ? generation.budget.sections + generation.budget.lore : 0;
  return /* @__PURE__ */ u3("div", {
    class: "lre-stack",
    "data-lre-panel": "core.context",
    children: [
      view.warnings.map((warning) => /* @__PURE__ */ u3("div", {
        class: "lre-banner warn",
        children: warning
      }, warning, false, undefined, this)),
      !generation ? /* @__PURE__ */ u3(Empty, {
        children: "No generations inspected yet."
      }, undefined, false, undefined, this) : /* @__PURE__ */ u3(M, {
        children: [
          /* @__PURE__ */ u3("div", {
            class: "lre-spread",
            children: [
              /* @__PURE__ */ u3("button", {
                type: "button",
                class: "lre-btn small",
                "aria-label": "Older generation",
                disabled: index >= generations.length - 1,
                onClick: () => setIndex(index + 1),
                children: "‹ Older"
              }, undefined, false, undefined, this),
              /* @__PURE__ */ u3("span", {
                class: "lre-small lre-muted",
                children: generation.at > 0 ? new Date(generation.at).toLocaleString() : "—"
              }, undefined, false, undefined, this),
              /* @__PURE__ */ u3("button", {
                type: "button",
                class: "lre-btn small",
                "aria-label": "Newer generation",
                disabled: index === 0,
                onClick: () => setIndex(index - 1),
                children: "Newer ›"
              }, undefined, false, undefined, this)
            ]
          }, undefined, true, undefined, this),
          /* @__PURE__ */ u3(Card, {
            title: "Activation",
            aside: /* @__PURE__ */ u3("span", {
              class: `lre-badge ${ACTIVATION[generation.activation].tone}`,
              children: ACTIVATION[generation.activation].text
            }, undefined, false, undefined, this),
            children: [
              /* @__PURE__ */ u3(Row, {
                k: "Budget used",
                v: `${generation.budget.used} / ${total} tokens`
              }, undefined, false, undefined, this),
              /* @__PURE__ */ u3("div", {
                class: generation.budget.used > total ? "lre-bar low" : "lre-bar",
                children: /* @__PURE__ */ u3("span", {
                  style: { width: `${total > 0 ? Math.min(100, generation.budget.used / total * 100) : 0}%` }
                }, undefined, false, undefined, this)
              }, undefined, false, undefined, this)
            ]
          }, undefined, true, undefined, this),
          /* @__PURE__ */ u3(Card, {
            title: "Engine sections",
            children: generation.sections.length === 0 ? /* @__PURE__ */ u3(Empty, {
              children: "None."
            }, undefined, false, undefined, this) : generation.sections.map((s) => /* @__PURE__ */ u3(Row, {
              k: s.label,
              v: /* @__PURE__ */ u3("span", {
                class: "lre-inline",
                children: [
                  s.tokens,
                  " tok",
                  " ",
                  s.clipped ? /* @__PURE__ */ u3("span", {
                    class: "lre-badge warn",
                    children: "clipped"
                  }, undefined, false, undefined, this) : /* @__PURE__ */ u3("span", {
                    class: `lre-badge ${DELIVERY_BADGE[s.delivery].tone}`,
                    children: DELIVERY_BADGE[s.delivery].text
                  }, undefined, false, undefined, this)
                ]
              }, undefined, true, undefined, this),
              sub: s.clipped ? "left out: over the section budget" : undefined,
              tone: s.clipped ? "warn" : undefined
            }, s.slot, false, undefined, this))
          }, undefined, false, undefined, this),
          /* @__PURE__ */ u3(Card, {
            title: "Candidates",
            aside: /* @__PURE__ */ u3("span", {
              class: "lre-badge",
              children: generation.candidates.length
            }, undefined, false, undefined, this),
            children: [
              /* @__PURE__ */ u3(Seg, {
                label: "Candidate status",
                value: status,
                options: [{ value: "all", label: "All" }, ...STATUSES2.map((s) => ({ value: s, label: `${s[0]?.toUpperCase()}${s.slice(1)} (${generation.candidates.filter((c) => c.status === s).length})` }))],
                onChange: (next) => setStatus(next)
              }, undefined, false, undefined, this),
              generation.candidates.filter((c) => status === "all" || c.status === status).map((c, i) => /* @__PURE__ */ u3("div", {
                class: "lre-row",
                style: { alignItems: "flex-start" },
                children: [
                  /* @__PURE__ */ u3("span", {
                    class: "k",
                    children: [
                      c.title,
                      /* @__PURE__ */ u3("span", {
                        class: "sub",
                        children: [
                          c.bookName,
                          c.reason ? ` — ${c.reason}` : ""
                        ]
                      }, undefined, true, undefined, this)
                    ]
                  }, undefined, true, undefined, this),
                  /* @__PURE__ */ u3("span", {
                    class: `lre-badge ${STATUS_TONE2[c.status]}`,
                    children: c.status
                  }, undefined, false, undefined, this)
                ]
              }, `${c.book}:${c.title}:${i}`, true, undefined, this))
            ]
          }, undefined, true, undefined, this)
        ]
      }, undefined, true, undefined, this)
    ]
  }, undefined, true, undefined, this);
}

// src/frontend/play/gm.tsx
function decodeGmView(value) {
  if (!isRecord(value))
    return null;
  if (!Array.isArray(value.previews) && !Array.isArray(value.truths) && !Array.isArray(value.agendas))
    return null;
  return {
    label: str(value.label, "Previews — not recorded"),
    previews: list(value.previews, (p) => ({ title: str(p.title, "Preview"), lines: strings(p.lines) })),
    truths: list(value.truths, (t) => ({ track: str(t.track), stage: str(t.stage), truth: str(t.truth) })),
    agendas: list(value.agendas, (a) => ({ entity: str(a.entity), label: str(a.label), stage: str(a.stage) }))
  };
}
function GmPanel(props) {
  const [revealed, setRevealed] = d2(false);
  if (!revealed) {
    return /* @__PURE__ */ u3("div", {
      class: "lre-stack",
      "data-lre-panel": "core.gm",
      children: /* @__PURE__ */ u3("div", {
        class: "lre-banner warn",
        children: [
          /* @__PURE__ */ u3("strong", {
            children: "Spoilers ahead"
          }, undefined, false, undefined, this),
          /* @__PURE__ */ u3("span", {
            children: "The GM view shows secrets, hidden agendas and unrevealed truths as previews. Nothing here is recorded or shown to the narrator."
          }, undefined, false, undefined, this),
          /* @__PURE__ */ u3("button", {
            type: "button",
            class: "lre-btn",
            onClick: () => setRevealed(true),
            children: "Show GM view"
          }, undefined, false, undefined, this)
        ]
      }, undefined, true, undefined, this)
    }, undefined, false, undefined, this);
  }
  const view = decodeGmView(props.view);
  return /* @__PURE__ */ u3("div", {
    class: "lre-stack",
    "data-lre-panel": "core.gm",
    children: [
      /* @__PURE__ */ u3("div", {
        class: "lre-spread",
        children: [
          /* @__PURE__ */ u3("span", {
            class: "lre-preview-label",
            children: view?.label ?? "Previews — not recorded"
          }, undefined, false, undefined, this),
          /* @__PURE__ */ u3("button", {
            type: "button",
            class: "lre-btn small",
            onClick: () => setRevealed(false),
            children: "Hide"
          }, undefined, false, undefined, this)
        ]
      }, undefined, true, undefined, this),
      props.view === undefined || props.view === null ? /* @__PURE__ */ u3(Empty, {
        children: "No GM view for this world."
      }, undefined, false, undefined, this) : !view ? /* @__PURE__ */ u3(Card, {
        preview: true,
        children: /* @__PURE__ */ u3(JsonView, {
          value: props.view
        }, undefined, false, undefined, this)
      }, undefined, false, undefined, this) : /* @__PURE__ */ u3(M, {
        children: [
          view.truths.length > 0 ? /* @__PURE__ */ u3(Card, {
            title: "Secret truths",
            preview: true,
            children: view.truths.map((t) => /* @__PURE__ */ u3(Row, {
              k: t.truth,
              sub: `${t.track} · ${t.stage}`
            }, `${t.track}:${t.stage}`, false, undefined, this))
          }, undefined, false, undefined, this) : null,
          view.agendas.length > 0 ? /* @__PURE__ */ u3(Card, {
            title: "Agendas",
            preview: true,
            children: view.agendas.map((a) => /* @__PURE__ */ u3(Row, {
              k: a.entity,
              sub: a.label,
              v: a.stage
            }, `${a.entity}:${a.label}`, false, undefined, this))
          }, undefined, false, undefined, this) : null,
          view.previews.map((p) => /* @__PURE__ */ u3(Card, {
            title: p.title,
            preview: true,
            children: p.lines.map((line, i) => /* @__PURE__ */ u3("div", {
              class: "lre-row",
              children: /* @__PURE__ */ u3("span", {
                class: "k",
                children: line
              }, undefined, false, undefined, this)
            }, i, false, undefined, this))
          }, p.title, false, undefined, this))
        ]
      }, undefined, true, undefined, this)
    ]
  }, undefined, true, undefined, this);
}

// src/frontend/play/journal.tsx
var KIND_LABEL = {
  dropped: "Dropped",
  inert: "Other branch",
  renarrate_drop: "Re-narrate",
  tombstoned: "Discarded",
  expired: "Expired",
  regenerated: "Regenerated",
  note: "Note"
};
var KIND_TONE = {
  dropped: "neg",
  inert: "",
  renarrate_drop: "warn",
  tombstoned: "neg",
  expired: "warn",
  regenerated: "accent",
  note: "accent"
};
function JournalPanel(props) {
  const [filter, setFilter] = d2("all");
  const notes = [...props.state.journal].reverse().filter((note) => filter === "all" || (filter === "notes" ? note.kind === "note" || note.kind === "regenerated" : note.kind !== "note" && note.kind !== "regenerated"));
  return /* @__PURE__ */ u3("div", {
    class: "lre-stack",
    "data-lre-panel": "core.journal",
    children: [
      /* @__PURE__ */ u3(Seg, {
        label: "Filter",
        value: filter,
        options: [
          { value: "all", label: `All (${props.state.journal.length})` },
          { value: "notes", label: "Notes & montages" },
          { value: "issues", label: "Not applied" }
        ],
        onChange: (next) => setFilter(next)
      }, undefined, false, undefined, this),
      notes.length === 0 ? /* @__PURE__ */ u3(Empty, {
        children: "Nothing in the journal yet."
      }, undefined, false, undefined, this) : /* @__PURE__ */ u3(Card, {
        children: notes.map((note, i) => /* @__PURE__ */ u3("div", {
          class: "lre-row",
          style: { alignItems: "flex-start" },
          children: [
            /* @__PURE__ */ u3("span", {
              class: "k",
              style: { whiteSpace: "pre-wrap" },
              children: note.text
            }, undefined, false, undefined, this),
            /* @__PURE__ */ u3("span", {
              class: `lre-badge ${KIND_TONE[note.kind]}`,
              children: KIND_LABEL[note.kind]
            }, undefined, false, undefined, this)
          ]
        }, `${note.messageId}:${i}`, true, undefined, this))
      }, undefined, false, undefined, this)
    ]
  }, undefined, true, undefined, this);
}

// src/frontend/play/scene.tsx
function ScenePanel(props) {
  const app = useApp();
  const { state } = props;
  const [busy, run] = useBusy();
  const scene = state.scene;
  const hud = state.hud;
  const open = (entity) => run(async () => {
    const cast = app.catalog.panels.find((panel) => panel.id === "castlife.cast");
    const result = await app.request({ type: "lre.view.open", chatId: props.chatId, panel: cast ? cast.id : "core.scene", entity });
    if (result && cast)
      app.ui.update((ui) => ({ ...ui, playPanel: cast.id }));
    if (result?.pending)
      app.toast("Details appear when the reply finishes.", "info");
  });
  return /* @__PURE__ */ u3("div", {
    class: "lre-stack",
    "data-lre-panel": "core.scene",
    children: [
      /* @__PURE__ */ u3(Card, {
        title: "Now",
        children: [
          hud ? /* @__PURE__ */ u3(Row, {
            k: "Time",
            sub: hud.clock.dayPart,
            v: /* @__PURE__ */ u3("span", {
              class: "lre-num",
              children: clockText(hud)
            }, undefined, false, undefined, this)
          }, undefined, false, undefined, this) : null,
          /* @__PURE__ */ u3(Row, {
            k: "Place",
            v: hud?.place?.name ?? "—"
          }, undefined, false, undefined, this),
          scene ? /* @__PURE__ */ u3(Row, {
            k: "Scene",
            v: scene.sceneType,
            sub: scene.elapsed > 0 ? `Last turn took ${formatMinutes(scene.elapsed)}` : "No time passed last turn"
          }, undefined, false, undefined, this) : null,
          hud?.weather ? /* @__PURE__ */ u3(Row, {
            k: "Weather",
            v: hud.weather
          }, undefined, false, undefined, this) : null,
          hud?.cash ? /* @__PURE__ */ u3(Row, {
            k: "Cash",
            v: /* @__PURE__ */ u3("span", {
              class: "lre-num",
              children: cashText(hud.cash)
            }, undefined, false, undefined, this)
          }, undefined, false, undefined, this) : null
        ]
      }, undefined, true, undefined, this),
      /* @__PURE__ */ u3(Card, {
        title: "Present",
        aside: scene ? /* @__PURE__ */ u3("span", {
          class: "lre-badge",
          children: scene.present.length
        }, undefined, false, undefined, this) : null,
        children: !scene || scene.present.length === 0 ? /* @__PURE__ */ u3(Empty, {
          children: "Nobody else is here."
        }, undefined, false, undefined, this) : /* @__PURE__ */ u3("div", {
          class: "lre-list",
          children: scene.present.map((person) => {
            const pending = state.pending.some((mark) => mark.entity === person.id);
            return /* @__PURE__ */ u3("button", {
              type: "button",
              class: "lre-item",
              disabled: busy,
              onClick: () => open(person.id),
              children: [
                /* @__PURE__ */ u3("span", {
                  class: "grow",
                  children: [
                    /* @__PURE__ */ u3("span", {
                      class: "title",
                      children: person.name
                    }, undefined, false, undefined, this),
                    /* @__PURE__ */ u3("span", {
                      class: "sub",
                      children: person.label
                    }, undefined, false, undefined, this)
                  ]
                }, undefined, true, undefined, this),
                pending ? /* @__PURE__ */ u3("span", {
                  class: "lre-badge warn",
                  children: "pending"
                }, undefined, false, undefined, this) : /* @__PURE__ */ u3("span", {
                  class: "lre-dim",
                  "aria-hidden": "true",
                  children: "›"
                }, undefined, false, undefined, this)
              ]
            }, person.id, true, undefined, this);
          })
        }, undefined, false, undefined, this)
      }, undefined, false, undefined, this),
      /* @__PURE__ */ u3("div", {
        class: "lre-inline",
        children: [
          /* @__PURE__ */ u3("button", {
            type: "button",
            class: "lre-btn",
            onClick: () => void app.overlays.openPalette("actions"),
            children: [
              /* @__PURE__ */ u3("span", {
                "aria-hidden": "true",
                children: "⚡"
              }, undefined, false, undefined, this),
              " Actions"
            ]
          }, undefined, true, undefined, this),
          state.palette?.timelapse ? /* @__PURE__ */ u3("button", {
            type: "button",
            class: "lre-btn",
            onClick: () => void app.overlays.openPalette("timelapse"),
            children: [
              /* @__PURE__ */ u3("span", {
                "aria-hidden": "true",
                children: "⏩"
              }, undefined, false, undefined, this),
              " Timelapse"
            ]
          }, undefined, true, undefined, this) : null,
          state.panels["space.map"] !== undefined ? /* @__PURE__ */ u3("button", {
            type: "button",
            class: "lre-btn",
            onClick: () => void app.overlays.openMap(),
            children: [
              /* @__PURE__ */ u3("span", {
                "aria-hidden": "true",
                children: "\uD83D\uDDFA"
              }, undefined, false, undefined, this),
              " Map"
            ]
          }, undefined, true, undefined, this) : null
        ]
      }, undefined, true, undefined, this)
    ]
  }, undefined, true, undefined, this);
}

// src/frontend/packs.ts
var core = {
  id: "core",
  register(r) {
    r.panel({ id: "core.scene", label: "Scene", order: 10, component: ScenePanel });
    r.panel({ id: "core.journal", label: "Journal", order: 90, component: JournalPanel });
    r.panel({ id: "core.context", label: "Context", order: 100, component: ContextPanel });
    r.panel({ id: "core.gm", label: "GM view", order: 110, component: GmPanel });
  }
};
var UI_PACKS = [core, ui_default5, ui_default3, ui_default8, ui_default4, ui_default2, ui_default, ui_default7, ui_default6];

// src/shared/protocol.ts
var PROTOCOL_VERSION = 1;

// src/frontend/delta.ts
class DeltaError extends Error {
  name = "DeltaError";
}
function isContainer(value) {
  return Array.isArray(value) || isRecord(value);
}
function pathText(path) {
  return path.length === 0 ? "(root)" : path.map(String).join(".");
}
function stepKey(container, key, path) {
  if (!Array.isArray(container))
    return String(key);
  const index = typeof key === "number" ? key : /^\d+$/.test(key) ? Number(key) : Number.NaN;
  if (!Number.isInteger(index) || index < 0)
    throw new DeltaError(`bad array index ${String(key)} at ${pathText(path)}`);
  return index;
}
function writeKey(container, key, value) {
  if (Array.isArray(container))
    container[Number(key)] = value;
  else
    Object.defineProperty(container, String(key), { value, enumerable: true, writable: true, configurable: true });
}
function applyOne(root, op) {
  const path = op.path;
  if (path.length === 0) {
    if (op.op === "del")
      throw new DeltaError("cannot delete the root");
    return op.value;
  }
  if (!isContainer(root))
    throw new DeltaError("root is not a container");
  const nextRoot = Array.isArray(root) ? root.slice() : { ...root };
  let parent = nextRoot;
  for (let i = 0;i < path.length - 1; i += 1) {
    const key = stepKey(parent, path[i] ?? "", path);
    const child = Array.isArray(parent) ? parent[Number(key)] : parent[String(key)];
    if (!isContainer(child))
      throw new DeltaError(`no container at ${pathText(path.slice(0, i + 1))}`);
    const copy = Array.isArray(child) ? child.slice() : { ...child };
    writeKey(parent, key, copy);
    parent = copy;
  }
  const key = stepKey(parent, path[path.length - 1] ?? "", path);
  if (Array.isArray(parent)) {
    const index = Number(key);
    if (op.op === "del") {
      if (index >= parent.length)
        throw new DeltaError(`no element at ${pathText(path)}`);
      parent.splice(index, 1);
    } else {
      if (index > parent.length)
        throw new DeltaError(`index past the end at ${pathText(path)}`);
      parent[index] = op.value;
    }
  } else if (op.op === "del") {
    if (!Object.prototype.hasOwnProperty.call(parent, key))
      throw new DeltaError(`no key at ${pathText(path)}`);
    delete parent[String(key)];
  } else {
    writeKey(parent, key, op.value);
  }
  return nextRoot;
}
function applyDelta(root, ops) {
  let next = root;
  for (const op of ops)
    next = applyOne(next, op);
  return next;
}

// src/frontend/protocol-client.ts
var REQUEST_TYPES = {
  "lre.hello": true,
  "lre.state.resync": true,
  "lre.action": true,
  "lre.chip": true,
  "lre.view.open": true,
  "lre.fix": true,
  "lre.marker": true,
  "lre.keep": true,
  "lre.settings.get": true,
  "lre.settings.set": true,
  "lre.editor": true,
  "lre.world": true,
  "lre.ui": true,
  "lre.job": true
};
function isRequestType(value) {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(REQUEST_TYPES, value);
}
function isStateView(value) {
  return isRecord(value) && value.v === 1 && typeof value.chatId === "string" && Array.isArray(value.chips) && isRecord(value.panels);
}
function errorMessage(reqId, code, message) {
  return { lre: PROTOCOL_VERSION, type: "lre.error", reqId, code, message };
}

class ProtocolClient {
  transport;
  send;
  pending = new Map;
  listeners = new Set;
  errorListeners = new Set;
  jobListeners = new Set;
  unsubscribe;
  timeoutMs;
  newReqId;
  schedule;
  timers;
  state = { chatId: null, rev: null, view: null, status: "closed", resyncs: 0 };
  notifyQueued = false;
  disposed = false;
  counter = 0;
  constructor(transport, options = {}) {
    this.transport = transport;
    this.timeoutMs = options.timeoutMs ?? 30000;
    this.newReqId = options.newReqId ?? (() => `r${Date.now().toString(36)}-${(this.counter += 1).toString(36)}`);
    this.schedule = options.schedule ?? ((fn) => queueMicrotask(fn));
    this.timers = options.timers ?? { set: (fn, ms) => setTimeout(fn, ms), clear: (handle) => clearTimeout(handle) };
    this.unsubscribe = transport.subscribe((payload) => this.receive(payload));
    this.send = (request) => this.request(request);
  }
  getState() {
    return this.state;
  }
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  onError(listener) {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }
  onJob(listener) {
    this.jobListeners.add(listener);
    return () => this.jobListeners.delete(listener);
  }
  open(chatId) {
    this.update({ chatId, rev: null, view: null, status: chatId === null ? "closed" : "syncing", resyncs: 0 });
    const reply = this.request({ type: "lre.hello", chatId });
    reply.then((message) => {
      if (message.type === "lre.error" && this.state.chatId === chatId) {
        this.update({ ...this.state, status: "closed" });
        this.emitError(message);
      }
    });
    return reply;
  }
  resync() {
    const chatId = this.state.chatId;
    if (chatId === null || this.state.status === "resyncing")
      return;
    this.update({ ...this.state, status: "resyncing", resyncs: this.state.resyncs + 1 });
    this.request({ type: "lre.state.resync", chatId }).then((message) => {
      if (message.type !== "lre.error" || this.state.chatId !== chatId || this.state.status !== "resyncing")
        return;
      this.update({ ...this.state, status: this.state.view ? "live" : "syncing" });
      this.emitError(message);
    });
  }
  dispose() {
    if (this.disposed)
      return;
    this.disposed = true;
    this.unsubscribe();
    for (const [reqId, entry] of this.pending) {
      this.timers.clear(entry.timer);
      entry.resolve(errorMessage(reqId, "unavailable", "The extension was unloaded"));
    }
    this.pending.clear();
    this.listeners.clear();
  }
  request(body) {
    const { promise, resolve } = Promise.withResolvers();
    const reqId = this.newReqId();
    if (this.disposed) {
      resolve(errorMessage(reqId, "unavailable", "The extension was unloaded"));
      return promise;
    }
    const timer = this.timers.set(() => {
      if (!this.pending.delete(reqId))
        return;
      resolve(errorMessage(reqId, "unavailable", `No reply from the engine within ${Math.round(this.timeoutMs / 1000)} s`));
    }, this.timeoutMs);
    this.pending.set(reqId, { type: body.type, resolve, timer });
    const message = { ...body, lre: PROTOCOL_VERSION, reqId };
    try {
      this.transport.send(message);
    } catch (error) {
      this.pending.delete(reqId);
      this.timers.clear(timer);
      resolve(errorMessage(reqId, "unavailable", error instanceof Error ? error.message : String(error)));
    }
    return promise;
  }
  receive(payload) {
    if (this.disposed || !isRecord(payload) || payload.lre !== PROTOCOL_VERSION)
      return;
    switch (payload.type) {
      case "lre.result":
        this.receiveResult(payload);
        return;
      case "lre.error":
        this.receiveError(payload);
        return;
      case "lre.state.snapshot":
        this.receiveSnapshot(payload);
        return;
      case "lre.state.delta":
        this.receiveDelta(payload);
        return;
      case "lre.job.update":
        if (typeof payload.jobId === "string" && typeof payload.status === "string") {
          const update = payload;
          for (const listener of this.jobListeners)
            listener(update);
        }
        return;
    }
  }
  settle(reqId) {
    const entry = this.pending.get(reqId);
    if (!entry)
      return null;
    this.pending.delete(reqId);
    this.timers.clear(entry.timer);
    return entry;
  }
  receiveResult(payload) {
    if (typeof payload.reqId !== "string" || !isRequestType(payload.request))
      return;
    const entry = this.settle(payload.reqId);
    if (!entry)
      return;
    if (entry.type !== payload.request || !isRecord(payload.body)) {
      entry.resolve(errorMessage(payload.reqId, "internal", `Result for ${String(payload.request)} answered a ${entry.type} request`));
      return;
    }
    entry.resolve(payload);
  }
  receiveError(payload) {
    if (typeof payload.code !== "string" || typeof payload.message !== "string")
      return;
    const error = payload;
    const entry = typeof payload.reqId === "string" ? this.settle(payload.reqId) : null;
    if (entry)
      entry.resolve(error);
    else
      this.emitError(error);
  }
  receiveSnapshot(payload) {
    if (payload.chatId !== this.state.chatId || typeof payload.rev !== "number" || !isStateView(payload.view))
      return;
    this.update({ ...this.state, rev: payload.rev, view: payload.view, status: "live" });
  }
  receiveDelta(payload) {
    if (payload.chatId !== this.state.chatId || typeof payload.base !== "number" || typeof payload.rev !== "number" || !Array.isArray(payload.ops))
      return;
    if (this.state.status === "resyncing" || this.state.status === "syncing")
      return;
    if (this.state.view === null || this.state.rev !== payload.base) {
      this.resync();
      return;
    }
    let next;
    try {
      next = applyDelta(this.state.view, payload.ops);
    } catch (error) {
      if (!(error instanceof DeltaError))
        throw error;
      this.resync();
      return;
    }
    if (!isStateView(next)) {
      this.resync();
      return;
    }
    this.update({ ...this.state, rev: payload.rev, view: next });
  }
  emitError(error) {
    for (const listener of this.errorListeners)
      listener(error);
  }
  update(next) {
    this.state = next;
    if (this.notifyQueued)
      return;
    this.notifyQueued = true;
    this.schedule(() => {
      this.notifyQueued = false;
      if (this.disposed)
        return;
      for (const listener of this.listeners)
        listener(this.state);
    });
  }
}

// src/frontend/styles.ts
var CSS = `
.lre,.lre-chips{--lre-fg:var(--lumiverse-text,#e8e8ea);--lre-muted:color-mix(in srgb,var(--lumiverse-text-muted,#a3a3ad) 85%,var(--lre-fg));--lre-dim:color-mix(in srgb,var(--lumiverse-text-dim,#7c7c86) 50%,var(--lre-fg));--lre-fill:var(--lumiverse-fill,#17171c);--lre-surface:var(--lumiverse-bg-deep,#121217);--lre-subtle:var(--lumiverse-fill-subtle,rgba(255,255,255,.05));--lre-border:var(--lumiverse-border,rgba(255,255,255,.12));--lre-accent:var(--lumiverse-primary,#7c6cff);--lre-accent-fg:var(--lumiverse-primary-contrast,#fff);--lre-accent-fill:var(--lre-accent);--lre-radius:var(--lumiverse-radius,10px);--lre-danger:var(--lumiverse-danger,#ef4444);--lre-success:var(--lumiverse-success,#22c55e);--lre-warning:var(--lumiverse-warning,#f59e0b);--lre-neg:color-mix(in srgb,var(--lre-danger) 55%,var(--lre-fg));--lre-pos:color-mix(in srgb,var(--lre-success) 35%,var(--lre-fg));--lre-warn:color-mix(in srgb,var(--lre-warning) 35%,var(--lre-fg));--lre-gutter:0px;overflow-wrap:break-word}
@supports (color:hsl(from red h s calc(100 - l))){.lre,.lre-chips{--lre-accent-fill:color-mix(in srgb,var(--lre-accent) 80%,hsl(from var(--lre-accent-fg) h s calc(100 - l)))}}
.lre{font:14px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--lre-fg);box-sizing:border-box;min-width:0}
.lre *,.lre *::before,.lre *::after{box-sizing:border-box}
.lre-drawer{padding:8px calc(10px + var(--lre-gutter)) 24px 10px;display:flex;flex-direction:column;gap:8px;min-height:100%}
.lre button,.lre-chips button{font:inherit;color:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent}
.lre button:disabled,.lre-chips button:disabled{cursor:default;opacity:.5}
.lre-btn{min-height:40px;min-width:40px;max-width:100%;padding:6px 12px;border-radius:var(--lre-radius);border:1px solid var(--lre-border);background:var(--lre-subtle);display:inline-flex;align-items:center;justify-content:center;gap:6px;white-space:normal;overflow-wrap:anywhere;text-align:center}
.lre-btn:hover:not(:disabled){border-color:var(--lumiverse-border-hover,rgba(255,255,255,.25))}
.lre-btn.primary{background:var(--lre-accent-fill);color:var(--lre-accent-fg);border-color:transparent}
.lre-btn.danger{color:var(--lre-neg);border-color:color-mix(in srgb,var(--lre-danger) 40%,transparent)}
.lre-btn.ghost{background:transparent;border-color:transparent}
.lre-btn.block{width:100%}
.lre-btn.small{min-height:40px;padding:6px 10px;font-size:13px}
.lre-seg{display:flex;gap:4px;flex-wrap:wrap}
.lre-seg>button{flex:1 0 auto;max-width:100%;min-height:40px;min-width:40px;padding:4px 8px;border-radius:var(--lre-radius);border:1px solid var(--lre-border);background:var(--lre-subtle);font-size:13px;white-space:normal;overflow-wrap:anywhere}
.lre-seg>button[aria-pressed=true]{background:var(--lre-accent-fill);color:var(--lre-accent-fg);border-color:transparent}
.lre-tabs{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;padding-bottom:2px;-webkit-overflow-scrolling:touch}
.lre-tabs::-webkit-scrollbar{display:none}
.lre-tabs>button{flex:0 0 auto;min-height:40px;min-width:40px;padding:0 12px;border-radius:20px;border:1px solid var(--lre-border);background:var(--lre-subtle);font-size:13px;position:relative}
.lre-tabs>button[aria-selected=true]{background:var(--lre-accent-fill);color:var(--lre-accent-fg);border-color:transparent}
.lre-tabs>button .lre-dot{position:absolute;top:6px;right:6px;width:7px;height:7px;border-radius:50%;background:var(--lre-warn)}
.lre-top{display:flex;gap:6px;align-items:center}
.lre-top>.lre-seg{flex:1;min-width:0}
.lre-card{border:1px solid var(--lre-border);border-radius:12px;padding:10px;background:var(--lre-subtle);min-width:0}
.lre-card+.lre-card{margin-top:8px}
.lre-card.preview{border-style:dashed}
.lre-h{margin:4px 0 6px;font-size:12px;letter-spacing:.05em;text-transform:uppercase;color:var(--lre-muted);display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:24px}
.lre-h>span{min-width:0;overflow-wrap:anywhere}
.lre-h2{margin:0;font-size:15px;font-weight:600}
.lre-row{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;padding:8px 0;border-bottom:1px solid rgba(127,127,127,.15);min-height:40px;min-width:0}
.lre-row:last-child{border-bottom:0}
.lre-row>.k{flex:1 1 0;min-width:min(9em,100%);overflow-wrap:anywhere}
.lre-row>.v{margin-left:auto;max-width:100%;min-width:0;font-variant-numeric:tabular-nums;font-weight:600;text-align:right;overflow-wrap:anywhere}
.lre-row .sub{display:block;font-size:12px;color:var(--lre-muted);font-weight:400;white-space:normal}
.lre-stack{display:flex;flex-direction:column;gap:8px;min-width:0}
.lre-inline{display:flex;gap:6px;align-items:center;flex-wrap:wrap;min-width:0}
.lre-spread{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between;min-width:0}
.lre-inline>*,.lre-spread>*{max-width:100%}
.lre-muted{color:var(--lre-muted)}.lre-dim{color:var(--lre-dim)}.lre-neg{color:var(--lre-neg)}.lre-pos{color:var(--lre-pos)}.lre-warn{color:var(--lre-warn)}
.lre-small{font-size:12px}
.lre-num{font-variant-numeric:tabular-nums}
.lre-empty{padding:16px 8px;text-align:center;color:var(--lre-muted)}
.lre-banner{border-radius:12px;padding:10px;display:flex;flex-direction:column;gap:8px;border:1px solid var(--lre-border)}
.lre-banner.warn{background:color-mix(in srgb,var(--lre-warning) 10%,transparent);border-color:color-mix(in srgb,var(--lre-warning) 45%,transparent)}
.lre-banner.info{background:color-mix(in srgb,var(--lre-accent) 10%,transparent);border-color:color-mix(in srgb,var(--lre-accent) 40%,transparent)}
.lre-badge{display:inline-flex;align-items:center;min-height:22px;padding:0 8px;border-radius:11px;font-size:11px;background:rgba(127,127,127,.18);color:var(--lre-muted);white-space:nowrap}
.lre-badge.accent{background:color-mix(in srgb,var(--lre-accent) 22%,transparent);color:var(--lre-fg)}
.lre-badge.warn{background:color-mix(in srgb,var(--lre-warning) 20%,transparent);color:var(--lre-warn)}
.lre-badge.neg{background:color-mix(in srgb,var(--lre-danger) 18%,transparent);color:var(--lre-neg)}
.lre-badge.pos{background:color-mix(in srgb,var(--lre-success) 16%,transparent);color:var(--lre-pos)}
.lre-preview-label{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--lre-warn)}
.lre-field{display:flex;flex-direction:column;gap:4px;min-width:0}
.lre-field>label,.lre-field>.label{font-size:12px;color:var(--lre-muted)}
.lre-input{min-height:40px;width:100%;padding:8px 10px;border-radius:var(--lre-radius);border:1px solid var(--lre-border);background:var(--lre-fill);color:var(--lre-fg);font:inherit;min-width:0}
textarea.lre-input{min-height:80px;resize:vertical;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px}
select.lre-input{appearance:auto}
.lre-input.invalid{border-color:var(--lre-neg)}
.lre-list{display:flex;flex-direction:column;gap:6px}
.lre-item{display:flex;align-items:center;gap:10px;min-height:44px;width:100%;padding:8px 10px;border-radius:var(--lre-radius);border:1px solid var(--lre-border);background:var(--lre-subtle);text-align:left}
.lre-item>.grow{flex:1;min-width:0}
.lre-item .title{display:block;font-weight:600;overflow-wrap:anywhere}
.lre-item .sub{display:block;font-size:12px;color:var(--lre-muted);overflow-wrap:anywhere}
.lre-item[aria-current=true]{border-color:var(--lre-accent)}
.lre-chips{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0 2px;font:13px/1.3 system-ui,-apple-system,sans-serif}
@media (max-width:600px),(pointer:coarse){.lre-chips{padding-right:44px}}
.lre-chip{display:inline-flex;flex-wrap:wrap;align-items:center;gap:6px;min-height:44px;max-width:100%;padding:2px 2px 2px 12px;border-radius:22px;border:1px solid color-mix(in srgb,var(--lre-accent) 40%,transparent);background:color-mix(in srgb,var(--lre-accent) 12%,transparent)}
.lre-chip.info{padding-right:12px}
.lre-chip>.lab{flex:1 1 auto;min-width:0;overflow-wrap:anywhere}
.lre-chip>.det{color:var(--lre-muted);font-size:12px}
.lre-chip button{flex:0 0 auto;max-width:100%;min-height:40px;min-width:40px;padding:4px 12px;border-radius:20px;border:1px solid var(--lre-border);background:var(--lre-fill);white-space:normal;overflow-wrap:anywhere;text-align:center}
.lre-chip button.primary{background:var(--lre-accent-fill);color:var(--lre-accent-fg);border-color:transparent}
.lre-chip button.danger{color:var(--lre-neg)}
.lre-chip[data-kind=decline],.lre-chip[data-kind=degraded]{border-color:color-mix(in srgb,var(--lre-danger) 45%,transparent);background:color-mix(in srgb,var(--lre-danger) 10%,transparent)}
.lre-chip[data-kind=confirm],.lre-chip[data-kind=overdue],.lre-chip[data-kind=keep_report],.lre-chip[data-kind=pending]{border-color:color-mix(in srgb,var(--lre-warning) 50%,transparent);background:color-mix(in srgb,var(--lre-warning) 10%,transparent)}
.lre-chip[data-kind=change],.lre-chip[data-kind=elapsed],.lre-chip[data-kind=price],.lre-chip[data-kind=roll]{border-color:var(--lre-border);background:var(--lre-subtle)}
.lre-chip.busy{opacity:.6}
.lre-keep{flex-basis:100%;border:1px solid color-mix(in srgb,var(--lre-warning) 50%,transparent);border-radius:12px;padding:8px 10px;background:color-mix(in srgb,var(--lre-warning) 6%,transparent)}
.lre-keep .lre-row{padding:6px 0}
.lre-hud{display:flex;align-items:center;gap:2px;height:100%;padding:0 4px;border-radius:22px;border:1px solid var(--lre-border);background:color-mix(in srgb,var(--lre-surface) 94%,transparent);backdrop-filter:blur(10px);box-shadow:0 4px 18px rgba(0,0,0,.45);overflow:hidden}
.lre-hud>button{min-height:40px;min-width:40px;padding:0 8px;border:0;background:transparent;display:inline-flex;align-items:center;justify-content:center;gap:4px;white-space:nowrap;border-radius:18px;font-size:13px}
.lre-hud>button:hover{background:var(--lre-subtle)}
.lre-hud .sep{width:1px;height:18px;background:var(--lre-border)}
.lre-hud-pop{width:min(340px,calc(100vw - 24px));padding:10px;border-radius:14px;border:1px solid var(--lre-border);background:var(--lre-surface);box-shadow:0 10px 30px rgba(0,0,0,.45);max-height:100%;overflow:auto}
.lre-sheet{display:flex;flex-direction:column;height:100%;background:var(--lre-surface);border:1px solid var(--lre-border);border-radius:16px 16px 0 0;box-shadow:0 -10px 30px rgba(0,0,0,.45);overflow:hidden}
.lre-sheet.desk{border-radius:16px}
.lre-sheet>header{display:flex;align-items:center;gap:8px;padding:8px 8px 6px 14px;border-bottom:1px solid var(--lre-border)}
.lre-sheet>header>.title{flex:1;min-width:0;font-weight:600;overflow-wrap:anywhere}
.lre-sheet>.body{flex:1;overflow:auto;padding:10px 12px 16px;display:flex;flex-direction:column;gap:10px;overscroll-behavior:contain}
.lre-sheet>footer{padding:8px 12px calc(8px + env(safe-area-inset-bottom,0px));border-top:1px solid var(--lre-border);display:flex;flex-wrap:wrap;gap:8px}
.lre-odds{display:flex;height:8px;border-radius:4px;overflow:hidden;background:rgba(127,127,127,.2);margin-top:4px}
.lre-odds>span{height:100%}
.lre-odds-legend{display:flex;gap:10px;flex-wrap:wrap;font-size:12px;color:var(--lre-muted);margin-top:4px}
.lre-odds-legend i{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:4px}
.lre-map{position:relative;width:100%;height:100%;overflow:hidden;touch-action:none;background:#12141a;border-radius:12px;user-select:none}
.lre-map.full{border-radius:0}
.lre-map canvas{position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none}
.lre-map .bar{position:absolute;top:8px;left:8px;right:8px;display:flex;gap:6px;justify-content:flex-end;align-items:center;pointer-events:none}
.lre-map .bar>*{pointer-events:auto}
.lre-map .bar .title{margin-right:auto;min-width:0;padding:0 10px;min-height:40px;display:flex;align-items:center;border-radius:20px;background:rgba(0,0,0,.45);color:#fff;font-weight:600;overflow-wrap:anywhere}
.lre-map .bar .lre-btn,.lre-map .zoom .lre-btn{background:var(--lre-surface)}
.lre-map .bar :focus-visible,.lre-map .zoom :focus-visible{outline-color:#fff}
.lre-map .dock{position:absolute;left:8px;right:8px;bottom:8px;padding:10px;border-radius:14px;background:color-mix(in srgb,var(--lre-surface) 94%,transparent);border:1px solid var(--lre-border);display:flex;flex-direction:column;gap:8px;max-height:55%;overflow:auto}
.lre-map .zoom{position:absolute;right:8px;bottom:8px;display:flex;flex-direction:column;gap:6px}
.lre-toasts{position:fixed;left:50%;transform:translateX(-50%);bottom:84px;z-index:2147483000;display:flex;flex-direction:column;gap:6px;width:min(420px,calc(100vw - 24px));pointer-events:none}
.lre-toast{pointer-events:auto;padding:10px 12px;border-radius:12px;background:var(--lre-surface);border:1px solid var(--lre-border);box-shadow:0 8px 24px rgba(0,0,0,.45);display:flex;gap:8px;align-items:center}
.lre-toast>span{min-width:0;overflow-wrap:anywhere}
.lre-toasts.inline{position:static;transform:none;width:auto;margin:4px 0}
.lre-overlay-root{width:100%;height:100%}
.lre-toast.error{border-color:color-mix(in srgb,var(--lre-danger) 60%,transparent)}
.lre-meter{display:grid;grid-template-columns:auto repeat(3,1fr);gap:4px 10px;font-size:12px;font-variant-numeric:tabular-nums}
.lre-meter>.hd{color:var(--lre-muted)}
.lre-timeline{display:flex;height:16px;border-radius:4px;overflow:hidden;background:rgba(127,127,127,.15);margin-top:6px}
.lre-timeline>span{height:100%;border-right:1px solid rgba(0,0,0,.25)}
.lre-tl-work{background:#6b5cff}.lre-tl-sleep{background:#2d3a6b}.lre-tl-free{background:#2d5a3c}.lre-tl-travel{background:#8a6b2d}.lre-tl-other{background:#555}
.lre-bar{height:8px;border-radius:4px;background:rgba(127,127,127,.2);overflow:hidden}
.lre-bar>span{display:block;height:100%;background:var(--lre-accent)}
.lre-bar.low>span{background:var(--lre-neg)}
.lre-tree{padding-left:12px;border-left:1px solid var(--lre-border);margin-left:4px}
.lre-json{font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;overflow-wrap:anywhere;margin:0;color:var(--lre-muted)}
.lre-graph{width:100%;overflow:auto;border:1px solid var(--lre-border);border-radius:12px;background:#12141a;touch-action:pan-x pan-y}
.lre-graph svg{display:block}
.lre-grid-editor{position:relative;width:100%;height:320px;border:1px solid var(--lre-border);border-radius:12px;overflow:hidden;touch-action:none;background:#12141a}
.lre-grid-editor canvas{position:absolute;inset:0;width:100%;height:100%;touch-action:none}
.lre-expr-tools{display:flex;gap:4px;flex-wrap:wrap}
.lre-expr-tools>button{min-height:40px;min-width:40px;padding:0 8px;border-radius:8px;border:1px solid var(--lre-border);background:var(--lre-subtle);font:12px ui-monospace,Menlo,monospace}
.lre-sched{position:relative;height:44px;border-radius:8px;background:rgba(127,127,127,.12);overflow:hidden}
.lre-sched>button{position:absolute;top:2px;bottom:2px;border-radius:6px;border:1px solid rgba(0,0,0,.3);background:var(--lre-accent-fill);color:var(--lre-accent-fg);font-size:11px;overflow:hidden;padding:0 4px;min-width:40px}
.lre-sched>button[aria-current=true]{outline:2px solid var(--lre-fg)}
.lre-sched-axis{display:flex;justify-content:space-between;font-size:10px;color:var(--lre-dim);margin-top:2px}
.lre-lint{display:flex;gap:8px;align-items:flex-start;padding:8px 0;border-bottom:1px solid rgba(127,127,127,.15)}
.lre-lint:last-child{border-bottom:0}
.lre-lint .path{font:11px ui-monospace,Menlo,monospace;color:var(--lre-dim);overflow-wrap:anywhere}
.lre-progress{height:6px;border-radius:3px;background:rgba(127,127,127,.2);overflow:hidden}
.lre-progress>span{display:block;height:100%;background:var(--lre-accent);transition:width .3s}
.lre-host-slot{min-height:40px}
.lre-tier-wrap{container-type:inline-size}
.lre-tier-grid{display:grid;grid-template-columns:minmax(0,1fr) repeat(3,52px);gap:4px;align-items:center;font-size:12px}
.lre-tier-grid [role=columnheader],.lre-tier-grid [role=rowheader]{min-width:0;overflow-wrap:break-word;hyphens:auto}
@container (max-width:240px){.lre-tier-grid{grid-template-columns:repeat(3,minmax(40px,1fr))}.lre-tier-grid [role=row]>[role=columnheader]:first-child,.lre-tier-grid [role=rowheader]{grid-column:1/-1}.lre-tier-grid [role=rowheader]{padding-top:4px}}
.lre-tier-grid select{min-height:40px;width:100%;min-width:40px;padding-left:4px;padding-right:4px}
.lre-check{display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;min-width:40px;min-height:40px;cursor:pointer}
.lre-check>input{width:22px;height:22px;margin:0;cursor:pointer}
.lre-sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.lre-stepper{display:inline-flex;align-items:center;gap:4px;margin-left:auto;max-width:100%;min-width:0}
.lre-stepper>.lre-input{flex:0 1 76px;width:76px;min-width:44px;text-align:center;font-variant-numeric:tabular-nums}
.lre-stepper>.lre-btn{flex:0 0 40px;padding:0}
.lre :focus-visible,.lre-chips :focus-visible{outline:2px solid var(--lre-accent);outline-offset:2px}
.lre-btn.primary:focus-visible,.lre-seg>button[aria-pressed=true]:focus-visible,.lre-tabs>button[aria-selected=true]:focus-visible,.lre-chip button.primary:focus-visible,.lre-sched>button:focus-visible{outline-color:var(--lre-fg);box-shadow:inset 0 0 0 2px var(--lre-accent-fg)}
.lre-tabs>button:focus-visible,.lre-hud>button:focus-visible,.lre-sched>button:focus-visible{outline-offset:-2px}
.lre-sheet:focus,[data-lre-overlay=map]:focus,.lre-hud-pop:focus{outline:none}
@media (prefers-reduced-motion:reduce){.lre,.lre *,.lre *::before,.lre *::after,.lre-chips,.lre-chips *,.lre-chips *::before,.lre-chips *::after{transition:none!important;animation:none!important;scroll-behavior:auto!important}}
`;

// src/frontend/ui-registry.ts
function buildCatalog(packs) {
  const panels = new Map;
  const editors = new Map;
  const chips = new Map;
  const ids = new Set;
  for (const pack of packs) {
    if (ids.has(pack.id))
      throw new Error(`UI pack ${pack.id} is registered twice`);
    ids.add(pack.id);
    const registry = {
      panel(def) {
        if (panels.has(def.id))
          throw new Error(`Panel ${def.id} (pack ${pack.id}) is already registered`);
        panels.set(def.id, def);
      },
      editor(def) {
        if (editors.has(def.collection))
          throw new Error(`An editor for ${def.collection} (pack ${pack.id}) is already registered`);
        editors.set(def.collection, def);
      },
      chip(kind, component) {
        if (chips.has(kind))
          throw new Error(`A chip renderer for ${kind} (pack ${pack.id}) is already registered`);
        chips.set(kind, component);
      }
    };
    pack.register(registry);
  }
  const ordered = [...panels.values()].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  return { panels: ordered, editors, chips, packs: [...ids] };
}

// src/frontend/setup.tsx
var ICON = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/></svg>`;
function setup(ctx) {
  const cleanups = [];
  const host = createHost(ctx);
  cleanups.push(() => host.dispose());
  cleanups.push(ctx.dom.addStyle(CSS));
  const client = new ProtocolClient({ send: (payload) => ctx.sendToBackend(payload), subscribe: (handler) => ctx.onBackendMessage(handler) });
  cleanups.push(() => client.dispose());
  cleanups.push(trackJobs(client));
  cleanups.push(client.subscribe((state) => setCurrency(state.view?.currency ?? null)));
  let announced = null;
  const announce = (packs) => {
    const key = JSON.stringify(packs);
    if (key === announced)
      return;
    announced = key;
    const detail = { engineVersion: ENGINE_VERSION, worldFormat: WORLD_FORMAT, packs, inbound: ["file"] };
    window.dispatchEvent(new CustomEvent("lre-state-v1", { detail }));
  };
  announce({});
  cleanups.push(client.subscribe((state) => state.view ? announce(state.view.packs) : undefined));
  const ui = createStore({ section: "play", playPanel: null, build: { view: "worlds" }, mapInDrawer: false, overlay: null });
  const toasts = createStore([]);
  let toastId = 0;
  const toast = (text, tone = "info") => {
    toastId += 1;
    const id = toastId;
    toasts.update((all) => [...all.slice(-2), { id, text, tone }]);
    setTimeout(() => toasts.update((all) => all.filter((entry) => entry.id !== id)), tone === "error" ? 6000 : 3500);
  };
  cleanups.push(client.onError((error) => toast(error.message, "error")));
  let overlays = null;
  const app = {
    client,
    send: client.send,
    sync: { get: () => client.getState(), subscribe: (listener) => client.subscribe(listener) },
    catalog: buildCatalog(UI_PACKS),
    ui,
    toasts,
    host,
    drafts: createStore(null),
    toast,
    request: makeRequest(client.send, toast),
    overlays: {
      openMap: () => overlays?.open("map") ?? Promise.resolve(),
      closeMap: () => overlays?.close("map"),
      openPalette: (tab) => overlays?.open("palette", tab) ?? Promise.resolve(),
      closePalette: () => overlays?.close("palette")
    }
  };
  overlays = createOverlays(app, host);
  const set = overlays;
  cleanups.push(() => set.destroy());
  const tab = host.ui.registerDrawerTab({
    id: "lumirpengine",
    title: "LumiRPEngine",
    shortName: "RPEngine",
    headerTitle: "LumiRPEngine",
    description: "World simulation: play, build and settings",
    keywords: ["world", "simulation", "roleplay", "map", "timelapse", "realism"],
    iconSvg: ICON
  });
  G(/* @__PURE__ */ u3(AppContext.Provider, {
    value: app,
    children: [
      /* @__PURE__ */ u3(Drawer, {
        measure: (el) => host.ui.geometry.layoutElementRect(el)
      }, undefined, false, undefined, this),
      /* @__PURE__ */ u3(Toasts, {
        surface: "drawer"
      }, undefined, false, undefined, this)
    ]
  }, undefined, true, undefined, this), tab.root);
  cleanups.push(() => {
    G(null, tab.root);
    tab.destroy();
  });
  let hud = null;
  let hudSize = { width: 0, height: 0 };
  const ensureHud = () => {
    if (hud)
      return hud;
    const rect = hudFloatRect(host.viewport.get());
    const widget = host.ui.createFloatWidget({ width: rect.width, height: rect.height, initialPosition: { x: rect.x, y: rect.y }, chromeless: true, tooltip: "World status", persistGeometry: rect.key });
    widget.root.style.width = "100%";
    widget.root.style.height = "100%";
    let placed = { x: rect.x, y: rect.y };
    G(/* @__PURE__ */ u3(AppContext.Provider, {
      value: app,
      children: /* @__PURE__ */ u3("div", {
        class: "lre",
        style: { width: "max-content", height: "100%" },
        children: /* @__PURE__ */ u3(Hud, {
          resize: (size) => {
            if (size.width === hudSize.width && size.height === hudSize.height)
              return;
            hudSize = size;
            widget.setSize(size.width, size.height);
            const at = widget.getPosition();
            if (at.x !== placed.x || at.y !== placed.y)
              return;
            placed = { x: hudCentreX(host.viewport.get(), size.width), y: placed.y };
            widget.moveTo(placed.x, placed.y);
          }
        }, undefined, false, undefined, this)
      }, undefined, false, undefined, this)
    }, undefined, false, undefined, this), widget.root);
    hud = widget;
    return widget;
  };
  cleanups.push(() => {
    if (!hud)
      return;
    G(null, hud.root);
    hud.destroy();
  });
  const actions = host.ui.registerInputBarAction({ id: "lre-actions", label: "World actions…", enabled: false });
  const timelapse = host.ui.registerInputBarAction({ id: "lre-timelapse", label: "Timelapse…", enabled: false });
  const clock = host.ui.registerInputBarAction({ id: "lre-clock", label: "Pause clock", enabled: false });
  const mapAction = host.ui.registerInputBarAction({ id: "lre-map", label: "World map", enabled: false });
  cleanups.push(actions.onClick(() => void app.overlays.openPalette("actions")));
  cleanups.push(timelapse.onClick(() => void app.overlays.openPalette("timelapse")));
  cleanups.push(mapAction.onClick(() => void app.overlays.openMap()));
  cleanups.push(clock.onClick(() => {
    const view = client.getState().view;
    if (view?.hud)
      app.request(timeMarker(view.chatId, "pause", { all: true }, !view.hud.clock.paused));
  }));
  for (const handle of [actions, timelapse, clock, mapAction])
    cleanups.push(() => handle.destroy());
  const follow = () => {
    const view = client.getState().view;
    const world = view !== null && view.status !== "not_world";
    if (world && view.hud)
      ensureHud().setVisible(true);
    else
      hud?.setVisible(false);
    actions.setEnabled(world && view.palette !== null);
    timelapse.setEnabled(world && view.palette?.timelapse != null);
    clock.setEnabled(world && view.hud !== null);
    clock.setLabel(view?.hud?.clock.paused ? "Resume clock" : "Pause clock");
    mapAction.setEnabled(world && view.panels["space.map"] !== undefined);
  };
  cleanups.push(client.subscribe(follow));
  cleanups.push(host.ui.registerDomDecorator({
    mount: "message_body_after",
    render(root, decorator) {
      const messageId = messageIdFromScope(decorator.scope);
      if (!messageId)
        return;
      G(/* @__PURE__ */ u3(AppContext.Provider, {
        value: app,
        children: /* @__PURE__ */ u3("div", {
          class: "lre",
          children: /* @__PURE__ */ u3(MessageChips, {
            messageId
          }, undefined, false, undefined, this)
        }, undefined, false, undefined, this)
      }, undefined, false, undefined, this), root);
      return () => G(null, root);
    },
    update(root, decorator) {
      const messageId = messageIdFromScope(decorator.scope);
      if (!messageId)
        return;
      G(/* @__PURE__ */ u3(AppContext.Provider, {
        value: app,
        children: /* @__PURE__ */ u3("div", {
          class: "lre",
          children: /* @__PURE__ */ u3(MessageChips, {
            messageId
          }, undefined, false, undefined, this)
        }, undefined, false, undefined, this)
      }, undefined, false, undefined, this), root);
    }
  }));
  cleanups.push(host.ui.registerDomDecorator({
    mount: "chat_toolbar",
    render(root) {
      G(/* @__PURE__ */ u3(AppContext.Provider, {
        value: app,
        children: /* @__PURE__ */ u3(Toasts, {
          surface: "chat"
        }, undefined, false, undefined, this)
      }, undefined, false, undefined, this), root);
      return () => G(null, root);
    }
  }));
  const openActive = (chatId) => {
    if (chatId === client.getState().chatId && client.getState().status !== "closed")
      return;
    app.overlays.closeMap();
    app.overlays.closePalette();
    client.open(chatId);
  };
  if (ctx.state) {
    cleanups.push(ctx.state.subscribe("chat.active", (value) => openActive(value.chatId)));
  } else {
    for (const event of ["CHAT_CHANGED", "CHAT_SWITCHED"])
      cleanups.push(ctx.events.on(event, () => openActive(ctx.getActiveChat().chatId)));
  }
  openActive(ctx.getActiveChat().chatId);
  return () => {
    for (const cleanup of cleanups.reverse()) {
      try {
        cleanup();
      } catch (error) {
        console.warn("[LumiRPEngine] cleanup failed", error);
      }
    }
  };
}
export {
  setup
};
