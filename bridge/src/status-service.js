import path from "node:path";
import fs from "node:fs";

const WEEK_MINUTES = 7 * 24 * 60;

export function chooseQuotaWindows(rateLimitResponse) {
  const byId = rateLimitResponse?.rateLimitsByLimitId;
  const snapshot = byId?.codex || rateLimitResponse?.rateLimits || null;
  if (!snapshot) return { short: null, weekly: null, planType: null };

  const windows = [snapshot.primary, snapshot.secondary]
    .filter(Boolean)
    .sort((a, b) => (a.windowDurationMins || 0) - (b.windowDurationMins || 0));

  const weekly = windows.find((window) => (window.windowDurationMins || 0) >= WEEK_MINUTES * 0.9)
    || windows.at(-1)
    || null;
  const short = windows.find((window) => window !== weekly) || null;

  return {
    short: normalizeWindow(short),
    weekly: normalizeWindow(weekly),
    planType: snapshot.planType || null,
  };
}

function normalizeWindow(window) {
  if (!window) return null;
  return {
    usedPercent: clampNumber(window.usedPercent, 0, 100),
    remainingPercent: clampNumber(100 - window.usedPercent, 0, 100),
    windowDurationMins: window.windowDurationMins ?? null,
    resetsAt: window.resetsAt ?? null,
  };
}

function clampNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(max, Math.max(min, number));
}

export function taskDisplayName(title, id, project) {
  const normalizedTitle = String(title || "")
    .replace(/\s+/g, " ")
    .trim();
  if (normalizedTitle) return normalizedTitle;

  const shortId = String(id || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 6);
  if (shortId) return `Task ${shortId}`;
  return project || "Codex task";
}

function summarizeThread(thread) {
  const waitingOn = thread.status?.activeFlags || [];
  const cwd = typeof thread.cwd === "string" ? thread.cwd : "";
  const project = path.basename(cwd) || null;
  const title = thread.name || thread.preview || project || "Codex task";
  return {
    id: thread.id,
    title,
    project,
    displayName: taskDisplayName(title, thread.id, project),
    cwd,
    waitingOn,
    updatedAt: thread.updatedAt || null,
  };
}

export function lastTaskLifecycle(lines) {
  for (let index = lines.length - 1; index >= 0; index--) {
    if (!lines[index].trim()) continue;
    try {
      const item = JSON.parse(lines[index]);
      if (item.type !== "event_msg") continue;
      const type = item.payload?.type;
      if (type === "task_started") return "active";
      // Codex records an interrupted or failed turn as turn_aborted rather than
      // task_complete. Treat it as terminal too, otherwise an aborted rollout is
      // reported as running forever because the preceding task_started wins.
      if (type === "task_complete" || type === "task_cancelled" || type === "turn_aborted") {
        return "idle";
      }
    } catch {
      // A growing JSONL file can end with a partial line. Ignore it.
    }
  }
  return null;
}

class RolloutActivityTracker {
  constructor() {
    this.cache = new Map();
  }

  isActive(filePath) {
    if (!filePath) return false;
    let size;
    try {
      size = fs.statSync(filePath).size;
    } catch {
      return false;
    }

    const cached = this.cache.get(filePath);
    if (cached?.size === size) return cached.active;

    let lifecycle = null;
    if (cached && size > cached.size) {
      lifecycle = this.#readRange(filePath, cached.size, size);
      if (!lifecycle) {
        this.cache.set(filePath, { size, active: cached.active });
        return cached.active;
      }
    } else {
      lifecycle = this.#scanBackward(filePath, size);
    }

    const active = lifecycle === "active";
    this.cache.set(filePath, { size, active });
    return active;
  }

  #readRange(filePath, start, end) {
    const length = end - start;
    if (length <= 0) return null;
    const fd = fs.openSync(filePath, "r");
    try {
      const buffer = Buffer.allocUnsafe(length);
      fs.readSync(fd, buffer, 0, length, start);
      return lastTaskLifecycle(buffer.toString("utf8").split("\n"));
    } finally {
      fs.closeSync(fd);
    }
  }

  #scanBackward(filePath, size) {
    const chunkSize = 64 * 1024;
    const fd = fs.openSync(filePath, "r");
    let position = size;
    let partialLine = "";
    try {
      while (position > 0) {
        const start = Math.max(0, position - chunkSize);
        const length = position - start;
        const buffer = Buffer.allocUnsafe(length);
        fs.readSync(fd, buffer, 0, length, start);
        const lines = (buffer.toString("utf8") + partialLine).split("\n");
        partialLine = start > 0 ? lines.shift() : "";
        const lifecycle = lastTaskLifecycle(lines);
        if (lifecycle) return lifecycle;
        position = start;
      }
      return null;
    } finally {
      fs.closeSync(fd);
    }
  }
}

export class StatusService {
  constructor(client) {
    this.client = client;
    this.activityTracker = new RolloutActivityTracker();
    this.status = {
      ok: false,
      stale: false,
      updatedAt: null,
      lastAttemptAt: null,
      quota: { short: null, weekly: null, planType: null },
      resetCredits: null,
      runningCount: 0,
      running: [],
      error: "Waiting for first refresh",
    };
    this.refreshPromise = null;
  }

  async refresh() {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.#refresh().finally(() => {
      this.refreshPromise = null;
    });
    return this.refreshPromise;
  }

  async #refresh() {
    try {
      if (!this.client.ready) await this.client.connect();

      const [rateLimits, threadsResponse] = await Promise.all([
        this.client.request("account/rateLimits/read"),
        this.client.request("thread/list", {
          limit: 30,
          sortKey: "updated_at",
          sortDirection: "desc",
          archived: false,
          useStateDbOnly: true,
        }),
      ]);

      // A separate read-only app-server instance can list Desktop threads but reports them as
      // notLoaded. Rollout lifecycle events are shared on disk, so they are the reliable source
      // for whether the Desktop app currently has an unfinished turn.
      const running = (threadsResponse?.data || [])
        .filter((thread) => this.activityTracker.isActive(thread.path))
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
        .map(summarizeThread);

      this.status = {
        ok: true,
        stale: false,
        updatedAt: new Date().toISOString(),
        lastAttemptAt: new Date().toISOString(),
        quota: chooseQuotaWindows(rateLimits),
        resetCredits: rateLimits?.rateLimitResetCredits?.availableCount ?? null,
        runningCount: running.length,
        running: running.slice(0, 4),
        error: null,
      };
    } catch (error) {
      this.status = {
        ...this.status,
        ok: false,
        stale: this.status.updatedAt !== null,
        lastAttemptAt: new Date().toISOString(),
        error: error.message,
      };
    }
    return this.status;
  }

  snapshot() {
    return this.status;
  }
}
