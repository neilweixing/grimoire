import { createRequire } from "node:module";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  readdirSync,
  symlinkSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  desktopDataDirectory,
  migrateDesktopData,
  migrateDesktopLayout,
} = require("../apps/grimoire-desktop/src/data-directory.cjs");
let root: string;
let legacy: string;
let target: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "grimoire-data-directory-"));
  legacy = join(root, "legacy");
  target = join(root, ".grimoire");
  mkdirSync(legacy);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

it("uses the home directory for desktop data and preserves explicit and development profiles", () => {
  expect(desktopDataDirectory({ legacy, home: root })).toBe(target);
  expect(desktopDataDirectory({ legacy, home: root, development: true })).toBe(
    legacy,
  );
  expect(
    desktopDataDirectory({
      legacy,
      home: root,
      override: join(root, "test-profile"),
    }),
  ).toBe(join(root, "test-profile"));
});

function seed() {
  writeFileSync(join(legacy, "providers.json"), '{"fixture":"provider"}');
  mkdirSync(join(legacy, "pi/workspaces/project/agent/sessions"), {
    recursive: true,
  });
  writeFileSync(
    join(legacy, "pi/workspaces/project/agent/sessions/chat.jsonl"),
    "session fixture",
  );
  writeFileSync(
    join(legacy, "browser-settings.json"),
    '{"ignoreCertificateErrors":false}',
  );
  writeFileSync(join(legacy, "SingletonLock"), "old runtime lock");
}

it("copies settings and complete sessions while preserving the original profile", () => {
  seed();
  expect(migrateDesktopData(legacy, target)).toBe(true);
  for (const name of [
    "providers.json",
    "browser-settings.json",
    "pi/workspaces/project/agent/sessions/chat.jsonl",
  ])
    expect(readFileSync(join(target, name), "utf8")).toBe(
      readFileSync(join(legacy, name), "utf8"),
    );
  expect(existsSync(join(target, "SingletonLock"))).toBe(false);
  expect(existsSync(join(target, ".desktop-data-migrated.json"))).toBe(true);
  expect(existsSync(join(target, ".desktop-data-migration-pending.json"))).toBe(
    false,
  );
});

it("does not resurrect deleted conversations on subsequent launches", () => {
  seed();
  migrateDesktopData(legacy, target);
  rmSync(join(target, "pi"), { recursive: true });
  expect(migrateDesktopData(legacy, target)).toBe(false);
  expect(existsSync(join(target, "pi"))).toBe(false);
});

it("keeps an existing profile authoritative instead of merging legacy sessions", () => {
  seed();
  mkdirSync(target);
  writeFileSync(join(target, "providers.json"), "new profile");
  expect(migrateDesktopData(legacy, target)).toBe(false);
  expect(readFileSync(join(target, "providers.json"), "utf8")).toBe(
    "new profile",
  );
  expect(existsSync(join(target, "pi"))).toBe(false);
});

it("resumes an interrupted migration without overwriting already published data", () => {
  seed();
  mkdirSync(target);
  writeFileSync(
    join(target, ".desktop-data-migration-pending.json"),
    JSON.stringify({ source: legacy }),
  );
  writeFileSync(join(target, "providers.json"), "published provider");
  expect(migrateDesktopData(legacy, target)).toBe(true);
  expect(readFileSync(join(target, "providers.json"), "utf8")).toBe(
    "published provider",
  );
  expect(
    existsSync(join(target, "pi/workspaces/project/agent/sessions/chat.jsonl")),
  ).toBe(true);
});

it("supports an unrelated existing attachments directory without moving or deleting it", () => {
  seed();
  mkdirSync(join(target, "attachments"), { recursive: true });
  writeFileSync(join(target, "attachments/fixture"), "attachment");
  expect(migrateDesktopData(legacy, target)).toBe(true);
  expect(readFileSync(join(target, "attachments/fixture"), "utf8")).toBe(
    "attachment",
  );
});

