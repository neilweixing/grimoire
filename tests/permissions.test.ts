import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
  realpathSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
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
    (mode) =>
      mode === "full"
        ? new NativeSandboxExecutor(executor.root, true)
        : executor,
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
  const args = {
    path: join(directory, "original.txt"),
    content: "private source",
  };
  const { execute, run } = setup(async () => {
    args.path = "changed.txt";
    args.content = "different";
    return true;
  });
  await run(args);
  expect(execute).toHaveBeenCalledWith(
    "call-1",
    {
      path: join(realpathSync(directory), "original.txt"),
      content: "private source",
    },
    expect.any(AbortSignal),
    undefined,
    expect.anything(),
  );
  expect(readFileSync(join(directory, "original.txt"), "utf8")).toBe(
    "private source",
  );
  const audit = readFileSync(join(directory, "audit.jsonl"), "utf8");
  expect(audit).toContain("completed");
  expect(audit).not.toContain("private source");
});
it("requires a fresh approval if the file changes while waiting", async () => {
  writeFileSync(join(directory, "file.txt"), "original");
  const { execute, run } = setup(async () => {
    writeFileSync(join(directory, "file.txt"), "external change");
    return true;
  });
  await expect(
    run({ path: join(directory, "file.txt"), content: "overwrite" }),
  ).rejects.toThrow("file changed");
  expect(execute).not.toHaveBeenCalled();
  expect(readFileSync(join(directory, "file.txt"), "utf8")).toBe(
    "external change",
  );
});
it("fails closed when approval UI is absent or the request is aborted", async () => {
  const { execute, run, ctx } = setup(async () => true);
  ctx.hasUI = false;
  await expect(
    run({ path: join(directory, "file.txt"), content: "code" }),
  ).rejects.toThrow("Approval denied");
  ctx.hasUI = true;
  const controller = new AbortController();
  controller.abort();
  await expect(
    run(
      { path: join(directory, "file.txt"), content: "code" },
      controller.signal,
    ),
  ).rejects.toThrow();
  expect(execute).not.toHaveBeenCalled();
});
it("rejects execution if permissions change during approval", async () => {
  const { execute, run } = setup(async () => {
    policy.setMode("thread", "read-only");
    return true;
  });
  await expect(
    run({ path: join(directory, "file.txt"), content: "code" }),
  ).rejects.toThrow("Permission mode changed");
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

it("allows project changes by default without prompting", async () => {
  const confirm = vi.fn(async () => true);
  const { run } = setup(confirm);
  await run({ path: "project.txt", content: "local change" });
  expect(confirm).not.toHaveBeenCalled();
  expect(readFileSync(join(executor.root, "project.txt"), "utf8")).toBe(
    "local change",
  );
});
it("rejects denied project-external writes without changing the target", async () => {
  const target = join(directory, "outside.txt");
  const { run } = setup(async () => false);
  await expect(run({ path: target, content: "blocked" })).rejects.toThrow(
    "Approval denied",
  );
  expect(existsSync(target)).toBe(false);
});

function setupShell(confirm: () => Promise<boolean>) {
  const execute = vi.fn(async (_id: string, args: { command: string }) => {
    let text = "";
    const current = executionContext.getStore()!;
    const result = await current.exec(args.command, current.root, {
      onData: (chunk) => {
        text += chunk.toString();
      },
    });
    return { content: [{ type: "text" as const, text }], details: result };
  });
  const tool = protectTool(
    {
      name: "bash",
      label: "Shell",
      description: "Fixture",
      parameters: { type: "object", properties: {} },
      execute,
    },
    policy,
    (mode) =>
      mode === "full"
        ? new NativeSandboxExecutor(executor.root, true)
        : executor,
    new AuditLog(join(directory, "audit.jsonl")),
  );
  const run = (args: Record<string, unknown>) =>
    tool.execute("shell-call", args, new AbortController().signal, undefined, {
      hasUI: true,
      sessionManager: { getSessionId: () => "thread" },
      ui: { confirm },
    } as never);
  return { run, execute };
}
it("runs sandbox commands and declared or undeclared networking without approval", async () => {
  if (!executor.shellAvailable()) return;
  const confirm = vi.fn(async () => true);
  const { run } = setupShell(confirm);
  await run({ command: "printf local > local.txt" });
  expect(confirm).not.toHaveBeenCalled();
  expect(readFileSync(join(executor.root, "local.txt"), "utf8")).toBe("local");
  await run({ command: "printf approved", networkDomains: ["example.com"] });
  await run({ command: "printf legacy-network", network: true });
  expect(confirm).not.toHaveBeenCalled();
}, 20000);
it("never executes a read-only network escalation", async () => {
  if (!executor.shellAvailable()) return;
  const confirm = vi.fn(async () => false);
  const { run, execute } = setupShell(confirm);
  policy.setMode("thread", "read-only");
  await expect(
    run({ command: "printf should-not-run", networkDomains: ["example.com"] }),
  ).rejects.toThrow("Read-only");
  expect(execute).not.toHaveBeenCalled();
  expect(confirm).not.toHaveBeenCalled();
});
it("grants command writes outside the project only after approval", async () => {
  if (!executor.shellAvailable()) return;
  const target = join(directory, "outside-command.txt");
  const confirm = vi.fn(async () => true);
  const { run } = setupShell(confirm);
  await run({ command: `printf approved > '${target}'`, writePaths: [target] });
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(readFileSync(target, "utf8")).toBe("approved");
}, 20000);

it("allows acknowledged full access without per-command prompts", async () => {
  policy = new PermissionPolicy(true);
  policy.setMode("thread", "full", true);
  const target = join(directory, "full-access.txt");
  const confirm = vi.fn(async () => false);
  const { run } = setupShell(confirm);
  await run({ command: `printf full > '${target}'` });
  expect(confirm).not.toHaveBeenCalled();
  expect(readFileSync(target, "utf8")).toBe("full");
});

it
  .skipIf(process.platform === "win32")
  .each(["read-only", "workspace", "full"] as const)(
  "rejects device reads before invoking the tool in %s mode",
  async (mode) => {
    policy = new PermissionPolicy(true);
    policy.setMode("thread", mode, mode === "full");
    const execute = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "unexpected" }],
      details: {},
    }));
    const tool = protectTool(
      {
        name: "read",
        label: "Read",
        description: "Fixture",
        parameters: {
          type: "object",
          properties: { path: { type: "string" } },
        },
        execute,
      },
      policy,
      (selected) =>
        selected === "full"
          ? new NativeSandboxExecutor(executor.root, true)
          : executor,
      new AuditLog(join(directory, "audit.jsonl")),
    );
    await expect(
      tool.execute(
        "device",
        { path: "/dev/null" },
        new AbortController().signal,
        undefined,
        {
          sessionManager: { getSessionId: () => "thread" },
          hasUI: false,
        } as never,
      ),
    ).rejects.toThrow("Special files");
    expect(execute).not.toHaveBeenCalled();
  },
);

