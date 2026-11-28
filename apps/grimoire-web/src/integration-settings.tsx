import { useEffect, useState, type FormEvent } from "react";
import {
  BookOpen,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import type { IntegrationConfig, IntegrationSnapshot } from "@grimoire/core";
import { useI18n } from "./i18n";

import { api } from "./api";

export function IntegrationSettings({
  section,
}: {
  section: "mcp" | "skills";
}) {
  const { t } = useI18n();
  const [snapshot, setSnapshot] = useState<IntegrationSnapshot>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [server, setServer] = useState("");
  const request = async (
    method = "GET",
    config?: IntegrationConfig,
    reload = false,
  ) => {
    setPending(true);
    setError("");
    try {
      const value = await api<IntegrationSnapshot>(
        `/integrations${reload ? "/reload" : ""}`,
        { method, ...(config ? { body: JSON.stringify(config) } : {}) },
      );
      setSnapshot(value);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : t("requestFailed"));
      return false;
    } finally {
      setPending(false);
    }
  };
  useEffect(() => {
    void request();
  }, []);
  const edit = (key = "") => {
    setEditing(key);
    setName(key);
    setServer(
      JSON.stringify(
        snapshot?.config.mcp.mcpServers[key] ?? {
          url: "https://example.com/mcp",
          exposure: "direct",
        },
        null,
        2,
      ),
    );
  };
  const saveServer = async (event: FormEvent) => {
    event.preventDefault();
    if (!snapshot) return;
    try {
      const config = structuredClone(snapshot.config);
      const parsed = JSON.parse(server);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        throw new Error(t("invalidMcpConfig"));
      if (editing && editing !== name) delete config.mcp.mcpServers[editing];
      config.mcp.mcpServers[name] = parsed;
      if (await request("PUT", config)) setEditing(null);
    } catch {
      setError(t("invalidMcpConfig"));
    }
  };
  return (
    <div className="integration-settings">
      <div className="integration-toolbar">
        <button
          className="text-button"
          disabled={pending}
          onClick={() => void request("POST", undefined, true)}
        >
          <RefreshCw size={14} className={pending ? "spin" : ""} />
          {t("reloadIntegrations")}
        </button>
      </div>
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      {snapshot?.pendingReloads ? (
        <p className="form-note">{t("integrationPending")}</p>
      ) : null}
      {!snapshot && pending && <LoaderCircle size={18} className="spin" />}
      {section === "mcp" && snapshot && (
        <>
          <button
            className="add-provider"
            disabled={pending}
            onClick={() => edit()}
          >
            <Plus size={15} />
            {t("addMcp")}
          </button>
          {Object.entries(snapshot.config.mcp.mcpServers).length === 0 && (
            <p className="integration-empty">{t("noMcpServers")}</p>
          )}
          {Object.entries(snapshot.config.mcp.mcpServers).map(
            ([key, value]) => (
              <div className="integration-card" key={key}>
                <div className="integration-card-info">
                  <strong>{key}</strong>
                  <p>{String(value.url || value.command || "")}</p>
                  <span className="field-hint">
                    {t("discoveredTools").replace(
                      "{count}",
                      String(
                        snapshot.tools.filter((tool) =>
                          tool.name.startsWith(
                            `mcp__${key.replace(/-/g, "_")}__`,
                          ),
                        ).length,
                      ),
                    )}
                  </span>
                </div>
                <button
                  className="preference-switch"
                  role="switch"
                  aria-checked={value.enabled !== false}
                  aria-label={`${t("enabled")}: ${key}`}
                  disabled={pending}
                  onClick={() =>
                    void request("PUT", {
                      ...snapshot.config,
                      mcp: {
                        ...snapshot.config.mcp,
                        mcpServers: {
                          ...snapshot.config.mcp.mcpServers,
                          [key]: { ...value, enabled: value.enabled === false },
                        },
                      },
                    })
                  }
                >
                  <span />
                </button>
                <button
                  className="icon-button"
                  aria-label={`${t("edit")}: ${key}`}
                  disabled={pending}
                  onClick={() => edit(key)}
                >
                  <Pencil size={15} />
                </button>
                <button
                  className="icon-button"
                  aria-label={`${t("remove")}: ${key}`}
                  disabled={pending}
                  onClick={() => {
                    const config = structuredClone(snapshot.config);
                    delete config.mcp.mcpServers[key];
                    void request("PUT", config);
                  }}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ),
          )}
          {editing !== null && (
            <form className="integration-form" onSubmit={saveServer}>
              <label>
                {t("name")}
                <input
                  required
                  pattern="[a-zA-Z0-9_-]+"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label>
                {t("mcpServerConfig")}
                <textarea
                  className="config-editor"
                  spellCheck={false}
                  rows={10}
                  value={server}
                  onChange={(e) => setServer(e.target.value)}
                />
              </label>

              <div className="form-footer">
                <button
                  className="text-button"
                  type="button"
                  onClick={() => setEditing(null)}
                >
                  {t("cancel")}
                </button>
                <button className="primary-button" disabled={pending}>
                  {t("save")}
                </button>
              </div>
            </form>
          )}
          <details className="integration-tools">
            <summary>
              {t("availableIntegrationTools")} · {snapshot.tools.length}
            </summary>
            {snapshot.tools.map((tool) => (
              <div key={tool.name}>
                <strong>{tool.name}</strong>
              </div>
            ))}
          </details>
        </>
      )}
      {section === "skills" && snapshot && (
        <>
          {snapshot.skills.length === 0 && (
            <p className="integration-empty">{t("noSkills")}</p>
          )}
          {snapshot.skills.map((skill) => (
            <div key={skill.name} className="integration-card">
              <BookOpen size={17} />
              <div className="integration-card-info">
                <strong>{skill.name}</strong>
                <p className="field-hint" title={skill.filePath}>
                  {skill.filePath}
                </p>
                {!skill.modelInvocable && (
                  <span className="field-hint">{t("skillExplicitOnly")}</span>
                )}
              </div>
              <button
                className="preference-switch"
                role="switch"
                aria-label={`${t("enabled")}: ${skill.name}`}
                aria-checked={skill.enabled}
                disabled={pending}
                onClick={() =>
                  void request("PUT", {
                    ...snapshot.config,
                    disabledSkills: skill.enabled
                      ? [...snapshot.config.disabledSkills, skill.name]
                      : snapshot.config.disabledSkills.filter(
                          (n) => n !== skill.name,
                        ),
                  })
                }
              >
                <span />
              </button>
            </div>
          ))}
        </>
      )}
      {snapshot?.diagnostics.map((issue, index) => (
        <p className="error-banner" key={index}>
          {issue.message}
        </p>
      ))}
    </div>
  );
}
