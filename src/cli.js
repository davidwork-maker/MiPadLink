#!/usr/bin/env node
import { buildImplementationPlan, planToMarkdown } from "./solution-plan.js";
import { runDemoSession } from "./simulation.js";
import { runTcpDemo } from "./tcp-demo.js";
import { startHostServer } from "./host-server.js";

function parseArgs(argv) {
  const flags = new Set(argv.slice(2));
  const portArg = argv.find((value) => value.startsWith("--port="));
  const hostArg = argv.find((value) => value.startsWith("--host="));
  const frameSourceArg = argv.find((value) => value.startsWith("--frame-source="));
  const frameIntervalArg = argv.find((value) => value.startsWith("--frame-interval-ms="));
  const displayWidthArg = argv.find((value) => value.startsWith("--display-width="));
  const displayHeightArg = argv.find((value) => value.startsWith("--display-height="));
  const displayNameArg = argv.find((value) => value.startsWith("--display-name="));
  const refreshRateArg = argv.find((value) => value.startsWith("--refresh-rate="));
  const jpegQualityArg = argv.find((value) => value.startsWith("--jpeg-quality="));
  const captureBackendArg = argv.find((value) => value.startsWith("--capture-backend="));
  const backendValue = captureBackendArg ? captureBackendArg.slice("--capture-backend=".length) : "coreGraphics";
  const captureBackend = ["auto", "screenCaptureKit", "coreGraphics"].includes(backendValue)
    ? backendValue
    : "coreGraphics";

  return {
    json: flags.has("--json"),
    help: flags.has("--help") || flags.has("-h"),
    demo: flags.has("--demo-session"),
    tcpDemo: flags.has("--tcp-demo"),
    hostServer: flags.has("--host-server"),
    port: portArg ? Number(portArg.slice("--port=".length)) : 9009,
    host: hostArg ? hostArg.slice("--host=".length) : "0.0.0.0",
    frameSource: frameSourceArg ? frameSourceArg.slice("--frame-source=".length) : "screen",
    frameIntervalMs: frameIntervalArg ? Number(frameIntervalArg.slice("--frame-interval-ms=".length)) : 80,
    virtualDisplay: flags.has("--virtual-display"),
    mirrorDisplay: flags.has("--mirror-display"),
    logInput: flags.has("--log-input"),
    displayWidth: displayWidthArg ? Number(displayWidthArg.slice("--display-width=".length)) : 1600,
    displayHeight: displayHeightArg ? Number(displayHeightArg.slice("--display-height=".length)) : 900,
    displayName: displayNameArg ? displayNameArg.slice("--display-name=".length) : "PadLink Virtual Display",
    refreshRate: refreshRateArg ? Number(refreshRateArg.slice("--refresh-rate=".length)) : 60,
    jpegQuality: jpegQualityArg ? Number(jpegQualityArg.slice("--jpeg-quality=".length)) : 0.72,
    captureBackend
  };
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(
      "Usage: padlink [--json] [--demo-session] [--tcp-demo] [--host-server] [--host=0.0.0.0] [--port=9009] [--frame-source=screen|mock] [--frame-interval-ms=80]"
      + " [--virtual-display] [--mirror-display] [--display-width=1600] [--display-height=900] [--display-name=PadLink Virtual Display] [--refresh-rate=60] [--jpeg-quality=0.72] [--capture-backend=coreGraphics|screenCaptureKit|auto] [--log-input]"
    );
    process.exit(0);
  }

  if (args.demo) {
    console.log(JSON.stringify(runDemoSession(), null, 2));
    return;
  }

  if (args.tcpDemo) {
    const result = await runTcpDemo({ frames: 3 });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (args.hostServer) {
    const hostServer = await startHostServer({
      host: args.host,
      port: args.port,
      frameSource: args.frameSource,
      frameIntervalMs: args.frameIntervalMs,
      virtualDisplay: args.virtualDisplay,
      mirrorDisplay: args.mirrorDisplay,
      width: args.displayWidth,
      height: args.displayHeight,
      virtualDisplayName: args.displayName,
      refreshRate: args.refreshRate,
      displayCaptureQuality: args.jpegQuality,
      captureBackend: args.captureBackend,
      logInput: args.logInput
    });
    console.log(
      `PadLink host server running on ${hostServer.host}:${hostServer.port} (frameSource=${args.frameSource}, frameIntervalMs=${args.frameIntervalMs}, virtualDisplay=${args.virtualDisplay})`
    );
    if (hostServer.virtualDisplay) {
      console.log(
        `PadLink virtual display active: id=${hostServer.virtualDisplay.displayId} name=${hostServer.virtualDisplay.name} size=${hostServer.virtualDisplay.width}x${hostServer.virtualDisplay.height}`
      );
      console.log(`PadLink capture jpeg quality: ${args.jpegQuality}`);
      console.log(`PadLink capture backend mode: ${args.captureBackend}`);
    }
    const shutdown = async () => {
      await hostServer.close();
      process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    return;
  }

  const plan = buildImplementationPlan({
    mustBeFree: true,
    mustBeWired: true,
    research: {
      officialWirelessExtension: true,
      officialWiredExtension: false,
      freeMatureThirdPartyWired: false
    }
  });

  if (args.json) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  console.log(planToMarkdown(plan));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
