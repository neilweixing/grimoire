import { createRequire } from "node:module";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  desktopDataDirectory,
  migrateDesktopData,
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
