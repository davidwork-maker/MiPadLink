import { execFile } from "node:child_process";
import net from "node:net";
import { getAdbDeviceLinkStatus, resolveAdbPath } from "./adb.js";
import { checkAccessibilityPermission, ensureVirtualDisplayHelpersBuilt, getCaptureBackendStatus, getExistingHelperPaths } from "./virtual-display-helper.js";

export { parseAdbDevicesOutput, resolveAdbPath } from "./adb.js";

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

function formatInlineError(error) {
  const message = error instanceof Error ? error.message : String(error);
  const lines = message
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const preferred = lines.find((line) => /failed|denied|not permitted|ack|timeout|unreachable|refused|http/i.test(line));
  return (preferred || lines[0] || "unknown-error").replace(/\s+/g, " ");
}

export function parseNodeMajor(version = process.version) {
  const value = String(version ?? "").trim().replace(/^v/i, "");
  const major = Number.parseInt(value.split(".")[0] ?? "", 10);
  return Number.isFinite(major) ? major : null;
}

export function isSupportedNodeVersion(version = process.version) {
  const major = parseNodeMajor(version);
  return Number.isFinite(major) && major >= 18;
}

export function checkTcpPort({
  host = "127.0.0.1",
  port,
  timeoutMs = 400
} = {}) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {
        // no-op
      }
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish({ ok: true, host, port }));
    socket.once("timeout", () => finish({ ok: false, host, port, error: "timeout" }));
    socket.once("error", (error) => finish({
      ok: false,
      host,
      port,
      error: error?.code || error?.message || "connect-failed"
    }));
  });
}

export async function fetchDashboardState({
  host = "127.0.0.1",
  port = 9010,
  fetchFn = globalThis.fetch
} = {}) {
  if (typeof fetchFn !== "function") {
    throw new Error("fetch-unavailable");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 800);
  try {
    const response = await fetchFn(`http://${host}:${port}/api/state`, {
      signal: controller.signal,
      headers: {
        Accept: "application/json"
      }
    });
    if (!response.ok) {
      throw new Error(`dashboard-http-${response.status}`);
    }
    return await response.json();
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("dashboard-timeout");
    }
    throw new Error(formatInlineError(error));
  } finally {
    clearTimeout(timeout);
  }
}

function buildNextSteps(report) {
  const steps = [];
  if (!report.node.ok) {
    steps.push("Install Node.js 18 or newer.");
  }
  if (!report.helpers.ok) {
    steps.push("Run ./scripts/build-macos-helper.sh to build the macOS helper.");
  }
  if (!report.adb.ok) {
    steps.push("Run ./start.sh start to auto-download adb, or install Android platform-tools manually.");
  } else if (report.adb.authorizedDevices.length === 0) {
    steps.push(report.adb.unauthorizedDevices.length > 0
      ? "Approve the USB debugging prompt on the tablet, then refresh the USB status."
      : "Connect the tablet over USB, enable USB debugging, and trust this Mac.");
  } else if (!report.adb.reverseReady) {
    steps.push(`Repair the USB link from the dashboard, or run adb reverse tcp:${report.port} tcp:${report.port} again.`);
  }
  if (report.accessibility.checked && !report.accessibility.ok) {
    steps.push("Grant Accessibility permission to the terminal or IDE that launches MiPadLink.");
  }
  if (!report.host.ok && !report.dashboard.ok) {
    steps.push("Run ./start.sh start to launch the host and dashboard.");
  } else if (report.host.ok && !report.dashboard.ok) {
    steps.push("Restart MiPadLink once so the dashboard can come back with the host.");
  }
  if (report.dashboard.state && !report.dashboard.state.virtualDisplay) {
    steps.push("Reconnect the Pad or rebuild the virtual display from the dashboard before dragging windows over.");
  }
  return steps;
}

