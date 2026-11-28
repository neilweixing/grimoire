import { useEffect, useRef, useState, type FormEvent } from "react";
import { LoaderCircle, Search, X } from "lucide-react";
import type { PluginLookup } from "@grimoire/core";
import { api } from "./api";
import { useI18n } from "./i18n";

export function PluginInstallDialog({
  onClose,
  onInstall,
}: {
  onClose: () => void;
  onInstall: (source: string) => Promise<void>;
}) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController | null>(null);
  const [source, setSource] = useState("");
  const [result, setResult] = useState<PluginLookup>();
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const element = dialog.current;
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    element?.showModal();
    field.current?.focus({ preventScroll: true });
    return () => {
      request.current?.abort();
      element?.close();
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  const search = async (event: FormEvent) => {
    event.preventDefault();
    if (installing || checking || !source.trim()) return;
    const controller = new AbortController();
    request.current?.abort();
    request.current = controller;
    setResult(undefined);
    setError("");
    setChecking(true);
    try {
      const next = await api<PluginLookup>(
        `/plugins/lookup?${new URLSearchParams({ source: source.trim() })}`,
        { signal: controller.signal },
      );
      if (!controller.signal.aborted) setResult(next);
    } catch (e) {
      if (!controller.signal.aborted)
        setError(e instanceof Error ? e.message : t("requestFailed"));
    } finally {
      if (!controller.signal.aborted) setChecking(false);
    }
  };
  const install = async () => {
    if (!result?.found || checking || installing) return;
    setInstalling(true);
    setError("");
    try {
      await onInstall(result.source);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("requestFailed"));
    } finally {
      setInstalling(false);
    }
  };
  return (
    <dialog
      ref={dialog}
      className="project-dialog plugin-install-dialog"
      aria-labelledby="plugin-install-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!installing) onClose();
      }}
      onClick={(event) => {
        if (event.target === dialog.current && !installing) onClose();
      }}
    >
      <div className="project-dialog-content">
        <header>
          <h2 id="plugin-install-title">{t("addPlugin")}</h2>
          <button
            type="button"
            className="icon-button"
            aria-label={t("close")}
            disabled={installing}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>
        <form onSubmit={(event) => void search(event)} aria-busy={checking}>
          <label htmlFor="plugin-install-source">{t("npmAddress")}</label>
          <div className="plugin-lookup-field">
            <input
              id="plugin-install-source"
              ref={field}
              value={source}
              disabled={installing}
              maxLength={300}
              placeholder="npm:package / https://www.npmjs.com/package/…"
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => {
                request.current?.abort();
                setSource(event.target.value);
                setResult(undefined);
                setChecking(false);
                setError("");
              }}
            />
            <button
              className="project-cancel"
              disabled={checking || installing || !source.trim()}
            >
              {checking ? (
                <LoaderCircle size={16} className="spin" />
              ) : (
                <Search size={16} />
              )}
              {t("search")}
            </button>
          </div>
        </form>
        <div className="plugin-lookup-result" aria-live="polite">
          {result?.found && (
            <p>
              <strong>{result.name}</strong>
              <span>{result.version}</span>
            </p>
          )}
          {result && !result.found && <p>{t("pluginNotFound")}</p>}
          {error && (
            <p className="error-banner" role="alert">
              {error}
            </p>
          )}
        </div>
        <footer>
          <button
            type="button"
            className="project-cancel"
            disabled={installing}
            onClick={onClose}
          >
            {t("cancel")}
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={!result?.found || checking || installing}
            onClick={() => void install()}
          >
            {installing && <LoaderCircle size={16} className="spin" />}
            {t("installAndTrust")}
          </button>
        </footer>
      </div>
    </dialog>
  );
}
