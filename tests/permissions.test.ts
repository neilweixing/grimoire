import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NativeSandboxExecutor } from "../apps/grimoire-agent/src/sandbox";
import {
  AuditLog,
  executionContext,
  PermissionPolicy,
  protectTool,
} from "../apps/grimoire-agent/src/permissions";

let directory: string;
let executor: NativeSandboxExecutor;
let policy: PermissionPolicy;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "grimoire-policy-"));
  executor = new NativeSandboxExecutor(join(directory, "workspace"));
  policy = new PermissionPolicy();
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));
function setup(confirm: () => Promise<boolean>) {
  const execute = vi.fn(
    async (_id: string, args: { path: string; content: string }) => {
      await executionContext.getStore()!.writeFile(args.path, args.content);
      return {
        content: [{ type: "text" as const, text: "done" }],
        details: {},
      };
    },
  );
  const tool = protectTool(
    {
      name: "write",
      label: "Write",
      description: "Fixture",
      parameters: {
        type: "object",
        properties: { path: { type: "string" }, content: { type: "string" } },
      },
      execute,
    },
    policy,
    () => executor,
    new AuditLog(join(directory, "audit.jsonl")),
  );
  const ctx = {
    hasUI: true,
    sessionManager: { getSessionId: () => "thread" },
    ui: { confirm },
  };
  const run = (
    args: { path: string; content: string },
    signal = new AbortController().signal,
  ) => tool.execute("call-1", args, signal, undefined, ctx as never);
  return { execute, run, ctx };
}
it("binds approval to a copied argument snapshot and hashes audit data", async () => {
  const args = { path: "original.txt", content: "private source" };
  const { execute, run } = setup(async () => {
    args.path = "changed.txt";
    args.content = "different";
    return true;
  });
  await run(args);
  expect(execute).toHaveBeenCalledWith(
    "call-1",
    { path: "original.txt", content: "private source" },
    expect.any(AbortSignal),
    undefined,
    expect.anything(),
  );
  expect((await executor.readFile("original.txt")).toString()).toBe(
    "private source",
  );
  const audit = readFileSync(join(directory, "audit.jsonl"), "utf8");
  expect(audit).toContain("completed");
  expect(audit).not.toContain("private source");
});
it("requires a fresh approval if the file changes while waiting", async () => {
  await executor.writeFile("file.txt", "original");
  const { execute, run } = setup(async () => {
    await executor.writeFile("file.txt", "external change");
    return true;
  });
  await expect(run({ path: "file.txt", content: "overwrite" })).rejects.toThrow(
    "file changed",
  );
  expect(execute).not.toHaveBeenCalled();
  expect((await executor.readFile("file.txt")).toString()).toBe(
    "external change",
  );
});
it("fails closed when approval UI is absent or the request is aborted", async () => {
  const { execute, run, ctx } = setup(async () => true);
  ctx.hasUI = false;
  await expect(run({ path: "file.txt", content: "code" })).rejects.toThrow(
    "Approval denied",
  );
  ctx.hasUI = true;
  const controller = new AbortController();
  controller.abort();
  await expect(
    run({ path: "file.txt", content: "code" }, controller.signal),
  ).rejects.toThrow();
  expect(execute).not.toHaveBeenCalled();
});
it("rejects execution if permissions change during approval", async () => {
  const { execute, run } = setup(async () => {
    policy.setMode("thread", "read-only");
    return true;
  });
  await expect(run({ path: "file.txt", content: "code" })).rejects.toThrow(
    "Permission mode changed",
  );
  expect(execute).not.toHaveBeenCalled();
});
it("persists read-only mode but requires full-access acknowledgement again after restart", () => {
  const path = join(directory, "permissions.json");
  const first = new PermissionPolicy(true, path);
  first.setMode("readonly-chat", "read-only");
  first.setMode("full-chat", "full", true);
  const reopened = new PermissionPolicy(true, path);
  expect(reopened.mode("readonly-chat")).toBe("read-only");
  expect(reopened.mode("full-chat")).toBe("workspace");
});
