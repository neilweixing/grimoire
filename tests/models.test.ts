import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { listProviderModels } from "../apps/grimoire-agent/src/models";
import { createApp } from "../apps/grimoire-agent/src/app";
import { SettingsStore } from "../apps/grimoire-agent/src/settings";
import {
  createGrimoireAgent,
  modelThinkingLevels,
} from "../apps/grimoire-agent/src/agent";

afterEach(() => vi.restoreAllMocks());
const provider = {
  id: "gateway",
  name: "Gateway",
  kind: "openai-compatible" as const,
  model: "configured-alias",
  apiKey: "fixture-secret",
  baseUrl: "https://gateway.example/v1/",
};

describe("provider model discovery", () => {
  it("uses server credentials and returns only model identifiers, labels, and supported levels", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            { id: "beta" },
            { id: "alpha", name: "Alpha" },
            { id: "beta" },
            { id: 123 },
          ],
        }),
      ),
    );
    const models = await listProviderModels(provider, fetcher);
    expect(fetcher).toHaveBeenCalledWith(
      "https://gateway.example/v1/models",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer fixture-secret",
        }),
        redirect: "error",
      }),
    );
    expect(models.map((model) => model.id)).toEqual([
      "alpha",
      "beta",
      "configured-alias",
    ]);
    expect(JSON.stringify(models)).not.toContain("fixture-secret");
    expect(models[0]?.thinkingLevels).not.toContain("max");
  });

  it("uses the Anthropic model-list path and headers", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ id: "claude-custom", display_name: "Claude custom" }],
        }),
      ),
    );
    const models = await listProviderModels(
      { ...provider, kind: "anthropic", baseUrl: "https://anthropic.example" },
      fetcher,
    );
    expect(fetcher).toHaveBeenCalledWith(
      "https://anthropic.example/v1/models",
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-api-key": "fixture-secret",
          "anthropic-version": "2023-06-01",
        }),
      }),
    );
    expect(models.find((model) => model.id === "claude-custom")?.name).toBe(
      "Claude custom",
    );
  });

  it("does not forward upstream errors or credentials to the browser", async () => {
    const directory = mkdtempSync(join(tmpdir(), "grimoire-models-"));
    try {
      const settings = new SettingsStore(join(directory, "providers.json"));
      settings.save(provider, provider.id);
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("upstream fixture-secret", { status: 401 }),
      );
      const response = await createApp(settings).request(
        "/api/providers/discover",
        {
          method: "POST",
          headers: {
            "Accept-Language": "en",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            id: provider.id,
            provider: { ...provider, apiKey: "" },
          }),
        },
      );
      expect(response.status).toBe(502);
      expect(await response.text()).not.toContain("fixture-secret");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("does not silently clamp unknown advanced thinking levels", () => {
    expect(modelThinkingLevels({ ...provider, model: "gpt-4.1-mini" })).toEqual(
      ["off"],
    );
    expect(() => createGrimoireAgent(provider, "en", "max")).toThrow(
      "does not support",
    );
    expect(() => createGrimoireAgent(provider, "en", "xhigh")).toThrow(
      "does not support",
    );
  });
});