it("handles first launch and identical locations without inventing legacy data", () => {
  expect(migrateDesktopData(legacy, target)).toBe(false);
  expect(migrateDesktopData(target, target)).toBe(false);
  expect(existsSync(join(target, ".desktop-data-migrated.json"))).toBe(false);
});

it("organizes the flat profile while preserving sessions, attachments, and unknown files", () => {
  seed();
  migrateDesktopData(legacy, target);
  writeFileSync(join(target, "preferences.json"), '{"appearance":"dark"}');
  writeFileSync(join(target, "desktop.log"), "old log");
  writeFileSync(join(target, "Cookies"), "cookie database");
  mkdirSync(join(target, "Partitions/chat"), { recursive: true });
  writeFileSync(join(target, "Partitions/chat/state"), "login state");
  writeFileSync(join(target, "notes.txt"), "user file");
  mkdirSync(join(target, "attachments"));
  writeFileSync(join(target, "attachments/file"), "attachment");
  const result = migrateDesktopLayout(target);
  expect(result.migrated).toBeGreaterThan(0);
  expect(readFileSync(join(target, "config/providers.json"), "utf8")).toContain(
    "provider",
  );
  expect(
    readFileSync(join(target, "config/preferences.json"), "utf8"),
  ).toContain("dark");
  expect(readFileSync(join(target, "desktop/Cookies"), "utf8")).toBe(
    "cookie database",
  );
  expect(
    readFileSync(join(target, "desktop/Partitions/chat/state"), "utf8"),
  ).toBe("login state");
  expect(readFileSync(join(target, "logs/desktop.log"), "utf8")).toBe(
    "old log",
  );
  expect(
    readFileSync(
      join(target, "pi/workspaces/project/agent/sessions/chat.jsonl"),
      "utf8",
    ),
  ).toBe("session fixture");
  expect(readFileSync(join(target, "attachments/file"), "utf8")).toBe(
    "attachment",
  );
  expect(readFileSync(join(target, "notes.txt"), "utf8")).toBe("user file");
  expect(existsSync(join(target, "providers.json"))).toBe(false);
  expect(migrateDesktopLayout(target).migrated).toBe(0);
  expect(migrateDesktopData(legacy, target)).toBe(false);
});
it("retains conflicts without merging databases and resumes a partly moved profile", () => {
  mkdirSync(join(target, "desktop"), { recursive: true });
  writeFileSync(join(target, "desktop/Cookies"), "current cookies");
  writeFileSync(join(target, "Cookies"), "legacy cookies");
  writeFileSync(join(target, "Cookies-journal"), "legacy journal");
  writeFileSync(join(target, "providers.json"), "remaining settings");
  migrateDesktopLayout(target);
  expect(readFileSync(join(target, "desktop/Cookies"), "utf8")).toBe(
    "current cookies",
  );
  const retained = readdirSync(join(target, "migrations")).find((name) =>
    name.startsWith("flat-profile-"),
  )!;
  expect(
    readFileSync(join(target, "migrations", retained, "Cookies"), "utf8"),
  ).toBe("legacy cookies");
  expect(
    readFileSync(
      join(target, "migrations", retained, "Cookies-journal"),
      "utf8",
    ),
  ).toBe("legacy journal");
  expect(existsSync(join(target, "desktop/Cookies-journal"))).toBe(false);
  expect(readFileSync(join(target, "config/providers.json"), "utf8")).toBe(
    "remaining settings",
  );
});
it.skipIf(process.platform === "win32")(
  "refuses to move a running legacy browser profile",
  () => {
    mkdirSync(target);
    symlinkSync("machine-999999", join(target, "SingletonLock"));
    writeFileSync(join(target, "Cookies"), "live database");
    expect(() => migrateDesktopLayout(target, () => true)).toThrow(
      "Quit the previous",
    );
    expect(readFileSync(join(target, "Cookies"), "utf8")).toBe("live database");
    expect(existsSync(join(target, "desktop"))).toBe(false);
    expect(migrateDesktopLayout(target, () => false).migrated).toBe(1);
  },
);
