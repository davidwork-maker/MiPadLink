import test from "node:test";
import assert from "node:assert/strict";
import { createDisplayCaptureFrameProvider, createScreenCaptureFrameProvider, createStaticFrameProvider } from "./frame-provider.js";

test("static frame provider returns text payload", () => {
  const provider = createStaticFrameProvider({ prefix: "demo" });
  const frame = provider.nextFrame({ seq: 2, width: 100, height: 200 });
  assert.deepEqual(frame, {
    seq: 2,
    width: 100,
    height: 200,
    payload: "demo-2",
    payloadFormat: "text"
  });
});

test("screen capture provider returns jpeg payload when command succeeds", async () => {
  const provider = createScreenCaptureFrameProvider({
    runCommand: async () => {},
    readFileFn: async () => Buffer.from([1, 2, 3]),
    retryAfterMs: 1
  });

  const frame = await provider.nextFrame({ seq: 0, width: 10, height: 20 });
  assert.equal(frame.payloadFormat, "jpeg-base64");
  assert.equal(frame.payload, Buffer.from([1, 2, 3]).toString("base64"));
});

test("screen capture provider falls back to text when command fails", async () => {
  const provider = createScreenCaptureFrameProvider({
    runCommand: async () => {
      throw new Error("denied");
    },
    readFileFn: async () => Buffer.from([]),
    retryAfterMs: 10000
  });

  const frame = await provider.nextFrame({ seq: 7, width: 10, height: 20 });
  assert.equal(frame.payloadFormat, "text");
  assert.match(frame.payload, /capture-failed/);

  const paused = await provider.nextFrame({ seq: 8, width: 10, height: 20 });
  assert.equal(paused.payloadFormat, "text");
  assert.match(paused.payload, /capture-paused/);
});

test("display capture provider returns jpeg payload when helper succeeds", async () => {
  const provider = createDisplayCaptureFrameProvider({
    displayId: 77,
    captureDisplayFn: async () => {},
    readFileFn: async () => Buffer.from([9, 8, 7]),
    retryAfterMs: 1
  });

  const frame = await provider.nextFrame({ seq: 1, width: 11, height: 22 });
  assert.equal(frame.payloadFormat, "jpeg-base64");
  assert.equal(frame.payload, Buffer.from([9, 8, 7]).toString("base64"));
});

test("display capture provider reuses last frame when a later capture fails", async () => {
  let attempt = 0;
  const provider = createDisplayCaptureFrameProvider({
    displayId: 77,
    captureDisplayFn: async () => {
      attempt += 1;
      if (attempt > 1) {
        throw new Error("transient");
      }
    },
    readFileFn: async () => Buffer.from([3, 2, 1]),
    retryAfterMs: 10000
  });

  const first = await provider.nextFrame({ seq: 1, width: 11, height: 22 });
  const second = await provider.nextFrame({ seq: 2, width: 11, height: 22 });
  assert.equal(first.payloadFormat, "jpeg-base64");
  assert.equal(second.payloadFormat, "jpeg-base64");
  assert.equal(second.payload, first.payload);
});

test("display capture provider forwards capture backend choice", async () => {
  const calls = [];
  const provider = createDisplayCaptureFrameProvider({
    displayId: 77,
    captureBackend: "coreGraphics",
    captureDisplayFn: async (options) => {
      calls.push(options);
    },
    readFileFn: async () => Buffer.from([4, 5, 6]),
    retryAfterMs: 1
  });

  const frame = await provider.nextFrame({ seq: 3, width: 11, height: 22 });
  assert.equal(frame.payloadFormat, "jpeg-base64");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].backend, "coreGraphics");
});
