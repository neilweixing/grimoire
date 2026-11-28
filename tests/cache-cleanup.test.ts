import { createRequire } from "node:module";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const require = createRequire(import.meta.url);
const {
  createCacheCleanup,
} = require("../apps/grimoire-desktop/src/cache-cleanup.cjs");
const DAY = 86400000;
let root: string;
const controllers: { dispose(): void }[] = [];
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "grimoire-cache-schedule-"));
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
});
afterEach(() => {
  controllers.splice(0).forEach((entry) => entry.dispose());
  vi.useRealTimers();
  rmSync(root, { recursive: true, force: true });
});
function fixture(clear = vi.fn(async () => {})) {
  const statePath = join(root, "cache-cleanup.json");
  const controller = createCacheCleanup({ clear, statePath });
  controllers.push(controller);
  return { controller, clear, statePath };
}
it("waits for the first seven-day interval and repeats only after success", async () => {
  const { controller, clear, statePath } = fixture();
  controller.setDays(7);
  await vi.advanceTimersByTimeAsync(7 * DAY - 1);
  expect(clear).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(clear).toHaveBeenCalledOnce();
  expect(JSON.parse(readFileSync(statePath, "utf8")).lastClearedAt).toBe(
    Date.now(),
  );
  await vi.advanceTimersByTimeAsync(7 * DAY);
  expect(clear).toHaveBeenCalledTimes(2);
});
it("keeps a disabled schedule off and still permits manual cleanup", async () => {
  const { controller, clear } = fixture();
  controller.setDays(0);
  await vi.advanceTimersByTimeAsync(30 * DAY);
  expect(clear).not.toHaveBeenCalled();
  await controller.clearNow();
  expect(clear).toHaveBeenCalledOnce();
});
it("catches up after a restart without resetting the saved baseline", async () => {
  const first = fixture();
  first.controller.setDays(7);
  await vi.advanceTimersByTimeAsync(3 * DAY);
  first.controller.dispose();
  vi.setSystemTime(Date.now() + 6 * DAY);
  const second = fixture();
  second.controller.setDays(7);
  await vi.advanceTimersByTimeAsync(0);
  expect(second.clear).toHaveBeenCalledOnce();
});
it("manual cleanup resets the automatic interval", async () => {
  const { controller, clear } = fixture();
  controller.setDays(7);
  await vi.advanceTimersByTimeAsync(6 * DAY);
  await controller.clearNow();
  await vi.advanceTimersByTimeAsync(DAY);
  expect(clear).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(6 * DAY);
  expect(clear).toHaveBeenCalledTimes(2);
});
it("retries failed cleanup after one hour without advancing the success timestamp", async () => {
  const clear = vi
    .fn()
    .mockRejectedValueOnce(new Error("busy"))
    .mockResolvedValue(undefined);
  const { controller, statePath } = fixture(clear);
  controller.setDays(1);
  await vi.advanceTimersByTimeAsync(DAY);
  expect(clear).toHaveBeenCalledOnce();
  expect(
    JSON.parse(readFileSync(statePath, "utf8")).lastClearedAt,
  ).toBeUndefined();
  await vi.advanceTimersByTimeAsync(3599999);
  expect(clear).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1);
  expect(clear).toHaveBeenCalledTimes(2);
});
it("handles long intervals without timer overflow and applies day-count changes", async () => {
  const { controller, clear } = fixture();
  controller.setDays(30);
  await vi.advanceTimersByTimeAsync(29 * DAY);
  expect(clear).not.toHaveBeenCalled();
  controller.setDays(7);
  await vi.advanceTimersByTimeAsync(0);
  expect(clear).toHaveBeenCalledOnce();
  controller.setDays(0);
  await vi.advanceTimersByTimeAsync(40 * DAY);
  expect(clear).toHaveBeenCalledOnce();
});
it("deduplicates a manual cleanup with an automatic run and stops after disposal", async () => {
  let finish!: () => void;
  const clear = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const { controller } = fixture(clear);
  controller.setDays(1);
  await vi.advanceTimersByTimeAsync(DAY);
  const manual = controller.clearNow();
  expect(clear).toHaveBeenCalledOnce();
  controller.dispose();
  finish();
  await manual;
  await vi.advanceTimersByTimeAsync(10 * DAY);
  expect(clear).toHaveBeenCalledOnce();
});
