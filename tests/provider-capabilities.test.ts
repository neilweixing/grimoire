import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../apps/grimoire-agent/src/app";
import {
  modelContextWindow,
  modelThinkingLevels,
  providerRuntime,
} from "../apps/grimoire-agent/src/agent";
import { listProviderModels } from "../apps/grimoire-agent/src/models";
import {
  providerCatalog,
  nativeProvider,
  selectProviderModel,
} from "../apps/grimoire-agent/src/provider-catalog";
import { SettingsStore } from "../apps/grimoire-agent/src/settings";

const directories: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const path of directories.splice(0))
    rmSync(path, { recursive: true, force: true });
});
const store = () => {
  const directory = mkdtempSync(join(tmpdir(), "grimoire-capabilities-"));
  directories.push(directory);
  return new SettingsStore(join(directory, "providers.json"));
};
const json = (body: unknown) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
const custom = {
  id: "gateway",
  name: "Gateway",
  kind: "openai-compatible" as const,
  model: "alias",
  baseUrl: "https://gateway.example/v1",
  apiKey: "fixture-secret",
  contextWindow: 4096,
};

describe("model capability configuration", () => {
  it("loads native model catalogs without credentials or network requests", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const models = await listProviderModels(
      {
        ...custom,
        kind: "native",
        nativeProvider: "google",
        apiKey: undefined,
        contextWindow: undefined,
      },
      fetcher,
    );
    expect(fetcher).not.toHaveBeenCalled();
    expect(models.length).toBeGreaterThan(0);
    expect(models[0]).toMatchObject({
      source: "sdk",
      contextWindow: expect.any(Number),
      maxTokens: expect.any(Number),
      input: expect.arrayContaining(["text"]),
    });

    expect(
      providerCatalog().providers.some(
        (provider) => provider.id === "deepseek",
      ),
    ).toBe(true);
    expect(
      providerCatalog().providers.some(
        (provider) => provider.id === "openai-codex",
      ),
    ).toBe(false);
  });

  it("keeps Max from Pi's native model configuration", () => {
    const native = nativeProvider("deepseek")!
      .getModels()
      .find((model) => model.thinkingLevelMap?.max != null)!;
    expect(native).toBeDefined();
    const configured = providerCatalog()
      .providers.find((provider) => provider.id === "deepseek")!
      .models.find((model) => model.id === native.id)!;
    expect(configured.thinkingLevels).toContain("max");
  });

  it("keeps unknown custom capabilities unknown instead of assuming reasoning or images", async () => {
    const models = await listProviderModels(
      { ...custom, contextWindow: undefined },
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(Response.json({ data: [{ id: "new-model" }] })),
    );
    expect(models.find((model) => model.id === "new-model")).toMatchObject({
      thinkingLevels: ["off"],
    });
    expect(
      models.find((model) => model.id === "new-model")?.contextWindow,
    ).toBeUndefined();
    expect(
      models.find((model) => model.id === "new-model")?.input,
    ).toBeUndefined();
  });

  it("reads explicit remote metadata without applying the default model's limits to siblings", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        data: [
          {
            id: "remote-model",
            context_length: 128000,
            architecture: { input_modalities: ["text", "image", "audio"] },
            top_provider: { max_completion_tokens: 16384 },
            thinkingLevels: ["off", "high"],
          },
          {
            id: "invalid",
            context_length: -1,
            max_output_tokens: "not-a-number",
          },
        ],
      }),
    );
    const models = await listProviderModels(custom, fetcher);
    expect(models.find((model) => model.id === "remote-model")).toMatchObject({
      contextWindow: 128000,
      maxTokens: 16384,
      input: ["text", "image"],
      thinkingLevels: ["off", "high"],
      source: "remote",
    });
    expect(
      models.find((model) => model.id === "invalid")?.contextWindow,
    ).toBeUndefined();
    expect(models.find((model) => model.id === "alias")?.contextWindow).toBe(
      4096,
    );
  });

  it("applies per-model overrides to actual Pi models, thinking maps and context metrics", () => {
    const provider = {
      ...custom,
      modelOverrides: {
        alias: {
          contextWindow: 64000,
          maxTokens: 2000,
          input: ["text", "image"] as ("text" | "image")[],
          thinkingLevels: ["off", "xhigh"] as ("off" | "xhigh")[],
        },
      },
    };
    const { model } = providerRuntime(provider, "en", "xhigh");
    expect(model).toMatchObject({
      contextWindow: 64000,
      maxTokens: 2000,
      input: ["text", "image"],
      reasoning: true,
    });
    expect(modelContextWindow(provider)).toBe(64000);
    expect(modelThinkingLevels(provider)).toEqual(["off", "xhigh"]);
    expect(model.thinkingLevelMap).toMatchObject({
      low: null,
      medium: null,
      high: null,
      xhigh: "xhigh",
      max: null,
    });
    expect(
      modelContextWindow(selectProviderModel(provider, "sibling")),
    ).toBeNull();
  });

  it("preserves native model API and maps while applying numeric overrides", () => {
    const preset = providerCatalog().providers.find(
      (provider) => provider.id === "google",
    )!;
    const selected = preset.models[0]!;
    const { model } = providerRuntime({
      id: "google-connection",
      name: "Google",
      kind: "native",
      nativeProvider: "google",
      model: selected.id,
      apiKey: "fixture-key",
      modelOverrides: {
        [selected.id]: { contextWindow: 64000, maxTokens: 4000 },
      },
    });
    expect(model.api).toBe("google-generative-ai");
    expect(model).toMatchObject({
      contextWindow: 64000,
      maxTokens: 4000,
      input: selected.input,
    });
  });

  it("persists overrides for each selected model across restarts", () => {
    const settings = store();
    settings.save(
      {
        ...custom,
        models: ["alias", "sibling"],
        modelOverrides: { sibling: { contextWindow: 64000, maxTokens: 2000 } },
      },
      custom.id,
    );
    settings.selectModel(custom.id, "sibling");
    const restored = new SettingsStore(
      join(directories.at(-1)!, "providers.json"),
    );
    expect(restored.active()?.contextWindow).toBeUndefined();
    expect(modelContextWindow(restored.active())).toBe(64000);
    settings.selectModel(custom.id, "alias");
    expect(modelContextWindow(settings.active())).toBe(4096);
  });

  it("uses a stored key only for an unchanged discovery connection and never returns it", async () => {
    const settings = store();
    settings.save(custom, custom.id);
    const app = createApp(settings);
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      Response.json({
        data: [{ id: "remote-model", context_length: 128000 }],
      }),
    );
    const unchanged = await app.request(
      "/api/providers/discover",
      json({ id: custom.id, provider: { ...custom, apiKey: "" } }),
    );
    expect(unchanged.status).toBe(200);
    expect(fetcher.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: "Bearer fixture-secret",
    });
    expect(await unchanged.text()).not.toContain("fixture-secret");
    await app.request(
      "/api/providers/discover",
      json({
        id: custom.id,
        provider: {
          ...custom,
          apiKey: "",
          baseUrl: "https://other.example/v1",
        },
      }),
    );
    expect(fetcher.mock.calls[1]?.[1]?.headers).not.toHaveProperty(
      "Authorization",
    );
    expect(settings.get(custom.id)?.apiKey).toBe("fixture-secret");
    settings.save(
      { ...custom, apiKey: "", baseUrl: "https://other.example/v1" },
      custom.id,
    );
    expect(settings.get(custom.id)?.apiKey).toBeUndefined();
  });

  it("rejects unknown native presets without changing saved providers", async () => {
    const settings = store();
    const app = createApp(settings);
    const response = await app.request(
      "/api/providers",
      json({
        name: "Bad",
        kind: "native",
        nativeProvider: "missing",
        model: "bad",
        apiKey: "fixture-secret",
      }),
    );
    expect(response.status).toBe(400);
    expect(settings.publicSettings().providers).toEqual([]);
  });

  it("lists only configured models without discovery and applies each model's capabilities", async () => {
    const settings = store();
    settings.save(
      {
        ...custom,
        models: ["alias", "remote-model"],
        modelMetadata: {
          "remote-model": {
            contextWindow: 128000,
            thinkingLevels: ["off", "high"],
          },
        },
        modelOverrides: {
          alias: { thinkingLevels: ["off", "low"] },
          "remote-model": { maxTokens: 8000 },
        },
      },
      custom.id,
    );
    const fetcher = vi.spyOn(globalThis, "fetch");
    const response = await createApp(settings).request(
      "/api/providers/gateway/models",
    );
    expect(response.status).toBe(200);
    expect(fetcher).not.toHaveBeenCalled();
    expect((await response.json()).models).toEqual([
      expect.objectContaining({
        id: "alias",
        contextWindow: 4096,
        thinkingLevels: ["off", "low"],
      }),
      expect.objectContaining({
        id: "remote-model",
        contextWindow: 128000,
        maxTokens: 8000,
        thinkingLevels: ["off", "high"],
      }),
    ]);
    settings.selectModel(custom.id, "remote-model");
    expect(modelContextWindow(settings.active())).toBe(128000);
    expect(JSON.stringify(settings.publicSettings())).not.toContain(
      "fixture-secret",
    );
  });

  it("rejects unconfigured selection and resets a removed active model", async () => {
    const settings = store();
    settings.save(
      {
        ...custom,
        models: ["alias", "second"],
        modelOverrides: { second: { thinkingLevels: ["high"] } },
      },
      custom.id,
    );
    const app = createApp(settings);
    const invalid = await app.request("/api/providers/selection", {
      ...json({ providerId: custom.id, model: "unconfigured" }),
      method: "PUT",
    });
    expect(invalid.status).toBe(400);
    expect(() => settings.selectModel(custom.id, "unconfigured")).toThrow(
      "not configured",
    );
    settings.selectModel(custom.id, "second");
    expect(modelThinkingLevels(settings.active())).toEqual(["high"]);
    settings.save({ ...custom, models: ["alias"] }, custom.id);
    expect(settings.active()?.model).toBe("alias");
    const restored = new SettingsStore(
      join(directories.at(-1)!, "providers.json"),
    );
    expect(restored.active()?.model).toBe("alias");
    expect(restored.publicSettings().providers[0]?.models).toEqual(["alias"]);
  });

  it("validates duplicate models and a missing default without changing saved data", async () => {
    const settings = store();
    const app = createApp(settings);
    for (const models of [[], ["alias", "alias"], ["other"]]) {
      const response = await app.request(
        "/api/providers",
        json({ ...custom, models }),
      );
      expect(response.status).toBe(400);
    }
    expect(settings.publicSettings().providers).toEqual([]);
  });
});
