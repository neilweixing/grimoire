import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const release = join(root, "release");
const executable =
  process.env.GRIMOIRE_SMOKE_APP_PATH ||
  (process.platform === "darwin"
    ? join(release, "mac-arm64/Grimoire.app/Contents/MacOS/Grimoire")
    : join(release, "win-unpacked/Grimoire.exe"));
if (!existsSync(executable))
  throw new Error(`Build the desktop app first: ${executable}`);
mkdirSync(release, { recursive: true });
const report = resolve(
  release,
  `smoke-${process.platform}-${process.arch}.json`,
);
const data = mkdtempSync(join(tmpdir(), "grimoire-smoke-"));
const child = spawn(executable, [], {
  env: {
    ...process.env,
    GRIMOIRE_DESKTOP_USER_DATA: data,
    GRIMOIRE_DESKTOP_SMOKE_REPORT: report,
  },
  stdio: "inherit",
});
const timeout = setTimeout(() => child.kill(), 90_000);
const code = await new Promise((done, fail) => {
  child.once("exit", done);
  child.once("error", fail);
}).finally(() => clearTimeout(timeout));
assert.equal(code, 0, "Desktop app failed its startup smoke test");
const result = JSON.parse(readFileSync(report, "utf8"));
assert.equal(result.packaged, true);
assert.equal(result.health.status, "ok");
assert.equal(result.chat.metadata.status, "idle");
assert.equal(result.sandbox.exitCode, 0);
assert.equal(result.sandbox.output.trim(), "grimoire-sandbox-ok");
assert.equal(result.ui.nodeIntegration, false);
assert.equal(
  result.ui.desktop,
  process.platform === "darwin" ? "macos" : "windows",
);
console.log(`Packaged app smoke test passed: ${report}`);
