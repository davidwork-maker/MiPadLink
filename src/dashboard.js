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
  .jumpbar {
    display: flex; gap: 10px; flex-wrap: wrap;
    margin-bottom: 18px;
  }
  .jumpbar .btn { box-shadow: inset 0 0 0 1px rgba(255,255,255,0.06); }
  .card {
    background: #16213e; border-radius: 12px; padding: 20px;
    border: 1px solid #0f3460;
  }
  .spotlight {
    margin-bottom: 16px;
    background: linear-gradient(135deg, #163454 0%, #1b2550 100%);
    border-color: #285c9b;
  }
  .spotlight .value { color: #f8fafc; }
  .card h2 {
    font-size: 13px; text-transform: uppercase; letter-spacing: 1px;
    color: #8892b0; margin-bottom: 14px;
  }
  .anchor-card { scroll-margin-top: 24px; }
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
  .health-list { display: grid; gap: 10px; margin-top: 10px; }
  .step-list { display: grid; gap: 10px; margin-top: 10px; }
  .test-list { display: grid; gap: 12px; margin-top: 12px; }
  .test-item {
    background: #0f1b35; border: 1px solid #1f3a68; border-radius: 12px;
    padding: 14px;
  }
  .test-item.active {
    border-color: #fbbf24;
    box-shadow: 0 0 0 1px rgba(251, 191, 36, 0.35);
  }
  .test-head {
    display: flex; align-items: center; justify-content: space-between; gap: 12px;
    margin-bottom: 8px;
  }
  .test-title { font-size: 14px; font-weight: 600; color: #fff; }
  .test-meta { font-size: 12px; color: #9fb3d9; margin-bottom: 8px; }
  .test-expected { font-size: 12px; color: #cbd5f5; margin-top: 8px; }
  .test-steps {
    padding-left: 18px; line-height: 1.7; font-size: 12px; color: #9fb3d9;
  }
  .test-footer {
    display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-top: 12px;
  }
  .pill {
    display: inline-flex; align-items: center; justify-content: center;
    min-width: 60px; padding: 4px 8px; border-radius: 999px;
    font-size: 11px; font-weight: 700;
  }
  .pill.pass { background: rgba(74, 222, 128, 0.16); color: #86efac; }
  .pill.fail { background: rgba(239, 68, 68, 0.16); color: #fca5a5; }
  .pill.todo { background: rgba(148, 163, 184, 0.16); color: #cbd5e1; }
  .pill.blocked { background: rgba(251, 191, 36, 0.16); color: #fde68a; }
  .note-input {
    width: 100%; min-height: 64px; resize: vertical;
    background: #0a0a1a; color: #e0e0e0; border: 1px solid #1f3a68;
    border-radius: 8px; padding: 10px; font-size: 12px; margin-top: 10px;
  }
  .summary-box {
    width: 100%; min-height: 120px; resize: vertical;
    background: #0a0a1a; color: #dbeafe; border: 1px solid #1f3a68;
    border-radius: 8px; padding: 10px; font-size: 12px; line-height: 1.6; margin-top: 10px;
  }
  .step-item {
    display: grid; grid-template-columns: auto 1fr; gap: 12px;
    align-items: start;
    background: #0f1b35; border: 1px solid #1f3a68; border-radius: 10px;
    padding: 12px;
  }
  .step-index {
    width: 28px; height: 28px; border-radius: 50%;
    display: inline-flex; align-items: center; justify-content: center;
    font-size: 12px; font-weight: 700; color: #fff;
    background: #334155;
  }
  .step-index.done { background: #15803d; }
  .step-index.current { background: #2563eb; }
  .step-index.todo { background: #475569; }
  .step-title { font-size: 13px; font-weight: 600; color: #fff; margin-bottom: 4px; }
  .step-detail { font-size: 12px; line-height: 1.5; color: #9fb3d9; }
  .health-item {
    background: #0f1b35; border: 1px solid #1f3a68; border-radius: 10px;
    padding: 12px;
  }
  .health-head {
    display: flex; align-items: center; justify-content: space-between; gap: 12px;
    margin-bottom: 6px;
  }
  .health-title { font-size: 13px; font-weight: 600; color: #fff; }
  .health-detail { font-size: 12px; line-height: 1.5; color: #9fb3d9; }
  .badge {
    display: inline-flex; align-items: center; justify-content: center;
    min-width: 52px; padding: 4px 8px; border-radius: 999px;
    font-size: 11px; font-weight: 600;
  }
  .badge.ok { background: rgba(74, 222, 128, 0.16); color: #86efac; }
  .badge.warn { background: rgba(251, 191, 36, 0.16); color: #fde68a; }
  .badge.info { background: rgba(59, 130, 246, 0.16); color: #93c5fd; }
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

<div class="jumpbar">
  <button class="btn primary" type="button" data-jump-target="acceptanceCard">验收测试</button>
  <button class="btn secondary" type="button" data-jump-target="guideCard">连接向导</button>
  <button class="btn secondary" type="button" data-jump-target="previewCard">实时预览</button>
</div>

<div class="card spotlight anchor-card" id="acceptanceSpotlight">
  <h2>验收入口 / Start Testing</h2>
  <div class="stat"><div class="label">现在先看这里</div><div class="value" id="acceptanceSpotlightSummary">加载中...</div></div>
  <div class="actions">
    <button class="btn primary" type="button" data-jump-target="acceptanceCard">打开验收测试</button>
    <button class="btn secondary" type="button" id="acceptanceSpotlightRecommendBtn">跳到推荐项</button>
  </div>
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
      <button class="btn secondary" id="closeDisplayBtn" type="button">关闭虚拟屏</button>
      <button class="btn danger" id="refreshDisplayBtn" type="button">重建虚拟屏</button>
    </div>
    <div class="stat" style="margin-top: 10px"><div class="label">采集速度</div><div class="value" id="capturePresetLabel">-</div></div>
    <div class="actions">
      <button class="btn secondary" data-preset="performance" type="button">性能</button>
      <button class="btn secondary" data-preset="balanced" type="button">平衡</button>
      <button class="btn secondary" data-preset="battery" type="button">省电</button>
    </div>
    <div class="actions">
      <button class="btn danger" id="shutdownHostBtn" type="button">退出服务</button>
    </div>
  </div>

  <div class="card anchor-card" id="acceptanceCard">
    <h2>验收测试 / Acceptance</h2>
    <div class="stat"><div class="label">测试摘要</div><div class="value" id="acceptanceSummary">-</div></div>
    <div class="stat"><div class="label">当前推荐</div><div class="value" id="acceptanceCurrent">-</div></div>
    <div class="actions">
      <button class="btn secondary" id="acceptancePrevBtn" type="button">上一项</button>
      <button class="btn primary" id="acceptanceRecommendBtn" type="button">跳到推荐项</button>
      <button class="btn secondary" id="acceptanceNextBtn" type="button">下一项</button>
    </div>
    <div class="actions">
      <button class="btn secondary" id="copyAcceptanceBtn" type="button">复制测试摘要</button>
      <button class="btn secondary" id="resetAcceptanceBtn" type="button">清空测试记录</button>
    </div>
    <textarea class="summary-box" id="acceptanceReport" readonly></textarea>
    <div class="test-list" id="acceptanceList"></div>
  </div>

  <div class="card">
    <h2>客户端连接 / Client</h2>
    <div class="stat"><div class="label">连接状态</div><div class="value" id="clientStatus">等待连接</div></div>
    <div class="stat"><div class="label">已推送帧数</div><div class="value" id="frameCount">0</div></div>
    <div class="stat"><div class="label">最近输入</div><div class="value" id="lastInput">-</div></div>
  </div>

  <div class="card">
    <h2>USB / ADB</h2>
    <div class="stat"><div class="label">adb 工具</div><div class="value" id="adbStatus">检测中</div></div>
    <div class="stat"><div class="label">USB 设备</div><div class="value" id="adbDevices">-</div></div>
    <div class="stat"><div class="label">端口转发</div><div class="value" id="adbReverse">-</div></div>
    <div class="actions">
      <button class="btn secondary" id="refreshUsbBtn" type="button">刷新 USB 状态</button>
      <button class="btn primary" id="repairUsbBtn" type="button">修复 USB 连接</button>
    </div>
  </div>

  <div class="card">
    <h2>首次运行检查 / Setup Check</h2>
    <div class="stat"><div class="label">推荐下一步</div><div class="value" id="healthRecommendation">-</div></div>
    <div class="health-list" id="healthList"></div>
  </div>

  <div class="card anchor-card" id="guideCard">
    <h2>连接向导 / Guided Setup</h2>
    <div class="stat"><div class="label">当前进度</div><div class="value" id="guideSummary">-</div></div>
    <div class="actions" id="guideActions"></div>
    <div class="step-list" id="guideSteps"></div>
  </div>
</div>

<div class="card anchor-card" id="previewCard" style="margin-top: 16px">
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
let lastState = null;
const ACCEPTANCE_STORAGE_KEY = 'mipadlink.acceptance.v1';
const ACCEPTANCE_FOCUS_KEY = 'mipadlink.acceptance.focus.v1';

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

function loadAcceptanceResults() {
  try {
    const raw = window.localStorage.getItem(ACCEPTANCE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveAcceptanceResults(results) {
  try {
    window.localStorage.setItem(ACCEPTANCE_STORAGE_KEY, JSON.stringify(results));
  } catch {
    // ignore storage errors
  }
}

function loadAcceptanceFocus() {
  try {
    return window.localStorage.getItem(ACCEPTANCE_FOCUS_KEY) || '';
  } catch {
    return '';
  }
}

function saveAcceptanceFocus(caseId) {
  try {
    if (!caseId) {
      window.localStorage.removeItem(ACCEPTANCE_FOCUS_KEY);
      return;
    }
    window.localStorage.setItem(ACCEPTANCE_FOCUS_KEY, caseId);
  } catch {
    // ignore storage errors
  }
}

function updateAcceptanceResult(caseId, patch) {
  const results = loadAcceptanceResults();
  results[caseId] = {
    ...(results[caseId] || {}),
    ...patch,
    updatedAt: new Date().toISOString()
  };
  saveAcceptanceResults(results);
}

function resetAcceptanceResult(caseId) {
  const results = loadAcceptanceResults();
  if (caseId) {
    delete results[caseId];
  } else {
    Object.keys(results).forEach((key) => delete results[key]);
    saveAcceptanceFocus('');
  }
  saveAcceptanceResults(results);
}

function summarizeAcceptance(checklist) {
  const results = loadAcceptanceResults();
  const cases = (checklist && checklist.cases) || [];
  let passed = 0;
  let failed = 0;
  let pending = 0;
  for (const item of cases) {
    const status = results[item.id] && results[item.id].status;
    if (status === 'pass') passed += 1;
    else if (status === 'fail') failed += 1;
    else pending += 1;
  }
  return { passed, failed, pending, total: cases.length, results };
}

function buildAcceptanceReport(data) {
  const checklist = data.acceptanceChecklist || {};
  const summary = summarizeAcceptance(checklist);
  const lines = [];
  lines.push('MiPadLink 验收测试摘要');
  lines.push('Host: ' + ((checklist.host || (data.host + ':' + data.port)) || '-'));
  lines.push('结果: 通过 ' + summary.passed + ' / 失败 ' + summary.failed + ' / 未测 ' + summary.pending);
  lines.push('');
  (checklist.cases || []).forEach((item, index) => {
    const result = summary.results[item.id] || {};
    const statusLabel = result.status === 'pass'
      ? '通过'
      : result.status === 'fail'
        ? '失败'
        : '未测';
    lines.push((index + 1) + '. ' + item.title + ' [' + statusLabel + ']');
    lines.push('   前置: ' + (item.prerequisite || '无'));
    lines.push('   期望: ' + (item.expected || '-'));
    if (result.note) {
      lines.push('   备注: ' + result.note);
    }
  });
  return lines.join('\n');
}

function getRecommendedAcceptanceCase(checklist, results) {
  const cases = (checklist && checklist.cases) || [];
  const failedReady = cases.find((item) => item.readiness === 'ready' && results[item.id]?.status === 'fail');
  if (failedReady) return failedReady;
  const readyUntested = cases.find((item) => item.readiness === 'ready' && !results[item.id]?.status);
  if (readyUntested) return readyUntested;
  const readyAny = cases.find((item) => item.readiness === 'ready');
  if (readyAny) return readyAny;
  const blockedUntested = cases.find((item) => !results[item.id]?.status);
  return blockedUntested || cases[0] || null;
}

function resolveFocusedAcceptanceCase(checklist, results) {
  const cases = (checklist && checklist.cases) || [];
  const stored = loadAcceptanceFocus();
  if (stored && cases.some((item) => item.id === stored)) {
    return stored;
  }
  const recommended = getRecommendedAcceptanceCase(checklist, results);
  return recommended ? recommended.id : '';
}

function setFocusedAcceptanceCase(caseId) {
  saveAcceptanceFocus(caseId || '');
}

function focusAcceptanceRelative(checklist, offset) {
  const cases = (checklist && checklist.cases) || [];
  if (cases.length === 0) return;
  const focusedId = resolveFocusedAcceptanceCase(checklist, loadAcceptanceResults());
  const index = Math.max(0, cases.findIndex((item) => item.id === focusedId));
  const nextIndex = Math.max(0, Math.min(cases.length - 1, index + offset));
  setFocusedAcceptanceCase(cases[nextIndex].id);
  renderAcceptanceState(lastState || {});
}

async function copyAcceptanceReport() {
  const report = $('acceptanceReport').value || '';
  if (!report) {
    addLog('当前还没有可复制的测试摘要', 'err');
    return;
  }
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(report);
    } else {
      $('acceptanceReport').focus();
      $('acceptanceReport').select();
      document.execCommand('copy');
    }
    addLog('验收测试摘要已复制', 'ok');
  } catch (error) {
    addLog(error instanceof Error ? error.message : String(error), 'err');
  }
}

function jumpToTarget(targetId) {
  const target = document.getElementById(targetId);
  if (!target) return;
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function setControlDisabled(disabled) {
  if (disabled) {
    document.querySelectorAll('.btn').forEach((button) => {
      button.disabled = true;
    });
    return;
  }
  renderControlState(lastState || {});
  renderDeviceLinkState(lastState || {});
  renderHealthState(lastState || {});
  renderGuideState(lastState || {});
  renderAcceptanceState(lastState || {});
}

function renderControlState(data) {
  const hasDisplay = Boolean(data.virtualDisplay);
  const mirrorEnabled = Boolean(data.mirrorEnabled);
  const capturePreset = data.capturePreset || 'balanced';
  $('displayMode').textContent = hasDisplay ? (mirrorEnabled ? '镜像显示' : '扩展屏') : '已关闭';
  $('capturePresetLabel').textContent = (CAPTURE_PRESET_LABELS[capturePreset] || capturePreset) + ' · ' + (data.frameIntervalMs ?? '-') + ' ms';
  $('extendModeBtn').classList.toggle('active', !mirrorEnabled);
  $('mirrorModeBtn').classList.toggle('active', mirrorEnabled);
  document.querySelectorAll('[data-preset]').forEach((button) => {
    button.classList.toggle('active', button.dataset.preset === capturePreset);
    button.disabled = controlBusy || !hasDisplay;
  });
  $('extendModeBtn').disabled = controlBusy || !hasDisplay;
  $('mirrorModeBtn').disabled = controlBusy || !hasDisplay;
  $('closeDisplayBtn').disabled = controlBusy || !hasDisplay;
  $('refreshDisplayBtn').disabled = controlBusy;
  $('shutdownHostBtn').disabled = controlBusy;
}

function renderDeviceLinkState(data) {
  const deviceLink = data.deviceLink || {};
  const authorizedDevices = Array.isArray(deviceLink.authorizedDevices) ? deviceLink.authorizedDevices.length : 0;
  const unauthorizedDevices = Array.isArray(deviceLink.unauthorizedDevices) ? deviceLink.unauthorizedDevices.length : 0;
  const totalDevices = Array.isArray(deviceLink.devices) ? deviceLink.devices.length : 0;
  const reverseTarget = deviceLink.reverseTarget || ('tcp:' + (data.port || 9009));

  if (!deviceLink.checked) {
    $('adbStatus').textContent = '检测中';
    $('adbStatus').className = 'value yellow';
    $('adbDevices').textContent = '等待 USB / adb 检查';
    $('adbDevices').className = 'value yellow';
    $('adbReverse').textContent = reverseTarget + ' · 检测中';
    $('adbReverse').className = 'value yellow';
  } else if (!deviceLink.ok) {
    $('adbStatus').textContent = '未找到 adb';
    $('adbStatus').className = 'value red';
    $('adbDevices').textContent = deviceLink.error || '请重新运行 ./start.sh';
    $('adbDevices').className = 'value red';
    $('adbReverse').textContent = '-';
    $('adbReverse').className = 'value red';
  } else {
    $('adbStatus').textContent = deviceLink.adbPath || '已就绪';
    $('adbStatus').className = 'value green';
    if (authorizedDevices > 0) {
      $('adbDevices').textContent = '已授权 ' + authorizedDevices + ' 台 / 共 ' + totalDevices + ' 台';
      $('adbDevices').className = 'value green';
    } else if (unauthorizedDevices > 0) {
      $('adbDevices').textContent = '检测到 ' + unauthorizedDevices + ' 台待授权设备';
      $('adbDevices').className = 'value yellow';
    } else {
      $('adbDevices').textContent = '还没有检测到已授权设备';
      $('adbDevices').className = 'value yellow';
    }
    $('adbReverse').textContent = reverseTarget + (deviceLink.reverseReady ? ' · 已就绪' : ' · 待修复');
    $('adbReverse').className = 'value ' + (deviceLink.reverseReady ? 'green' : 'yellow');
  }

  $('refreshUsbBtn').disabled = controlBusy;
  $('repairUsbBtn').disabled = controlBusy || !deviceLink.ok || authorizedDevices === 0;
}

function renderHealthState(data) {
  const health = data.health || {};
  $('healthRecommendation').textContent = health.recommendation || '刷新检查后会显示下一步建议';
  const list = $('healthList');
  list.innerHTML = '';
  (health.checks || []).forEach((item) => {
    const row = document.createElement('div');
    row.className = 'health-item';
    const head = document.createElement('div');
    head.className = 'health-head';

    const title = document.createElement('div');
    title.className = 'health-title';
    title.textContent = item.label || item.key || '检查项';

    const badge = document.createElement('span');
    const tone = item.tone || (item.ok ? 'ok' : 'warn');
    badge.className = 'badge ' + tone;
    badge.textContent = tone === 'ok' ? '就绪' : tone === 'info' ? '提示' : '待处理';

    head.appendChild(title);
    head.appendChild(badge);

    const detail = document.createElement('div');
    detail.className = 'health-detail';
    detail.textContent = item.detail || '-';

    row.appendChild(head);
    row.appendChild(detail);
    list.appendChild(row);
  });
}

function renderGuideState(data) {
  const guide = data.guide || {};
  $('guideSummary').textContent = guide.summary || '按顺序完成下面的步骤即可。';

  const actions = $('guideActions');
  actions.innerHTML = '';
  (guide.actions || []).forEach((item) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn ' + (item.tone === 'primary' ? 'primary' : item.tone === 'danger' ? 'danger' : 'secondary');
    button.textContent = item.label || '执行';
    button.disabled = controlBusy;
    button.addEventListener('click', () => runControl(item.action, item.payload || {}));
    actions.appendChild(button);
  });

  const steps = $('guideSteps');
  steps.innerHTML = '';
  (guide.steps || []).forEach((item, index) => {
    const row = document.createElement('div');
    row.className = 'step-item';

    const badge = document.createElement('div');
    const status = item.status || 'todo';
    badge.className = 'step-index ' + status;
    badge.textContent = status === 'done' ? 'OK' : String(index + 1);

    const body = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'step-title';
    title.textContent = item.label || ('步骤 ' + (index + 1));
    const detail = document.createElement('div');
    detail.className = 'step-detail';
    detail.textContent = item.detail || '-';

    body.appendChild(title);
    body.appendChild(detail);
    row.appendChild(badge);
    row.appendChild(body);
    steps.appendChild(row);
  });
}

function renderAcceptanceState(data) {
  const checklist = data.acceptanceChecklist || { cases: [] };
  const summary = summarizeAcceptance(checklist);
  const recommended = getRecommendedAcceptanceCase(checklist, summary.results);
  const focusedId = resolveFocusedAcceptanceCase(checklist, summary.results);
  $('acceptanceSummary').textContent = '通过 ' + summary.passed + ' / 失败 ' + summary.failed + ' / 未测 ' + summary.pending;
  $('acceptanceReport').value = buildAcceptanceReport(data);
  $('acceptanceSpotlightSummary').textContent = recommended
    ? ('推荐先测：' + recommended.title)
    : '验收测试已就绪，点“打开验收测试”开始';
  $('acceptanceCurrent').textContent = recommended
    ? ('推荐当前测试：' + recommended.title + (recommended.readiness === 'ready' ? '（现在可测）' : '（先准备前置条件）'))
    : '当前没有可显示的测试项';
  $('acceptancePrevBtn').disabled = controlBusy || checklist.cases.length === 0;
  $('acceptanceNextBtn').disabled = controlBusy || checklist.cases.length === 0;
  $('acceptanceRecommendBtn').disabled = controlBusy || !recommended;
  $('acceptanceSpotlightRecommendBtn').disabled = controlBusy || !recommended;

  const list = $('acceptanceList');
  list.innerHTML = '';
  (checklist.cases || []).forEach((item) => {
    const result = summary.results[item.id] || {};
    const row = document.createElement('div');
    row.className = 'test-item' + (item.id === focusedId ? ' active' : '');
    row.id = 'acceptance-case-' + item.id;

    const head = document.createElement('div');
    head.className = 'test-head';
    const title = document.createElement('div');
    title.className = 'test-title';
    title.textContent = item.title || item.id;
    const badges = document.createElement('div');
    badges.className = 'actions';

    const readiness = document.createElement('span');
    readiness.className = 'pill ' + (item.readiness === 'ready' ? 'pass' : 'blocked');
    readiness.textContent = item.readiness === 'ready' ? '可测试' : '待准备';
    badges.appendChild(readiness);

    const outcome = document.createElement('span');
    const status = result.status || 'todo';
    outcome.className = 'pill ' + (status === 'pass' ? 'pass' : status === 'fail' ? 'fail' : 'todo');
    outcome.textContent = status === 'pass' ? '已通过' : status === 'fail' ? '已失败' : '未记录';
    badges.appendChild(outcome);

    head.appendChild(title);
    head.appendChild(badges);
    row.appendChild(head);

    if (item.id === focusedId) {
      const current = document.createElement('div');
      current.className = 'test-meta';
      current.textContent = '当前聚焦测试';
      row.appendChild(current);
    }

    const meta = document.createElement('div');
    meta.className = 'test-meta';
    meta.textContent = '前置条件：' + (item.prerequisite || '无');
    row.appendChild(meta);

    const steps = document.createElement('ol');
    steps.className = 'test-steps';
    (item.steps || []).forEach((step) => {
      const li = document.createElement('li');
      li.textContent = step;
      steps.appendChild(li);
    });
    row.appendChild(steps);

    const expected = document.createElement('div');
    expected.className = 'test-expected';
    expected.textContent = '期望结果：' + (item.expected || '-');
    row.appendChild(expected);

    const note = document.createElement('textarea');
    note.className = 'note-input';
    note.placeholder = '记录你的观察，例如“右上角点击偏左 1cm”';
    note.value = result.note || '';
    note.addEventListener('focus', () => {
      setFocusedAcceptanceCase(item.id);
      renderAcceptanceState(lastState || {});
    });
    note.addEventListener('change', () => {
      updateAcceptanceResult(item.id, { note: note.value, status: result.status || 'todo' });
      renderAcceptanceState(lastState || {});
    });
    row.appendChild(note);

    const footer = document.createElement('div');
    footer.className = 'test-footer';

    const passBtn = document.createElement('button');
    passBtn.type = 'button';
    passBtn.className = 'btn secondary';
    passBtn.textContent = '标记通过';
    passBtn.disabled = controlBusy || item.readiness !== 'ready';
    passBtn.addEventListener('click', () => {
      setFocusedAcceptanceCase(item.id);
      updateAcceptanceResult(item.id, { status: 'pass', note: note.value });
      addLog('测试已标记为通过：' + item.title, 'ok');
      const nextRecommended = getRecommendedAcceptanceCase(checklist, loadAcceptanceResults());
      if (nextRecommended) {
        setFocusedAcceptanceCase(nextRecommended.id);
      }
      renderAcceptanceState(lastState || {});
    });
    footer.appendChild(passBtn);

    const failBtn = document.createElement('button');
    failBtn.type = 'button';
    failBtn.className = 'btn danger';
    failBtn.textContent = '标记失败';
    failBtn.disabled = controlBusy || item.readiness !== 'ready';
    failBtn.addEventListener('click', () => {
      setFocusedAcceptanceCase(item.id);
      updateAcceptanceResult(item.id, { status: 'fail', note: note.value });
      addLog('测试已标记为失败：' + item.title, 'err');
      renderAcceptanceState(lastState || {});
    });
    footer.appendChild(failBtn);

    const resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.className = 'btn secondary';
    resetBtn.textContent = '重置记录';
    resetBtn.disabled = controlBusy || !result.status;
    resetBtn.addEventListener('click', () => {
      setFocusedAcceptanceCase(item.id);
      resetAcceptanceResult(item.id);
      renderAcceptanceState(lastState || {});
    });
    footer.appendChild(resetBtn);

    row.appendChild(footer);
    list.appendChild(row);
  });
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
    } else if (action === 'closeDisplay') {
      addLog('虚拟显示器已关闭', 'ok');
    } else if (action === 'shutdownHost') {
      addLog('服务正在退出', 'ok');
    } else if (action === 'refreshChecks') {
      addLog('已刷新本机检查', 'ok');
    } else if (action === 'refreshDeviceLink') {
      addLog('已刷新 USB / adb 状态', 'ok');
    } else if (action === 'repairUsbLink') {
      addLog('已执行 USB 修复，请看上面的状态卡片', 'ok');
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
  document.querySelectorAll('[data-jump-target]').forEach((button) => {
    button.addEventListener('click', () => jumpToTarget(button.dataset.jumpTarget));
  });
  $('extendModeBtn').addEventListener('click', () => runControl('setMirror', { enabled: false }));
  $('mirrorModeBtn').addEventListener('click', () => runControl('setMirror', { enabled: true }));
  $('closeDisplayBtn').addEventListener('click', () => runControl('closeDisplay', {}));
  $('refreshDisplayBtn').addEventListener('click', () => runControl('refreshDisplay', {}));
  $('shutdownHostBtn').addEventListener('click', () => runControl('shutdownHost', {}));
  $('refreshUsbBtn').addEventListener('click', () => runControl('refreshDeviceLink', {}));
  $('repairUsbBtn').addEventListener('click', () => runControl('repairUsbLink', {}));
  $('copyAcceptanceBtn').addEventListener('click', () => copyAcceptanceReport());
  $('acceptancePrevBtn').addEventListener('click', () => focusAcceptanceRelative((lastState || {}).acceptanceChecklist || { cases: [] }, -1));
  $('acceptanceNextBtn').addEventListener('click', () => focusAcceptanceRelative((lastState || {}).acceptanceChecklist || { cases: [] }, 1));
  $('acceptanceRecommendBtn').addEventListener('click', () => {
    const checklist = (lastState || {}).acceptanceChecklist || { cases: [] };
    const recommended = getRecommendedAcceptanceCase(checklist, loadAcceptanceResults());
    if (recommended) {
      setFocusedAcceptanceCase(recommended.id);
      renderAcceptanceState(lastState || {});
      jumpToTarget('acceptanceCard');
    }
  });
  $('acceptanceSpotlightRecommendBtn').addEventListener('click', () => {
    const checklist = (lastState || {}).acceptanceChecklist || { cases: [] };
    const recommended = getRecommendedAcceptanceCase(checklist, loadAcceptanceResults());
    if (recommended) {
      setFocusedAcceptanceCase(recommended.id);
      renderAcceptanceState(lastState || {});
      jumpToTarget('acceptanceCard');
    }
  });
  $('resetAcceptanceBtn').addEventListener('click', () => {
    resetAcceptanceResult();
    renderAcceptanceState(lastState || {});
    addLog('验收测试记录已清空', 'ok');
  });
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
      lastState = data;
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
      renderDeviceLinkState(data);
      renderHealthState(data);
      renderGuideState(data);
      renderAcceptanceState(data);
      if (data.clients > 0) {
        $('clientStatus').textContent = data.clients + ' 个客户端已连接';
        $('clientStatus').className = 'value green';
      } else if (data.virtualDisplay) {
        $('clientStatus').textContent = '等待连接';
        $('clientStatus').className = 'value yellow';
      } else {
        $('clientStatus').textContent = '虚拟屏已关闭';
        $('clientStatus').className = 'value red';
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
    lastInput: null,
    deviceLink: {
      checked: false,
      ok: false,
      adbPath: null,
      devices: [],
      authorizedDevices: [],
      unauthorizedDevices: [],
      reverseMappings: [],
      reverseTarget: "tcp:9009",
      reverseReady: false,
      ready: false,
      error: null
    }
  };

  function snapshotState() {
    return {
      ...state,
      uptimeMs: Date.now() - state.startTime
    };
  }

  function broadcast() {
    const payload = JSON.stringify(snapshotState());
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

    if (req.method === "GET" && req.url === "/api/state") {
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*"
      });
      res.end(JSON.stringify(snapshotState()));
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
      const payload = JSON.stringify(snapshotState());
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
