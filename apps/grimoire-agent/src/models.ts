import {
  modelCapabilitiesSchema,
  type ModelCapabilities,
  type ProviderModel,
} from "@grimoire/core";
import {
  describeModel,
  nativeProvider,
  selectProviderModel,
} from "./provider-catalog.js";
import type { StoredProvider } from "./settings.js";

function remoteCapabilities(value: Record<string, unknown>): ModelCapabilities {
  const architecture = value.architecture as
    Record<string, unknown> | undefined;
  const top = value.top_provider as Record<string, unknown> | undefined;
  const fields = {
    contextWindow: value.contextWindow ?? value.context_length,
    maxTokens:
      value.maxTokens ?? value.max_output_tokens ?? top?.max_completion_tokens,
    input: value.input ?? architecture?.input_modalities,
    thinkingLevels: value.thinkingLevels,
  };
  const result: Record<string, unknown> = {};
  // Validate fields independently: an unsupported modality must not hide valid limits.
  for (const [key, item] of Object.entries(fields)) {
    if (item === undefined || item === null) continue;
    const normalized =
      key === "input" && Array.isArray(item)
        ? item.filter((modality) => modality === "text" || modality === "image")
        : item;
    const parsed = modelCapabilitiesSchema.safeParse({ [key]: normalized });
    if (parsed.success) Object.assign(result, parsed.data);
  }
  return result;
}

export function discoveryMetadata(
  models: ProviderModel[],
): Record<string, ModelCapabilities> {
  return Object.fromEntries(
    models
      .filter((model) => model.source === "remote")
      .map((model) => [
        model.id,
        {
          contextWindow: model.contextWindow,
          maxTokens: model.maxTokens,
          input: model.input,
          thinkingLevels: model.thinkingLevels,
        },
      ]),
  );
}

export async function listProviderModels(
  provider: StoredProvider,
  fetcher: typeof fetch = fetch,
): Promise<ProviderModel[]> {
  if (provider.kind === "native") {
    const native = nativeProvider(provider.nativeProvider);
    if (!native) throw new Error("Unknown native provider.");
    return native
      .getModels()
      .map((model) =>
        describeModel(selectProviderModel(provider, model.id), model.name),
      )
      .sort((a, b) => a.id.localeCompare(b.id));
  }
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
    const metadata = remoteCapabilities(value);
    const selected = selectProviderModel(provider, value.id);
    if (Object.keys(metadata).length)
      selected.modelMetadata = {
        ...provider.modelMetadata,
        [value.id]: metadata,
      };
    const model = describeModel(selected, name);
    // Discovery returns the automatic values; manual overrides are applied at runtime.
    models.set(value.id, {
      ...model,
      ...(Object.keys(metadata).length ? { source: "remote" } : {}),
    });
  }
  if (provider.model !== "__discovery__" && !models.has(provider.model))
    models.set(provider.model, describeModel(provider));
  return [...models.values()].sort((a, b) => a.id.localeCompare(b.id));
}
