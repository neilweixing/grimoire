import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const desktop = join(root, "apps/grimoire-desktop");
const stage = join(desktop, "stage");
const run = (args) => {
  const pnpm = process.env.npm_execpath;
  // pnpm can be a JavaScript entry point or a standalone native executable.
  const javascript = /\.[cm]?js$/i.test(pnpm);
  return execFileSync(
    javascript ? process.execPath : pnpm,
    javascript ? [pnpm, ...args] : args,
    {
      cwd: root,
      stdio: "inherit",
    },
  );
};
if (!(
  (process.platform === "darwin" && process.arch === "arm64") ||
  (process.platform === "win32" && process.arch === "x64")
))
  throw new Error("Desktop packaging supports macOS arm64 and Windows x64.");
if (!process.env.npm_execpath)
  throw new Error("Run staging through pnpm run stage.");
execFileSync(process.execPath, [join(desktop, "scripts/icon.mjs")], {
  stdio: "inherit",
});
run(["--filter", "grimoire-web", "build"]);
run(["--filter", "grimoire-agent", "build"]);
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
run([
  "--filter",
  "grimoire-agent",
  "deploy",
  "--legacy",
  "--prod",
  // MSI packages require real directories instead of pnpm directory junctions.
  "--node-linker=hoisted",
  join(stage, "agent"),
]);
cpSync(join(root, "apps/grimoire-web/dist"), join(stage, "web"), {
  recursive: true,
});
// The desktop runtime uses compiled files; workspace TypeScript stays out of the app.
writeFileSync(
  join(stage, "agent/package.json"),
  JSON.stringify(
    { name: "grimoire-agent", version: "0.1.0", type: "module" },
    null,
    2,
  ),
);
console.log(
  "Desktop runtime staged without local settings, credentials, or workspace files.",
);
