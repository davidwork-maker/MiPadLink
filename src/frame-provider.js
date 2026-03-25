import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { captureDisplayToFile } from "./virtual-display-helper.js";

function runExecFile(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { encoding: "utf8" }, (error, _stdout, stderr) => {
      if (error) {
        const details = typeof stderr === "string" ? stderr.trim() : "";
        if (details) error.message = `${error.message}: ${details}`;
        reject(error);
        return;
      }
      resolve();
    });
  });
}

export function createStaticFrameProvider({ prefix = "host-frame" } = {}) {
  return {
    nextFrame({ seq, width, height }) {
      return {
        seq,
        width,
        height,
        payload: `${prefix}-${seq}`,
        payloadFormat: "text"
      };
    }
  };
}

export function createScreenCaptureFrameProvider({
  captureFile = path.join(os.tmpdir(), `padlink-screen-${process.pid}.jpg`),
  retryAfterMs = 2000,
  readFileFn = readFile,
  runCommand = runExecFile
} = {}) {
  let retryAt = 0;
  let lastError = null;

  return {
    async nextFrame({ seq, width, height }) {
      const now = Date.now();
      if (retryAt > now) {
        return {
          seq,
          width,
          height,
          payload: lastError ? `capture-paused:${lastError}` : "capture-paused",
          payloadFormat: "text"
        };
      }

      try {
        await runCommand("screencapture", ["-x", "-t", "jpg", captureFile]);
        const jpeg = await readFileFn(captureFile);
        return {
          seq,
          width,
          height,
          payload: jpeg.toString("base64"),
          payloadFormat: "jpeg-base64"
        };
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        retryAt = now + retryAfterMs;
        return {
          seq,
          width,
          height,
          payload: `capture-failed:${lastError}`,
          payloadFormat: "text"
        };
      }
    }
  };
}

export function createDisplayCaptureFrameProvider({
  displayId,
  captureFile = path.join(os.tmpdir(), `padlink-display-${displayId}-${process.pid}.jpg`),
  retryAfterMs = 1000,
  readFileFn = readFile,
  quality = 0.72,
  captureBackend = "systemScreencapture",
  captureDisplayFn = captureDisplayToFile
} = {}) {
  let retryAt = 0;
  let lastError = null;
  let lastPayload = null;

  return {
    async nextFrame({ seq, width, height }) {
      const now = Date.now();
      if (retryAt > now) {
        if (lastPayload) {
          return {
            seq,
            width,
            height,
            payload: lastPayload,
            payloadFormat: "jpeg-base64"
          };
        }
        return {
          seq,
          width,
          height,
          payload: lastError ? `display-capture-paused:${lastError}` : "display-capture-paused",
          payloadFormat: "text"
        };
      }

      try {
        const timeoutMs = lastPayload ? 900 : 3500;
        await captureDisplayFn({
          displayId,
          output: captureFile,
          quality,
          backend: captureBackend,
          timeoutMs
        });
        const jpeg = await readFileFn(captureFile);
        lastPayload = jpeg.toString("base64");
        retryAt = 0;
        return {
          seq,
          width,
          height,
          payload: lastPayload,
          payloadFormat: "jpeg-base64"
        };
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        retryAt = now + retryAfterMs;
        if (lastPayload) {
          return {
            seq,
            width,
            height,
            payload: lastPayload,
            payloadFormat: "jpeg-base64"
          };
        }
        return {
          seq,
          width,
          height,
          payload: `display-capture-failed:${lastError}`,
          payloadFormat: "text"
        };
      }
    }
  };
}
