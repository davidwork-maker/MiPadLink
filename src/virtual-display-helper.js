import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";

const helperPath = path.resolve(process.cwd(), "macos-helper/build/padlink-virtual-display");
const scCapturePath = path.resolve(process.cwd(), "macos-helper/build/padlink-sc-capture");
const buildScriptPath = path.resolve(process.cwd(), "scripts/build-macos-helper.sh");
let helperPathsCache = null;
let scCapturePermanentlyDisabled = false;

function execFileAsync(file, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { encoding: "utf8", ...options }, (error, stdout, stderr) => {
      if (error) {
        const err = new Error(stderr?.trim() || error.message);
        err.cause = error;
        reject(err);
        return;
      }
      resolve(stdout);
    });
  });
}

function parseBuildOutput(stdout = "") {
  const result = {};
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (!trimmed.includes("=")) continue;
    const [key, ...rest] = trimmed.split("=");
    const value = rest.join("=").trim();
    if (!value) continue;
    if (key === "virtual_display") {
      result.virtualDisplay = value;
      continue;
    }
    if (key === "sc_capture") {
      result.scCapture = value;
    }
  }
  return result;
}

export function getExistingHelperPaths() {
  const enableScreenCaptureKit = process.env.PADLINK_ENABLE_SC_CAPTURE === "1";
  return {
    virtualDisplay: existsSync(helperPath) ? helperPath : null,
    scCapture: enableScreenCaptureKit && existsSync(scCapturePath) ? scCapturePath : null
  };
}

export async function ensureVirtualDisplayHelpersBuilt() {
  if (helperPathsCache?.virtualDisplay && existsSync(helperPathsCache.virtualDisplay)) {
    return helperPathsCache;
  }

  const stdout = await execFileAsync(buildScriptPath);
  const parsed = parseBuildOutput(stdout);
  const fallback = getExistingHelperPaths();
  const enableScreenCaptureKit = process.env.PADLINK_ENABLE_SC_CAPTURE === "1";
  const resolved = {
    virtualDisplay: parsed.virtualDisplay && existsSync(parsed.virtualDisplay)
      ? parsed.virtualDisplay
      : fallback.virtualDisplay,
    scCapture: enableScreenCaptureKit
      ? ((parsed.scCapture && existsSync(parsed.scCapture))
        ? parsed.scCapture
        : fallback.scCapture)
      : null
  };

  if (!resolved.virtualDisplay) {
    throw new Error("virtual display helper build failed: missing padlink-virtual-display");
  }

  helperPathsCache = resolved;
  return resolved;
}

export async function ensureVirtualDisplayHelperBuilt() {
  const helpers = await ensureVirtualDisplayHelpersBuilt();
  return helpers.virtualDisplay;
}

export async function getCaptureBackendStatus() {
  const helpers = await ensureVirtualDisplayHelpersBuilt();
  return {
    systemScreencapture: true,
    screenCaptureKit: Boolean(helpers.scCapture),
    coreGraphicsFallback: true,
    scCapturePath: helpers.scCapture
  };
}

export function resolveScreenCaptureDisplayIndex(displays, displayId) {
  if (!Array.isArray(displays)) {
    return null;
  }
  const normalizedDisplayId = Number(displayId);
  const index = displays.findIndex((display) => Number(display?.displayId) === normalizedDisplayId);
  return index >= 0 ? index + 1 : null;
}

async function captureDisplayWithSystemScreencapture({
  displayId,
  output,
  timeoutMs
}) {
  const displays = await listDisplays();
  const displayIndex = resolveScreenCaptureDisplayIndex(displays, displayId);
  if (!displayIndex) {
    throw new Error(`display-capture failed (display ${displayId} not found for screencapture)`);
  }
  await execFileAsync("screencapture", [
    "-x",
    "-C",
    `-D${displayIndex}`,
    "-t",
    "jpg",
    output
  ], {
    timeout: timeoutMs,
    killSignal: "SIGKILL"
  });
  return {
    displayId,
    output,
    displayIndex
  };
}

export async function listDisplays() {
  const binary = await ensureVirtualDisplayHelperBuilt();
  const stdout = await execFileAsync(binary, ["list"]);
  return JSON.parse(stdout);
}

export async function checkAccessibilityPermission() {
  const binary = await ensureVirtualDisplayHelperBuilt();
  const stdout = await execFileAsync(binary, ["accessibility"]);
  return JSON.parse(stdout);
}

async function openSystemSettingsUrl(url) {
  await execFileAsync("open", [url], {
    timeout: 2_000,
    killSignal: "SIGKILL"
  });
  return { ok: true, url };
}

