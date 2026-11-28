import {
  getSupportedThinkingLevels,
  type Api,
  type Model,
} from "@earendil-works/pi-ai";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import {
  thinkingLevelSchema,
  type ModelCapabilities,
  type ProviderCatalog,
  type ProviderInput,
  type ProviderModel,
} from "@grimoire/core";

// These presets use a single API key. Providers needing OAuth, an account ID,
// or a cloud credential chain need their own connection flow.
const providers = new Map(
  builtinProviders()
    .filter(
      (provider) =>
        provider.baseUrl &&
        provider.auth.apiKey &&
        provider.getModels().length &&
        provider.id !== "github-copilot",
    )
    .map((provider) => [provider.id, provider]),
);

export function nativeProvider(id?: string) {
  return id ? providers.get(id) : undefined;
}

export function knownModel(provider: ProviderInput): Model<Api> | undefined {
  const id =
    provider.kind === "native"
      ? provider.nativeProvider
      : provider.kind === "anthropic"
        ? "anthropic"
        : "openai";
  return nativeProvider(id)
    ?.getModels()
    .find((model) => model.id === provider.model);
}

export function modelCapabilities(provider: ProviderInput): ModelCapabilities {
  const known = knownModel(provider);
  const baseline: ModelCapabilities = known
    ? {
        contextWindow: known.contextWindow,
        maxTokens: known.maxTokens,
        input: [...known.input],
        thinkingLevels: getSupportedThinkingLevels(known),
      }
    : {};
  return {
    ...baseline,
    ...provider.modelMetadata?.[provider.model],
    ...(provider.contextWindow
      ? { contextWindow: provider.contextWindow }
      : {}),
    ...provider.modelOverrides?.[provider.model],
  };
}

export function describeModel(
  provider: ProviderInput,
  name = provider.model,
): ProviderModel {
  const capabilities = modelCapabilities(provider);
  return {
    id: provider.model,
    name,
    ...capabilities,
    thinkingLevels: capabilities.thinkingLevels ?? ["off"],
    source: Object.keys(provider.modelOverrides?.[provider.model] ?? {}).length
      ? "custom"
      : provider.modelMetadata?.[provider.model]
        ? "remote"
        : knownModel(provider)
          ? "sdk"
          : undefined,
  };
}

export function providerCatalog(): ProviderCatalog {
  return {
    providers: [...providers.values()]
      .map((provider) => ({
        id: provider.id,
        name: provider.name,
        baseUrl: provider.baseUrl!,
        models: provider
          .getModels()
          .map((model) =>
            describeModel(
              {
                name: provider.name,
                kind: "native",
                nativeProvider: provider.id,
                model: model.id,
              },
              model.name,
            ),
          )
          .sort((a, b) => a.id.localeCompare(b.id)),
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export function selectProviderModel<T extends ProviderInput>(
  provider: T,
  model: string,
): T {
  return {
    ...provider,
    model,
    contextWindow:
      model === provider.model ? provider.contextWindow : undefined,
  };
}

export function thinkingLevelMap(provider: ProviderInput) {
  const explicit =
    provider.modelOverrides?.[provider.model]?.thinkingLevels ??
    provider.modelMetadata?.[provider.model]?.thinkingLevels;
  if (!explicit) return knownModel(provider)?.thinkingLevelMap;
  const original = knownModel(provider)?.thinkingLevelMap;
  return Object.fromEntries(
    thinkingLevelSchema.options.map((level) => [
      level,
      explicit.includes(level)
        ? (original?.[level] ??
          (level === "xhigh" || level === "max" ? level : undefined))
        : null,
    ]),
  );
}
