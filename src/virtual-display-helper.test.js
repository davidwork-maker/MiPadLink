import test from "node:test";
import assert from "node:assert/strict";
import { resolveScreenCaptureDisplayIndex } from "./virtual-display-helper.js";

test("resolveScreenCaptureDisplayIndex maps display ids to screencapture indexes", () => {
  const displays = [
    { displayId: 1, main: true },
    { displayId: 24, main: false },
    { displayId: 31, main: false }
  ];

  assert.equal(resolveScreenCaptureDisplayIndex(displays, 1), 1);
  assert.equal(resolveScreenCaptureDisplayIndex(displays, 24), 2);
  assert.equal(resolveScreenCaptureDisplayIndex(displays, 31), 3);
});

test("resolveScreenCaptureDisplayIndex returns null when the display is absent", () => {
  const displays = [{ displayId: 1, main: true }];
  assert.equal(resolveScreenCaptureDisplayIndex(displays, 999), null);
  assert.equal(resolveScreenCaptureDisplayIndex(null, 1), null);
});
