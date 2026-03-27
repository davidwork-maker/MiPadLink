import test from "node:test";
import assert from "node:assert/strict";
import { ensureAdbReverseForPort, getAdbDeviceLinkStatus, parseAdbReverseListOutput } from "./adb.js";

test("parseAdbReverseListOutput keeps reverse mappings", () => {
  const mappings = parseAdbReverseListOutput(`
de59cf69 tcp:9009 tcp:9009
emulator-5554 tcp:7777 tcp:7777
`);

  assert.deepEqual(mappings, [
    { serial: "de59cf69", remote: "tcp:9009", local: "tcp:9009" },
    { serial: "emulator-5554", remote: "tcp:7777", local: "tcp:7777" }
  ]);
});

test("getAdbDeviceLinkStatus detects reverse-ready authorized devices", async () => {
  const calls = [];
  const status = await getAdbDeviceLinkStatus({
    port: 9009,
    resolveAdbPathFn: async () => "/tmp/adb",
    execFileFn: async (file, args) => {
      calls.push([file, ...args]);
      if (args[0] === "devices") {
        return "List of devices attached\nde59cf69 device usb:1-1\n";
      }
      if (args[0] === "reverse" && args[1] === "--list") {
        return "de59cf69 tcp:9009 tcp:9009\n";
      }
      throw new Error(`unexpected:${args.join(" ")}`);
    }
  });

  assert.equal(status.ok, true);
  assert.equal(status.authorizedDevices.length, 1);
  assert.equal(status.reverseReady, true);
  assert.equal(status.ready, true);
  assert.equal(calls.length, 2);
});

test("ensureAdbReverseForPort applies reverse per authorized device", async () => {
  const calls = [];
  const result = await ensureAdbReverseForPort({
    port: 9009,
    adbPath: "/tmp/adb",
    serials: ["de59cf69", "tablet-02"],
    execFileFn: async (file, args) => {
      calls.push([file, ...args]);
      return "";
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.repaired, true);
  assert.deepEqual(result.serials, ["de59cf69", "tablet-02"]);
  assert.deepEqual(calls, [
    ["/tmp/adb", "-s", "de59cf69", "reverse", "tcp:9009", "tcp:9009"],
    ["/tmp/adb", "-s", "tablet-02", "reverse", "tcp:9009", "tcp:9009"]
  ]);
});
