import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  Check,
  LoaderCircle,
  RefreshCw,
  FlaskConical,
  Trash2,
  X,
} from "lucide-react";
import {
  thinkingLevelSchema,
  configuredModelIds,
  type ModelCapabilities,
  type ModelProbeResult,
  type ProviderCatalog,
  type ProviderInput,
  type ProviderModel,
  type ProviderModelList,
  type PublicProvider,
  type ThinkingLevel,
} from "@grimoire/core";
import { ConfirmDialog } from "./confirm-dialog";
import { Select } from "./select";
import { api } from "./api";
import { useI18n } from "./i18n";
import { levelLabels } from "./model-picker";

export function ProviderForm({
  provider,
  pending,
  onSave,
  onCancel,
}: {
  provider?: PublicProvider;
  pending: boolean;
  onSave: (input: ProviderInput) => Promise<boolean>;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [form, setForm] = useState<ProviderInput>(() =>
    provider
      ? {
          ...provider,
          apiKey: "",
          contextWindow: undefined,
          modelOverrides: {
            ...provider.modelOverrides,
            ...(provider.contextWindow
              ? {
                  [provider.model]: {
                    contextWindow: provider.contextWindow,
                    ...provider.modelOverrides?.[provider.model],
                  },
                }
              : {}),
          },
        }
      : {
          name: "",
          kind: "native",
          nativeProvider: "openai",
          model: "",
          apiKey: "",
        },
  );
  const [editingModel, setEditingModel] = useState(provider?.model ?? "");
  const [probeConfirm, setProbeConfirm] = useState(false);
  const [probing, setProbing] = useState(false);
  const configured = form.model ? configuredModelIds(form) : [];
  const addModel = (id: string) => {
    setForm((value) => ({
      ...value,
      model: value.model || id,
      models: [
        ...new Set([...(value.model ? configuredModelIds(value) : []), id]),
      ],
    }));
    setEditingModel(id);
  };
  const removeModel = (id: string) => {
    const remaining = configured.filter((model) => model !== id);
    setForm((value) => {
      const modelOverrides = { ...value.modelOverrides };
      delete modelOverrides[id];
      return {
        ...value,
        model: value.model === id ? (remaining[0] ?? "") : value.model,
        models: remaining,
        modelOverrides,
      };
    });
    if (editingModel === id) setEditingModel(remaining[0] ?? "");
  };
  const [catalog, setCatalog] = useState<ProviderCatalog["providers"]>([]);
  const [remote, setRemote] = useState<ProviderModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [discovering, setDiscovering] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void api<ProviderCatalog>("/providers/catalog", {
      signal: controller.signal,
    })
      .then((result) => {
        setCatalog(result.providers);
        if (!provider)
          setForm((value) => ({ ...value, name: value.name || "OpenAI" }));
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(t("modelListFailed"));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
      request.current?.abort();
    };
  }, []);
  const native = form.kind === "native";
  const preset = catalog.find((item) => item.id === form.nativeProvider);
  const models = native ? (preset?.models ?? []) : remote;
  const builtin = (
    native
      ? preset
      : catalog.find(
          (item) =>
            item.id === (form.kind === "anthropic" ? "anthropic" : "openai"),
        )
  )?.models.find((model) => model.id === editingModel);
  const automatic = {
    ...builtin,
    ...form.modelMetadata?.[editingModel],
    ...models.find((model) => model.id === editingModel),
  };
  const override = form.modelOverrides?.[editingModel] ?? {};
  const setOverride = (patch: Partial<ModelCapabilities>) =>
    setForm((value) => ({
      ...value,
      modelOverrides: {
        ...value.modelOverrides,
        [editingModel]: { ...value.modelOverrides?.[editingModel], ...patch },
      },
    }));
  const sameConnection =
    provider &&
    provider.kind === form.kind &&
    provider.nativeProvider === form.nativeProvider &&
    (provider.baseUrl || "") === (form.baseUrl || "");
  const connect = (input: ProviderInput) => {
    request.current?.abort();
    setRemote([]);
    setError("");
    setForm(input);
    setEditingModel(input.model);
  };
  const discover = async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setDiscovering(true);
    setError("");
    try {
      const result = await api<ProviderModelList>("/providers/discover", {
        method: "POST",
        signal: controller.signal,
        body: JSON.stringify({
          id: provider?.id,
          provider: { ...form, models: form.model ? form.models : undefined },
        }),
      });
      if (controller.signal.aborted) return;
      setRemote(result.models);
      const metadata = Object.fromEntries(
        result.models
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
      setForm((value) => ({
        ...value,
        modelMetadata: { ...value.modelMetadata, ...metadata },
      }));
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : t("modelListFailed"));
    } finally {
      if (!controller.signal.aborted) setDiscovering(false);
    }
  };
  const probe = async () => {
    setProbeConfirm(false);
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setProbing(true);
    setError("");
    try {
      const result = await api<ModelProbeResult>("/providers/probe", {
        method: "POST",
        signal: controller.signal,
        body: JSON.stringify({
          id: provider?.id,
          provider: { ...form, model: editingModel },
        }),
      });
      if (!controller.signal.aborted) {
        const accepted = result.results
          .filter((item) => item.status === "accepted")
          .map((item) => item.level);
        if (accepted.length) {
          const previous = override.thinkingLevels ??
            automatic.thinkingLevels ?? ["off"];
          const statuses = new Map(
            result.results.map((item) => [item.level, item.status]),
          );
          setOverride({
            thinkingLevels: thinkingLevelSchema.options.filter(
              (level) =>
                accepted.includes(level) ||
                (previous.includes(level) &&
                  statuses.get(level) !== "rejected"),
            ),
          });
        }
      }
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(
          cause instanceof Error ? cause.message : t("modelProbeFailed"),
        );
    } finally {
      if (!controller.signal.aborted) setProbing(false);
    }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void onSave(form);
  };
  const levels = override.thinkingLevels ??
    automatic?.thinkingLevels ?? ["off"];
  const toggleLevel = (level: ThinkingLevel) => {
    const next = levels.includes(level)
      ? levels.filter((item) => item !== level)
      : [...levels, level];
    setOverride({ thinkingLevels: next.length ? next : ["off"] });
  };
  const numberPlaceholder = (value?: number) =>
    value
      ? `${t("automatic")} · ${value.toLocaleString()}`
      : t("capabilityUnknown");
  return (
    <form className="provider-form" onSubmit={submit}>
      <div className="form-heading">
        <h4>{provider ? t("editProvider") : t("addProvider")}</h4>
        <button
          type="button"
          className="icon-button"
          aria-label={t("cancelEdit")}
          onClick={onCancel}
        >
          <X size={16} />
        </button>
      </div>
      <fieldset
        className="provider-fields"
        disabled={pending || discovering || probing}
      >
        <div
          className="provider-mode"
          role="group"
          aria-label={t("connectionType")}
        >
          <button
            type="button"
            aria-pressed={native}
            onClick={() =>
              connect({
                name: "OpenAI",
                kind: "native",
                nativeProvider: "openai",
                model: "",
                apiKey: "",
              })
            }
          >
            {t("presetProvider")}
          </button>
          <button
            type="button"
            aria-pressed={!native}
            onClick={() =>
              connect({
                name: "",
                kind: "openai-compatible",
                model: "",
                baseUrl: "",
                apiKey: "",
              })
            }
          >
            {t("customProvider")}
          </button>
        </div>
        <div className="form-grid">
          {native ? (
            <label className="full-width">
              {t("presetProvider")}
              <Select
                label={t("presetProvider")}
                value={form.nativeProvider || ""}
                disabled={loading}
                searchable
                options={
                  loading
                    ? [{ value: "openai", label: "OpenAI" }]
                    : catalog.map((item) => ({
                        value: item.id,
                        label: item.name,
                      }))
                }
                onChange={(value) => {
                  const selected = catalog.find((item) => item.id === value)!;
                  connect({
                    name: selected.name,
                    kind: "native",
                    nativeProvider: selected.id,
                    model: "",
                    apiKey: "",
                  });
                }}
              />
            </label>
          ) : (
            <>
              <label>
                {t("apiType")}
                <Select
                  label={t("apiType")}
                  value={form.kind}
                  options={[
                    {
                      value: "openai-compatible",
                      label: "OpenAI Chat Completions",
                    },
                    { value: "openai", label: "OpenAI Responses" },
                    { value: "anthropic", label: "Anthropic Messages" },
                  ]}
                  onChange={(value) =>
                    connect({
                      ...form,
                      kind: value as ProviderInput["kind"],
                      modelMetadata: undefined,
                      modelOverrides: undefined,
                    })
                  }
                />
              </label>
              <label>
                {t("name")}
                <input
                  required
                  maxLength={80}
                  value={form.name}
                  placeholder={t("namePlaceholder")}
                  onChange={(event) =>
                    setForm({ ...form, name: event.target.value })
                  }
                />
              </label>
              <label className="full-width">
                {t("apiUrl")}
                <input
                  type="url"
                  required
                  value={form.baseUrl || ""}
                  placeholder="https://api.example.com/v1"
                  onChange={(event) =>
                    connect({
                      ...form,
                      baseUrl: event.target.value,
                      modelMetadata: undefined,
                    })
                  }
                />
              </label>
            </>
          )}
          <label className="full-width">
            {t("apiKey")}
            <input
              type="password"
              autoComplete="new-password"
              value={form.apiKey || ""}
              required={native && !(sameConnection && provider.hasApiKey)}
              placeholder={
                sameConnection && provider.hasApiKey
                  ? t("keepKey")
                  : t("apiKey")
              }
              onChange={(event) =>
                setForm({ ...form, apiKey: event.target.value })
              }
            />
          </label>
          <label className="full-width">
            {t("addModel")}
            <div className="provider-model-input">
              <Select
                label={t("addModel")}
                value=""
                disabled={loading}
                searchable
                allowCustom={!native}
                placeholder={
                  native ? t("selectModel") : t("enterOrSelectModel")
                }
                options={models
                  .filter((model) => !configured.includes(model.id))
                  .map((model) => ({
                    value: model.id,
                    label: model.name,
                    description: model.name !== model.id ? model.id : undefined,
                  }))}
                onChange={addModel}
              />
              {!native && (
                <button
                  type="button"
                  className="small-button"
                  disabled={!form.baseUrl}
                  onClick={() => void discover()}
                >
                  <RefreshCw size={14} />
                  {t("fetchModels")}
                </button>
              )}
            </div>
          </label>
        </div>
        {configured.length > 0 && (
          <div className="configured-models" aria-label={t("configuredModels")}>
            {configured.map((id) => (
              <div className="configured-model-row" key={id}>
                <button
                  type="button"
                  className="configured-model-name"
                  aria-pressed={editingModel === id}
                  onClick={() => {
                    setEditingModel(id);
                  }}
                  title={id}
                >
                  <span>{id}</span>
                </button>
                <button
                  type="button"
                  className="text-button configured-model-default"
                  aria-label={`${t("setDefaultModel")}: ${id}`}
                  aria-pressed={form.model === id}
                  onClick={() => setForm({ ...form, model: id })}
                >
                  {form.model === id && <Check size={14} />}
                  {t(form.model === id ? "defaultModel" : "setDefaultModel")}
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`${t("removeModel")}: ${id}`}
                  onClick={() => removeModel(id)}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        )}
        {editingModel && (
          <section
            className="model-capabilities"
            aria-label={`${t("modelCapabilities")}: ${editingModel}`}
          >
            <p className="capability-model-id">{editingModel}</p>
            <div className="form-heading">
              <h4>{t("modelCapabilities")}</h4>
              <div className="capability-actions">
                <button
                  type="button"
                  className="text-button"
                  onClick={() =>
                    setForm((value) => ({
                      ...value,
                      modelOverrides: {
                        ...value.modelOverrides,
                        [editingModel]: {},
                      },
                    }))
                  }
                >
                  {t("useAutomatic")}
                </button>
              </div>
            </div>
            <div className="form-grid">
              <label>
                {t("contextWindowSize")}
                <input
                  type="number"
                  min={1}
                  max={10_000_000}
                  step={1}
                  value={override.contextWindow ?? ""}
                  placeholder={numberPlaceholder(automatic?.contextWindow)}
                  onChange={(event) =>
                    setOverride({
                      contextWindow: event.target.value
                        ? Number(event.target.value)
                        : undefined,
                    })
                  }
                />
              </label>
              <label>
                {t("maxOutputTokens")}
                <input
                  type="number"
                  min={1}
                  max={10_000_000}
                  step={1}
                  value={override.maxTokens ?? ""}
                  placeholder={numberPlaceholder(automatic?.maxTokens)}
                  onChange={(event) =>
                    setOverride({
                      maxTokens: event.target.value
                        ? Number(event.target.value)
                        : undefined,
                    })
                  }
                />
              </label>
              <label className="full-width">
                {t("inputModalities")}
                <Select
                  label={t("inputModalities")}
                  value={
                    override.input?.includes("image")
                      ? "image"
                      : override.input
                        ? "text"
                        : "auto"
                  }
                  options={[
                    {
                      value: "auto",
                      label: `${t("automatic")} · ${automatic?.input ? (automatic.input.includes("image") ? t("textAndImages") : t("textOnly")) : t("capabilityUnknown")}`,
                    },
                    { value: "text", label: t("textOnly") },
                    { value: "image", label: t("textAndImages") },
                  ]}
                  onChange={(value) =>
                    setOverride({
                      input:
                        value === "auto"
                          ? undefined
                          : value === "image"
                            ? ["text", "image"]
                            : ["text"],
                    })
                  }
                />
              </label>
            </div>
            <fieldset className="reasoning-levels">
              <legend>
                {t("thinkingDepth")}
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setProbeConfirm(true)}
                >
                  <FlaskConical size={14} />
                  {t("probeCapabilities")}
                </button>
                <span>
                  {override.thinkingLevels
                    ? t("manualCapabilities")
                    : automatic?.thinkingLevels
                      ? t("automatic")
                      : t("capabilityUnknown")}
                </span>
              </legend>
              <div>
                {thinkingLevelSchema.options.map((level) => (
                  <label key={level}>
                    <input
                      type="checkbox"
                      checked={levels.includes(level)}
                      onChange={() => toggleLevel(level)}
                    />
                    {levelLabels[level]}
                  </label>
                ))}
              </div>
            </fieldset>
          </section>
        )}
      </fieldset>
      {(error || discovering || probing) && (
        <p
          className={error ? "error-banner" : "provider-loading"}
          role="status"
        >
          {discovering || probing ? (
            <LoaderCircle size={14} className="spin" />
          ) : null}
          {error || t(probing ? "probingModel" : "loadingModels")}
        </p>
      )}
      <div className="form-footer">
        <button type="button" className="text-button" onClick={onCancel}>
          {t("cancel")}
        </button>
        <button
          className="primary-button"
          disabled={pending || discovering || probing || loading || !form.model}
          type="submit"
        >
          {pending && <LoaderCircle size={14} className="spin" />}
          {t("saveProvider")}
        </button>
      </div>
      <ConfirmDialog
        open={probeConfirm}
        title={t("probeCapabilities")}
        description={t("modelProbeConfirm").replace("{model}", editingModel)}
        confirmLabel={t("startModelProbe")}
        pending={false}
        icon={FlaskConical}
        tone="primary"
        onCancel={() => setProbeConfirm(false)}
        onConfirm={() => void probe()}
      />
    </form>
  );
}
