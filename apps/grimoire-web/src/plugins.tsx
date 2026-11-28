import { useEffect, useState, type FormEvent } from "react";
import { LoaderCircle, Puzzle, Search, RefreshCw, Plus } from "lucide-react";
import type {
  IntegrationSnapshot,
  PluginCatalog,
  PluginUpdate,
} from "@grimoire/core";
import { useI18n } from "./i18n";
import { api } from "./api";
import { PluginInstallDialog } from "./plugin-install-dialog";

export function Plugins() {
  const { t } = useI18n();
  const [snapshot, setSnapshot] = useState<IntegrationSnapshot>();
  const [discover, setDiscover] = useState(false);
  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState("");
  const [offset, setOffset] = useState(0);
  const [catalog, setCatalog] = useState<PluginCatalog>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [updates, setUpdates] = useState<PluginUpdate[]>([]);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [updateCheckFailed, setUpdateCheckFailed] = useState(false);
  const [updateCheck, setUpdateCheck] = useState(0);
  useEffect(() => {
    if (discover || !snapshot?.packages.length) {
      setCheckingUpdates(false);
      return;
    }
    const controller = new AbortController();
    setCheckingUpdates(true);
    setUpdateCheckFailed(false);
    setUpdates([]);
    void api<PluginUpdate[]>(
      `/plugins/updates${updateCheck ? "?refresh=1" : ""}`,
      { signal: controller.signal },
    )
      .then((result) => {
        if (!controller.signal.aborted) setUpdates(result);
      })
      .catch(() => {
        if (!controller.signal.aborted) setUpdateCheckFailed(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setCheckingUpdates(false);
      });
    return () => controller.abort();
  }, [discover, snapshot, updateCheck]);
  useEffect(() => {
    const controller = new AbortController();
    void api<IntegrationSnapshot>("/integrations", {
      signal: controller.signal,
    })
      .then(setSnapshot)
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, []);
  const search = async (event?: FormEvent, nextOffset = 0) => {
    event?.preventDefault();
    setPending(true);
    setError("");
    try {
      const text = event ? query : searched;
      setCatalog(
        await api<PluginCatalog>(
          `/plugins/catalog?${new URLSearchParams({ query: text, offset: String(nextOffset) })}`,
        ),
      );
      setSearched(text);
      setOffset(nextOffset);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("requestFailed"));
    } finally {
      setPending(false);
    }
  };
  const action = async (
    type: "install" | "remove" | "enable" | "disable" | "update",
    source: string,
  ) => {
    setPending(true);
    setError("");
    try {
      setSnapshot(
        await api<IntegrationSnapshot>("/plugins", {
          method: "POST",
          body: JSON.stringify({
            action: type,
            source,
            ...(["install", "enable", "update"].includes(type)
              ? { trust: true }
              : {}),
          }),
        }),
      );
      setAdding(false);
      return true;
    } catch (e) {
      if (adding) throw e;
      setError(e instanceof Error ? e.message : t("requestFailed"));
      return false;
    } finally {
      setPending(false);
    }
  };
  const refresh = async () => {
    setPending(true);
    setError("");
    try {
      setSnapshot(
        await api<IntegrationSnapshot>("/integrations/reload", {
          method: "POST",
        }),
      );
      setUpdateCheck((value) => value + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("requestFailed"));
    } finally {
      setPending(false);
    }
  };
  return (
    <section className="plugins-panel" aria-labelledby="plugins-title">
      <div className="plugins-shell">
        <header className="plugin-page-header">
          <h2 id="plugins-title">{t("plugins")}</h2>
          <div className="plugin-page-actions">
            <button
              className="plugin-refresh"
              disabled={pending}
              onClick={() => void refresh()}
            >
              <RefreshCw
                size={14}
                className={pending || checkingUpdates ? "spin" : ""}
              />
              {t("refreshPlugins")}
            </button>
            <button
              className="primary-button"
              disabled={pending}
              onClick={() => setAdding(true)}
            >
              <Plus size={16} />
              {t("addPlugin")}
            </button>
          </div>
        </header>
        <div className="plugin-toolbar">
          <div className="plugin-tabs" role="tablist" aria-label={t("plugins")}>
            <button
              id="plugins-installed-tab"
              role="tab"
              aria-selected={!discover}
              aria-controls="plugins-tab-panel"
              onClick={() => setDiscover(false)}
            >
              {t("installedPlugins")}
            </button>
            <button
              id="plugins-discover-tab"
              role="tab"
              aria-selected={discover}
              aria-controls="plugins-tab-panel"
              onClick={() => {
                setDiscover(true);
                setAdding(false);
              }}
            >
              {t("discoverPlugins")}
            </button>
          </div>
          {discover && (
            <form
              className="plugin-search"
              role="search"
              onSubmit={(e) => void search(e)}
            >
              <label className="plugin-search-field">
                <Search size={16} aria-hidden="true" />
                <input
                  type="search"
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  aria-label={t("searchPlugins")}
                  placeholder={t("searchPlugins")}
                  maxLength={200}
                />
              </label>
              <button
                className="primary-button"
                disabled={pending || !query.trim()}
              >
                {pending && <LoaderCircle size={14} className="spin" />}
                {t("search")}
              </button>
            </form>
          )}
        </div>
        <div
          className="plugins-body"
          id="plugins-tab-panel"
          role="tabpanel"
          aria-labelledby={
            discover ? "plugins-discover-tab" : "plugins-installed-tab"
          }
        >
          {error && (
            <p className="error-banner" role="alert">
              {error}
            </p>
          )}
          {discover ? (
            <>
              {catalog?.packages.length === 0 && (
                <p className="integration-empty">{t("noPluginMatches")}</p>
              )}
              <div className="plugin-catalog-grid">
                {catalog?.packages.map((pkg) => {
                  const installed = snapshot?.packages.some(
                    (p) =>
                      p.source === `npm:${pkg.name}` ||
                      p.source.startsWith(`npm:${pkg.name}@`),
                  );
                  return (
                    <article className="plugin-catalog-card" key={pkg.name}>
                      <div className="plugin-catalog-heading">
                        <Puzzle size={18} aria-hidden="true" />
                        <h3>
                          <a href={pkg.url} target="_blank" rel="noreferrer">
                            {pkg.name}
                          </a>
                        </h3>
                      </div>
                      <div className="plugin-catalog-footer">
                        <span className="plugin-catalog-version">
                          {pkg.version}
                        </span>
                        <button
                          className="text-button plugin-install"
                          disabled={pending || installed}
                          onClick={() =>
                            void action("install", `npm:${pkg.name}`)
                          }
                        >
                          {installed
                            ? t("pluginInstalled")
                            : t("installAndTrust")}
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
              {catalog && (
                <div className="plugin-pagination">
                  <button
                    className="text-button"
                    disabled={pending || offset === 0}
                    onClick={() =>
                      void search(undefined, Math.max(0, offset - 24))
                    }
                  >
                    {t("previousPage")}
                  </button>
                  <span>
                    {offset + 1}–{Math.min(offset + 24, catalog.total)} /{" "}
                    {catalog.total}
                  </span>
                  <button
                    className="text-button"
                    disabled={pending || offset + 24 >= catalog.total}
                    onClick={() => void search(undefined, offset + 24)}
                  >
                    {t("nextPage")}
                  </button>
                </div>
              )}
            </>
          ) : (
            <>
              {snapshot?.packages.length === 0 && (
                <div className="integration-empty">
                  <Puzzle size={28} />
                  <p>{t("noInstalledPlugins")}</p>
                </div>
              )}
              {checkingUpdates && (
                <p className="integration-loading" role="status">
                  <LoaderCircle size={14} className="spin" />
                  {t("checkingPluginUpdates")}
                </p>
              )}
              {updateCheckFailed && (
                <p className="error-banner" role="status">
                  {t("pluginUpdateCheckFailed")}{" "}
                  <button
                    className="text-button"
                    onClick={() => setUpdateCheck((value) => value + 1)}
                  >
                    {t("retryPluginUpdates")}
                  </button>
                </p>
              )}
              {snapshot?.packages.map((pkg) => {
                const update = updates.find(
                  (entry) => entry.source === pkg.source,
                );
                return (
                  <div className="plugin-card" key={pkg.source}>
                    <Puzzle size={19} />
                    <div className="integration-card-info">
                      <strong>{pkg.source.replace(/^npm:/, "")}</strong>
                      <p className="plugin-installed-meta">
                        <span>
                          {pkg.enabled ? t("enabled") : t("disabled")}
                        </span>
                      </p>
                    </div>
                    {update && (
                      <button
                        className="text-button plugin-update-button"
                        disabled={pending}
                        onClick={() => void action("update", pkg.source)}
                      >
                        {t("updatePlugin")}
                      </button>
                    )}
                    <button
                      className="text-button"
                      disabled={pending}
                      onClick={() =>
                        void action(
                          pkg.enabled ? "disable" : "enable",
                          pkg.source,
                        )
                      }
                    >
                      {pkg.enabled ? t("disablePlugin") : t("enableAndTrust")}
                    </button>
                    <button
                      className="text-button danger"
                      disabled={pending}
                      onClick={() => void action("remove", pkg.source)}
                    >
                      {t("remove")}
                    </button>
                  </div>
                );
              })}
            </>
          )}

          {pending && (
            <p className="integration-loading" role="status">
              <LoaderCircle size={14} className="spin" />
              {t("pluginPending")}
            </p>
          )}
        </div>
      </div>
      {adding && (
        <PluginInstallDialog
          onClose={() => setAdding(false)}
          onInstall={async (source) => {
            await action("install", source);
          }}
        />
      )}
    </section>
  );
}
