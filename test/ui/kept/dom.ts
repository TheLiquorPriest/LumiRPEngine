// A page for Preact to draw today's Build mode in without a browser: elements and text, attributes,
// styles, events that bubble to the document and the window, focus, and the few calls of the window
// Build and its host bridge make (its size, a media query, a confirm, `getComputedStyle`, a resize
// observer). It is put in place of the globals for the length of a test file and taken out after.
// What listens on the window and the document, and what a resize observer watches, is counted, so a
// test can see that nothing is left once a page is gone.

type Handler = (this: unknown, event: PageEvent) => void;

export class PageEvent {
  defaultPrevented = false;
  stopped = false;
  target: PageNode | null = null;
  currentTarget: unknown = null;
  readonly bubbles: boolean;
  readonly key: string;

  constructor(
    readonly type: string,
    init: { bubbles?: boolean; key?: string } = {},
  ) {
    this.bubbles = init.bubbles ?? true;
    this.key = init.key ?? "";
  }

  preventDefault(): void {
    this.defaultPrevented = true;
  }

  stopPropagation(): void {
    this.stopped = true;
  }

  stopImmediatePropagation(): void {
    this.stopped = true;
  }
}

class Target {
  readonly #handlers: { type: string; handler: Handler; capture: boolean }[] = [];

