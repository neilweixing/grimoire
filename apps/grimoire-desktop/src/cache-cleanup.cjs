const {
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
  rmSync,
} = require("node:fs");
const { dirname } = require("node:path");
const { randomUUID } = require("node:crypto");
const DAY = 24 * 60 * 60 * 1000;

function createCacheCleanup({ clear, statePath, log = () => {} }) {
  let days = 0;
  let baselineAt;
  let lastClearedAt;
  let retryAt = 0;
  let timer;
  let pending;
  let disposed = false;
  try {
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    if (Number.isFinite(state.baselineAt) && state.baselineAt >= 0)
      baselineAt = state.baselineAt;
    if (Number.isFinite(state.lastClearedAt) && state.lastClearedAt >= 0)
      lastClearedAt = state.lastClearedAt;
  } catch (error) {
    if (error.code !== "ENOENT") log(`Cache cleanup state: ${error.message}`);
  }
  function persist() {
    mkdirSync(dirname(statePath), { recursive: true, mode: 0o700 });
    const temp = `${statePath}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temp, JSON.stringify({ baselineAt, lastClearedAt }), {
        mode: 0o600,
        flag: "wx",
      });
      renameSync(temp, statePath);
    } finally {
      rmSync(temp, { force: true });
    }
  }
  function schedule() {
    clearTimeout(timer);
    if (!days || disposed || pending) return;
    const due = (lastClearedAt ?? baselineAt) + days * DAY;
    // Long intervals must not overflow Node's approximately 24-day timer limit.
    const delay = Math.max(
      0,
      Math.min(DAY, Math.max(due, retryAt) - Date.now()),
    );
    timer = setTimeout(() => {
      if (Date.now() >= Math.max(due, retryAt)) void clearNow().catch(() => {});
      else schedule();
    }, delay);
    timer.unref?.();
  }
  function clearNow() {
    if (pending) return pending;
    pending = Promise.resolve()
      .then(clear)
      .then(() => {
        lastClearedAt = Date.now();
        baselineAt ??= lastClearedAt;
        retryAt = 0;
        persist();
      })
      .catch((error) => {
        retryAt = Date.now() + 60 * 60 * 1000;
        log(`Cache cleanup failed: ${error.message}`);
        throw error;
      })
      .finally(() => {
        pending = undefined;
        schedule();
      });
    return pending;
  }
  return {
    clearNow,
    setDays(value) {
      if (!Number.isInteger(value) || value < 0 || value > 365)
        throw new Error("Cache cleanup interval must be 0 to 365 days.");
      days = value;
      if (days && baselineAt === undefined) {
        baselineAt = Date.now();
        persist();
      }
      schedule();
    },
    dispose() {
      disposed = true;
      clearTimeout(timer);
    },
  };
}
module.exports = { createCacheCleanup };
