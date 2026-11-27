import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const require = createRequire(import.meta.url);
const env = { ...process.env };
// Empty optional CI secrets must be absent: electron-builder treats CSC_LINK="" as a file path.
for (const name of [
  "CSC_LINK",
  "CSC_KEY_PASSWORD",
  "WIN_CSC_LINK",
  "WIN_CSC_KEY_PASSWORD",
  "APPLE_ID",
  "APPLE_APP_SPECIFIC_PASSWORD",
  "APPLE_TEAM_ID",
])
  if (!env[name]) delete env[name];
const result = spawnSync(
  process.execPath,
  [require.resolve("electron-builder/cli.js"), ...process.argv.slice(2)],
  {
    env,
    stdio: "inherit",
  },
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
