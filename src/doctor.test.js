import test from "node:test";
import assert from "node:assert/strict";
import { collectDoctorReport, formatDoctorReport, parseAdbDevicesOutput } from "./doctor.js";

test("parseAdbDevicesOutput keeps real device rows", () => {
  const devices = parseAdbDevicesOutput(`
List of devices attached
emulator-5554 device product:sdk_gphone64
de59cf69 unauthorized usb:1-1

`);

  assert.deepEqual(devices, [
    {
      serial: "emulator-5554",
      state: "device",
      detail: "product:sdk_gphone64"
    },
    {
      serial: "de59cf69",
      state: "unauthorized",
      detail: "usb:1-1"
    }
  ]);
});

test("collectDoctorReport summarizes a healthy setup", async () => {
  const report = await collectDoctorReport({
    host: "127.0.0.1",
    port: 9009,
    dashboardPort: 9010,
    buildHelpers: false,
    getExistingHelperPathsFn: () => ({
      virtualDisplay: "/tmp/padlink-virtual-display",
      scCapture: null
    }),
    checkAccessibilityPermissionFn: async () => ({
      trusted: true,
      promptNeeded: false
    }),
    getCaptureBackendStatusFn: async () => ({
      systemScreencapture: true,
      coreGraphicsFallback: true,
      screenCaptureKit: false
    }),
    getAdbDeviceLinkStatusFn: async () => ({
      ok: true,
      adbPath: "/tmp/adb",
      devices: [{ serial: "de59cf69", state: "device", detail: "usb:1-1" }],
      authorizedDevices: [{ serial: "de59cf69", state: "device", detail: "usb:1-1" }],
      unauthorizedDevices: [],
      reverseMappings: [{ serial: "de59cf69", remote: "tcp:9009", local: "tcp:9009" }],
      reverseTarget: "tcp:9009",
      reverseReady: true,
      error: null
    }),
    checkPortFn: async () => ({ ok: true }),
    fetchDashboardStateFn: async () => ({
      host: "127.0.0.1",
      port: 9009,
      clients: 1,
      mirrorEnabled: false,
      virtualDisplay: {
        displayId: 24,
        width: 1600,
        height: 900
      }
    })
  });

  assert.equal(report.helpers.ok, true);
  assert.equal(report.adb.authorizedDevices.length, 1);
  assert.equal(report.adb.reverseReady, true);
  assert.equal(report.nextSteps.length, 0);

  const compact = formatDoctorReport(report, { compact: true });
  assert.match(compact, /running on 127\.0\.0\.1:9009/);
  assert.match(compact, /extend · 1600x900 · clients=1/);
});

test("collectDoctorReport suggests recovery actions when key pieces are missing", async () => {
  const report = await collectDoctorReport({
    host: "127.0.0.1",
    port: 9009,
    dashboardPort: 9010,
    buildHelpers: false,
    getExistingHelperPathsFn: () => ({
      virtualDisplay: null,
      scCapture: null
    }),
    getAdbDeviceLinkStatusFn: async () => ({
      ok: false,
      adbPath: null,
      devices: [],
      authorizedDevices: [],
      unauthorizedDevices: [],
      reverseMappings: [],
      reverseTarget: "tcp:9009",
      reverseReady: false,
      error: "adb-not-found"
    }),
    checkPortFn: async () => ({ ok: false, error: "ECONNREFUSED" }),
    fetchDashboardStateFn: async () => {
      throw new Error("dashboard-http-503");
    }
  });

  assert.equal(report.helpers.ok, false);
  assert.equal(report.adb.ok, false);
  assert.equal(report.host.ok, false);
  assert.match(report.nextSteps.join("\n"), /build the macOS helper/i);
  assert.match(report.nextSteps.join("\n"), /launch the host and dashboard/i);

  const full = formatDoctorReport(report);
  assert.match(full, /MiPadLink Doctor/);
  assert.match(full, /Next steps:/);
});
