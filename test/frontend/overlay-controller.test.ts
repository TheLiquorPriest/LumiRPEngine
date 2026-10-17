import { describe, expect, test } from "bun:test";
import { OverlayController } from "../../src/frontend/overlay-controller";
import type { FloatSurface } from "../../src/frontend/overlay-controller";

interface Probe {
  log: string[];
  controller: OverlayController;
}

function probe(width: number, drawerOpen: boolean, closes = true): Probe {
  const log: string[] = [];
  let visible = false;
  const surface: FloatSurface = {
    show(fullscreen) {
      visible = true;
      log.push(`show:${fullscreen ? "full" : "float"}`);
    },
    hide() {
      visible = false;
      log.push("hide");
    },
    isVisible: () => visible,
  };
  const controller = new OverlayController({
    viewport: () => ({ width, height: 844, coarse: false }),
    drawerOpen: () => drawerOpen,
    closeDrawer: async () => {
      log.push("closeDrawer");
      return closes;
    },
    surface,
    inDrawer: () => log.push("inDrawer"),
  });
  return { log, controller };
}

describe("opening the map", () => {
  test("at 390 px with the drawer open: the drawer closes before the fullscreen map shows", async () => {
    const { log, controller } = probe(390, true);
    expect(await controller.open()).toBe("float");
    expect(log).toEqual(["closeDrawer", "show:full"]);
  });

  test("at 390 px with the drawer closed: fullscreen map, no drawer request", async () => {
    const { log, controller } = probe(390, false);
    await controller.open();
    expect(log).toEqual(["show:full"]);
  });

  test("on desktop the drawer stays and the map is a float", async () => {
    const { log, controller } = probe(1280, true);
    await controller.open();
    expect(log).toEqual(["show:float"]);
  });

  test("if the drawer can't close, the map renders in the drawer instead of under it", async () => {
    const { log, controller } = probe(390, true, false);
    expect(await controller.open()).toBe("drawer");
    expect(log).toEqual(["closeDrawer", "inDrawer"]);
  });

  test("toggle closes a visible overlay", async () => {
    const { log, controller } = probe(1280, false);
    await controller.toggle();
    await controller.toggle();
    expect(log).toEqual(["show:float", "hide"]);
  });
});
