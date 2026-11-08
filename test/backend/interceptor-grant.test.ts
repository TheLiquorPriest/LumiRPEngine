// Core drops an interceptor registered before `interceptor` is granted and never asks again: the grant
// registers it once more, replacing whatever core kept, and nothing else does.
import { expect, test } from "bun:test";
import { createSpindleHost } from "../../src/backend/spindle-host";

test("the prompt interceptor registers again when `interceptor` is granted", () => {
  const registered: unknown[] = [];
  let disposed = 0;
  const listeners = new Map<string, ((payload: unknown) => void)[]>();
  const spindle = {
    registerInterceptor: (_handler: unknown, options: unknown) => (registered.push(options), () => void (disposed += 1)),
    on: (event: string, handler: (payload: unknown) => void) => (listeners.set(event, [...(listeners.get(event) ?? []), handler]), () => undefined),
  };
  Object.assign(globalThis, { spindle });
  try {
    const host = createSpindleHost();
    host.registerPromptInterceptor(async () => ({}), { priority: 5, generationTypes: ["normal"], required: true });
    expect(registered).toHaveLength(1);
    const emit = (payload: unknown): void => {
      for (const h of listeners.get("PERMISSION_CHANGED") ?? []) h(payload);
    };
    emit({ extensionId: "x", permission: "characters", granted: true });
    emit({ extensionId: "x", permission: "interceptor", granted: false });
    expect(registered).toHaveLength(1);
    emit({ extensionId: "x", permission: "interceptor", granted: true });
    expect(registered).toHaveLength(2);
    expect(disposed).toBe(1);
    expect(registered[1]).toEqual({ priority: 5, match: { generationTypes: ["normal"] }, required: true });
  } finally {
    Object.assign(globalThis, { spindle: undefined });
  }
});
