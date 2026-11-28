import {
  mkdtempSync,
  writeFileSync,
  symlinkSync,
  linkSync,
  rmSync,
  readFileSync,
  existsSync,
  realpathSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NativeSandboxExecutor } from "../apps/grimoire-agent/src/sandbox";
import { PermissionPolicy } from "../apps/grimoire-agent/src/permissions";

let directory: string;
let executor: NativeSandboxExecutor;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "grimoire-sandbox-"));
  executor = new NativeSandboxExecutor(join(directory, "workspace"));
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});
it.each([false, true])(
  "keeps command caches and temporary files outside the project (full access: %s)",
  async (unrestricted) => {
    const runtime = join(directory, "shell-runtime");
    const shell = new NativeSandboxExecutor(
      executor.root,
      unrestricted,
      undefined,
      runtime,
    );
    if (!shell.shellAvailable()) return;
    let output = "";
    const result = await shell.exec(
      [
        "set -e",
        'mkdir -p "$HOME/Library/Caches"',
        'printf cached > "$HOME/Library/Caches/marker"',
        'printf temporary > "$TMPDIR/marker"',
        'printf xdg > "$XDG_CACHE_HOME/marker"',
        'printf "%s\\n" "$HOME" "$TMPDIR" "$PWD"',
      ].join("; "),
      shell.root,
      {
        onData: (chunk) => {
          output += chunk.toString();
        },
      },
    );
    expect(result.exitCode).toBe(0);
    const [home, temporary, cwd] = output.trim().split("\n");
    expect(home).toBe(join(realpathSync(runtime), "home"));
    expect(temporary).toBe(join(realpathSync(runtime), "tmp"));
    expect(cwd).toBe(shell.root);
    expect(readFileSync(join(home!, "Library/Caches/marker"), "utf8")).toBe(
      "cached",
    );
    expect(readFileSync(join(temporary!, "marker"), "utf8")).toBe("temporary");
    expect(existsSync(join(shell.root, "Library"))).toBe(false);
    expect(existsSync(join(shell.root, ".cache"))).toBe(false);
    expect(existsSync(join(shell.root, "marker"))).toBe(false);
    output = "";
    await shell.exec('cat "$HOME/Library/Caches/marker"', shell.root, {
      onData: (chunk) => {
        output += chunk.toString();
      },
    });
    expect(output).toBe("cached");
  },
);
it("blocks unapproved project-external paths and hard links", async () => {
  writeFileSync(join(directory, "outside.txt"), "private");
  symlinkSync(
    join(directory, "outside.txt"),
    join(executor.root, "symbol.txt"),
  );
  linkSync(join(directory, "outside.txt"), join(executor.root, "hard.txt"));
  for (const path of [
    "../outside.txt",
    join(directory, "outside.txt"),
    "symbol.txt",
    "hard.txt",
  ]) {
    await expect(executor.readFile(path)).rejects.toThrow();
    await expect(executor.writeFile(path, "overwrite")).rejects.toThrow();
  }
  expect(readFileSync(join(directory, "outside.txt"), "utf8")).toBe("private");
  await executor.writeFile("src/hello.ts", "export const hello = 1;");
  expect((await executor.readFile("src/hello.ts")).toString()).toContain(
    "hello",
  );
});
it("enforces file size limits", async () => {
  await expect(
    executor.writeFile("large.txt", "x".repeat(1024 * 1024 + 1)),
  ).rejects.toThrow("1 MiB");
  writeFileSync(
    join(executor.root, "huge.txt"),
    Buffer.alloc(8 * 1024 * 1024 + 1),
  );
  await expect(executor.readFile("huge.txt")).rejects.toThrow("8 MiB");
});
it("requires explicit server opt-in and acknowledgement for unsandboxed tools", () => {
  const policy = new PermissionPolicy(true);
  expect(() => policy.setMode("thread", "full")).toThrow();
  policy.setMode("thread", "full", true);
  expect(policy.decide("thread", "bash")).toBe("allow");
  expect(policy.decide("thread", "unknown")).toBe("deny");
  policy.setMode("thread", "read-only");
  expect(policy.decide("thread", "bash")).toBe("allow");
  expect(policy.decide("thread", "read")).toBe("allow");
});
it("runs commands inside the native sandbox with no service secrets or outside writes", async () => {
  if (!executor.shellAvailable()) {
    await expect(
      executor.exec("echo test", executor.root, { onData() {} }),
    ).rejects.toThrow("Sandbox unavailable");
    return;
  }
  process.env.GRIMOIRE_SANDBOX_TEST_SECRET = "do-not-forward";
  let output = "";
  try {
    const result = await executor.exec(
      "printf 'sandbox-ok'; printf '%s' \"$GRIMOIRE_SANDBOX_TEST_SECRET\"; printf allowed > allowed.txt",
      executor.root,
      {
        onData: (data) => {
          output += data.toString();
        },
      },
    );
    expect(output).toBe("sandbox-ok");
    expect(result.exitCode).toBe(0);
    expect(readFileSync(join(executor.root, "allowed.txt"), "utf8")).toBe(
      "allowed",
    );
    writeFileSync(join(directory, "outside.txt"), "private");
    output = "";
    const denied = await executor.exec(
      `cat ../outside.txt; printf hacked > ../outside.txt`,
      executor.root,
      {
        onData: (data) => {
          output += data.toString();
        },
      },
    );
    expect(denied.exitCode).not.toBe(0);
    expect(output).toContain("private");
    expect(readFileSync(join(directory, "outside.txt"), "utf8")).toBe(
      "private",
    );
    writeFileSync(join(executor.root, ".env"), "hidden-secret");
    output = "";
    const projectFile = await executor.exec(
      "cat .env; printf changed > .env",
      executor.root,
      {
        onData: (data) => {
          output += data.toString();
        },
      },
    );
    expect(projectFile.exitCode).toBe(0);
    expect(output).toContain("hidden-secret");
    expect(readFileSync(join(executor.root, ".env"), "utf8")).toBe("changed");
  } finally {
    delete process.env.GRIMOIRE_SANDBOX_TEST_SECRET;
  }
}, 20000);