export async function collectDoctorReport({
  host = "127.0.0.1",
  port = 9009,
  dashboardPort = 9010,
  buildHelpers = true,
  processVersion = process.version,
  resolveAdbPathFn = resolveAdbPath,
  execFileFn = execFileAsync,
  getAdbDeviceLinkStatusFn = getAdbDeviceLinkStatus,
  ensureVirtualDisplayHelpersBuiltFn = ensureVirtualDisplayHelpersBuilt,
  getExistingHelperPathsFn = getExistingHelperPaths,
  checkAccessibilityPermissionFn = checkAccessibilityPermission,
  getCaptureBackendStatusFn = getCaptureBackendStatus,
  checkPortFn = checkTcpPort,
  fetchDashboardStateFn = fetchDashboardState
} = {}) {
  const report = {
    listenHost: host,
    port,
    dashboardPort,
    timestamp: new Date().toISOString(),
    node: {
      version: processVersion,
      ok: isSupportedNodeVersion(processVersion),
      minimum: "18.0.0"
    },
    helpers: {
      ok: false,
      built: false,
      virtualDisplayPath: null,
      scCapturePath: null,
      error: null
    },
    capture: {
      ok: false,
      systemScreencapture: true,
      screenCaptureKit: false,
      coreGraphicsFallback: true,
      error: null
    },
    accessibility: {
      checked: false,
      ok: false,
      trusted: false,
      promptNeeded: true,
      error: null
    },
    adb: {
      ok: false,
      path: null,
      devices: [],
      authorizedDevices: [],
      unauthorizedDevices: [],
      reverseMappings: [],
      reverseTarget: `tcp:${port}`,
      reverseReady: false,
      error: null
    },
    host: {
      ok: false,
      error: null
    },
    dashboard: {
      ok: false,
      url: `http://${host}:${dashboardPort}`,
      state: null,
      error: null
    },
    nextSteps: []
  };

  try {
    const helpers = buildHelpers
      ? await ensureVirtualDisplayHelpersBuiltFn()
      : await Promise.resolve(getExistingHelperPathsFn());
    report.helpers = {
      ok: Boolean(helpers?.virtualDisplay),
      built: Boolean(helpers?.virtualDisplay),
      virtualDisplayPath: helpers?.virtualDisplay ?? null,
      scCapturePath: helpers?.scCapture ?? null,
      error: null
    };
  } catch (error) {
    report.helpers.error = formatInlineError(error);
  }

  if (report.helpers.ok) {
    try {
      const capture = await getCaptureBackendStatusFn();
      report.capture = {
        ok: true,
        systemScreencapture: Boolean(capture?.systemScreencapture),
        screenCaptureKit: Boolean(capture?.screenCaptureKit),
        coreGraphicsFallback: Boolean(capture?.coreGraphicsFallback),
        error: null
      };
    } catch (error) {
      report.capture.error = formatInlineError(error);
    }

    try {
      const accessibility = await checkAccessibilityPermissionFn();
      report.accessibility = {
        checked: true,
        ok: Boolean(accessibility?.trusted),
        trusted: Boolean(accessibility?.trusted),
        promptNeeded: Boolean(accessibility?.promptNeeded ?? !accessibility?.trusted),
        error: null
      };
    } catch (error) {
      report.accessibility.error = formatInlineError(error);
    }
  }

  try {
    const adb = await getAdbDeviceLinkStatusFn({
      port,
      resolveAdbPathFn,
      execFileFn
    });
    report.adb = {
      ok: Boolean(adb?.ok),
      path: adb?.adbPath ?? null,
      devices: Array.isArray(adb?.devices) ? adb.devices : [],
      authorizedDevices: Array.isArray(adb?.authorizedDevices) ? adb.authorizedDevices : [],
      unauthorizedDevices: Array.isArray(adb?.unauthorizedDevices) ? adb.unauthorizedDevices : [],
      reverseMappings: Array.isArray(adb?.reverseMappings) ? adb.reverseMappings : [],
      reverseTarget: adb?.reverseTarget ?? `tcp:${port}`,
      reverseReady: Boolean(adb?.reverseReady),
      error: adb?.error ? formatInlineError(adb.error) : null
    };
  } catch (error) {
    report.adb.error = formatInlineError(error);
  }

  const hostStatus = await checkPortFn({ host, port });
  report.host = {
    ok: Boolean(hostStatus?.ok),
    error: hostStatus?.ok ? null : hostStatus?.error || "not-listening"
  };

  try {
    const dashboardState = await fetchDashboardStateFn({ host, port: dashboardPort });
    report.dashboard = {
      ok: true,
      url: `http://${host}:${dashboardPort}`,
      state: dashboardState,
      error: null
    };
  } catch (error) {
    report.dashboard.error = formatInlineError(error);
  }

  report.nextSteps = buildNextSteps(report);
  return report;
}