export async function openAccessibilitySettings() {
  return openSystemSettingsUrl("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility");
}

export async function openScreenRecordingSettings() {
  return openSystemSettingsUrl("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture");
}

export async function captureDisplayToFile({
  displayId,
  output,
  quality = 0.75,
  timeoutMs = 900,
  backend = "systemScreencapture"
}) {
  const helpers = await ensureVirtualDisplayHelpersBuilt();
  const scArgs = [
    `--display-id=${displayId}`,
    `--output=${output}`,
    `--quality=${quality}`
  ];
  let systemCaptureError = null;
  let scCaptureError = null;
  const allowSystemScreencapture = backend === "auto" || backend === "systemScreencapture";
  const allowScreenCaptureKit = !scCapturePermanentlyDisabled && backend === "screenCaptureKit";
  const allowCoreGraphics = backend === "auto" || backend === "coreGraphics";

  if (allowSystemScreencapture) {
    try {
      const systemStdout = await captureDisplayWithSystemScreencapture({
        displayId,
        output,
        timeoutMs
      });
      return {
        ...systemStdout,
        backend: "systemScreencapture"
      };
    } catch (error) {
      systemCaptureError = error;
    }
  }

  if (allowScreenCaptureKit && helpers.scCapture) {
    try {
      const scStdout = await execFileAsync(helpers.scCapture, scArgs, {
        timeout: timeoutMs,
        killSignal: "SIGKILL"
      });
      return {
        ...JSON.parse(scStdout),
        backend: "screenCaptureKit"
      };
    } catch (error) {
      scCaptureError = error;
      scCapturePermanentlyDisabled = true;
      console.warn("[padlink] ScreenCaptureKit capture failed; disabling for this session to avoid repeated macOS permission popups.");
    }
  }

  if (backend === "screenCaptureKit" && !helpers.scCapture && !scCapturePermanentlyDisabled) {
    throw new Error("display-capture failed (screenCaptureKit helper unavailable)");
  }

  if (backend === "systemScreencapture") {
    if (systemCaptureError) throw systemCaptureError;
    throw new Error("display-capture failed (system screencapture unavailable)");
  }

  if (!allowCoreGraphics && !scCapturePermanentlyDisabled) {
    if (systemCaptureError) throw systemCaptureError;
    if (scCaptureError) throw scCaptureError;
    throw new Error("display-capture failed (coreGraphics backend disabled)");
  }

  try {
    const fallbackStdout = await execFileAsync(helpers.virtualDisplay, [
      "capture",
      `--display-id=${displayId}`,
      `--output=${output}`,
      `--quality=${quality}`
    ], {
      timeout: timeoutMs,
      killSignal: "SIGKILL"
    });
    return {
      ...JSON.parse(fallbackStdout),
      backend: "coreGraphics"
    };
  } catch (fallbackError) {
    if (systemCaptureError) {
      const systemReason = systemCaptureError instanceof Error ? systemCaptureError.message : String(systemCaptureError);
      const fallbackReason = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      throw new Error(`display-capture failed (system=${systemReason}; fallback=${fallbackReason})`);
    }
    if (scCaptureError) {
      const scReason = scCaptureError instanceof Error ? scCaptureError.message : String(scCaptureError);
      const fallbackReason = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      throw new Error(`display-capture failed (sc=${scReason}; fallback=${fallbackReason})`);
    }
    throw fallbackError;
  }
}

export async function injectDisplayInput({
  displayId,
  x,
  y,
  action = "tap"
}) {
  const binary = await ensureVirtualDisplayHelperBuilt();
  const stdout = await execFileAsync(binary, [
    "input",
    `--display-id=${displayId}`,
    `--x=${x}`,
    `--y=${y}`,
    `--action=${action}`
  ], {
    timeout: 500,
    killSignal: "SIGKILL"
  });
  return JSON.parse(stdout);
}

function killStaleHelpers() {
  return new Promise((resolve) => {
    execFile("pkill", ["-f", "padlink-virtual-display create"], { encoding: "utf8" }, () => {
      setTimeout(resolve, 1500);
    });
  });
}

