import type { ProviderModel } from "@grimoire/core";
import { modelThinkingLevels } from "./agent.js";
import type { StoredProvider } from "./settings.js";

export async function listProviderModels(
  provider: StoredProvider,
  fetcher: typeof fetch = fetch,
): Promise<ProviderModel[]> {
  const base = (
    provider.baseUrl ||
    (provider.kind === "anthropic"
      ? "https://api.anthropic.com"
      : "https://api.openai.com/v1")
  ).replace(/\/+$/, "");
  const path =
    provider.kind === "anthropic" && !base.endsWith("/v1")
      ? "/v1/models"
      : "/models";
  const headers: Record<string, string> = { Accept: "application/json" };
  if (provider.kind === "anthropic") {
    headers["anthropic-version"] = "2023-06-01";
    if (provider.apiKey) headers["x-api-key"] = provider.apiKey;
  } else if (provider.apiKey)
    headers.Authorization = `Bearer ${provider.apiKey}`;
  const response = await fetcher(`${base}${path}`, {
    headers,
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("Model discovery failed");
  const body: unknown = await response.json();
  const data =
    body && typeof body === "object" && "data" in body ? body.data : undefined;
  if (!Array.isArray(data)) throw new Error("Invalid model list");
  const models = new Map<string, ProviderModel>();
  for (const value of data) {
    if (
      !value ||
      typeof value !== "object" ||
      typeof value.id !== "string" ||
      !value.id.trim() ||
      value.id.length > 200
    )
      continue;
    const name =
      typeof value.display_name === "string"
        ? value.display_name
        : typeof value.name === "string"
          ? value.name
          : value.id;
    models.set(value.id, {
      id: value.id,
      name,
      thinkingLevels: modelThinkingLevels({ ...provider, model: value.id }),
    });
  }
  // Keep the explicitly configured model selectable when an upstream list omits aliases.
  if (!models.has(provider.model))
    models.set(provider.model, {
      id: provider.model,
      name: provider.model,
      thinkingLevels: modelThinkingLevels(provider),
    });
  return [...models.values()].sort((a, b) => a.id.localeCompare(b.id));
}
