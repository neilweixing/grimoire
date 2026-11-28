import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync } from "node:fs";
import { fileURLToPath } from "node:url";

const cwd = fileURLToPath(new URL("..", import.meta.url));
const git = (args) =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

// Source archives and packaged applications do not need development hooks.
if (spawnSync("git", ["rev-parse", "--git-dir"], { cwd }).status === 0) {
  const existing = spawnSync("git", ["config", "--get", "core.hooksPath"], {
    cwd,
    encoding: "utf8",
  });
  if (existing.status !== 0 && existing.status !== 1) {
    throw new Error(existing.stderr || "Cannot read core.hooksPath.");
  }
  const hooksPath = existing.stdout.trim();
  if (hooksPath && hooksPath !== ".githooks") {
    throw new Error(
      `Refusing to replace existing core.hooksPath: ${hooksPath}`,
    );
  }
  chmodSync(new URL("../.githooks/pre-push", import.meta.url), 0o755);
  git(["config", "--local", "core.hooksPath", ".githooks"]);
  console.log("Installed Git pre-push commit message validation.");
}
