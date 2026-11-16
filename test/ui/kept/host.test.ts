// The four controls the kept views mount through the bridge, drawn by the web shell's page itself: each
// mounts, draws what it is given and reports a change.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { webHost } from "../../../src/ui/kept/host";
import { openPage, type Page, PageEvent } from "./dom";

let page: Page;
beforeAll(() => {
  page = openPage();
});
afterAll(() => page.close());

describe("the web shell's controls", () => {
  test("a switch, a select, a slider and a model picker each mount and report a change", () => {
    const host = webHost({ revokeMs: () => 1000 });
    const slot = (): HTMLElement => {
      const element = page.document.createElement("div");
      page.document.body.append(element);
      return element as unknown as HTMLElement;
    };
    const heard: unknown[] = [];

    const switchSlot = slot();
    const toggle = host.components.mountSwitch(switchSlot, { checked: false, ariaLabel: "On", onChange: (checked) => heard.push(["switch", checked]) });
    const box = (switchSlot as unknown as { querySelector(selector: string): { checked: boolean; dispatchEvent(event: unknown): void } }).querySelector("input");
    box.checked = true;
    box.dispatchEvent(new PageEvent("change"));
    expect(toggle.getValue()).toBe(true);

    const selectSlot = slot();
    const pick = host.components.mountSelect(selectSlot, { value: "a", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }], onChange: (value) => heard.push(["select", value]) });
    const select = (selectSlot as unknown as { querySelector(selector: string): { value: string; dispatchEvent(event: unknown): void } }).querySelector("select");
    select.value = "b";
    select.dispatchEvent(new PageEvent("change"));
    expect(pick.getValue()).toBe("b");

    const sliderSlot = slot();
    const slide = host.components.mountRangeSlider(sliderSlot, { min: 0, max: 10, value: 2, step: 1, label: "Reach", onCommit: (value) => heard.push(["commit", value]), onDragValue: (value) => heard.push(["drag", value]) });
    const range = (sliderSlot as unknown as { querySelector(selector: string): { value: string; dispatchEvent(event: unknown): void } }).querySelector("input");
    range.value = "7";
    range.dispatchEvent(new PageEvent("input"));
    range.dispatchEvent(new PageEvent("change"));
    expect(slide.getValue()).toBe(7);

    const modelSlot = slot();
    host.components.mountModelCombobox(modelSlot, { value: "m1", connection: { kind: "llm", id: "c1" }, onChange: (model) => heard.push(["model", model]) });
    const text = (modelSlot as unknown as { querySelector(selector: string): { value: string; dispatchEvent(event: unknown): void } }).querySelector("input");
    text.value = " m2 ";
    text.dispatchEvent(new PageEvent("change"));

    expect(heard).toEqual([["switch", true], ["select", "b"], ["drag", 7], ["drag", null], ["commit", 7], ["model", "m2"]]);
    host.dispose();
  });
});
