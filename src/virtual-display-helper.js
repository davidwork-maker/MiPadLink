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

function existingHelperPaths() {
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
  const fallback = existingHelperPaths();
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
    screenCaptureKit: Boolean(helpers.scCapture),
    coreGraphicsFallback: true,
    scCapturePath: helpers.scCapture
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

export async function captureDisplayToFile({
  displayId,
  output,
  quality = 0.75,
  timeoutMs = 900,
  backend = "coreGraphics"
}) {
  const helpers = await ensureVirtualDisplayHelpersBuilt();
  const scArgs = [
    `--display-id=${displayId}`,
    `--output=${output}`,
    `--quality=${quality}`
  ];
  let scCaptureError = null;
  const allowScreenCaptureKit = !scCapturePermanentlyDisabled && (backend === "auto" || backend === "screenCaptureKit");
  const allowCoreGraphics = backend === "auto" || backend === "coreGraphics";

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

  if (!allowCoreGraphics && !scCapturePermanentlyDisabled) {
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
  const args = [
    "create",
    `--width=${width}`,
    `--height=${height}`,
    `--refresh=${refreshRate}`,
    `--name=${name}`,
    `--ppi=${ppi}`
  ];
  if (hiDPI) args.push("--hiDPI");
  if (mirror) args.push("--mirror");

  const child = spawn(binary, args, {
    stdio: ["pipe", "pipe", "pipe"]
  });

  let metadata;
  try {
    metadata = await new Promise((resolve, reject) => {
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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("create-failed:no-display")) {
      throw error;
    }
    const displays = await listDisplays();
    const reusable = displays.find(
      (display) => !display.main && display.width === width && display.height === height
    );
    if (!reusable) {
      throw error;
    }
    return {
      displayId: reusable.displayId,
      width: reusable.width,
      height: reusable.height,
      refreshRate,
      name: `Reused Display ${reusable.displayId}`,
      reused: true,
      close: async () => {}
    };
  }

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
