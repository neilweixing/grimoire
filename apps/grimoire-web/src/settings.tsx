import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  Check,
  ChevronRight,
  Globe2,
  KeyRound,
  LoaderCircle,
  Pencil,
  Plus,
  Server,
  SlidersHorizontal,
  Trash2,
  X,
  ShieldAlert,
  Plug,
  BookOpen,
} from "lucide-react";
import {
  type ProviderInput,
  type ProviderKind,
  type ProviderSettings,
  type PublicProvider,
} from "@grimoire/core";
import { api } from "./api";
import { IntegrationSettings } from "./integration-settings";
import { AppVersion } from "./desktop-updates";

import { useI18n, type Locale } from "./i18n";

const defaults: Record<ProviderKind, { model: string; baseUrl: string }> = {
  openai: { model: "gpt-4.1-mini", baseUrl: "https://api.openai.com/v1" },
  anthropic: {
    model: "claude-sonnet-4-6",
    baseUrl: "https://api.anthropic.com",
  },
  "openai-compatible": { model: "", baseUrl: "" },
};
const blank: ProviderInput = {
  name: "",
  kind: "openai",
  ...defaults.openai,
  apiKey: "",
};

export function Settings({
  settings,
  onChange,
  onClose,
  initialSection,
}: {
  settings: ProviderSettings;
  onChange: (settings: ProviderSettings) => void;
  onClose: () => void;
  initialSection: "general" | "providers";
}) {
  const { t, locale, setLocale } = useI18n();
  const [section, setSection] = useState<
    "general" | "providers" | "mcp" | "skills"
  >(initialSection);
  const dialog = useRef<HTMLDialogElement>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<ProviderInput>(blank);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const [browserReady, setBrowserReady] = useState(false);
  const [ignoreCertificates, setIgnoreCertificates] = useState(false);
  const [browserPending, setBrowserPending] = useState(false);
  const [browserError, setBrowserError] = useState("");
  useEffect(() => {
    const bridge = window.grimoireDesktop?.browser;
    if (!bridge) return;
    let active = true;
    void bridge
      .command({ action: "state" })
      .then((state) => {
        if (active) {
          setIgnoreCertificates(state.ignoreCertificateErrors);
          setBrowserReady(true);
        }
      })
      .catch(() => {
        if (active) setBrowserError(t("browserPreferenceFailed"));
      });
    return () => {
      active = false;
    };
  }, []);
  const changeCertificatePreference = async () => {
    const bridge = window.grimoireDesktop?.browser;
    if (!bridge) return;
    setBrowserPending(true);
    setBrowserError("");
    try {
      const state = await bridge.command({
        action: "settings",
        ignoreCertificateErrors: !ignoreCertificates,
      });
      setIgnoreCertificates(state.ignoreCertificateErrors);
    } catch {
      setBrowserError(t("browserPreferenceFailed"));
    } finally {
      setBrowserPending(false);
    }
  };
  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  const mutate = async (path: string, method: string, body?: unknown) => {
    setPending(true);
    setError("");
    try {
      const result = await api<ProviderSettings>(path, {
        method,
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      onChange(result);
      return true;
    } catch (error) {
      setError(error instanceof Error ? error.message : t("saveFailed"));
      return false;
    } finally {
      setPending(false);
    }
  };
  const edit = (provider?: PublicProvider) => {
    setError("");
    setEditingId(provider?.id || null);
    setShowForm(true);
    setForm(
      provider
        ? {
            name: provider.name,
            kind: provider.kind,
            model: provider.model,
            baseUrl: provider.baseUrl,
            apiKey: "",
            contextWindow: provider.contextWindow,
          }
        : blank,
    );
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (
      await mutate(
        editingId ? `/providers/${editingId}` : "/providers",
        editingId ? "PUT" : "POST",
        form,
      )
    )
      setShowForm(false);
  };

  return (
    <dialog
      ref={dialog}
      className="settings-dialog"
      aria-labelledby="settings-title"
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="settings-shell">
        <aside className="settings-nav">
          <h2 id="settings-title">{t("settings")}</h2>
          <nav className="settings-tabs" aria-label={t("settings")}>
            <button
              className={`settings-nav-item ${section === "general" ? "settings-nav-active" : ""}`}
              aria-current={section === "general" ? "page" : undefined}
              onClick={() => setSection("general")}
            >
              <SlidersHorizontal size={17} /> {t("generalSettings")}{" "}
              <ChevronRight size={14} />
            </button>
            <button
              className={`settings-nav-item ${section === "providers" ? "settings-nav-active" : ""}`}
              aria-current={section === "providers" ? "page" : undefined}
              onClick={() => setSection("providers")}
            >
              <Server size={17} /> {t("providers")} <ChevronRight size={14} />
            </button>
            {(["mcp", "skills"] as const).map((key) => (
              <button
                key={key}
                className={`settings-nav-item ${section === key ? "settings-nav-active" : ""}`}
                aria-current={section === key ? "page" : undefined}
                onClick={() => setSection(key)}
              >
                {key === "mcp" ? <Plug size={17} /> : <BookOpen size={17} />}{" "}
                {t(key === "mcp" ? "mcpSettings" : "skillsSettings")}{" "}
                <ChevronRight size={14} />
              </button>
            ))}
          </nav>
        </aside>
        <section className="settings-content">
          <header className="settings-header">
            <div>
              <h3>
                {t(
                  section === "general"
                    ? "generalSettings"
                    : section === "mcp"
                      ? "mcpSettings"
                      : section === "skills"
                        ? "skillsSettings"
                        : "providersTitle",
                )}
              </h3>
            </div>
            <button
              className="icon-button"
              aria-label={t("closeSettings")}
              onClick={onClose}
            >
              <X size={20} />
            </button>
          </header>
          {section === "mcp" || section === "skills" ? (
            <IntegrationSettings key={section} section={section} />
          ) : section === "general" ? (
            <div className="general-settings">
              <h4 className="settings-category">{t("commonCategory")}</h4>
              <div className="preference-row">
                <span className="preference-icon">
                  <Globe2 size={20} />
                </span>
                <div className="preference-description">
                  <label htmlFor="interface-language">{t("language")}</label>
                </div>
                <select
                  id="interface-language"
                  aria-label={t("language")}
                  value={locale}
                  onChange={(event) => setLocale(event.target.value as Locale)}
                >
                  <option value="zh">简体中文</option>
                  <option value="en">English</option>
                </select>
              </div>
              <h4 className="settings-category">{t("securityCategory")}</h4>
              <div className="preference-row">
                <span className="preference-icon">
                  <ShieldAlert size={20} />
                </span>
                <div className="preference-description">
                  <label id="ignore-browser-certificates">
                    {t("ignoreBrowserCertificates")}
                  </label>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-labelledby="ignore-browser-certificates"
                  aria-checked={ignoreCertificates}
                  disabled={!browserReady || browserPending}
                  className={`preference-switch ${ignoreCertificates ? "is-on" : ""}`}
                  onClick={() => void changeCertificatePreference()}
                >
                  <span />
                </button>
              </div>
              {browserError && (
                <p className="error-banner" role="alert">
                  {browserError}
                </p>
              )}
              <AppVersion />
            </div>
          ) : (
            <>
              {error && (
                <div className="error-banner" role="alert">
                  {error}
                </div>
              )}
              <div className="provider-list">
                {settings.providers.map((provider) => (
                  <div
                    key={provider.id}
                    className={`provider-card ${settings.activeProviderId === provider.id ? "active" : ""}`}
                  >
                    <div className={`provider-icon ${provider.kind}`}>
                      {provider.name.slice(0, 1).toUpperCase()}
                    </div>
                    <div className="provider-info">
                      <strong>{provider.name}</strong>
                      <p>
                        {settings.activeProviderId === provider.id
                          ? settings.activeModel || provider.model
                          : provider.model}
                      </p>
                      <span className="key-status">
                        <KeyRound size={11} />
                        {provider.hasApiKey
                          ? t("keyConfigured")
                          : t("keyMissing")}
                      </span>
                    </div>
                    <div className="provider-actions">
                      <button
                        className="small-button"
                        disabled={
                          pending || settings.activeProviderId === provider.id
                        }
                        onClick={() =>
                          void mutate("/providers/active", "PUT", {
                            id: provider.id,
                          })
                        }
                      >
                        {settings.activeProviderId === provider.id ? (
                          <>
                            <Check size={14} /> {t("active")}
                          </>
                        ) : (
                          t("activate")
                        )}
                      </button>
                      <button
                        className="icon-button"
                        disabled={pending}
                        aria-label={`${t("edit")} ${provider.name}`}
                        onClick={() => edit(provider)}
                      >
                        <Pencil size={15} />
                      </button>
                      {deleting === provider.id ? (
                        <button
                          className="danger-button"
                          disabled={pending}
                          onClick={async () => {
                            if (
                              await mutate(
                                `/providers/${provider.id}`,
                                "DELETE",
                              )
                            ) {
                              setDeleting(null);
                              if (editingId === provider.id) setShowForm(false);
                            }
                          }}
                        >
                          {t("confirmRemove")}
                        </button>
                      ) : (
                        <button
                          className="icon-button"
                          disabled={pending}
                          aria-label={`${t("remove")} ${provider.name}`}
                          onClick={() => setDeleting(provider.id)}
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              {!showForm ? (
                <button className="add-provider" onClick={() => edit()}>
                  <Plus size={17} /> {t("addProvider")}
                </button>
              ) : (
                <form className="provider-form" onSubmit={save}>
                  <div className="form-heading">
                    <h4>{editingId ? t("editProvider") : t("addProvider")}</h4>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={t("cancelEdit")}
                      onClick={() => setShowForm(false)}
                    >
                      <X size={16} />
                    </button>
                  </div>
                  <div className="form-grid">
                    <label>
                      {t("name")}
                      <input
                        autoFocus
                        required
                        maxLength={80}
                        placeholder={t("namePlaceholder")}
                        value={form.name}
                        onChange={(e) =>
                          setForm({ ...form, name: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      {t("apiType")}
                      <select
                        value={form.kind}
                        onChange={(e) => {
                          const kind = e.target.value as ProviderKind;
                          setForm({ ...form, kind, ...defaults[kind] });
                        }}
                      >
                        <option value="openai">OpenAI Responses</option>
                        <option value="anthropic">Anthropic Messages</option>
                        <option value="openai-compatible">
                          {t("compatible")}
                        </option>
                      </select>
                    </label>
                    <label className="full-width">
                      {t("apiUrl")}
                      <input
                        type="url"
                        required
                        value={form.baseUrl || ""}
                        placeholder="https://api.example.com/v1"
                        onChange={(e) =>
                          setForm({ ...form, baseUrl: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      {t("modelId")}
                      <input
                        required
                        maxLength={200}
                        placeholder={t("modelPlaceholder")}
                        value={form.model}
                        onChange={(e) =>
                          setForm({ ...form, model: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      {t("apiKey")}
                      <input
                        type="password"
                        autoComplete="new-password"
                        value={form.apiKey || ""}
                        placeholder={editingId ? t("keepKey") : t("localKey")}
                        onChange={(e) =>
                          setForm({ ...form, apiKey: e.target.value })
                        }
                      />
                    </label>
                    <label className="full-width">
                      {t("contextWindow")}
                      <input
                        type="number"
                        min={1}
                        max={10_000_000}
                        step={1}
                        value={form.contextWindow ?? ""}
                        placeholder={t("contextWindowPlaceholder")}
                        onChange={(event) =>
                          setForm({
                            ...form,
                            contextWindow:
                              event.target.value === ""
                                ? undefined
                                : Number(event.target.value),
                          })
                        }
                      />
                    </label>
                  </div>

                  <div className="form-footer">
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => setShowForm(false)}
                    >
                      {t("cancel")}
                    </button>
                    <button
                      className="primary-button"
                      disabled={pending}
                      type="submit"
                    >
                      {pending && <LoaderCircle size={14} className="spin" />}
                      {t("saveProvider")}
                    </button>
                  </div>
                </form>
              )}
            </>
          )}
        </section>
      </div>
    </dialog>
  );
}
