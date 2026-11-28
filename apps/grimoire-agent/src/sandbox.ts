import {
  access,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  writeFile,
} from "node:fs/promises";
import { existsSync, realpathSync, mkdirSync, mkdtempSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import {
  SandboxManager,
  type SandboxRuntimeConfig,
} from "@anthropic-ai/sandbox-runtime";
import {
  getPowerShellConfig,
  type BashOperations,
} from "@earendil-works/pi-coding-agent";
import { PolicyError } from "./permissions.js";

export type SandboxAccess = {
  readOnly?: boolean;
  networkDomains?: string[];
  writePaths?: string[];
};

export async function canonicalPath(
  root: string,
  path: string,
): Promise<string> {
  const absolute = resolve(root, path);
  let parent = absolute;
  const missing: string[] = [];
  while (true) {
    try {
      return resolve(await realpath(parent), ...missing);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const next = dirname(parent);
      if (next === parent) throw error;
      missing.unshift(parent.slice(next.length + (next.endsWith(sep) ? 0 : 1)));
      parent = next;
    }
  }
}

const inside = (root: string, path: string) => {
  const local = relative(root, path);
  return local !== ".." && !local.startsWith(`..${sep}`) && !isAbsolute(local);
};

/** Replace this interface to delegate tools to a remote sandbox or micro-VM. */
export interface SandboxExecutor {
  readonly root: string;
  readonly kind: string;
  shellAvailable(): boolean;
  withAccess(access: SandboxAccess): SandboxExecutor;
  checkPath(path: string): Promise<string>;
  fingerprint(path: string): Promise<string>;
  readFile(path: string): Promise<Buffer>;
  writeFile(path: string, content: string): Promise<void>;
  mkdir(path: string): Promise<void>;
  access(path: string): Promise<void>;
  stat(path: string): Promise<{ isDirectory(): boolean }>;
  readdir(path: string): Promise<string[]>;
  exec: BashOperations["exec"];
}

let initialization: Promise<void> | undefined;
export class NativeSandboxExecutor implements SandboxExecutor {
  readonly root: string;
  readonly kind: string;
  readonly dependencyErrors: string[];
  private runtimeDir?: string;
  constructor(
    root: string,
    private readonly unrestricted = false,
    private readonly readOnlyPaths: () => string[] = () => [],
    runtimeDir?: string,
    private readonly accessScope: SandboxAccess = {},
  ) {
    mkdirSync(root, { recursive: true, mode: 0o700 });
    this.root = realpathSync(root);
    if (runtimeDir) {
      const candidate = resolve(runtimeDir);
      const local = relative(this.root, candidate);
      if (local === ".." || local.startsWith(`..${sep}`) || isAbsolute(local))
        this.runtimeDir = candidate;
    }
    this.kind = unrestricted ? "host" : "native";
    this.dependencyErrors = ["darwin", "linux"].includes(process.platform)
      ? SandboxManager.checkDependencies().errors
      : ["Native sandbox supports macOS and Linux only."];
  }
  shellAvailable() {
    return this.unrestricted || this.dependencyErrors.length === 0;
  }
  withAccess(access: SandboxAccess): SandboxExecutor {
    return new NativeSandboxExecutor(
      this.root,
      this.unrestricted,
      this.readOnlyPaths,
      this.runtimeDir,
      access,
    );
  }
  async checkPath(path: string): Promise<string> {
    const absolute = await canonicalPath(this.root, path);
    if (
      !this.unrestricted &&
      !inside(this.root, absolute) &&
      !this.accessScope.writePaths?.some((entry) => inside(entry, absolute))
    )
      throw new PolicyError("Path is outside the configured workspace.");
    try {
      const info = await lstat(absolute);
      if (!this.unrestricted && info.isFile() && info.nlink > 1)
        throw new PolicyError("Linked files require explicit approval.");
      if (!info.isDirectory() && !info.isFile())
        throw new PolicyError("Special files are not allowed.");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (this.unrestricted) return absolute;
    if ((await realpath(this.root)) !== this.root)
      throw new PolicyError("Workspace changed.");
    return absolute;
  }
  async fingerprint(path: string) {
    try {
      return createHash("sha256")
        .update(await this.readFile(path))
        .digest("hex");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
      throw error;
    }
  }
  async readFile(path: string) {
    const safe = await this.checkPath(path);
    const info = await lstat(safe);
    if (info.size > 8 * 1024 * 1024)
      throw new PolicyError("File exceeds the 8 MiB read limit.");
    return readFile(safe);
  }
  async writeFile(path: string, content: string) {
    if (this.accessScope.readOnly)
      throw new PolicyError("File writes are disabled in read-only mode.");
    if (Buffer.byteLength(content) > 1024 * 1024)
      throw new PolicyError("File exceeds the 1 MiB write limit.");
    const safe = await this.checkPath(path);
    await mkdir(dirname(safe), { recursive: true });
    await this.checkPath(safe);
    await writeFile(safe, content, { mode: 0o600 });
  }
  async mkdir(path: string) {
    if (this.accessScope.readOnly)
      throw new PolicyError("File writes are disabled in read-only mode.");
    await mkdir(await this.checkPath(path), { recursive: true });
  }
  async access(path: string) {
    await access(await this.checkPath(path));
  }
  async stat(path: string) {
    return lstat(await this.checkPath(path));
  }
  async readdir(path: string) {
    return readdir(await this.checkPath(path));
  }
  private shellDirectories() {
    // Development data can live inside the project; use an external temp directory then.
    this.runtimeDir ??= mkdtempSync(join(tmpdir(), "grimoire-shell-"));
    mkdirSync(this.runtimeDir, { recursive: true, mode: 0o700 });
    const root = realpathSync(this.runtimeDir);
    const local = relative(this.root, root);
    if (local !== ".." && !local.startsWith(`..${sep}`) && !isAbsolute(local))
      throw new PolicyError("Shell runtime must be outside the workspace.");
    const home = join(root, "home");
    const temporary = join(root, "tmp");
    for (const path of [
      home,
      temporary,
      join(home, ".cache"),
      join(home, ".config"),
      join(home, ".local", "share"),
      join(home, ".local", "state"),
      ...(process.platform === "win32"
        ? [join(home, "AppData", "Roaming"), join(home, "AppData", "Local")]
        : []),
    ])
      mkdirSync(path, { recursive: true, mode: 0o700 });
    return { root, home, temporary };
  }
  private config(runtimeRoot: string): SandboxRuntimeConfig {
    return {
      network: {
        allowedDomains: [],
        deniedDomains: [],
        strictAllowlist: false,
        allowLocalBinding: false,
      },
      filesystem: {
        denyRead: [],
        allowRead: [],
        allowWrite: this.accessScope.readOnly
          ? [runtimeRoot]
          : [this.root, runtimeRoot, ...(this.accessScope.writePaths ?? [])],
        denyWrite: this.accessScope.readOnly ? [this.root] : [],
      },
    };
  }
  exec: BashOperations["exec"] = async (command, _cwd, options) => {
    options.signal?.throwIfAborted();
    if (!this.shellAvailable())
      throw new PolicyError(
        `Sandbox unavailable: ${this.dependencyErrors.join("; ")}`,
      );
    const directories = this.shellDirectories();
    const commandId = randomBytes(16).toString("base64url");
    let networkRegistered = false;
    let argv = ["/bin/bash", "--noprofile", "--norc", "-c", command];
    if (process.platform === "win32") {
      const config = getPowerShellConfig();
      argv = [config.shell, ...config.args, command];
    }
    if (!this.unrestricted) {
      initialization ??= SandboxManager.initialize(
        {
          network: {
            allowedDomains: [],
            deniedDomains: [],
            strictAllowlist: false,
          },
          filesystem: { denyRead: [], allowWrite: [], denyWrite: [] },
        },
        undefined,
        false,
      ).catch((error) => {
        initialization = undefined;
        throw error;
      });
      await initialization;
      const wrapped = await SandboxManager.wrapWithSandboxArgv(
        // SRT injects its own TMPDIR; restore the per-project temp path inside the sandbox.
        `export TMPDIR="$TEMP"\n${command}`,
        "/bin/bash",
        this.config(directories.root),
        options.signal,
        this.root,
        { commandId, commandText: command },
      );
      if (
        this.accessScope.networkDomains?.length &&
        !this.accessScope.readOnly
      ) {
        SandboxManager.registerCommandNetworkLists(commandId, {
          allowedDomains: this.accessScope.networkDomains,
        });
        networkRegistered = true;
      }
      argv = wrapped.argv;
    }
    // Never forward provider keys, proxy credentials, or the service environment.
    const env = {
      PATH: process.env.PATH || "/usr/bin:/bin",
      HOME: directories.home,
      LANG: "en_US.UTF-8",
      TMPDIR: directories.temporary,
      TEMP: directories.temporary,
      TMP: directories.temporary,
      XDG_CACHE_HOME: join(directories.home, ".cache"),
      XDG_CONFIG_HOME: join(directories.home, ".config"),
      XDG_DATA_HOME: join(directories.home, ".local", "share"),
      XDG_STATE_HOME: join(directories.home, ".local", "state"),
      ...(process.platform === "win32"
        ? {
            SystemRoot: process.env.SystemRoot,
            WINDIR: process.env.WINDIR,
            USERPROFILE: directories.home,
            APPDATA: join(directories.home, "AppData", "Roaming"),
            LOCALAPPDATA: join(directories.home, "AppData", "Local"),
          }
        : {}),
    };
    return new Promise((resolvePromise, reject) => {
      const child = spawn(argv[0]!, argv.slice(1), {
        cwd: this.root,
        env,
        detached: process.platform !== "win32",
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let finished = false;
      let outputBytes = 0;
      let outputText = "";
      const terminate = () => {
        if (child.pid) {
          if (process.platform === "win32") {
            const killer = spawn(
              "taskkill.exe",
              ["/PID", String(child.pid), "/T", "/F"],
              { stdio: "ignore", windowsHide: true, env },
            );
            killer.once("error", () => {});
            return;
          }
          try {
            process.kill(-child.pid, "SIGKILL");
          } catch {}
        }
      };
      const abort = () => terminate();
      const timeout = setTimeout(
        terminate,
        Math.min(Math.max((options.timeout ?? 60) * 1000, 1000), 120_000),
      );
      options.signal?.addEventListener("abort", abort, { once: true });
      if (options.signal?.aborted) terminate();
      const data = (chunk: Buffer) => {
        outputText = (outputText + chunk.toString()).slice(-32_000);
        const remaining = 32_000 - outputBytes;
        outputBytes += chunk.length;
        if (remaining > 0) options.onData(chunk.subarray(0, remaining));
      };
      child.stdout.on("data", data);
      child.stderr.on("data", data);
      const cleanup = () => {
        if (networkRegistered)
          SandboxManager.unregisterCommandNetworkLists(commandId);
        clearTimeout(timeout);
        options.signal?.removeEventListener("abort", abort);
        terminate();
      };
      child.once("error", (error) => {
        if (!finished) {
          finished = true;
          cleanup();
          reject(error);
        }
      });
      child.once("close", (code) => {
        if (!finished) {
          finished = true;
          cleanup();
          if (code !== 0 && !this.unrestricted) {
            const violations =
              SandboxManager.getSandboxViolationStore().getViolationsForCommand(
                commandId,
              );
            if (
              violations.length ||
              /operation not permitted|permission denied|403.*proxy|proxy.*403/i.test(
                outputText,
              )
            )
              options.onData(
                Buffer.from(
                  "\nGrimoire sandbox: project-external writes and network are blocked unless approved. Retry with explicit writePaths and/or networkDomains to request permission. Never retry a partially completed command without checking its effects.\n",
                ),
              );
          }
          resolvePromise({ exitCode: code ?? 137 });
        }
      });
    });
  };
}
