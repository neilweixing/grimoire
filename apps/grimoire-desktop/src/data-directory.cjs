const {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  writeFileSync,
  readlinkSync,
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
    [
      "providers.json",
      "config/providers.json",
      "pi",
      "migrations/legacy-profile.json",
    ].some((name) => existsSync(join(target, name)))
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

const chromiumEntries = [
  "Cache",
  "Code Cache",
  "Cookies",
  "Cookies-journal",
  "Cookies-wal",
  "Cookies-shm",
  "DIPS",
  "DIPS-wal",
  "DIPS-shm",
  "DawnGraphiteCache",
  "DawnWebGPUCache",
  "Extension State",
  "GPUCache",
  "GPUPersistentCache",
  "GraphiteDawnCache",
  "Local State",
  "Local Storage",
  "Network",
  "Network Persistent State",
  "Partitions",
  "Preferences",
  "Session Storage",
  "Shared Dictionary",
  "TransportSecurity",
  "Trust Tokens",
  "Trust Tokens-journal",
  "Trust Tokens-wal",
  "Trust Tokens-shm",
  "blob_storage",
  "databases",
  "IndexedDB",
  "Service Worker",
  "File System",
  "WebStorage",
  "Storage",
  "Crashpad",
  "Crash Reports",
  "BrowserMetrics",
  "VideoDecodeStats",
  "component_crx_cache",
  "extensions_crx_cache",
  "declarative_performance_observer.db",
  "declarative_performance_observer.db-journal",
  ".updaterId",
];

function desktopLayout(root) {
  return {
    config: join(root, "config"),
    desktop: join(root, "desktop"),
    logs: join(root, "logs"),
    updates: join(root, "updates"),
    migrations: join(root, "migrations"),
  };
}

function migrateDesktopLayout(
  root,
  isAlive = (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return error.code !== "ESRCH";
    }
  },
) {
  // The old app owns SQLite/LevelDB files until it has completely exited.
  try {
    const lock = readlinkSync(join(root, "SingletonLock"));
    const pid = Number(lock.match(/-(\d+)$/)?.[1]);
    if (pid && pid !== process.pid && isAlive(pid))
      throw new Error(
        "Quit the previous Grimoire version before migrating its profile.",
      );
  } catch (error) {
    if (!["ENOENT", "EINVAL"].includes(error.code)) throw error;
  }
  const layout = desktopLayout(root);
  for (const path of Object.values(layout))
    mkdirSync(path, { recursive: true, mode: 0o700 });
  const moves = [
    ...["providers.json", "preferences.json", "browser-settings.json"].map(
      (name) => [name, join(layout.config, name)],
    ),
    ...chromiumEntries.map((name) => [name, join(layout.desktop, name)]),
    ["desktop.log", join(layout.logs, "desktop.log")],
    ["update-result.json", join(layout.updates, "result.json")],
    [
      ".desktop-data-migrated.json",
      join(layout.migrations, "legacy-profile.json"),
    ],
    [
      ".desktop-data-migration-pending.json",
      join(layout.migrations, "legacy-profile-pending.json"),
    ],
  ];
  let migrated = 0;
  // A conflicting SQLite database and its sidecars must stay together.
  for (const name of [
    "Cookies",
    "DIPS",
    "Trust Tokens",
    "declarative_performance_observer.db",
  ]) {
    if (
      !existsSync(join(root, name)) ||
      !existsSync(join(layout.desktop, name))
    )
      continue;
    const backup = mkdtempSync(join(layout.migrations, "flat-profile-"));
    for (const suffix of ["", "-journal", "-wal", "-shm"]) {
      const source = join(root, name + suffix);
      if (existsSync(source)) {
        renameSync(source, join(backup, name + suffix));
        migrated++;
      }
    }
  }
  for (const [name, destination] of moves) {
    const source = join(root, name);
    if (!existsSync(source)) continue;
    if (existsSync(destination)) {
      // Never merge browser databases or overwrite newer settings. Retain conflicts.
      const backup = mkdtempSync(join(layout.migrations, "flat-profile-"));
      renameSync(source, join(backup, name));
    } else renameSync(source, destination);
    migrated++;
  }
  return { ...layout, migrated };
}

module.exports = {
  desktopDataDirectory,
  migrateDesktopData,
  desktopLayout,
  migrateDesktopLayout,
};
