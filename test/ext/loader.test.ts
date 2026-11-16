// The extension's frontend loader (`src/ext/loader.ts`): every chat surface the shell hands it registered through Lumiverse's own frontend API as given, one of each placement, a later one with no
// change to the loader, and every one taken off on cleanup. The context is a recording stand-in with the members the loader calls, each where Lumiverse has it (the DOM decorator under `ctx.ui`).

import { expect, test } from "bun:test";
import type { SpindleFrontendContext } from "lumiverse-spindle-types";
import { keepSurfaces, type ChatSurface, type SurfaceList } from "../../src/ext/loader";

function recording() {
  const log: string[] = [];
  const ctx = {
    ui: {
      registerDomDecorator: (options: { mount: string }) => {
        log.push(`decorator ${options.mount}`);
        return () => log.push(`decorator ${options.mount} off`);
      },
      createFloatWidget: () => ({ root: {}, widgetId: "w1", destroy: () => log.push("float destroyed") }),
      requestDockPanel: () => ({ root: {}, panelId: "p1", destroy: () => log.push("dock destroyed") }),
      registerInputBarAction: (options: { id: string }) => ({
        actionId: options.id,
        onClick: () => () => log.push(`action ${options.id} unhooked`),
        destroy: () => log.push(`action ${options.id} destroyed`),
      }),
    },
    messages: {
      renderWidget: (options: { messageId: string }) => {
        log.push(`widget ${options.messageId}`);
        return () => log.push(`widget ${options.messageId} off`);
      },
    },
  } as unknown as SpindleFrontendContext;
  return { ctx, log };
}

function listOf(initial: ChatSurface[]) {
  let now = initial;
  const listeners = new Set<() => void>();
  const list: SurfaceList = {
    current: () => now,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return {
    list,
    set(next: ChatSurface[]) {
      now = next;
      for (const l of [...listeners]) l();
    },
    listening: () => listeners.size,
  };
}

const one: ChatSurface[] = [
  { key: "marker", placement: "dom-decorator", options: { mount: "message_footer" } },
  { key: "hud", placement: "float-widget", render: () => () => undefined },
  { key: "panel", placement: "dock-panel", options: { edge: "right", title: "RPE", size: 320 }, render: () => undefined },
  { key: "depth", placement: "input-bar-action", options: { id: "depth", label: "Depth" }, onClick: () => undefined },
  { key: "under-m1", placement: "message-widget", options: { messageId: "m1", widgetId: "chips", html: "<b>chips</b>" } },
];

test("the loader registers every surface the shell hands it through Lumiverse's frontend API, one of each placement, and removes them all on cleanup", () => {
  const { ctx, log } = recording();
  const shell = listOf(one);
  const stop = keepSurfaces(ctx, shell.list);
  expect(log).toEqual(["decorator message_footer", "widget m1"]);
  stop();
  expect(log).toEqual(["decorator message_footer", "widget m1", "decorator message_footer off", "float destroyed", "dock destroyed", "action depth unhooked", "action depth destroyed", "widget m1 off"]);
  expect(shell.listening()).toBe(0);
});

test("a surface added to the shell's list later is registered with no change to the loader, and one taken from it is taken off", () => {
  const { ctx, log } = recording();
  const shell = listOf([one[0]!]);
  keepSurfaces(ctx, shell.list);
  shell.set([one[0]!, one[4]!]);
  shell.set([one[4]!]);
  expect(log).toEqual(["decorator message_footer", "widget m1", "decorator message_footer off"]);
});

test("a surface the host refuses costs the others nothing and is tried again at the next change", () => {
  const { ctx, log } = recording();
  let refuse = true;
  (ctx.ui as unknown as { createFloatWidget(): unknown }).createFloatWidget = () => {
    if (refuse) throw new Error("ui_panels is not granted");
    log.push("float made");
    return { root: {}, widgetId: "w1", destroy: () => undefined };
  };
  const warned: unknown[] = [];
  const warn = console.warn;
  console.warn = (...args: unknown[]) => void warned.push(args[0]);
  try {
    const shell = listOf([one[1]!, one[0]!]);
    keepSurfaces(ctx, shell.list);
    expect(log).toEqual(["decorator message_footer"]);
    expect(String(warned[0])).toContain("ui_panels is not granted");
    refuse = false;
    shell.set([one[1]!, one[0]!]);
    expect(log).toEqual(["decorator message_footer", "float made"]);
  } finally {
    console.warn = warn;
  }
});
