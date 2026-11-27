import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../apps/grimoire-agent/src/app";
import { SettingsStore } from "../apps/grimoire-agent/src/settings";

let directory: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "grimoire-test-"));
});
afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});
const json = (body: unknown) => ({
  headers: { "Content-Type": "application/json", "Accept-Language": "en" },
  body: JSON.stringify(body),
});

describe("provider settings API", () => {
  it("persists CRUD, activation, and key preservation without returning secrets", async () => {
    const path = join(directory, "providers.json");
    const app = createApp(new SettingsStore(path));
    const input = {
      name: "Test provider",
      kind: "openai",
      model: "gpt-4.1-mini",
      apiKey: "test-secret",
      contextWindow: 64000,
    };
    const created = await app.request("/api/providers", {
      method: "POST",
      ...json(input),
    });
    expect(created.status).toBe(201);
    const text = await created.text();
    expect(text).not.toContain("test-secret");
    const id = JSON.parse(text).providers[0].id;
    expect(JSON.parse(text).providers[0].hasApiKey).toBe(true);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(
      (
        await app.request("/api/providers/active", {
          method: "PUT",
          ...json({ id }),
        })
      ).status,
    ).toBe(200);
    await app.request(`/api/providers/${id}`, {
      method: "PUT",
      ...json({ ...input, name: "Renamed", apiKey: "" }),
    });
    const restored = new SettingsStore(path);
    expect(restored.active()?.apiKey).toBe("test-secret");
    expect(restored.active()?.name).toBe("Renamed");
    expect(restored.active()?.contextWindow).toBe(64000);
    expect(readFileSync(path, "utf8")).toContain("test-secret");
    await app.request(`/api/providers/${id}`, { method: "DELETE" });
    const final = await (await app.request("/api/providers")).json();
    expect(final).toEqual({
      providers: [],
      activeProviderId: "demo",
      thinkingLevels: ["off"],
    });
    expect(readFileSync(path, "utf8")).not.toContain("test-secret");
  });

  it("rejects invalid API addresses and missing providers", async () => {
    const app = createApp(new SettingsStore(join(directory, "providers.json")));
    const invalid = await app.request("/api/providers", {
      method: "POST",
      ...json({
        name: "Bad",
        model: "x",
        kind: "openai",
        baseUrl: "file:///etc/passwd",
      }),
    });
    expect(invalid.status).toBe(400);
    expect(
      (
        await app.request("/api/providers/active", {
          method: "PUT",
          ...json({ id: "missing" }),
        })
      ).status,
    ).toBe(404);
  });

  it("rejects cross-origin browser writes and invalid JSON", async () => {
    const app = createApp(new SettingsStore(join(directory, "providers.json")));
    const denied = await app.request("/api/providers", {
      method: "POST",
      headers: { Origin: "https://untrusted.example" },
    });
    expect(denied.status).toBe(403);
    const malformed = await app.request("/api/providers", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept-Language": "en" },
      body: "{",
    });
    expect(malformed.status).toBe(400);
    expect((await malformed.json()).error).toBe(
      "The request is not valid JSON.",
    );
  });

  it("persists model selection without replacing the configured default or its context window", async () => {
    const path = join(directory, "providers.json");
    const settings = new SettingsStore(path);
    settings.save(
      {
        name: "Gateway",
        kind: "openai-compatible",
        model: "default-model",
        apiKey: "fixture-secret",
        contextWindow: 64000,
      },
      "gateway",
    );
    const app = createApp(settings);
    const selected = await app.request("/api/providers/selection", {
      method: "PUT",
      ...json({ providerId: "gateway", model: "another-model" }),
    });
    expect(selected.status).toBe(200);
    const result = await selected.json();
    expect(result.activeModel).toBe("another-model");
    expect(JSON.stringify(result)).not.toContain("fixture-secret");
    expect(result.providers[0].model).toBe("default-model");
    const restored = new SettingsStore(path);
    expect(restored.active()).toMatchObject({
      model: "another-model",
      apiKey: "fixture-secret",
    });
    expect(restored.active()?.contextWindow).toBeUndefined();
    restored.selectModel("gateway", "default-model");
    expect(restored.active()?.contextWindow).toBe(64000);
    restored.activate("gateway");
    expect(restored.publicSettings().activeModel).toBeUndefined();
    restored.selectModel("gateway", "another-model");
    restored.save(
      { name: "Gateway", kind: "openai-compatible", model: "new-default" },
      "gateway",
    );
    expect(restored.active()?.model).toBe("new-default");
    expect(restored.active()?.apiKey).toBe("fixture-secret");
  });

  it("validates model selections before changing the active provider", async () => {
    const app = createApp(new SettingsStore(join(directory, "providers.json")));
    expect(
      (
        await app.request("/api/providers/selection", {
          method: "PUT",
          ...json({ providerId: "missing", model: "model" }),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await app.request("/api/providers/selection", {
          method: "PUT",
          ...json({ providerId: "demo", model: "" }),
        })
      ).status,
    ).toBe(400);
  });
});
