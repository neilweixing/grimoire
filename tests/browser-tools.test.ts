import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, expect, it, vi } from "vitest";
import { createBrowserTools } from "../apps/grimoire-agent/src/browser-tools";
import {
  AuditLog,
  PermissionPolicy,
  protectTool,
} from "../apps/grimoire-agent/src/permissions";
import { NativeSandboxExecutor } from "../apps/grimoire-agent/src/sandbox";

const directory = mkdtempSync(join(tmpdir(), "grimoire-browser-tools-"));
afterEach(() => vi.restoreAllMocks());
afterAll(() => rmSync(directory, { recursive: true, force: true }));
const require = createRequire(import.meta.url);
const {
  createBrowserAutomation,
} = require("../apps/grimoire-desktop/src/browser-tools.cjs");

it.each(["read-only", "workspace", "full"] as const)(
  "runs browser tools without approval in %s mode and hashes input in the audit log",
  async (mode) => {
    const bridge = vi.fn().mockResolvedValue({ ok: true });
    const executor = new NativeSandboxExecutor(directory);
    const policy = new PermissionPolicy(true);
    policy.setMode("chat", mode, true);
    const path = join(directory, `audit-${mode}.jsonl`);
    const audit = new AuditLog(path);
    const confirm = vi.fn().mockResolvedValue(false);
    const ctx = {
      sessionManager: { getSessionId: () => "chat" },
      hasUI: false,
      ui: { confirm },
    };
    const args = {
      url: "https://example.com/",
      snapshotId: "snapshot",
      ref: "e1",
      label: "Password",
      text: "private browser password",
    };
    for (const definition of createBrowserTools(bridge, executor.root)) {
      expect(policy.decide("chat", definition.name)).toBe("allow");
      const tool = protectTool(definition, policy, () => executor, audit);
      await tool.execute(
        definition.name,
        args,
        undefined,
        undefined,
        ctx as never,
      );
      expect(bridge).toHaveBeenLastCalledWith(
        {
          tool: definition.name,
          args,
          workspace: executor.root,
          threadId: "chat",
        },
        undefined,
      );
    }
    expect(confirm).not.toHaveBeenCalled();
    expect(bridge).toHaveBeenCalledTimes(4);
    const records = readFileSync(path, "utf8");
    expect(records).not.toContain(args.text);
    expect(records).not.toContain("approval-requested");
    expect(records.trim().split("\n")).toHaveLength(4);
    expect(policy.decide("chat", "browser_evaluate")).toBe("deny");
    expect(policy.decide("chat", "write")).toBe(
      mode === "read-only" ? "deny" : mode === "workspace" ? "ask" : "allow",
    );
  },
);

it("refuses browser requests from inactive chats, other projects, and cancelled calls", async () => {
  const navigate = vi.fn().mockReturnValue({ url: "https://example.com/" });
  const controller = createBrowserAutomation({
    getView: () => undefined,
    navigate,
    show: vi.fn(),
  });
  controller.bind({ workspace: "/project", threadId: "active" });
  const request = {
    tool: "browser_navigate",
    workspace: "/project",
    threadId: "active",
    args: { url: "https://example.com/" },
  };
  await expect(
    controller.execute({ ...request, threadId: "other" }),
  ).rejects.toThrow("active project and chat");
  await expect(
    controller.execute({ ...request, workspace: "/other" }),
  ).rejects.toThrow("active project and chat");
  await expect(
    controller.execute(request, AbortSignal.abort()),
  ).rejects.toThrow();
  expect(navigate).not.toHaveBeenCalled();
  await controller.execute(request);
  expect(navigate).toHaveBeenCalledWith("https://example.com/");
  await expect(
    controller.execute({ ...request, tool: "browser_evaluate" }),
  ).rejects.toThrow("Unknown browser tool");
});
it("does not return page content after switching away and back during a snapshot", async () => {
  let finish!: (value: unknown) => void;
  const view = {
    getVisible: () => true,
    webContents: {
      isDestroyed: () => false,
      isLoadingMainFrame: () => false,
      executeJavaScriptInIsolatedWorld: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    },
  };
  const controller = createBrowserAutomation({
    getView: () => view,
    navigate: vi.fn(),
    show: vi.fn(),
  });
  controller.bind({ workspace: "/project", threadId: "one" });
  const pending = controller.execute({
    tool: "browser_snapshot",
    args: {},
    workspace: "/project",
    threadId: "one",
  });
  controller.bind({ workspace: "/project", threadId: "two" });
  controller.bind({ workspace: "/project", threadId: "one" });
  finish({ ok: true, value: { text: "must not return" } });
  await expect(pending).rejects.toThrow("context changed");
});
it("reports certificate failures without mistaking a hidden error page for a dialog", async () => {
  const controller = createBrowserAutomation({
    getView: () => ({
      getVisible: () => false,
      webContents: {
        isDestroyed: () => false,
        isLoadingMainFrame: () => false,
      },
    }),
    getState: () => ({ error: true, errorCode: "ERR_CERT_AUTHORITY_INVALID" }),
    navigate: vi.fn(),
    show: vi.fn(),
  });
  controller.bind({ workspace: "/project", threadId: "active" });
  await expect(
    controller.execute({
      tool: "browser_snapshot",
      args: {},
      workspace: "/project",
      threadId: "active",
    }),
  ).rejects.toThrow("ERR_CERT_AUTHORITY_INVALID");
});
