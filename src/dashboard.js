import http from "node:http";

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MiPadLink Dashboard</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", sans-serif;
    background: #1a1a2e; color: #e0e0e0;
    min-height: 100vh; padding: 24px;
  }
  .header {
    display: flex; align-items: center; gap: 12px;
    margin-bottom: 28px;
  }
  .header h1 { font-size: 22px; font-weight: 600; color: #fff; }
  .header .dot {
    width: 10px; height: 10px; border-radius: 50%;
    background: #4ade80; box-shadow: 0 0 8px #4ade80;
    animation: pulse 2s infinite;
  }
  .header .dot.off { background: #ef4444; box-shadow: 0 0 8px #ef4444; }
  @keyframes pulse {
    0%, 100% { opacity: 1; } 50% { opacity: 0.5; }
  }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 16px; }
  .card {
    background: #16213e; border-radius: 12px; padding: 20px;
    border: 1px solid #0f3460;
  }
  .card h2 {
    font-size: 13px; text-transform: uppercase; letter-spacing: 1px;
    color: #8892b0; margin-bottom: 14px;
  }
  .stat { margin-bottom: 10px; }
  .stat .label { font-size: 12px; color: #8892b0; }
  .stat .value { font-size: 18px; font-weight: 500; color: #fff; }
  .stat .value.green { color: #4ade80; }
  .stat .value.yellow { color: #fbbf24; }
  .stat .value.red { color: #ef4444; }
  .preview-container {
    background: #0a0a1a; border-radius: 8px; padding: 8px;
    text-align: center; margin-top: 10px;
  }
  .preview-container img {
    max-width: 100%; border-radius: 4px;
    image-rendering: auto;
  }
  .preview-container .placeholder {
    color: #555; padding: 40px; font-size: 13px;
  }
  .log {
    font-family: "SF Mono", "Menlo", monospace; font-size: 11px;
    background: #0a0a1a; border-radius: 8px; padding: 12px;
    max-height: 200px; overflow-y: auto; margin-top: 10px;
    line-height: 1.6; color: #8892b0;
  }
  .log .entry { white-space: pre-wrap; word-break: break-all; }
  .log .entry.err { color: #ef4444; }
  .log .entry.ok { color: #4ade80; }
  .actions { margin-top: 16px; display: flex; gap: 8px; flex-wrap: wrap; }
  .btn {
    padding: 8px 16px; border: none; border-radius: 6px;
    font-size: 13px; cursor: pointer; font-weight: 500;
    transition: opacity 0.2s;
  }
  .btn:hover { opacity: 0.85; }
  .btn:disabled { opacity: 0.45; cursor: not-allowed; }
  .btn.active { outline: 2px solid #fbbf24; box-shadow: 0 0 0 1px rgba(251, 191, 36, 0.35); }
  .btn.primary { background: #3b82f6; color: #fff; }
  .btn.danger { background: #ef4444; color: #fff; }
  .btn.secondary { background: #334155; color: #e0e0e0; }
  .instructions {
    margin-top: 20px; background: #16213e; border-radius: 12px;
    padding: 20px; border: 1px solid #0f3460;
  }
  .instructions h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 1px; color: #8892b0; margin-bottom: 10px; }
  .instructions ol { padding-left: 20px; line-height: 2; font-size: 14px; }
  .instructions code { background: #0f3460; padding: 2px 6px; border-radius: 4px; font-size: 12px; }
</style>
</head>
<body>
<div class="header">
  <div class="dot" id="statusDot"></div>
  <h1>MiPadLink</h1>
</div>

<div class="grid">
  <div class="card">
    <h2>服务器状态 / Server</h2>
    <div class="stat"><div class="label">状态</div><div class="value green" id="serverStatus">运行中</div></div>
    <div class="stat"><div class="label">监听地址</div><div class="value" id="listenAddr">-</div></div>
    <div class="stat"><div class="label">运行时间</div><div class="value" id="uptime">-</div></div>
  </div>

  <div class="card">
    <h2>虚拟显示器 / Virtual Display</h2>
    <div class="stat"><div class="label">Display ID</div><div class="value" id="displayId">-</div></div>
    <div class="stat"><div class="label">分辨率</div><div class="value" id="displayRes">-</div></div>
    <div class="stat"><div class="label">帧率设置</div><div class="value" id="frameInterval">-</div></div>
  </div>

  <div class="card">
    <h2>控制 / Controls</h2>
    <div class="stat"><div class="label">显示模式</div><div class="value" id="displayMode">-</div></div>
    <div class="actions">
      <button class="btn secondary" id="extendModeBtn" type="button">扩展屏</button>
      <button class="btn secondary" id="mirrorModeBtn" type="button">镜像显示</button>
      <button class="btn danger" id="refreshDisplayBtn" type="button">重建虚拟屏</button>
    </div>
    <div class="stat" style="margin-top: 10px"><div class="label">采集速度</div><div class="value" id="capturePresetLabel">-</div></div>
    <div class="actions">
      <button class="btn secondary" data-preset="performance" type="button">性能</button>
      <button class="btn secondary" data-preset="balanced" type="button">平衡</button>
      <button class="btn secondary" data-preset="battery" type="button">省电</button>
    </div>
  </div>

  <div class="card">
    <h2>客户端连接 / Client</h2>
    <div class="stat"><div class="label">连接状态</div><div class="value" id="clientStatus">等待连接</div></div>
    <div class="stat"><div class="label">已推送帧数</div><div class="value" id="frameCount">0</div></div>
    <div class="stat"><div class="label">最近输入</div><div class="value" id="lastInput">-</div></div>
  </div>
</div>

<div class="card" style="margin-top: 16px">
  <h2>实时预览 / Live Preview</h2>
  <div class="preview-container">
    <img id="previewImg" style="display:none" />
    <div class="placeholder" id="previewPlaceholder">连接客户端后显示预览</div>
  </div>
</div>

<div class="card" style="margin-top: 16px">
  <h2>日志 / Log</h2>
  <div class="log" id="logBox"></div>
</div>

<div class="instructions">
  <h2>快速使用 / Quick Start</h2>
  <ol>
    <li>用 USB 线连接 Mac 和平板</li>
    <li>运行 <code>./start.sh</code> （自动配置 adb reverse + 启动服务）</li>
    <li>在平板上打开 <b>MiPadLink</b>，地址 <code>127.0.0.1:9009</code>，点击 <b>连接 TCP</b></li>
    <li>把 Mac 上的窗口拖到右边的扩展屏</li>
    <li>双击平板预览区进入全屏</li>
  </ol>
</div>

<script>
const $ = id => document.getElementById(id);
let eventSource;
let controlBusy = false;

const CAPTURE_PRESET_LABELS = {
  performance: "性能",
  balanced: "平衡",
  battery: "省电"
};

function formatUptime(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return h + 'h ' + (m % 60) + 'm';
  if (m > 0) return m + 'm ' + (s % 60) + 's';
  return s + 's';
}

function addLog(text, type) {
  const box = $('logBox');
  const entry = document.createElement('div');
  entry.className = 'entry' + (type ? ' ' + type : '');
  entry.textContent = new Date().toLocaleTimeString() + '  ' + text;
  box.appendChild(entry);
  if (box.children.length > 200) box.removeChild(box.firstChild);
  box.scrollTop = box.scrollHeight;
}

function setControlDisabled(disabled) {
  const buttons = [
    $('extendModeBtn'),
    $('mirrorModeBtn'),
    $('refreshDisplayBtn'),
    ...document.querySelectorAll('[data-preset]')
  ];
  buttons.forEach((button) => {
    if (button) button.disabled = disabled;
  });
}

function renderControlState(data) {
  const mirrorEnabled = Boolean(data.mirrorEnabled);
  const capturePreset = data.capturePreset || 'balanced';
  $('displayMode').textContent = data.virtualDisplay ? (mirrorEnabled ? '镜像显示' : '扩展屏') : '未启用';
  $('capturePresetLabel').textContent = (CAPTURE_PRESET_LABELS[capturePreset] || capturePreset) + ' · ' + (data.frameIntervalMs ?? '-') + ' ms';
  $('extendModeBtn').classList.toggle('active', !mirrorEnabled);
  $('mirrorModeBtn').classList.toggle('active', mirrorEnabled);
  document.querySelectorAll('[data-preset]').forEach((button) => {
    button.classList.toggle('active', button.dataset.preset === capturePreset);
  });
  setControlDisabled(controlBusy || !data.virtualDisplay);
}

async function postControl(payload) {
  const response = await fetch('/api/control', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.ok === false) {
    throw new Error(result.error || 'control-request-failed:' + response.status);
  }
  return result;
}

async function runControl(action, payload) {
  if (controlBusy) return;
  controlBusy = true;
  setControlDisabled(true);
  try {
    const result = await postControl({ action, ...payload });
    if (action === 'setMirror') {
      addLog(payload.enabled ? '切换到镜像显示' : '切换到扩展屏', 'ok');
    } else if (action === 'setCapturePreset') {
      addLog('采集速度切换到 ' + (CAPTURE_PRESET_LABELS[payload.preset] || payload.preset), 'ok');
    } else if (action === 'refreshDisplay') {
      addLog('虚拟显示器已重建', 'ok');
    }
    return result;
  } catch (error) {
    addLog(error instanceof Error ? error.message : String(error), 'err');
    throw error;
  } finally {
    controlBusy = false;
    setControlDisabled(false);
  }
}

function bindControls() {
  $('extendModeBtn').addEventListener('click', () => runControl('setMirror', { enabled: false }));
  $('mirrorModeBtn').addEventListener('click', () => runControl('setMirror', { enabled: true }));
  $('refreshDisplayBtn').addEventListener('click', () => runControl('refreshDisplay', {}));
  document.querySelectorAll('[data-preset]').forEach((button) => {
    button.addEventListener('click', () => runControl('setCapturePreset', { preset: button.dataset.preset }));
  });
}

function connect() {
  eventSource = new EventSource('/events');
  eventSource.onopen = () => addLog('Dashboard connected', 'ok');
  eventSource.onerror = () => {
    $('statusDot').className = 'dot off';
    $('serverStatus').textContent = '断开';
    $('serverStatus').className = 'value red';
    addLog('Connection lost, retrying...', 'err');
  };
  eventSource.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      $('statusDot').className = 'dot';
      $('serverStatus').textContent = '运行中';
      $('serverStatus').className = 'value green';
      $('listenAddr').textContent = data.host + ':' + data.port;
      $('uptime').textContent = formatUptime(data.uptimeMs);
      if (data.virtualDisplay) {
        $('displayId').textContent = data.virtualDisplay.displayId;
        $('displayRes').textContent = data.virtualDisplay.width + ' × ' + data.virtualDisplay.height;
      } else {
        $('displayId').textContent = '-';
        $('displayRes').textContent = '-';
      }
      $('frameInterval').textContent = data.frameIntervalMs + ' ms';
      renderControlState(data);
      if (data.clients > 0) {
        $('clientStatus').textContent = data.clients + ' 个客户端已连接';
        $('clientStatus').className = 'value green';
      } else {
        $('clientStatus').textContent = '等待连接';
        $('clientStatus').className = 'value yellow';
      }
      $('frameCount').textContent = data.totalFrames;
      if (data.lastInput) {
        $('lastInput').textContent = 'x=' + data.lastInput.x?.toFixed(2) + ' y=' + data.lastInput.y?.toFixed(2);
      }
    } catch {}
  };
  eventSource.addEventListener('log', (e) => {
    try {
      const data = JSON.parse(e.data);
      addLog(data.message, data.level === 'error' ? 'err' : data.level === 'ok' ? 'ok' : '');
    } catch {}
  });
  eventSource.addEventListener('preview', (e) => {
    try {
      const data = JSON.parse(e.data);
      if (data.jpeg) {
        $('previewImg').src = 'data:image/jpeg;base64,' + data.jpeg;
        $('previewImg').style.display = 'block';
        $('previewPlaceholder').style.display = 'none';
      }
    } catch {}
  });
}

bindControls();
connect();
addLog('Dashboard loaded');
</script>
</body>
</html>`;

export function createDashboard({ port = 9010, onControl = null } = {}) {
  const clients = new Set();
  let state = {
    host: "127.0.0.1",
    port: 9009,
    startTime: Date.now(),
    virtualDisplay: null,
    frameIntervalMs: 100,
    displayCaptureQuality: 0.72,
    capturePreset: "balanced",
    mirrorEnabled: false,
    clients: 0,
    totalFrames: 0,
    lastInput: null
  };

  function broadcast() {
    const payload = JSON.stringify({
      ...state,
      uptimeMs: Date.now() - state.startTime
    });
    for (const res of clients) {
      try { res.write(`data: ${payload}\n\n`); } catch { clients.delete(res); }
    }
  }

  function broadcastLog(message, level = "info") {
    const payload = JSON.stringify({ message, level });
    for (const res of clients) {
      try { res.write(`event: log\ndata: ${payload}\n\n`); } catch { clients.delete(res); }
    }
  }

  function broadcastPreview(jpegBase64) {
    const payload = JSON.stringify({ jpeg: jpegBase64 });
    for (const res of clients) {
      try { res.write(`event: preview\ndata: ${payload}\n\n`); } catch { clients.delete(res); }
    }
  }

  const server = http.createServer((req, res) => {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
      });
      res.end();
      return;
    }

    if (req.method === "POST" && req.url === "/api/control") {
      let body = "";
      req.setEncoding("utf8");
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", async () => {
        try {
          if (typeof onControl !== "function") {
            throw new Error("controls-unavailable");
          }
          const payload = body ? JSON.parse(body) : {};
          const result = await onControl(payload);
          res.writeHead(200, {
            "Content-Type": "application/json; charset=utf-8",
            "Access-Control-Allow-Origin": "*"
          });
          res.end(JSON.stringify({ ok: true, ...(result && typeof result === "object" ? result : {}) }));
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          res.writeHead(400, {
            "Content-Type": "application/json; charset=utf-8",
            "Access-Control-Allow-Origin": "*"
          });
          res.end(JSON.stringify({ ok: false, error: reason }));
        }
      });
      return;
    }

    if (req.url === "/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "Access-Control-Allow-Origin": "*"
      });
      clients.add(res);
      // send initial state
      const payload = JSON.stringify({ ...state, uptimeMs: Date.now() - state.startTime });
      res.write(`data: ${payload}\n\n`);
      req.on("close", () => clients.delete(res));
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(DASHBOARD_HTML);
  });

  // periodic status broadcast
  const timer = setInterval(() => broadcast(), 2000);

  return {
    start: () => new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => resolve());
    }),
    updateState: (partial) => { Object.assign(state, partial); broadcast(); },
    log: broadcastLog,
    preview: broadcastPreview,
    close: () => {
      clearInterval(timer);
      for (const res of clients) { try { res.end(); } catch {} }
      clients.clear();
      return new Promise((resolve) => server.close(() => resolve()));
    }
  };
}
