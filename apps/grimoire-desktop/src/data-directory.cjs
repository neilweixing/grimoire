const {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  writeFileSync,
} = require("node:fs");
const { homedir } = require("node:os");
const { join, resolve } = require("node:path");

const entries = [
  "providers.json",
  "pi",
  "preferences.json",
  "browser-settings.json",
];

function desktopDataDirectory({
  override,
  development,
  legacy,
  home = homedir(),
}) {
  return resolve(override || (development ? legacy : join(home, ".grimoire")));
}

function migrateDesktopData(legacy, target) {
  if (resolve(legacy) === resolve(target)) return false;
  mkdirSync(target, { recursive: true, mode: 0o700 });
  const complete = join(target, ".desktop-data-migrated.json");
  const pending = join(target, ".desktop-data-migration-pending.json");
  if (existsSync(complete)) return false;
  // An existing profile wins over legacy data. A pending migration can resume.
  if (
    !existsSync(pending) &&
    ["providers.json", "pi"].some((name) => existsSync(join(target, name)))
  )
    return false;
  const available = entries.filter((name) => existsSync(join(legacy, name)));
  if (!available.length) return false;
  if (!existsSync(pending))
    writeFileSync(pending, JSON.stringify({ source: legacy }), {
      mode: 0o600,
      flag: "wx",
    });
  const staging = mkdtempSync(join(target, ".desktop-migration-"));
  try {
    for (const name of available) {
      if (existsSync(join(target, name))) continue;
      cpSync(join(legacy, name), join(staging, name), { recursive: true });
      // Publish complete files/directories only, keeping the source as a backup.
      renameSync(join(staging, name), join(target, name));
    }
    renameSync(pending, complete);
    return true;
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

module.exports = { desktopDataDirectory, migrateDesktopData };