  addEventListener(type: string, handler: Handler, options?: boolean | { capture?: boolean }): void {
    const capture = options === true || (typeof options === "object" && options.capture === true);
    if (!this.#handlers.some((h) => h.type === type && h.handler === handler && h.capture === capture)) this.#handlers.push({ type, handler, capture });
  }

  removeEventListener(type: string, handler: Handler, options?: boolean | { capture?: boolean }): void {
    const capture = options === true || (typeof options === "object" && options.capture === true);
    const at = this.#handlers.findIndex((h) => h.type === type && h.handler === handler && h.capture === capture);
    if (at >= 0) this.#handlers.splice(at, 1);
  }

  /** How many handlers listen here. */
  get handlers(): number {
    return this.#handlers.length;
  }

  hear(event: PageEvent): void {
    event.currentTarget = this;
    for (const h of [...this.#handlers]) if (h.type === event.type) h.handler.call(this, event);
  }
}

export class PageNode extends Target {
  parentNode: PageElement | null = null;

  constructor(
    readonly nodeType: number,
    readonly ownerDocument: PageDocument,
  ) {
    super();
  }

  get parentElement(): PageElement | null {
    return this.parentNode;
  }

  get nextSibling(): PageNode | null {
    const siblings = this.parentNode?.childNodes;
    return siblings === undefined ? null : (siblings[siblings.indexOf(this) + 1] ?? null);
  }

  get previousSibling(): PageNode | null {
    const siblings = this.parentNode?.childNodes;
    return siblings === undefined ? null : (siblings[siblings.indexOf(this) - 1] ?? null);
  }

  get isConnected(): boolean {
    for (let node: PageNode | null = this; node !== null; node = node.parentNode) if (node === this.ownerDocument.documentElement) return true;
    return false;
  }

  get textContent(): string {
    return "";
  }

  remove(): void {
    this.parentNode?.removeChild(this);
  }
}

export class PageText extends PageNode {
  constructor(
    public data: string,
    doc: PageDocument,
    type = 3,
  ) {
    super(type, doc);
  }

  override get textContent(): string {
    return this.nodeType === 3 ? this.data : "";
  }
}

const XHTML = "http://www.w3.org/1999/xhtml";

function style(): Record<string, unknown> & { cssText: string; setProperty(name: string, value: string): void; getPropertyValue(name: string): string; removeProperty(name: string): void } {
  const props = new Map<string, string>();
  return {
    cssText: "",
    setProperty: (name, value) => void props.set(name, value),
    getPropertyValue: (name) => props.get(name) ?? "",
    removeProperty: (name) => void props.delete(name),
  };
}

/** One step of a selector: a tag, classes, ids, attributes, and whether it must be enabled or disabled. */
interface Step {
  tag: string | null;
  classes: string[];
  attrs: [name: string, value: string | null][];
  enabled: boolean | null;
}

function stepsOf(selector: string): Step[] {
  return selector
    .trim()
    .split(/\s+/)
    .map((part) => {
      const step: Step = { tag: null, classes: [], attrs: [], enabled: null };
      const rest = part.replace(/^[a-z][\w-]*/i, (tag) => {
        step.tag = tag.toLowerCase();
        return "";
      });
      for (const m of rest.matchAll(/\.([\w-]+)|#([\w-]+)|\[([\w-]+)(?:="([^"]*)")?\]|:not\(:disabled\)|:disabled/g)) {
        if (m[1] !== undefined) step.classes.push(m[1]);
        else if (m[2] !== undefined) step.attrs.push(["id", m[2]]);
        else if (m[3] !== undefined) step.attrs.push([m[3], m[4] ?? null]);
        else step.enabled = m[0] === ":not(:disabled)";
      }
      return step;
    });
}

function fits(el: PageElement, step: Step): boolean {
  if (step.tag !== null && el.localName !== step.tag) return false;
  const classes = (el.getAttribute("class") ?? "").split(/\s+/);
  if (!step.classes.every((c) => classes.includes(c))) return false;
  if (!step.attrs.every(([name, value]) => (value === null ? el.hasAttribute(name) : el.getAttribute(name) === value))) return false;
  return step.enabled === null || step.enabled !== el.disabled;
}

export class PageElement extends PageNode {
  readonly childNodes: PageNode[] = [];
  readonly style = style();
  readonly #attrs = new Map<string, string>();
  #html = "";
  value = "";
  checked = false;
  scrollTop = 0;
  readonly clientTop = 0;
  readonly clientHeight = 0;

  constructor(
    readonly localName: string,
    readonly namespaceURI: string,
    doc: PageDocument,
  ) {
    super(1, doc);
  }

  get tagName(): string {
    return this.localName.toUpperCase();
  }

  get nodeName(): string {
    return this.tagName;
  }

  get firstChild(): PageNode | null {
    return this.childNodes[0] ?? null;
  }

  get lastChild(): PageNode | null {
    return this.childNodes[this.childNodes.length - 1] ?? null;
  }

  get children(): PageElement[] {
    return this.childNodes.filter((node): node is PageElement => node instanceof PageElement);
  }

  get attributes(): { name: string; value: string }[] {
    return [...this.#attrs].map(([name, value]) => ({ name, value }));
  }

  setAttribute(name: string, value: unknown): void {
    this.#attrs.set(name, String(value));
  }

  getAttribute(name: string): string | null {
    return this.#attrs.get(name) ?? null;
  }

  hasAttribute(name: string): boolean {
    return this.#attrs.has(name);
  }

  removeAttribute(name: string): void {
    this.#attrs.delete(name);
  }

  get id(): string {
    return this.getAttribute("id") ?? "";
  }

  set id(value: string) {
    this.setAttribute("id", value);
  }

  get className(): string {
    return this.getAttribute("class") ?? "";
  }

  set className(value: string) {
    this.setAttribute("class", value);
  }

  get disabled(): boolean {
    return this.hasAttribute("disabled");
  }

  set disabled(value: boolean) {
    if (value) this.setAttribute("disabled", "");
    else this.removeAttribute("disabled");
  }

  get type(): string {
    return this.getAttribute("type") ?? (this.localName === "input" ? "text" : "");
  }

  set type(value: string) {
    this.setAttribute("type", value);
  }

  get innerHTML(): string {
    return this.#html;
  }

  set innerHTML(html: string) {
    this.replaceChildren();
    this.#html = html;
  }

  override get textContent(): string {
    return this.childNodes.map((node) => node.textContent).join("");
  }

  override set textContent(text: string) {
    this.replaceChildren(...(text === "" ? [] : [text]));
  }

  appendChild(node: PageNode): PageNode {
    return this.insertBefore(node, null);
  }

  insertBefore(node: PageNode, before: PageNode | null): PageNode {
    node.parentNode?.removeChild(node);
    const at = before === null ? this.childNodes.length : this.childNodes.indexOf(before);
    if (at < 0) throw new Error("insertBefore: not a child");
    this.childNodes.splice(at, 0, node);
    node.parentNode = this;
    return node;
  }

  removeChild(node: PageNode): PageNode {
    const at = this.childNodes.indexOf(node);
    if (at < 0) throw new Error("removeChild: not a child");
    this.childNodes.splice(at, 1);
    node.parentNode = null;
    return node;
  }

  append(...nodes: (PageNode | string)[]): void {
    for (const node of nodes) this.appendChild(typeof node === "string" ? new PageText(node, this.ownerDocument) : node);
  }

  replaceChildren(...nodes: (PageNode | string)[]): void {
    for (const child of [...this.childNodes]) this.removeChild(child);
    this.#html = "";
    this.append(...nodes);
  }

  contains(other: PageNode | null): boolean {
    for (let node = other; node !== null; node = node.parentNode) if (node === this) return true;
    return false;
  }

  /** Every element below this one, in document order. */
  descendants(): PageElement[] {
    return this.children.flatMap((child) => [child, ...child.descendants()]);
  }

  matches(selector: string): boolean {
    const steps = stepsOf(selector);
    const last = steps[steps.length - 1];
    if (last === undefined || !fits(this, last)) return false;
    let at: PageElement | null = this.parentNode;
    for (let i = steps.length - 2; i >= 0; i--) {
      const step = steps[i] as Step;
      while (at !== null && !fits(at, step)) at = at.parentNode;
      if (at === null) return false;
      at = at.parentNode;
    }
    return true;
  }

  querySelectorAll(selector: string): PageElement[] {
    return this.descendants().filter((el) => el.matches(selector));
  }

  querySelector(selector: string): PageElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  closest(selector: string): PageElement | null {
    for (let el: PageElement | null = this; el !== null; el = el.parentNode) if (el.matches(selector)) return el;
    return null;
  }

  dispatchEvent(event: PageEvent): boolean {
    event.target = this;
    const path: Target[] = [];
    for (let node: PageNode | null = this; node !== null; node = node.parentNode) path.push(node);
    path.push(this.ownerDocument, this.ownerDocument.defaultView);
    for (const at of path) {
      at.hear(event);
      if (event.stopped || !event.bubbles) break;
    }
    return !event.defaultPrevented;
  }

  click(): void {
    if (!this.disabled) this.dispatchEvent(new PageEvent("click"));
  }

  focus(): void {
    this.ownerDocument.activeElement = this;
  }

  blur(): void {
    if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = this.ownerDocument.body;
  }

  showPicker(): void {}

  scrollIntoView(): void {}

  getBoundingClientRect(): { top: number; left: number; right: number; bottom: number; width: number; height: number; x: number; y: number } {
    return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 };
  }
}

export class PageDocument extends Target {
  readonly nodeType = 9;
  readonly documentElement: PageElement;
  readonly head: PageElement;
  readonly body: PageElement;
  activeElement: PageElement;
  readonly visibilityState = "visible";

  constructor(readonly defaultView: PageWindow) {
    super();
    this.documentElement = this.createElement("html");
    this.head = this.createElement("head");
    this.body = this.createElement("body");
    this.documentElement.append(this.head, this.body);
    this.activeElement = this.body;
  }

  createElement(tag: string): PageElement {
    return new PageElement(tag.toLowerCase(), XHTML, this);
  }

  createElementNS(namespace: string | null, tag: string): PageElement {
    return new PageElement(tag, namespace ?? XHTML, this);
  }

  createTextNode(text: string): PageText {
    return new PageText(String(text), this);
  }

  createComment(text: string): PageText {
    return new PageText(text, this, 8);
  }

  querySelector(selector: string): PageElement | null {
    return this.documentElement.querySelector(selector);
  }

  querySelectorAll(selector: string): PageElement[] {
    return this.documentElement.querySelectorAll(selector);
  }
}

export class PageWindow extends Target {
  innerWidth = 1280;
  innerHeight = 800;
  readonly document: PageDocument;
  /** What each confirm asked, and what the next one answers. */
  readonly confirms: string[] = [];
  answer = true;

  constructor() {
    super();
    this.document = new PageDocument(this);
  }

  confirm(text: string): boolean {
    this.confirms.push(text);
    return this.answer;
  }

  matchMedia(query: string): { matches: boolean; media: string; addEventListener(): void; removeEventListener(): void } {
    return { matches: false, media: query, addEventListener: () => undefined, removeEventListener: () => undefined };
  }
}

export interface Page {
  window: PageWindow;
  document: PageDocument;
  /** Handlers on the window and the document, and elements resize observers watch. */
  listening(): number;
  /** Takes the page out of the globals, putting back what was there. */
  close(): void;
}

const GLOBALS = ["window", "document", "HTMLElement", "Element", "Node", "getComputedStyle", "ResizeObserver"] as const;

/** Puts a fresh page in place of the browser's globals. */
export function openPage(): Page {
  const window = new PageWindow();
  const { document } = window;
  let watched = 0;
  class Observer {
    #watching = 0;
    observe(): void {
      this.#watching += 1;
      watched += 1;
    }
    unobserve(): void {
      if (this.#watching === 0) return;
      this.#watching -= 1;
      watched -= 1;
    }
    disconnect(): void {
      watched -= this.#watching;
      this.#watching = 0;
    }
  }
  const before = new Map(GLOBALS.map((name) => [name, Reflect.get(globalThis, name)] as const));
  Object.assign(globalThis, {
    window,
    document,
    HTMLElement: PageElement,
    Element: PageElement,
    Node: PageNode,
    getComputedStyle: () => ({ overflowY: "visible", scrollMarginTop: "", getPropertyValue: () => "" }),
    ResizeObserver: Observer,
  });
  return {
    window,
    document,
    listening: () => window.handlers + document.handlers + watched,
    close() {
      for (const [name, value] of before) Reflect.set(globalThis, name, value);
    },
  };
}
