import {
  access,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  writeFile,
} from "node:fs/promises";
import { existsSync, realpathSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { tmpdir, homedir } from "node:os";
import {
  SandboxManager,
  type SandboxRuntimeConfig,
} from "@anthropic-ai/sandbox-runtime";
import {
  getPowerShellConfig,
  type BashOperations,
} from "@earendil-works/pi-coding-agent";
import { PolicyError } from "./permissions.js";

const protectedName = (original: string) => {
  const name = process.platform === "win32" ? original.toLowerCase() : original;
  return (
    [
      ".git",
      ".data",
      ".ssh",
      ".aws",
      ".codex",
      ".agents",
      ".pi",
      ".npmrc",
      ".netrc",
      "credentials.json",
    ].includes(name) ||
    name === ".env" ||
    name.startsWith(".env.") ||
    /\.(pem|key)$/i.test(name)
  );
};

/** Replace this interface to delegate tools to a remote sandbox or micro-VM. */
export interface SandboxExecutor {
  readonly root: string;
  readonly kind: string;
  shellAvailable(): boolean;
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
  constructor(
    root: string,
    private readonly unrestricted = false,
    private readonly readOnlyPaths: () => string[] = () => [],
  ) {
    mkdirSync(root, { recursive: true, mode: 0o700 });
    this.root = realpathSync(root);
    this.kind = unrestricted ? "host" : "native";
    this.dependencyErrors = ["darwin", "linux"].includes(process.platform)
      ? SandboxManager.checkDependencies().errors
      : ["Native sandbox supports macOS and Linux only."];
  }
  shellAvailable() {
    return this.unrestricted || this.dependencyErrors.length === 0;
  }
  async checkPath(path: string): Promise<string> {
    const absolute = resolve(this.root, path);
    if (this.unrestricted) return absolute;
    const local = relative(this.root, absolute);
    if (local === ".." || local.startsWith(`..${sep}`) || isAbsolute(local))
      throw new PolicyError("Path is outside the configured workspace.");
    if (local.split(sep).some(protectedName))
      throw new PolicyError("This path is protected.");
    // Refuse symlinks and hardlinks, including links pointing inside the workspace.
    let current = this.root;
    for (const part of local.split(sep).filter(Boolean)) {
      current = join(current, part);
      try {
        const info = await lstat(current);
        if (info.isSymbolicLink() || (info.isFile() && info.nlink > 1))
          throw new PolicyError(
            "Linked paths are not allowed in the workspace.",
          );
        if (!info.isDirectory() && !info.isFile())
          throw new PolicyError("Special files are not allowed.");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        break;
      }
    }
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
    if (Buffer.byteLength(content) > 1024 * 1024)
      throw new PolicyError("File exceeds the 1 MiB write limit.");
    const safe = await this.checkPath(path);
    await mkdir(dirname(safe), { recursive: true });
    await this.checkPath(safe);
    await writeFile(safe, content, { mode: 0o600 });
  }
  async mkdir(path: string) {
    await mkdir(await this.checkPath(path), { recursive: true });
  }
  async access(path: string) {
    await access(await this.checkPath(path));
  }
  async stat(path: string) {
    return lstat(await this.checkPath(path));
  }
  async readdir(path: string) {
    return (await readdir(await this.checkPath(path))).filter(
      (name) => this.unrestricted || !protectedName(name),
    );
  }
  private config(): SandboxRuntimeConfig {
    const home = homedir();
    const deny = [
      home,
      "/Users",
      "/home",
      "/root",
      "/private/tmp",
      "/tmp",
      "/private/var/folders",
      "/var/folders",
    ];
    const sensitive = [
      ".env",
      ".env.*",
      ".git",
      ".data",
      ".ssh",
      ".aws",
      ".codex",
      ".agents",
      ".pi",
      ".npmrc",
      ".netrc",
      "credentials.json",
      "*.pem",
      "*.key",
    ].map((pattern) => `${this.root}/**/${pattern}`);
    return {
      network: {
        allowedDomains: [],
        deniedDomains: [],
        strictAllowlist: true,
        allowLocalBinding: false,
      },
      filesystem: {
        denyRead: [...deny, ...sensitive],
        allowRead: [
          this.root,
          ...this.readOnlyPaths(),
          ...["/opt/homebrew", "/usr/local", dirname(process.execPath)].filter(
            existsSync,
          ),
        ],
        allowWrite: [this.root],
        denyWrite: [...sensitive, ...this.readOnlyPaths()],
      },
    };
  }
  exec: BashOperations["exec"] = async (command, _cwd, options) => {
    options.signal?.throwIfAborted();
    if (!this.shellAvailable())
      throw new PolicyError(
        `Sandbox unavailable: ${this.dependencyErrors.join("; ")}`,
      );
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
            strictAllowlist: true,
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
        command,
        "/bin/bash",
        this.config(),
        options.signal,
      );
      argv = wrapped.argv;
    }
    // Never forward provider keys, proxy credentials, or the service environment.
    const env = {
      PATH: process.env.PATH || "/usr/bin:/bin",
      HOME: this.root,
      LANG: "en_US.UTF-8",
      TMPDIR: this.unrestricted ? tmpdir() : this.root,
      ...(process.platform === "win32"
        ? {
            SystemRoot: process.env.SystemRoot,
            WINDIR: process.env.WINDIR,
            USERPROFILE: this.root,
            TEMP: tmpdir(),
            TMP: tmpdir(),
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
        const remaining = 32_000 - outputBytes;
        outputBytes += chunk.length;
        if (remaining > 0) options.onData(chunk.subarray(0, remaining));
      };
      child.stdout.on("data", data);
      child.stderr.on("data", data);
      const cleanup = () => {
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
          resolvePromise({ exitCode: code ?? 137 });
        }
      });
    });
  };
}
