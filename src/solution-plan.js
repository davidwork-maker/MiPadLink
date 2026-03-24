const DEFAULT_RESEARCH = Object.freeze({
  officialWirelessExtension: true,
  officialWiredExtension: false,
  freeMatureThirdPartyWired: false
});

export function recommendPath(input = {}) {
  const research = { ...DEFAULT_RESEARCH, ...(input.research ?? {}) };
  const mustBeFree = input.mustBeFree ?? true;
  const mustBeWired = input.mustBeWired ?? true;

  if (!mustBeWired) {
    return {
      path: "official_wireless",
      reason: "既然不强制有线，优先使用小米官方已确认的同网/热点扩展能力。"
    };
  }

  if (!mustBeFree && research.officialWiredExtension) {
    return {
      path: "official_wired",
      reason: "官方已支持有线扩展时，优先使用成熟官方方案。"
    };
  }

  if (!mustBeFree && research.freeMatureThirdPartyWired) {
    return {
      path: "third_party_paid_or_free",
      reason: "如果第三方成熟方案可接受，优先使用现成稳定实现。"
    };
  }

  return {
    path: "self_hosted",
    reason:
      "在当前约束下，没有找到可直接落地的官方有线方案，也没有确认成熟的免费有线第三方方案，因此收敛到自研。"
  };
}

export function buildImplementationPlan(input = {}) {
  const decision = recommendPath(input);

  return {
    title: "小米 Pad 7 通过有线连接作为 MacBook M3 扩展屏",
    decision,
    summary: [
      "先把可行性结论固定下来，再做双端实现。",
      "优先验证免费路径，不把付费工具作为主方案。",
      "自研时拆成 Mac host、Pad client、USB transport 三层。"
    ],
    phases: [
      {
        name: "Phase 0 Research Gate",
        goals: [
          "确认官方无线能力边界",
          "确认免费有线第三方是否成熟可用",
          "如果没有，锁定自研"
        ]
      },
      {
        name: "Phase 1 Host Prototype",
        goals: [
          "创建 macOS 虚拟显示器抽象",
          "打通屏幕采集与编码",
          "定义可测试的设备协议"
        ]
      },
      {
        name: "Phase 2 Pad Client",
        goals: [
          "接收视频流并全屏渲染",
          "回传触控与鼠标输入",
          "处理断线重连与横竖屏切换"
        ]
      },
      {
        name: "Phase 3 AI-Optimized Workflow",
        goals: [
          "AI 自写代码",
          "AI 自跑测试与修 bug",
          "人只做效果审核和关键决策"
        ]
      }
    ],
    testPlan: [
      "USB 连接后是否能稳定识别第二显示器。",
      "窗口拖拽、缩放、横竖屏切换是否正确。",
      "反复插拔、睡眠唤醒、长时间运行是否稳定。",
      "输入回传和画面延迟是否达到可办公水平。"
    ],
    assumptions: [
      "目标是‘真扩展屏’，不是单纯镜像。",
      "默认不接受付费工具作为首选。",
      "若虚拟显示器路径受限，则降级为窗口式第二屏或停止继续硬做。"
    ]
  };
}

export function planToMarkdown(plan) {
  const lines = [];
  lines.push(`# ${plan.title}`);
  lines.push("");
  lines.push(`**Decision:** ${plan.decision.path}`);
  lines.push("");
  lines.push("## Summary");
  for (const item of plan.summary) lines.push(`- ${item}`);
  lines.push("");
  lines.push("## Phases");
  for (const phase of plan.phases) {
    lines.push(`- ${phase.name}`);
    for (const goal of phase.goals) lines.push(`  - ${goal}`);
  }
  lines.push("");
  lines.push("## Test Plan");
  for (const test of plan.testPlan) lines.push(`- ${test}`);
  lines.push("");
  lines.push("## Assumptions");
  for (const item of plan.assumptions) lines.push(`- ${item}`);
  lines.push("");
  lines.push(`Reason: ${plan.decision.reason}`);
  return lines.join("\n");
}