it("runs read-only sandbox commands while blocking project writes", async () => {
  const readOnly = executor.withAccess({ readOnly: true });
  if (!readOnly.shellAvailable()) return;
  writeFileSync(join(executor.root, "source.txt"), "original");
  let output = "";
  expect(
    (
      await readOnly.exec("cat source.txt", readOnly.root, {
        onData: (chunk) => {
          output += chunk.toString();
        },
      })
    ).exitCode,
  ).toBe(0);
  expect(output).toContain("original");
  const denied = await readOnly.exec(
    "printf changed > source.txt",
    readOnly.root,
    { onData() {} },
  );
  expect(denied.exitCode).not.toBe(0);
  expect(readFileSync(join(executor.root, "source.txt"), "utf8")).toBe(
    "original",
  );
  await expect(readOnly.writeFile("source.txt", "changed")).rejects.toThrow(
    "read-only",
  );
}, 20000);

it.skipIf(process.platform === "win32")(
  "rejects named pipes in unrestricted path checks before opening them",
  async () => {
    const fifo = join(directory, "pipe");
    execFileSync("mkfifo", [fifo]);
    const unrestricted = new NativeSandboxExecutor(executor.root, true);
    await expect(unrestricted.checkPath(fifo)).rejects.toThrow("Special files");
  },
);
it.skipIf(process.platform === "win32")(
  "rejects character devices even for globally allowed reads",
  async () => {
    const unrestricted = new NativeSandboxExecutor(executor.root, true);
    await expect(unrestricted.readFile("/dev/null")).rejects.toThrow(
      "Special files",
    );
  },
);
it("still permits regular external files after validating their type", async () => {
  const path = join(directory, "outside.txt");
  writeFileSync(path, "Regular file");
  const unrestricted = new NativeSandboxExecutor(executor.root, true);
  expect((await unrestricted.readFile(path)).toString()).toBe("Regular file");
});

it("inherits arbitrary process environment values in full access without a variable-name allowlist", async () => {
  vi.stubEnv(
    "GRIMOIRE_ENV_FIXTURE_ONE",
    "fixture value with spaces and $literal",
  );
  vi.stubEnv("GRIMOIRE_ENV_FIXTURE_TWO", "another-fixture-value");
  vi.stubEnv("LANG", "C");
  const full = new NativeSandboxExecutor(
    executor.root,
    true,
    undefined,
    join(directory, "full-runtime"),
  ).withAccess({});
  const read = async () => {
    let output = "";
    const result = await full.exec(
      'printf "%s|%s|%s" "$GRIMOIRE_ENV_FIXTURE_ONE" "$GRIMOIRE_ENV_FIXTURE_TWO" "$LANG"',
      full.root,
      {
        onData: (data) => {
          output += data.toString();
        },
      },
    );
    expect(result.exitCode).toBe(0);
    return output;
  };
  expect(await read()).toBe(
    "fixture value with spaces and $literal|another-fixture-value|C",
  );
  vi.stubEnv("GRIMOIRE_ENV_FIXTURE_TWO", "changed-before-next-command");
  expect(await read()).toBe(
    "fixture value with spaces and $literal|changed-before-next-command|C",
  );
});
it.each(["workspace", "read-only"] as const)(
  "does not inherit arbitrary process values in %s mode",
  async (mode) => {
    vi.stubEnv("GRIMOIRE_ENV_FIXTURE_ONE", "must-stay-in-parent");
    vi.stubEnv("GRIMOIRE_ENV_FIXTURE_TWO", "another-parent-value");
    const sandbox = new NativeSandboxExecutor(
      executor.root,
      false,
      undefined,
      join(directory, "sandbox-runtime"),
    ).withAccess({ readOnly: mode === "read-only" });
    if (!sandbox.shellAvailable()) return;
    let output = "";
    const result = await sandbox.exec(
      'printf "%s|%s" "${GRIMOIRE_ENV_FIXTURE_ONE-unset}" "${GRIMOIRE_ENV_FIXTURE_TWO-unset}"',
      sandbox.root,
      {
        onData: (data) => {
          output += data.toString();
        },
      },
    );
    expect(result.exitCode).toBe(0);
    expect(output).toBe("unset|unset");
  },
);
it("does not leak inherited values from full access into concurrent or subsequent sandbox commands", async () => {
  vi.stubEnv("GRIMOIRE_ENV_FIXTURE_ONE", "full-only-fixture");
  const sandbox = new NativeSandboxExecutor(
    executor.root,
    false,
    undefined,
    join(directory, "sandbox-runtime"),
  );
  if (!sandbox.shellAvailable()) return;
  const full = new NativeSandboxExecutor(
    executor.root,
    true,
    undefined,
    join(directory, "full-runtime"),
  );
  const read = async (target: NativeSandboxExecutor) => {
    let output = "";
    const result = await target.exec(
      'printf "%s" "${GRIMOIRE_ENV_FIXTURE_ONE-unset}"',
      target.root,
      {
        onData: (data) => {
          output += data.toString();
        },
      },
    );
    expect(result.exitCode).toBe(0);
    return output;
  };
  expect(await Promise.all([read(full), read(sandbox)])).toEqual([
    "full-only-fixture",
    "unset",
  ]);
  expect(await read(sandbox)).toBe("unset");
  expect(process.env.GRIMOIRE_ENV_FIXTURE_ONE).toBe("full-only-fixture");
});
