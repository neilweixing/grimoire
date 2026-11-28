import { useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronRight,
  KeyRound,
  Pencil,
  Plus,
  Server,
  SlidersHorizontal,
  Trash2,
  X,
  Plug,
  BookOpen,
} from "lucide-react";
import {
  type ProviderInput,
  type ProviderSettings,
  type PublicProvider,
} from "@grimoire/core";
import { Select } from "./select";
import { api } from "./api";
import { ProviderForm } from "./provider-form";
import { IntegrationSettings } from "./integration-settings";
import { useUserPreferences } from "./preferences";
import { AppVersion } from "./desktop-updates";

import { useI18n, type Locale } from "./i18n";

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
  const [editingProvider, setEditingProvider] = useState<PublicProvider>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const preferences = useUserPreferences();
  const [quitPending, setQuitPending] = useState(false);
  const [quitError, setQuitError] = useState(false);
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
    setEditingProvider(provider);
  };
  const save = async (input: ProviderInput) => {
    if (
      await mutate(
        editingId ? `/providers/${editingId}` : "/providers",
        editingId ? "PUT" : "POST",
        input,
      )
    ) {
      setShowForm(false);
      return true;
    }
    return false;
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
                <div className="preference-description">
                  <label htmlFor="interface-language">{t("language")}</label>
                </div>
                <Select
                  id="interface-language"
                  label={t("language")}
                  value={locale}
                  disabled={!preferences.ready || preferences.pending}
                  options={[
                    { value: "zh", label: "简体中文" },
                    { value: "en", label: "English" },
                  ]}
                  onChange={(value) => setLocale(value as Locale)}
                />
              </div>
              <div className="preference-row">
                <div className="preference-description">
                  <label htmlFor="interface-appearance">
                    {t("appearance")}
                  </label>
                </div>
                <Select
                  id="interface-appearance"
                  label={t("appearance")}
                  value={preferences.preferences.appearance}
                  disabled={!preferences.ready || preferences.pending}
                  options={[
                    { value: "light", label: t("appearanceLight") },
                    { value: "dark", label: t("appearanceDark") },
                  ]}
                  onChange={(value) =>
                    void preferences.update({
                      appearance: value as "light" | "dark",
                    })
                  }
                />
              </div>
              <h4 className="settings-category">{t("securityCategory")}</h4>
              <div className="preference-row">
                <div className="preference-description">
                  <label id="ignore-browser-certificates">
                    {t("ignoreBrowserCertificates")}
                  </label>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-labelledby="ignore-browser-certificates"
                  aria-checked={preferences.preferences.ignoreCertificateErrors}
                  disabled={
                    !window.grimoireDesktop?.browser ||
                    !preferences.ready ||
                    preferences.pending
                  }
                  className={`preference-switch ${preferences.preferences.ignoreCertificateErrors ? "is-on" : ""}`}
                  onClick={() =>
                    void preferences.update({
                      ignoreCertificateErrors:
                        !preferences.preferences.ignoreCertificateErrors,
                    })
                  }
                >
                  <span />
                </button>
              </div>
              {preferences.failed && (
                <p className="error-banner" role="alert">
                  {t("preferencesFailed")}
                  <button
                    className="text-button"
                    disabled={preferences.pending}
                    onClick={() => void preferences.reload()}
                  >
                    {t("retryPreferences")}
                  </button>
                </p>
              )}
              <footer className="general-settings-footer">
                <AppVersion />
                {window.grimoireDesktop?.app && (
                  <button
                    type="button"
                    className="text-button quit-application"
                    disabled={quitPending}
                    onClick={async () => {
                      setQuitPending(true);
                      setQuitError(false);
                      try {
                        await window.grimoireDesktop!.app!.quit();
                      } catch {
                        setQuitPending(false);
                        setQuitError(true);
                      }
                    }}
                  >
                    {t("quitApplication")}
                  </button>
                )}
              </footer>
              {quitError && (
                <p className="error-banner" role="alert">
                  {t("quitApplicationFailed")}
                </p>
              )}
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
                <ProviderForm
                  key={editingId ?? "new"}
                  provider={editingProvider}
                  pending={pending}
                  onSave={save}
                  onCancel={() => setShowForm(false)}
                />
              )}
            </>
          )}
        </section>
      </div>
    </dialog>
  );
}
