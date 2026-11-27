import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
} from "node:fs";
import { dirname } from "node:path";
import { createHash } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { PermissionMode } from "@grimoire/core";
import type { SandboxExecutor } from "./sandbox.js";

export class PolicyError extends Error {}
export const executionContext = new AsyncLocalStorage<SandboxExecutor>();

export class PermissionPolicy {
  private readonly modes = new Map<string, PermissionMode>();
  constructor(
    readonly allowFullAccess = false,
    private readonly storagePath?: string,
  ) {
    if (!storagePath) return;
    try {
      const saved = JSON.parse(readFileSync(storagePath, "utf8"));
      for (const [id, mode] of Object.entries(saved))
        if (mode === "read-only" || mode === "workspace")
          this.modes.set(id, mode);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  private persist() {
    if (!this.storagePath) return;
    // Full access always requires a fresh acknowledgement after a service restart.
    const saved = Object.fromEntries(
      [...this.modes].map(([id, mode]) => [
        id,
        mode === "full" ? "workspace" : mode,
      ]),
    );
    const temp = `${this.storagePath}.tmp`;
    writeFileSync(temp, JSON.stringify(saved), { mode: 0o600 });
    renameSync(temp, this.storagePath);
  }
  mode(threadId: string): PermissionMode {
    return this.modes.get(threadId) ?? "workspace";
  }
  setMode(threadId: string, mode: PermissionMode, acknowledged = false) {
    if (mode === "full" && (!this.allowFullAccess || !acknowledged))
      throw new PolicyError(
        "Full access requires server enablement and explicit acknowledgement.",
      );
    this.modes.set(threadId, mode);
    this.persist();
  }
  forget(threadId: string) {
    this.modes.delete(threadId);
    this.persist();
  }
  decide(threadId: string, tool: string): "allow" | "ask" | "deny" {
    if (
      ![
        "read",
        "ls",
        "write",
        "edit",
        "bash",
        "powershell",
        "inspect_dataset",
        "browser_navigate",
        "browser_snapshot",
        "browser_click",
        "browser_type",
      ].includes(tool)
    )
      return "deny";
    if (
      [
        "read",
        "ls",
        "inspect_dataset",
        "browser_navigate",
        "browser_snapshot",
        "browser_click",
        "browser_type",
      ].includes(tool)
    )
      return "allow";
    if (this.mode(threadId) === "read-only") return "deny";
    return this.mode(threadId) === "full" ? "allow" : "ask";
  }
  decideExternal(
    threadId: string,
    readOnly: boolean,
  ): "allow" | "ask" | "deny" {
    if (readOnly) return "allow";
    if (this.mode(threadId) === "read-only") return "deny";
    return this.mode(threadId) === "full" ? "allow" : "ask";
  }
}

export class AuditLog {
  constructor(private readonly path: string) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  }
  record(
    threadId: string,
    toolCallId: string,
    tool: string,
    args: unknown,
    outcome: string,
  ) {
    // Store hashes rather than source code, command contents, or credentials.
    appendFileSync(
      this.path,
      JSON.stringify({
        at: new Date().toISOString(),
        threadId,
        toolCallId,
        tool,
        argsHash: createHash("sha256")
          .update(JSON.stringify(args))
          .digest("hex"),
        outcome,
      }) + "\n",
      { mode: 0o600 },
    );
  }
}

export type HostedTool = ToolDefinition<any, any, any>;
export function protectTool<T extends HostedTool>(
  tool: T,
  policy: PermissionPolicy,
  executorFor: (mode: PermissionMode) => SandboxExecutor,
  audit: AuditLog,
  checkReadPath?: (path: string) => Promise<string | undefined>,
): T {
  return {
    ...tool,
    executionMode: "sequential",
    async execute(id, originalArgs, signal, update, ctx) {
      const args = structuredClone(originalArgs);
      const threadId = ctx.sessionManager.getSessionId();
      const mode = policy.mode(threadId);
      const executor = executorFor(mode);
      const log = (outcome: string) =>
        audit.record(threadId, id, tool.name, args, outcome);
      try {
        signal?.throwIfAborted();
        const decision = policy.decide(threadId, tool.name);
        if (decision === "deny")
          throw new PolicyError(
            `Permission denied: ${tool.name} in ${mode} mode.`,
          );
        if (
          ["bash", "powershell"].includes(tool.name) &&
          !executor.shellAvailable()
        )
          throw new PolicyError(
            "The sandbox is unavailable. Command execution is disabled.",
          );
        const record =
          args && typeof args === "object"
            ? (args as Record<string, unknown>)
            : {};
        const path = typeof record.path === "string" ? record.path : undefined;
        const checkPath = async () => {
          if (
            path !== undefined &&
            !(
              checkReadPath &&
              ["read", "ls"].includes(tool.name) &&
              (await checkReadPath(path))
            )
          )
            await executor.checkPath(path!);
        };
        if (path !== undefined) await checkPath();
        const before =
          path && ["write", "edit"].includes(tool.name)
            ? await executor.fingerprint(path)
            : undefined;
        if (decision === "ask") {
          log("approval-requested");
          const approved =
            ctx.hasUI &&
            (await ctx.ui.confirm(
              "Grimoire · Approval required",
              JSON.stringify(
                { tool: tool.name, workspace: executor.root, arguments: args },
                null,
                2,
              ),
              { signal, timeout: 300_000 },
            ));
          if (!approved)
            throw new PolicyError("Approval denied, cancelled, or expired.");
          log("approved");
        }
        signal?.throwIfAborted();
        if (policy.mode(threadId) !== mode)
          throw new PolicyError("Permission mode changed. Please retry.");
        if (path !== undefined) await checkPath();
        if (
          before !== undefined &&
          before !== (await executor.fingerprint(path!))
        )
          throw new PolicyError(
            "The file changed while approval was pending. Please retry.",
          );
        const result = await executionContext.run(executor, () =>
          tool.execute(id, args, signal, update, ctx),
        );
        log("completed");
        return result;
      } catch (error) {
        log(error instanceof PolicyError ? "denied" : "failed");
        throw error;
      }
    },
  };
}
