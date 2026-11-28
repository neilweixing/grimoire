import { createRequire } from "node:module";
import { expect, it, vi } from "vitest";
const require = createRequire(import.meta.url);
const {
  createBrowserSessions,
} = require("../apps/grimoire-desktop/src/browser-sessions.cjs");
it("stops queued work from reopening a deleted browser chat and leaves the other chat active", async () => {
  const pages = new Map<string, any>();
  const sessions = createBrowserSessions((context: { threadId: string }) => {
    const page = {
      bind: vi.fn(),
      execute: vi.fn(async () => "done"),
      dispose: vi.fn(),
    };
    pages.set(context.threadId, page);
    return page;
  });
  const a = { workspace: "/project", threadId: "a" },
    b = { workspace: "/project", threadId: "b" };
  sessions.bind(a);
  sessions.bind(b);
  const queued = sessions.execute({ ...a, tool: "browser_navigate" });
  const removed = sessions.remove(a);
  await expect(queued).rejects.toThrow("deleted");
  await removed;
  expect(pages.get("a").execute).not.toHaveBeenCalled();
  expect(pages.get("a").dispose).toHaveBeenCalledOnce();
  expect(sessions.active()).toBe(pages.get("b"));
  expect(() => sessions.bind(a)).toThrow("deleted");
  expect(await sessions.execute({ ...b, tool: "browser_snapshot" })).toBe(
    "done",
  );
});
it("allows the chat to reopen if data cleanup fails", async () => {
  const create = vi.fn(() => ({
    bind: vi.fn(),
    execute: vi.fn(),
    dispose: vi.fn(),
  }));
  const sessions = createBrowserSessions(create);
  const a = { workspace: "/project", threadId: "a" };
  sessions.bind(a);
  const restore = await sessions.remove(a);
  restore();
  expect(() => sessions.bind(a)).not.toThrow();
  expect(create).toHaveBeenCalledTimes(2);
});
