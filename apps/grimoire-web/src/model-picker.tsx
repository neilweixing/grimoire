import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  LoaderCircle,
  RefreshCw,
  Search,
  Settings2,
} from "lucide-react";
import {
  DEMO_PROVIDER_ID,
  thinkingLevelSchema,
  type ProviderModel,
  type ProviderModelList,
  type ProviderSettings,
  type ThinkingLevel,
} from "@grimoire/core";
import { api } from "./api";
import { useI18n } from "./i18n";

const levelLabels: Record<ThinkingLevel, string> = {
  off: "Default",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
};

export function ModelPicker({
  settings,
  thinkingLevel,
  onThinkingLevelChange,
  onSelectModel,
  onConfigureModel,
  pending,
}: {
  settings: ProviderSettings;
  thinkingLevel: ThinkingLevel;
  onThinkingLevelChange: (level: ThinkingLevel) => void | Promise<void>;
  onSelectModel: (providerId: string, model: string) => Promise<void>;
  onConfigureModel: () => void;
  pending: boolean;
}) {
  const { t } = useI18n();
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"main" | "models" | "thinking">("main");
  const [providerId, setProviderId] = useState(
    settings.activeProviderId === DEMO_PROVIDER_ID
      ? (settings.providers[0]?.id ?? "")
      : settings.activeProviderId,
  );
  const [query, setQuery] = useState("");
  const [catalog, setCatalog] = useState<{
    providerId: string;
    models: ProviderModel[];
  }>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [listError, setListError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const active = settings.providers.find(
    (provider) => provider.id === settings.activeProviderId,
  );
  const isDemo = settings.activeProviderId === DEMO_PROVIDER_ID;
  const modelLabel = isDemo
    ? t("selectModel")
    : settings.activeModel || active?.model || t("configure");
  const levels = settings.thinkingLevels ?? [
    "off",
    "minimal",
    "low",
    "medium",
    "high",
  ];
  const selectedLevel = isDemo ? "off" : thinkingLevel;

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);

  useEffect(() => {
    if (open && view !== "models")
      (
        panel.current?.querySelector<HTMLButtonElement>(
          'button[aria-checked="true"]:not(:disabled)',
        ) ??
        panel.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")
      )?.focus();
  }, [open, view]);

  useEffect(() => {
    if (
      !open ||
      view !== "models" ||
      !providerId ||
      providerId === DEMO_PROVIDER_ID
    )
      return;
    const controller = new AbortController();
    setLoading(true);
    setListError("");
    void api<ProviderModelList>(
      `/providers/${encodeURIComponent(providerId)}/models`,
      { signal: controller.signal },
    )
      .then((result) => {
        if (!controller.signal.aborted)
          setCatalog({ providerId, models: result.models });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setListError(
            error instanceof Error ? error.message : t("modelListFailed"),
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [open, view, providerId, refresh]);

  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  const keyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLSelectElement
    )
      return;
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const buttons = [
      ...(panel.current?.querySelectorAll<HTMLButtonElement>(
        "button:not(:disabled)",
      ) ?? []),
    ];
    if (!buttons.length) return;
    event.preventDefault();
    const current = buttons.indexOf(
      document.activeElement as HTMLButtonElement,
    );
    const index =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? buttons.length - 1
          : (current + (event.key === "ArrowUp" ? -1 : 1) + buttons.length) %
            buttons.length;
    buttons[index]?.focus();
  };

  const configured = settings.providers.find(
    (provider) => provider.id === providerId,
  );
  const choices = new Map<string, ProviderModel>();
  if (configured)
    choices.set(configured.model, {
      id: configured.model,
      name: configured.model,
      thinkingLevels: ["off", "minimal", "low", "medium", "high"],
    });
  if (providerId === settings.activeProviderId && settings.activeModel)
    choices.set(settings.activeModel, {
      id: settings.activeModel,
      name: settings.activeModel,
      thinkingLevels: levels,
    });
  if (catalog?.providerId === providerId)
    for (const model of catalog.models) choices.set(model.id, model);
  const models = [...choices.values()].filter((model) =>
    `${model.id} ${model.name}`.toLowerCase().includes(query.toLowerCase()),
  );
  const select = async (model: ProviderModel) => {
    setError("");
    try {
      await onSelectModel(providerId, model.id);
      close();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : t("modelSelectionFailed"),
      );
    }
  };

  return (
    <div className="model-picker" ref={root} onKeyDown={keyDown}>
      <button
        type="button"
        ref={trigger}
        className="model-selector"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${t("modelOptions")}: ${modelLabel}, ${levelLabels[selectedLevel]}`}
        title={active ? `${active.name} · ${modelLabel}` : modelLabel}
        disabled={pending}
        onClick={() => {
          setOpen(!open);
          setView("main");
          setProviderId(
            settings.activeProviderId === DEMO_PROVIDER_ID
              ? (settings.providers[0]?.id ?? "")
              : settings.activeProviderId,
          );
          setQuery("");
          setError("");
        }}
      >
        {pending && <LoaderCircle size={12} className="spin" />}
        <span className="model-selector-label">{modelLabel}</span>
        <span className="selected-thinking">{levelLabels[selectedLevel]}</span>
        <ChevronDown size={12} className={open ? "chevron-open" : ""} />
      </button>
      {open && (
        <div
          className={`model-popover ${view === "models" ? "model-popover-wide" : ""}`}
          ref={panel}
          role="dialog"
          aria-label={t("modelOptions")}
        >
          {view === "main" ? (
            <>
              <button
                type="button"
                className="model-menu-row"
                onClick={() => setView("models")}
              >
                <span>{t("model")}</span>
                <span className="model-menu-value">{modelLabel}</span>
                <ChevronRight size={13} />
              </button>
              <button
                type="button"
                className="model-menu-row"
                disabled={isDemo}
                title={t(
                  isDemo ? "demoThinkingUnavailable" : "thinkingNextMessage",
                )}
                onClick={() => setView("thinking")}
              >
                <span>{t("thinkingDepth")}</span>
                <span className="model-menu-value">
                  {levelLabels[selectedLevel]}
                </span>
                <ChevronRight size={13} />
              </button>
              <div className="model-menu-divider" />
              <button
                type="button"
                className="model-menu-row model-menu-settings"
                onClick={() => {
                  close();
                  onConfigureModel();
                }}
              >
                <Settings2 size={14} />
                {t("providersTitle")}
              </button>
            </>
          ) : (
            <>
              <div className="model-popover-heading">
                <button
                  type="button"
                  className="icon-button"
                  aria-label={t("back")}
                  onClick={() => {
                    setView("main");
                    setError("");
                  }}
                >
                  <ArrowLeft size={15} />
                </button>
                <strong>
                  {t(view === "models" ? "selectModel" : "thinkingDepth")}
                </strong>
                {view === "models" && providerId !== DEMO_PROVIDER_ID && (
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={t("refreshModels")}
                    disabled={loading}
                    onClick={() => setRefresh((value) => value + 1)}
                  >
                    {loading ? (
                      <LoaderCircle size={14} className="spin" />
                    ) : (
                      <RefreshCw size={14} />
                    )}
                  </button>
                )}
              </div>
              {view === "models" ? (
                <>
                  <label className="model-provider-field">
                    {t("providers")}
                    <select
                      aria-label={t("providers")}
                      value={providerId}
                      disabled={pending}
                      onChange={(event) => {
                        setProviderId(event.target.value);
                        setQuery("");
                        setError("");
                        setListError("");
                      }}
                    >
                      <option value="" disabled>
                        {t("selectModel")}
                      </option>
                      {settings.providers.map((provider) => (
                        <option key={provider.id} value={provider.id}>
                          {provider.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="model-search">
                    <Search size={13} />
                    <input
                      autoFocus
                      aria-label={t("searchModels")}
                      placeholder={t("searchModels")}
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                    />
                  </div>
                  {listError && (
                    <p className="model-list-notice" role="status">
                      {listError}
                    </p>
                  )}
                  <div
                    className="model-choice-list"
                    role="menu"
                    aria-label={t("selectModel")}
                  >
                    {models.map((model) => (
                      <button
                        type="button"
                        role="menuitemradio"
                        aria-checked={
                          (settings.activeProviderId === providerId &&
                            modelLabel === model.id) ||
                          (isDemo && providerId === DEMO_PROVIDER_ID)
                        }
                        disabled={pending}
                        className="model-choice"
                        key={model.id}
                        onClick={() => void select(model)}
                      >
                        <span>
                          <strong>{model.name}</strong>
                          {model.name !== model.id && <small>{model.id}</small>}
                        </span>
                        {(settings.activeProviderId === providerId &&
                          modelLabel === model.id) ||
                        (isDemo && providerId === DEMO_PROVIDER_ID) ? (
                          <Check size={14} />
                        ) : null}
                      </button>
                    ))}
                    {!models.length && (
                      <p className="model-list-notice">{t("noModels")}</p>
                    )}
                  </div>
                </>
              ) : (
                <div
                  className="thinking-choice-list"
                  role="menu"
                  aria-label={t("thinkingDepth")}
                >
                  {thinkingLevelSchema.options.map((level) => (
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={thinkingLevel === level}
                      disabled={pending || !levels.includes(level)}
                      title={
                        !levels.includes(level)
                          ? t("thinkingLevelUnavailable")
                          : t("thinkingNextMessage")
                      }
                      className="model-choice"
                      key={level}
                      onClick={() => {
                        void Promise.resolve(onThinkingLevelChange(level))
                          .then(close)
                          .catch((error) =>
                            setError(
                              error instanceof Error
                                ? error.message
                                : t("modelSelectionFailed"),
                            ),
                          );
                      }}
                    >
                      <span>{levelLabels[level]}</span>
                      {thinkingLevel === level && <Check size={14} />}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
          {error && (
            <p className="model-list-notice error-text" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
