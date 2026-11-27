import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  DEMO_PROVIDER_ID,
  providerInputSchema,
  type ProviderInput,
  type ProviderSettings,
} from "@grimoire/core";

export type StoredProvider = ProviderInput & { id: string };
type StoredSettings = {
  providers: StoredProvider[];
  activeProviderId: string;
  activeModel?: string;
};
const defaultPath = fileURLToPath(
  new URL("../../../.data/providers.json", import.meta.url),
);

export class SettingsStore {
  private state: StoredSettings;
  constructor(
    private readonly filePath = process.env.GRIMOIRE_SETTINGS_FILE ||
      process.env.DATAPI_SETTINGS_FILE ||
      defaultPath,
  ) {
    try {
      const parsed = JSON.parse(
        readFileSync(filePath, "utf8"),
      ) as StoredSettings;
      if (
        !Array.isArray(parsed.providers) ||
        typeof parsed.activeProviderId !== "string"
      ) {
        throw new Error("供应商配置格式不正确");
      }
      this.state = {
        providers: parsed.providers.map((p) => ({
          ...providerInputSchema.parse(p),
          id: p.id,
        })),
        activeProviderId: parsed.activeProviderId,
        activeModel: parsed.activeModel,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      this.state = { providers: [], activeProviderId: DEMO_PROVIDER_ID };
    }
  }

  publicSettings(): ProviderSettings {
    return {
      activeProviderId: this.state.activeProviderId,
      ...(this.state.activeModel
        ? { activeModel: this.state.activeModel }
        : {}),
      providers: this.state.providers.map(({ apiKey, ...provider }) => ({
        ...provider,
        hasApiKey: Boolean(apiKey),
      })),
    };
  }

  active(): StoredProvider | undefined {
    const provider = this.get(this.state.activeProviderId);
    if (
      !provider ||
      !this.state.activeModel ||
      this.state.activeModel === provider.model
    )
      return provider;
    return {
      ...provider,
      model: this.state.activeModel,
      contextWindow: undefined,
    };
  }

  get(id: string): StoredProvider | undefined {
    return this.state.providers.find((provider) => provider.id === id);
  }

  selectModel(id: string, model: string): void {
    if (id === DEMO_PROVIDER_ID) {
      this.activate(id);
      return;
    }
    if (!this.has(id)) throw new Error("Provider not found");
    this.persist({ ...this.state, activeProviderId: id, activeModel: model });
  }

  save(input: ProviderInput, id: string = randomUUID()): void {
    const previous = this.state.providers.find((p) => p.id === id);
    const provider = { ...input, id, apiKey: input.apiKey || previous?.apiKey };
    const providers = this.state.providers.filter((p) => p.id !== id);
    this.persist({
      ...this.state,
      providers: [...providers, provider],
      activeModel:
        this.state.activeProviderId === id && input.model !== previous?.model
          ? undefined
          : this.state.activeModel,
    });
  }

  has(id: string): boolean {
    return this.state.providers.some((p) => p.id === id);
  }

  activate(id: string): void {
    if (id !== DEMO_PROVIDER_ID && !this.has(id))
      throw new Error("供应商不存在");
    this.persist({
      ...this.state,
      activeProviderId: id,
      activeModel: undefined,
    });
  }

  remove(id: string): void {
    this.persist({
      providers: this.state.providers.filter((p) => p.id !== id),
      activeProviderId:
        this.state.activeProviderId === id
          ? DEMO_PROVIDER_ID
          : this.state.activeProviderId,
      activeModel:
        this.state.activeProviderId === id ? undefined : this.state.activeModel,
    });
  }

  private persist(next: StoredSettings): void {
    mkdirSync(dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temp = join(dirname(this.filePath), `.providers-${randomUUID()}.tmp`);
    writeFileSync(temp, JSON.stringify(next, null, 2), { mode: 0o600 });
    renameSync(temp, this.filePath);
    this.state = next;
  }
}