function formatDisplayMode(state) {
  if (!state?.virtualDisplay) {
    return "virtual display closed";
  }
  return state.mirrorEnabled ? "mirror" : "extend";
}

export function formatDoctorReport(report, { compact = false } = {}) {
  const lines = [];
  const adbSummary = report.adb.ok
    ? `${report.adb.path} (${report.adb.authorizedDevices.length} ready / ${report.adb.devices.length} total, reverse=${report.adb.reverseReady ? "ok" : "missing"})`
    : `missing${report.adb.error ? `, ${report.adb.error}` : ""}`;
  const displaySummary = report.dashboard.state?.virtualDisplay
    ? `${formatDisplayMode(report.dashboard.state)} · ${report.dashboard.state.virtualDisplay.width}x${report.dashboard.state.virtualDisplay.height} · clients=${report.dashboard.state.clients}`
    : "no active virtual display";

  if (compact) {
    lines.push("MiPadLink Status");
    lines.push(`- Host: ${report.host.ok ? `running on ${report.listenHost}:${report.port}` : `stopped (${report.host.error || "not-listening"})`}`);
    lines.push(`- Dashboard: ${report.dashboard.ok ? report.dashboard.url : `stopped (${report.dashboard.error || "unreachable"})`}`);
    lines.push(`- Display: ${displaySummary}`);
    lines.push(`- adb: ${adbSummary}`);
    lines.push(`- Accessibility: ${report.accessibility.checked ? (report.accessibility.ok ? "granted" : "needs permission") : "not checked yet"}`);
    return lines.join("\n");
  }

  lines.push("MiPadLink Doctor");
  lines.push(`- Node.js: ${report.node.ok ? "OK" : "WARN"} (${report.node.version}, requires >= ${report.node.minimum})`);
  lines.push(`- macOS helper: ${report.helpers.ok ? "OK" : "WARN"}${report.helpers.virtualDisplayPath ? ` (${report.helpers.virtualDisplayPath})` : report.helpers.error ? ` (${report.helpers.error})` : ""}`);
  lines.push(`- Capture path: ${report.capture.ok ? "OK" : "WARN"} (system screencapture=${report.capture.systemScreencapture ? "yes" : "no"}, CoreGraphics fallback=${report.capture.coreGraphicsFallback ? "yes" : "no"}, ScreenCaptureKit=${report.capture.screenCaptureKit ? "yes" : "no"})`);
  lines.push(`- Accessibility: ${report.accessibility.checked ? (report.accessibility.ok ? "OK" : "WARN") : "SKIP"}${report.accessibility.error ? ` (${report.accessibility.error})` : report.accessibility.checked ? (report.accessibility.ok ? "" : " (touch input will not work until granted)") : " (helper not ready yet)"}`);
  lines.push(`- adb: ${report.adb.ok ? "OK" : "WARN"} (${adbSummary})`);
  if (report.adb.ok) {
    lines.push(`- adb reverse target: ${report.adb.reverseTarget} (${report.adb.reverseReady ? "ready" : "missing"})`);
  }
  lines.push(`- Host: ${report.host.ok ? `OK (${report.listenHost}:${report.port})` : `WARN (${report.host.error || "not listening"})`}`);
  lines.push(`- Dashboard: ${report.dashboard.ok ? `OK (${report.dashboard.url})` : `WARN (${report.dashboard.error || "unreachable"})`}`);
  lines.push(`- Display state: ${displaySummary}`);
  if (report.nextSteps.length > 0) {
    lines.push("");
    lines.push("Next steps:");
    for (const step of report.nextSteps) {
      lines.push(`- ${step}`);
    }
  }
  return lines.join("\n");
}
