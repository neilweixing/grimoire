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
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { NativeSandboxExecutor } from "../apps/grimoire-agent/src/sandbox";
import { PermissionPolicy } from "../apps/grimoire-agent/src/permissions";

let directory: string;
let executor: NativeSandboxExecutor;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "grimoire-sandbox-"));
  executor = new NativeSandboxExecutor(join(directory, "workspace"));
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));
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
it("blocks traversal, protected files, symbolic links, and hard links", async () => {
  writeFileSync(join(directory, "outside.txt"), "private");
  symlinkSync(
    join(directory, "outside.txt"),
    join(executor.root, "symbol.txt"),
  );
  linkSync(join(directory, "outside.txt"), join(executor.root, "hard.txt"));
  for (const path of [
    "../outside.txt",
    join(directory, "outside.txt"),
    ".env",
    "nested/.ssh/config",
    "nested/credentials.json",
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
  expect(policy.decide("thread", "bash")).toBe("deny");
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
    expect(output).not.toContain("private");
    expect(readFileSync(join(directory, "outside.txt"), "utf8")).toBe(
      "private",
    );
    writeFileSync(join(executor.root, ".env"), "hidden-secret");
    output = "";
    const protectedFile = await executor.exec(
      "cat .env; printf changed > .env",
      executor.root,
      {
        onData: (data) => {
          output += data.toString();
        },
      },
    );
    expect(protectedFile.exitCode).not.toBe(0);
    expect(output).not.toContain("hidden-secret");
    expect(readFileSync(join(executor.root, ".env"), "utf8")).toBe(
      "hidden-secret",
    );
  } finally {
    delete process.env.GRIMOIRE_SANDBOX_TEST_SECRET;
  }
}, 20000);
