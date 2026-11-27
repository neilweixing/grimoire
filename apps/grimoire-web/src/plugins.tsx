import { useEffect, useState, type FormEvent } from "react";
import {
  Compass,
  LoaderCircle,
  Puzzle,
  Search,
  RefreshCw,
  Plus,
  ChevronDown,
} from "lucide-react";
import type { IntegrationSnapshot, PluginCatalog } from "@grimoire/core";
import { useI18n } from "./i18n";
import { api } from "./api";

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
  const [source, setSource] = useState("");
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
    type: "install" | "remove" | "enable" | "disable",
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
            ...(["install", "enable"].includes(type) ? { trust: true } : {}),
          }),
        }),
      );
      setAdding(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("requestFailed"));
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
              <RefreshCw size={14} className={pending ? "spin" : ""} />
              {t("refreshPlugins")}
            </button>
            <div className="plugin-add-split">
              <button
                disabled={pending}
                onClick={() => {
                  setAdding(true);
                  setDiscover(false);
                }}
              >
                <Plus size={15} />
                {t("addPlugin")}
              </button>
              <details className="plugin-add-menu">
                <summary aria-label={t("moreActions")}>
                  <ChevronDown size={13} />
                </summary>
                <div>
                  <button
                    onClick={(e) => {
                      e.currentTarget
                        .closest("details")
                        ?.removeAttribute("open");
                      setAdding(true);
                      setDiscover(false);
                    }}
                  >
                    {t("addFromNpm")}
                  </button>
                  <button
                    onClick={(e) => {
                      e.currentTarget
                        .closest("details")
                        ?.removeAttribute("open");
                      setDiscover(true);
                      setAdding(false);
                    }}
                  >
                    {t("discoverPlugins")}
                  </button>
                </div>
              </details>
            </div>
          </div>
        </header>
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
        <div
          className="plugins-body"
          id="plugins-tab-panel"
          role="tabpanel"
          aria-labelledby={
            discover ? "plugins-discover-tab" : "plugins-installed-tab"
          }
        >
          {adding && (
            <form
              className="plugin-source-form"
              onSubmit={(e) => {
                e.preventDefault();
                void action(
                  "install",
                  source.startsWith("npm:") ? source : `npm:${source}`,
                );
              }}
            >
              <label htmlFor="plugin-source">{t("pluginSource")}</label>
              <div>
                <input
                  id="plugin-source"
                  autoFocus
                  required
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  placeholder="npm:package@version"
                />
                <button
                  className="primary-button"
                  disabled={pending || !source.trim()}
                >
                  {t("installAndTrust")}
                </button>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setAdding(false)}
                >
                  {t("cancel")}
                </button>
              </div>
            </form>
          )}
          {error && (
            <p className="error-banner" role="alert">
              {error}
            </p>
          )}
          {discover ? (
            <>
              <form className="plugin-search" onSubmit={(e) => void search(e)}>
                <Search size={17} />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  aria-label={t("searchPlugins")}
                  placeholder={t("searchPlugins")}
                  maxLength={200}
                />
                <button
                  className="primary-button"
                  disabled={pending || !query.trim()}
                >
                  {pending ? (
                    <LoaderCircle size={14} className="spin" />
                  ) : (
                    t("search")
                  )}
                </button>
              </form>

              {catalog?.packages.length === 0 && (
                <p className="integration-empty">{t("noPluginMatches")}</p>
              )}
              {catalog?.packages.map((pkg) => {
                const installed = snapshot?.packages.some(
                  (p) =>
                    p.source === `npm:${pkg.name}` ||
                    p.source === `npm:${pkg.name}@${pkg.version}`,
                );
                return (
                  <div className="plugin-card" key={pkg.name}>
                    <Puzzle size={19} />
                    <div className="integration-card-info">
                      <a href={pkg.url} target="_blank" rel="noreferrer">
                        <strong>{pkg.name}</strong>
                      </a>
                      <span className="plugin-version">{pkg.version}</span>
                    </div>
                    <button
                      className="text-button"
                      disabled={pending || installed}
                      onClick={() =>
                        void action("install", `npm:${pkg.name}@${pkg.version}`)
                      }
                    >
                      {installed ? t("pluginInstalled") : t("installAndTrust")}
                    </button>
                  </div>
                );
              })}
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
              {snapshot?.packages.map((pkg) => (
                <div className="plugin-card" key={pkg.source}>
                  <Puzzle size={19} />
                  <div className="integration-card-info">
                    <strong>{pkg.source.replace(/^npm:/, "")}</strong>
                    <p>{pkg.enabled ? t("enabled") : t("disabled")}</p>
                  </div>
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
              ))}
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
    </section>
  );
}