it("permits real HTTP requests without network declarations and keeps concurrent read-only commands isolated", async () => {
  if (!executor.shellAvailable()) return;
  let requests = 0;
  const server = createServer((_request, response) => {
    requests++;
    response.end("network-ok");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const port = (server.address() as { port: number }).port;
    const command = `curl --noproxy '' --fail --silent --show-error --max-time 5 http://127.0.0.1:${port}/`;
    const confirm = vi.fn(async () => false);
    const { run } = setupShell(confirm);
    const readOnly = executor.withAccess({ readOnly: true });
    let deniedText = "";
    const [allowed, denied] = await Promise.all([
      run({ command }),
      readOnly.exec(command, readOnly.root, {
        onData: (data) => {
          deniedText += data;
        },
      }),
    ]);
    expect(allowed.details.exitCode).toBe(0);
    expect(allowed.content[0].text).toContain("network-ok");
    expect(denied.exitCode, deniedText).not.toBe(0);
    expect(requests).toBe(1);
    expect(confirm).not.toHaveBeenCalled();
    const outside = join(directory, "outside-network.txt");
    await expect(
      run({
        command: `printf blocked > '${outside}'`,
        network: true,
        writePaths: [outside],
      }),
    ).rejects.toThrow("Approval denied");
    expect(existsSync(outside)).toBe(false);
    expect(confirm).toHaveBeenCalledOnce();
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 20000);
