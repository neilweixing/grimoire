import { useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  LoaderCircle,
  Settings2,
} from "lucide-react";
import {
  DEMO_PROVIDER_ID,
  thinkingLevelSchema,
  configuredModelIds,
  type ProviderSettings,
  type ThinkingLevel,
} from "@grimoire/core";
import * as Menu from "./menu";
import { useI18n } from "./i18n";

export const levelLabels: Record<ThinkingLevel, string> = {
  off: "Default",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
};
type ModelMenuPage = "main" | "models" | "thinking";

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
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState<ModelMenuPage>("main");
  const [selecting, setSelecting] = useState(false);
  const [error, setError] = useState("");
  const skipRestore = useRef(false);
  const content = useRef<HTMLDivElement>(null);
  const active = settings.providers.find(
    (provider) => provider.id === settings.activeProviderId,
  );
  const isDemo = settings.activeProviderId === DEMO_PROVIDER_ID;
  const modelLabel = isDemo
    ? t("selectModel")
    : settings.activeModel || active?.model || t("configure");
  const levels = thinkingLevelSchema.options.filter((level) =>
    settings.thinkingLevels?.includes(level),
  );
  const selectedLevel = isDemo ? "off" : thinkingLevel;
  const busy = pending || selecting;
  const navigate = (next: ModelMenuPage) => {
    setPage(next);
    requestAnimationFrame(() => {
      const menu = content.current;
      const target =
        menu?.querySelector<HTMLElement>(
          '[aria-checked="true"]:not([data-disabled])',
        ) ??
        menu?.querySelector<HTMLElement>(
          '[role="menuitemradio"]:not([data-disabled])',
        ) ??
        menu;
      target?.focus({ preventScroll: true });
    });
  };
  const select = async (action: () => void | Promise<void>) => {
    if (busy) return;
    setSelecting(true);
    setError("");
    try {
      await action();
      setOpen(false);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : t("modelSelectionFailed"),
      );
    } finally {
      setSelecting(false);
    }
  };
  return (
    <div className="model-picker">
      <Menu.Root
        modal={false}
        open={open}
        onOpenChange={(value) => {
          setOpen(value);
          if (value) {
            setError("");
            setPage("main");
          }
        }}
      >
        <Menu.Trigger asChild>
          <button
            type="button"
            className="model-selector"
            aria-label={`${t("modelOptions")}: ${modelLabel}, ${levelLabels[selectedLevel]}`}
            title={active ? `${active.name} · ${modelLabel}` : modelLabel}
            disabled={busy}
          >
            {busy && <LoaderCircle size={12} className="spin" />}
            <span className="model-selector-label">{modelLabel}</span>
            <span className="selected-thinking">
              {levelLabels[selectedLevel]}
            </span>
            <ChevronDown size={12} className={open ? "chevron-open" : ""} />
          </button>
        </Menu.Trigger>
        <Menu.Content
          ref={content}
          className="model-menu"
          data-page={page}
          aria-label={
            page === "models"
              ? t("selectModel")
              : page === "thinking"
                ? t("thinkingDepth")
                : t("modelOptions")
          }
          onCloseAutoFocus={(event) => {
            if (skipRestore.current) {
              event.preventDefault();
              skipRestore.current = false;
            }
          }}
        >
          {page === "main" ? (
            <>
              <Menu.Item
                className="model-page-trigger"
                data-model-page="models"
                disabled={busy}
                onSelect={(event) => {
                  event.preventDefault();
                  navigate("models");
                }}
              >
                <span>{t("model")}</span>
                <span className="menu-item-label model-current-value">
                  {modelLabel}
                </span>
                <ChevronRight size={14} />
              </Menu.Item>
              <Menu.Item
                className="thinking-menu-trigger"
                data-model-page="thinking"
                disabled={isDemo || busy || !levels.length}
                onSelect={(event) => {
                  event.preventDefault();
                  navigate("thinking");
                }}
              >
                <span className="menu-item-label">{t("thinkingDepth")}</span>
                <span className="menu-current-value">
                  {levelLabels[selectedLevel]}
                </span>
                <ChevronRight size={14} />
              </Menu.Item>
              <Menu.Separator />
              <Menu.Item
                disabled={busy}
                onSelect={() => {
                  skipRestore.current = true;
                  setOpen(false);
                  onConfigureModel();
                }}
              >
                <Settings2 size={16} />
                <span className="menu-item-label">{t("providersTitle")}</span>
              </Menu.Item>
            </>
          ) : (
            <>
              <div className="cascade-menu-list">
                {page === "models" ? (
                  <>
                    {settings.providers.map((provider) => (
                      <div className="model-provider-group" key={provider.id}>
                        <Menu.Label>{provider.name}</Menu.Label>
                        <Menu.RadioGroup
                          aria-label={provider.name}
                          value={
                            settings.activeProviderId === provider.id
                              ? modelLabel
                              : ""
                          }
                        >
                          {configuredModelIds(provider).map((id) => (
                            <Menu.RadioItem
                              value={id}
                              key={id}
                              disabled={busy}
                              textValue={id}
                              onSelect={(event) => {
                                event.preventDefault();
                                void select(() =>
                                  onSelectModel(provider.id, id),
                                );
                              }}
                            >
                              <span className="menu-item-label">{id}</span>
                            </Menu.RadioItem>
                          ))}
                        </Menu.RadioGroup>
                      </div>
                    ))}
                    {!settings.providers.length && (
                      <Menu.Empty>{t("noModels")}</Menu.Empty>
                    )}
                  </>
                ) : (
                  <Menu.RadioGroup value={selectedLevel}>
                    {levels.map((level) => (
                      <Menu.RadioItem
                        key={level}
                        value={level}
                        disabled={busy}
                        onSelect={(event) => {
                          event.preventDefault();
                          void select(() => onThinkingLevelChange(level));
                        }}
                      >
                        <span className="menu-item-label">
                          {levelLabels[level]}
                        </span>
                      </Menu.RadioItem>
                    ))}
                  </Menu.RadioGroup>
                )}
              </div>
            </>
          )}
          {error && (
            <Menu.Label className="error-text" role="alert">
              {error}
            </Menu.Label>
          )}
        </Menu.Content>
      </Menu.Root>
    </div>
  );
}
