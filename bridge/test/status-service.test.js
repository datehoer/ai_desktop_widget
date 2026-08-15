import test from "node:test";
import assert from "node:assert/strict";
import {
  chooseQuotaWindows,
  lastTaskLifecycle,
  StatusService,
  taskDisplayName,
} from "../src/status-service.js";

test("chooses the seven-day window as weekly quota", () => {
  const result = chooseQuotaWindows({
    rateLimits: {
      planType: "plus",
      primary: { usedPercent: 20, windowDurationMins: 300, resetsAt: 10 },
      secondary: { usedPercent: 65, windowDurationMins: 10080, resetsAt: 20 },
    },
  });

  assert.equal(result.planType, "plus");
  assert.equal(result.short.usedPercent, 20);
  assert.equal(result.weekly.usedPercent, 65);
  assert.equal(result.weekly.remainingPercent, 35);
});

test("detects the latest rollout task lifecycle", () => {
  const started = JSON.stringify({ type: "event_msg", payload: { type: "task_started" } });
  const completed = JSON.stringify({ type: "event_msg", payload: { type: "task_complete" } });
  const aborted = JSON.stringify({ type: "event_msg", payload: { type: "turn_aborted" } });
  const token = JSON.stringify({ type: "event_msg", payload: { type: "token_count" } });

  assert.equal(lastTaskLifecycle([completed, started, token]), "active");
  assert.equal(lastTaskLifecycle([started, token, completed]), "idle");
  assert.equal(lastTaskLifecycle([started, token, aborted]), "idle");
  assert.equal(lastTaskLifecycle([aborted, started, token]), "active");
  assert.equal(lastTaskLifecycle([token]), null);
});

test("preserves Chinese task titles for the TFT UTF-8 font", () => {
  assert.equal(taskDisplayName("开发 Codex Usage 桌面面板", "abc123", "widget"), "开发 Codex Usage 桌面面板");
  assert.equal(taskDisplayName("分析接线图片", "def456", "widget"), "分析接线图片");
});

test("builds a compact status snapshot", async () => {
  const responses = new Map([
    ["account/rateLimits/read", {
      rateLimits: {
        primary: { usedPercent: 10, windowDurationMins: 300, resetsAt: 10 },
        secondary: { usedPercent: 40, windowDurationMins: 10080, resetsAt: 20 },
      },
      rateLimitResetCredits: { availableCount: 2 },
    }],
    ["thread/list", { data: [] }],
  ]);

  const client = {
    ready: true,
    request(method) {
      return Promise.resolve(responses.get(method));
    },
  };

  const service = new StatusService(client);
  service.activityTracker = {
    isActive() { return true; },
  };
  responses.set("thread/list", {
    data: [{
      id: "one",
      name: "Build widget",
      preview: "",
      cwd: "/tmp/widget",
      path: "/tmp/rollout.jsonl",
      updatedAt: 2,
      status: { type: "notLoaded" },
    }],
  });
  const status = await service.refresh();
  assert.equal(status.ok, true);
  assert.equal(status.resetCredits, 2);
  assert.equal(status.runningCount, 1);
  assert.equal(status.running[0].title, "Build widget");
  assert.equal(status.running[0].displayName, "Build widget");
  assert.equal(status.stale, false);
});

test("preserves the last successful snapshot after a transient failure", async () => {
  let shouldFail = false;
  const client = {
    ready: true,
    request(method) {
      if (shouldFail) return Promise.reject(new Error("temporary failure"));
      if (method === "account/rateLimits/read") {
        return Promise.resolve({
          rateLimits: {
            secondary: { usedPercent: 50, windowDurationMins: 10080, resetsAt: 20 },
          },
          rateLimitResetCredits: { availableCount: 1 },
        });
      }
      return Promise.resolve({ data: [] });
    },
  };

  const service = new StatusService(client);
  const fresh = await service.refresh();
  shouldFail = true;
  const stale = await service.refresh();

  assert.equal(fresh.ok, true);
  assert.equal(stale.ok, false);
  assert.equal(stale.stale, true);
  assert.equal(stale.quota.weekly.usedPercent, 50);
  assert.equal(stale.resetCredits, 1);
  assert.equal(stale.updatedAt, fresh.updatedAt);
  assert.match(stale.error, /temporary failure/);
});
