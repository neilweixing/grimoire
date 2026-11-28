import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { IntegrationStore } from "../apps/grimoire-agent/src/integrations";
import { createApp } from "../apps/grimoire-agent/src/app";
import { SettingsStore } from "../apps/grimoire-agent/src/settings";

let root: string;
let store: IntegrationStore;
const source = "npm:grimoire-fixture-plugin";
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "grimoire-plugin-updates-"));
  const workspace = join(root, "workspace"),
    agent = join(root, "agent");
  mkdirSync(workspace);
  mkdirSync(agent);
  writeFileSync(
    join(agent, "settings.json"),
    JSON.stringify({
      npmCommand: [process.execPath, resolve("tests/fixtures/npm-fixture.cjs")],
    }),
  );
  vi.stubEnv("PI_OFFLINE", "");
  vi.stubEnv("GRIMOIRE_NPM_FIXTURE_LATEST", "1.0.0");
  store = new IntegrationStore(workspace, agent, join(root, "home-agents"));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});
const version = (spec = source) =>
  JSON.parse(
    readFileSync(
      join(store.packages.getInstalledPath(spec, "user")!, "package.json"),
      "utf8",
    ),
  ).version;

it("checks unpinned packages through Pi without installing, caches, and supports forced refresh", async () => {
  await store.packageAction("install", source);
  vi.stubEnv("GRIMOIRE_NPM_FIXTURE_LATEST", "1.1.0");
  const check = vi.spyOn(store.packages, "checkForAvailableUpdates");
  const install = vi.spyOn(store.packages, "installAndPersist");
  const updates = await store.checkPackageUpdates();
  expect(updates).toEqual([
    {
      source,
      displayName: "grimoire-fixture-plugin",
      type: "npm",
      scope: "user",
    },
  ]);
  expect(version()).toBe("1.0.0");
  expect(install).not.toHaveBeenCalled();
  expect(await store.checkPackageUpdates()).toEqual(updates);
  expect(check).toHaveBeenCalledTimes(1);
  await store.checkPackageUpdates(true);
  expect(check).toHaveBeenCalledTimes(2);
  expect(store.nativeSettings.getPackages()).toEqual([source]);
});
it("updates through Pi's native update and preserves disabled resource filters", async () => {
  await store.packageAction("install", source);
  await store.packageAction("disable", source);
  const before = store.nativeSettings.getPackages();
  vi.stubEnv("GRIMOIRE_NPM_FIXTURE_LATEST", "1.2.0");
  expect(await store.checkPackageUpdates()).toHaveLength(1);
  const update = vi.spyOn(store.packages, "update");
  await store.packageAction("update", source);
  expect(update).toHaveBeenCalledWith(source);
  expect(version()).toBe("1.2.0");
  expect(store.nativeSettings.getPackages()).toEqual(before);
  expect(await store.listPackages()).toEqual([{ source, enabled: false }]);
  expect(await store.checkPackageUpdates()).toEqual([]);
});
it("respects Pi's exact-version pin semantics", async () => {
  const pinned = source + "@1.0.0";
  await store.packageAction("install", pinned);
  vi.stubEnv("GRIMOIRE_NPM_FIXTURE_LATEST", "2.0.0");
  expect(await store.checkPackageUpdates()).toEqual([]);
  await store.packageAction("update", pinned);
  expect(version(pinned)).toBe("1.0.0");
  expect(store.nativeSettings.getPackages()).toEqual([pinned]);
});
it("retains version ranges when Pi updates an installed package", async () => {
  const ranged = source + "@^1.0.0";
  await store.packageAction("install", ranged);
  vi.stubEnv("GRIMOIRE_NPM_FIXTURE_LATEST", "1.3.0");
  expect(await store.checkPackageUpdates()).toHaveLength(1);
  await store.packageAction("update", ranged);
  expect(version(ranged)).toBe("1.3.0");
  expect(store.nativeSettings.getPackages()).toEqual([ranged]);
});
it("does not check or download updates when Pi offline mode is enabled", async () => {
  await store.packageAction("install", source);
  vi.stubEnv("GRIMOIRE_NPM_FIXTURE_LATEST", "2.0.0");
  vi.stubEnv("PI_OFFLINE", "1");
  expect(await store.checkPackageUpdates()).toEqual([]);
  await store.packageAction("update", source);
  expect(version()).toBe("1.0.0");
});
it("rejects unknown installed sources before calling Pi update", async () => {
  const update = vi.spyOn(store.packages, "update");
  await expect(store.packageAction("update", "npm:missing")).rejects.toThrow(
    "Package not found",
  );
  expect(update).not.toHaveBeenCalled();
});
it("does not cache a failed native check and permits retry", async () => {
  const check = vi
    .spyOn(store.packages, "checkForAvailableUpdates")
    .mockRejectedValueOnce(new Error("Fixture check failure"))
    .mockResolvedValueOnce([]);
  await expect(store.checkPackageUpdates()).rejects.toThrow(
    "Fixture check failure",
  );
  expect(await store.checkPackageUpdates()).toEqual([]);
  expect(check).toHaveBeenCalledTimes(2);
});
it("requires explicit trust for the API update operation", async () => {
  const app = createApp(new SettingsStore(join(root, "providers.json")), {
    dataDir: join(root, "api"),
    globalSkillRoot: join(root, "home-agents"),
  });
  try {
    const response = await app.request("/api/plugins", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "update", source }),
    });
    expect(response.status).toBe(403);
  } finally {
    await app.dispose();
  }
});
