import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";

function execFileAsync(file, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { encoding: "utf8", ...options }, (error, stdout, stderr) => {
      if (error) {
        const reason = stderr?.trim() || error.message;
        reject(new Error(reason));
        return;
      }
      resolve(stdout);
    });
  });
}

export function parseAdbDevicesOutput(stdout = "") {
  const devices = [];
  for (const rawLine of String(stdout).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("List of devices attached") || line.startsWith("* daemon")) {
      continue;
    }
    const [serial, state, ...rest] = line.split(/\s+/);
    if (!serial || !state) {
      continue;
    }
    devices.push({
      serial,
      state,
      detail: rest.join(" ").trim()
    });
  }
  return devices;
}

export function parseAdbReverseListOutput(stdout = "") {
  const mappings = [];
  for (const rawLine of String(stdout).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("* daemon")) {
      continue;
    }
    const [serial, remote, local] = line.split(/\s+/);
    if (!serial || !remote || !local) {
      continue;
    }
    mappings.push({ serial, remote, local });
  }
  return mappings;
}

export async function resolveAdbPath({
  env = process.env,
  existsSyncFn = existsSync,
  execFileFn = execFileAsync,
  homedir = os.homedir()
} = {}) {
  const candidates = [
    env.PADLINK_ADB,
    "/tmp/padlink-tools/platform-tools/adb",
    `${homedir}/.local/android-sdk/platform-tools/adb`,
    `${homedir}/Library/Android/sdk/platform-tools/adb`
  ];

  for (const candidate of candidates) {
    if (candidate && existsSyncFn(candidate)) {
      return candidate;
    }
  }

  try {
    const stdout = await execFileFn("which", ["adb"]);
    const resolved = stdout.trim();
    return resolved || null;
  } catch {
    return null;
  }
}

export async function getAdbDeviceLinkStatus({
  port = 9009,
  resolveAdbPathFn = resolveAdbPath,
  execFileFn = execFileAsync
} = {}) {
  const adbPath = await resolveAdbPathFn({ execFileFn });
  const reverseTarget = `tcp:${port}`;
  if (!adbPath) {
    return {
      ok: false,
      adbPath: null,
      devices: [],
      authorizedDevices: [],
      unauthorizedDevices: [],
      offlineDevices: [],
      reverseMappings: [],
      reverseReady: false,
      ready: false,
      reverseTarget,
      error: "adb-not-found"
    };
  }

  const devices = parseAdbDevicesOutput(await execFileFn(adbPath, ["devices"]));
  const authorizedDevices = devices.filter((device) => device.state === "device");
  const unauthorizedDevices = devices.filter((device) => device.state === "unauthorized");
  const offlineDevices = devices.filter((device) => !["device", "unauthorized"].includes(device.state));

  let reverseMappings = [];
  try {
    reverseMappings = parseAdbReverseListOutput(await execFileFn(adbPath, ["reverse", "--list"]));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      ok: true,
      adbPath,
      devices,
      authorizedDevices,
      unauthorizedDevices,
      offlineDevices,
      reverseMappings: [],
      reverseReady: false,
      ready: false,
      reverseTarget,
      error: reason
    };
  }

  const reverseReady = authorizedDevices.length > 0 && authorizedDevices.every((device) => reverseMappings.some((mapping) => (
    mapping.serial === device.serial
    && mapping.remote === reverseTarget
    && mapping.local === reverseTarget
  )));

  return {
    ok: true,
    adbPath,
    devices,
    authorizedDevices,
    unauthorizedDevices,
    offlineDevices,
    reverseMappings,
    reverseReady,
    ready: reverseReady && authorizedDevices.length > 0,
    reverseTarget,
    error: null
  };
}

export async function ensureAdbReverseForPort({
  port = 9009,
  adbPath = null,
  serials = null,
  resolveAdbPathFn = resolveAdbPath,
  execFileFn = execFileAsync
} = {}) {
  const resolvedAdbPath = adbPath || await resolveAdbPathFn({ execFileFn });
  const reverseTarget = `tcp:${port}`;
  if (!resolvedAdbPath) {
    return {
      ok: false,
      repaired: false,
      adbPath: null,
      reverseTarget,
      serials: [],
      failed: [],
      error: "adb-not-found"
    };
  }

  let targetSerials = Array.isArray(serials) ? serials.filter(Boolean) : [];
  if (targetSerials.length === 0) {
    const devices = parseAdbDevicesOutput(await execFileFn(resolvedAdbPath, ["devices"]));
    targetSerials = devices
      .filter((device) => device.state === "device")
      .map((device) => device.serial);
  }

  if (targetSerials.length === 0) {
    return {
      ok: false,
      repaired: false,
      adbPath: resolvedAdbPath,
      reverseTarget,
      serials: [],
      failed: [],
      error: "no-authorized-device"
    };
  }

  const applied = [];
  const failed = [];
  for (const serial of targetSerials) {
    try {
      await execFileFn(resolvedAdbPath, ["-s", serial, "reverse", reverseTarget, reverseTarget]);
      applied.push(serial);
    } catch (error) {
      failed.push({
        serial,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return {
    ok: applied.length > 0 && failed.length === 0,
    repaired: applied.length > 0,
    adbPath: resolvedAdbPath,
    reverseTarget,
    serials: applied,
    failed,
    error: failed.length > 0 ? "adb-reverse-partial-failure" : null
  };
}