function spawnVirtualDisplay(binary, args) {
  const child = spawn(binary, args, {
    stdio: ["pipe", "pipe", "pipe"]
  });

  const metadataPromise = new Promise((resolve, reject) => {
    const lineReader = readline.createInterface({ input: child.stdout });
    let stderrBuffer = "";
    const timeout = setTimeout(() => {
      lineReader.close();
      child.kill("SIGTERM");
      reject(new Error("virtual display helper timed out"));
    }, 20_000);

    child.stderr.on("data", (chunk) => {
      stderrBuffer += chunk.toString();
    });

    child.once("error", (error) => {
      clearTimeout(timeout);
      lineReader.close();
      reject(error);
    });

    lineReader.once("line", (line) => {
      clearTimeout(timeout);
      lineReader.close();
      try {
        resolve(JSON.parse(line));
      } catch (error) {
        reject(new Error(`failed to parse helper output: ${line}\n${stderrBuffer}\n${error}`));
      }
    });

    child.once("exit", (code) => {
      if (code !== null && code !== 0) {
        clearTimeout(timeout);
        lineReader.close();
        reject(new Error(`virtual display helper exited with code ${code}: ${stderrBuffer.trim()}`));
      }
    });
  });

  return { child, metadataPromise };
}

async function verifyDisplayCapture(displayId) {
  try {
    const helpers = await ensureVirtualDisplayHelpersBuilt();
    const tmpFile = `/tmp/padlink-verify-${displayId}.jpg`;
    await execFileAsync(helpers.virtualDisplay, [
      "capture", `--display-id=${displayId}`, `--output=${tmpFile}`, "--quality=0.3"
    ], { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

export async function createVirtualDisplaySession({
  width = 1920,
  height = 1080,
  refreshRate = 60,
  ppi = 110,
  hiDPI = true,
  mirror = false,
  name = `PadLink Virtual Display ${os.hostname()}`
} = {}) {
  const binary = await ensureVirtualDisplayHelperBuilt();
  const buildArgs = () => {
    const a = [
      "create",
      `--width=${width}`,
      `--height=${height}`,
      `--refresh=${refreshRate}`,
      `--name=${name}`,
      `--ppi=${ppi}`
    ];
    if (hiDPI) a.push("--hiDPI");
    if (mirror) a.push("--mirror");
    return a;
  };

  // --- Attempt 1: try to create fresh ---
  let { child, metadataPromise } = spawnVirtualDisplay(binary, buildArgs());
  let metadata;
  try {
    metadata = await metadataPromise;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("create-failed:no-display")) {
      throw error;
    }

    // --- Attempt 2: kill stale helpers to free display slots, then retry ---
    console.log("[padlink] virtual display limit reached, cleaning up stale helpers...");
    await killStaleHelpers();

    try {
      const retry = spawnVirtualDisplay(binary, buildArgs());
      child = retry.child;
      metadata = await retry.metadataPromise;
    } catch (retryError) {
      const retryMsg = retryError instanceof Error ? retryError.message : String(retryError);
      if (!retryMsg.includes("create-failed:no-display")) {
        throw retryError;
      }

      // --- Attempt 3: auto-detect any existing non-main display ---
      console.log("[padlink] still cannot create virtual display, auto-detecting existing displays...");
      const displays = await listDisplays();
      const candidates = displays.filter((d) => !d.main);
      let reusable = null;

      // prefer matching dimensions, then any non-main display
      reusable = candidates.find((d) => d.width === width && d.height === height);
      if (!reusable && candidates.length > 0) {
        reusable = candidates[0];
        console.log(`[padlink] no exact size match; using display ${reusable.displayId} (${reusable.width}x${reusable.height})`);
      }

      if (!reusable) {
        throw retryError;
      }

      // verify the display actually responds to capture
      const alive = await verifyDisplayCapture(reusable.displayId);
      if (!alive) {
        console.warn(`[padlink] display ${reusable.displayId} exists but capture failed`);
        throw retryError;
      }

      console.log(`[padlink] reusing verified display id=${reusable.displayId}`);
      const mainDisplay = displays.find((d) => d.main) ?? null;
      const mirrorSourceDisplayId = mirror ? (mainDisplay?.displayId ?? null) : null;
      return {
        displayId: reusable.displayId,
        width: reusable.width,
        height: reusable.height,
        refreshRate,
        name: `Reused Display ${reusable.displayId}`,
        mirror,
        mirrorSourceDisplayId,
        captureDisplayId: mirrorSourceDisplayId ?? reusable.displayId,
        inputDisplayId: mirrorSourceDisplayId ?? reusable.displayId,
        reused: true,
        close: async () => {
          await killStaleHelpers();
        }
      };
    }
  }

  console.log(`[padlink] created fresh virtual display id=${metadata.displayId}`);
  return {
    ...metadata,
    reused: false,
    close: async () => {
      if (child.stdin && !child.stdin.destroyed) {
        child.stdin.end();
      }
      await new Promise((resolve) => {
        child.once("exit", () => resolve());
        child.kill("SIGTERM");
      });
    }
  };
}
