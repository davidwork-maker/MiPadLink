import test from "node:test";
import assert from "node:assert/strict";
import { buildImplementationPlan, planToMarkdown, recommendPath } from "./solution-plan.js";

test("recommends self-hosted path under free wired constraints", () => {
  const decision = recommendPath({
    mustBeFree: true,
    mustBeWired: true,
    research: {
      officialWiredExtension: false,
      freeMatureThirdPartyWired: false
    }
  });

  assert.equal(decision.path, "self_hosted");
  assert.match(decision.reason, /自研/);
});

test("buildImplementationPlan contains the expected phases and tests", () => {
  const plan = buildImplementationPlan();

  assert.equal(plan.title, "小米 Pad 7 通过有线连接作为 MacBook M3 扩展屏");
  assert.equal(plan.phases.length, 4);
  assert.deepEqual(
    plan.phases.map((phase) => phase.name),
    [
      "Phase 0 Research Gate",
      "Phase 1 Host Prototype",
      "Phase 2 Pad Client",
      "Phase 3 AI-Optimized Workflow"
    ]
  );
  assert.ok(plan.testPlan.length >= 4);
  assert.ok(plan.assumptions.length >= 3);
});

test("planToMarkdown renders a readable document", () => {
  const plan = buildImplementationPlan();
  const markdown = planToMarkdown(plan);

  assert.match(markdown, /## Summary/);
  assert.match(markdown, /## Test Plan/);
  assert.match(markdown, /AI 自写代码/);
  assert.match(markdown, /Reason:/);
});
