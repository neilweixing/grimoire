import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { UserPreferencesStore } from "../apps/grimoire-agent/src/user-preferences";
import { createApp } from "../apps/grimoire-agent/src/app";
import { SettingsStore } from "../apps/grimoire-agent/src/settings";
let root: string;
let path: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "grimoire-preferences-"));
  path = join(root, "preferences.json");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
it("uses light and Chinese defaults without writing a file on read", () => {
  expect(new UserPreferencesStore(path).get()).toEqual({
    appearance: "light",
    language: "zh",
    ignoreCertificateErrors: false,
  });
  expect(existsSync(path)).toBe(false);
});
it("persists all general preferences and reloads them in a fresh store", () => {
  const preferences = {
    appearance: "dark",
    language: "en",
    ignoreCertificateErrors: true,
  };
  new UserPreferencesStore(path).update(preferences);
  expect(new UserPreferencesStore(path).get()).toEqual(preferences);
  expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(preferences);
  if (process.platform !== "win32")
    expect(statSync(path).mode & 0o777).toBe(0o600);
});
it("preserves other keys and unrelated general fields during a partial update", () => {
  writeFileSync(
    path,
    JSON.stringify({
      appearance: "dark",
      language: "en",
      ignoreCertificateErrors: true,
      future: { keep: true },
    }),
  );
  new UserPreferencesStore(path).update({ language: "zh" });
  expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
    appearance: "dark",
    language: "zh",
    ignoreCertificateErrors: true,
    future: { keep: true },
  });
});
it("migrates legacy certificate choices without deleting the original", () => {
  const legacy = join(root, "browser-settings.json");
  writeFileSync(legacy, JSON.stringify({ ignoreCertificateErrors: true }));
  expect(new UserPreferencesStore(path).get().ignoreCertificateErrors).toBe(
    true,
  );
  expect(existsSync(legacy)).toBe(true);
  expect(existsSync(path)).toBe(true);
  new UserPreferencesStore(path).update({ ignoreCertificateErrors: false });
  expect(new UserPreferencesStore(path).get().ignoreCertificateErrors).toBe(
    false,
  );
});
it("rejects invalid settings and protects malformed files from overwrite", () => {
  const store = new UserPreferencesStore(path);
  expect(() => store.update({ appearance: "system" })).toThrow();
  expect(() => store.update({ version: "1.0.0" })).toThrow();
  expect(existsSync(path)).toBe(false);
  writeFileSync(path, "invalid json");
  expect(() => store.update({ appearance: "dark" })).toThrow();
  expect(readFileSync(path, "utf8")).toBe("invalid json");
});
it("serves and saves preferences through the guarded API and notifies the desktop host", async () => {
  const onPreferencesChange = vi.fn().mockResolvedValue(undefined);
  const app = createApp(new SettingsStore(join(root, "providers.json")), {
    preferences: new UserPreferencesStore(path),
    onPreferencesChange,
  });
  try {
    expect((await app.request("/api/preferences")).status).toBe(200);
    const saved = await app.request("/api/preferences", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        appearance: "dark",
        language: "en",
        ignoreCertificateErrors: true,
      }),
    });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual(new UserPreferencesStore(path).get());
    expect(onPreferencesChange).toHaveBeenCalledWith({
      appearance: "dark",
      language: "en",
      ignoreCertificateErrors: true,
    });
    const rejected = await app.request("/api/preferences", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://untrusted.example",
      },
      body: JSON.stringify({ appearance: "light" }),
    });
    expect(rejected.status).toBe(403);
    expect(new UserPreferencesStore(path).get().appearance).toBe("dark");
  } finally {
    await app.dispose();
  }
});
it("preserves all fields across concurrent partial API requests", async () => {
  const app = createApp(new SettingsStore(join(root, "providers.json")), {
    preferences: new UserPreferencesStore(path),
  });
  try {
    const responses = await Promise.all(
      [
        { appearance: "dark" },
        { language: "en" },
        { ignoreCertificateErrors: true },
      ].map((body) =>
        app.request("/api/preferences", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
      ),
    );
    expect(responses.every((r) => r.status === 200)).toBe(true);
    expect(new UserPreferencesStore(path).get()).toEqual({
      appearance: "dark",
      language: "en",
      ignoreCertificateErrors: true,
    });
  } finally {
    await app.dispose();
  }
});
