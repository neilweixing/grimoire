import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Globe,
  LoaderCircle,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  RotateCw,
  Search,
  X,
} from "lucide-react";
import { useI18n } from "./i18n";
import { normalizeBrowserUrl } from "./browser-url";
import type { DesktopUpdateBridge } from "./desktop-updates";

type BrowserState = {
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  error: boolean;
  errorCode: string;
  ignoreCertificateErrors: boolean;
};
type BrowserCommand = {
  action:
    | "state"
    | "navigate"
    | "back"
    | "forward"
    | "reload"
    | "clear"
    | "bounds"
    | "settings"
    | "bind";
  context?: { workspace: string; threadId: string | null };
  ignoreCertificateErrors?: boolean;
  url?: string;
  visible?: boolean;
  bounds?: { x: number; y: number; width: number; height: number };
};
declare global {
  interface Window {
    grimoireDesktop?: {
      app?: { quit(): Promise<void> };
      clipboard?: { writeText(text: string): Promise<void> };
      updates?: DesktopUpdateBridge;
      browser: {
        command(command: BrowserCommand): Promise<BrowserState>;
        onState(listener: (state: BrowserState) => void): () => void;
        onOpen(listener: () => void): () => void;
      };
    };
  }
}
const empty: BrowserState = {
  url: "",
  title: "",
  loading: false,
  canGoBack: false,
  canGoForward: false,
  error: false,
  errorCode: "",
  ignoreCertificateErrors: false,
};

export function BrowserTopbar({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle(): void;
}) {
  const { t } = useI18n();
  return (
    <header className="topbar">
      <div className="topbar-drag" aria-hidden="true" />
      {!open && (
        <button
          type="button"
          className={`icon-button browser-toggle ${open ? "active" : ""}`}
          onClick={onToggle}
          aria-label={t(open ? "closeBrowser" : "openBrowser")}
          title={t(open ? "closeBrowser" : "openBrowser")}
          aria-expanded={open}
          aria-controls="browser-drawer"
        >
          {open ? <PanelRightClose size={19} /> : <PanelRightOpen size={19} />}
        </button>
      )}
    </header>
  );
}

export function BrowserDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose(): void;
}) {
  const { t } = useI18n();
  const bridge = window.grimoireDesktop?.browser;
  const [state, setState] = useState<BrowserState>(empty);
  const [address, setAddress] = useState("");
  const [inputError, setInputError] = useState(false);
  const [width, setWidth] = useState<number | undefined>(() => {
    try {
      const value = Number(localStorage.getItem("grimoire.browser.width"));
      return Number.isFinite(value) && value >= 320 ? value : undefined;
    } catch {
      return undefined;
    }
  });
  const [resizing, setResizing] = useState(false);
  const panel = useRef<HTMLElement>(null);
  const drag = useRef<{ x: number; width: number } | null>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const addressInput = useRef<HTMLInputElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const syncBounds = useCallback(() => {
    if (!bridge) return;
    const box = viewport.current?.getBoundingClientRect();
    void bridge
      .command({
        action: "bounds",
        visible: Boolean(
          open &&
          state.url &&
          !resizing &&
          box?.width &&
          !document.querySelector("dialog[open]"),
        ),
        ...(box
          ? {
              bounds: {
                x: box.x,
                y: box.y,
                width: box.width,
                height: box.height,
              },
            }
          : {}),
      })
      .catch(() => {});
  }, [bridge, open, state.url, resizing]);
  const resizeTo = (value: number) => {
    const sidebar =
      document
        .querySelector(
          ".app-shell.sidebar-open .sidebar, .app-shell.sidebar-closed .sidebar-rail",
        )
        ?.getBoundingClientRect().width ?? 72;
    const chatMinimum =
      Number.parseFloat(
        getComputedStyle(
          panel.current?.closest(".app-shell") ?? document.documentElement,
        ).getPropertyValue("--chat-min-width"),
      ) || 360;
    const maximum =
      window.innerWidth <= 759
        ? window.innerWidth -
          (document.documentElement.dataset.desktop ? 144 : 72)
        : Math.max(280, window.innerWidth - sidebar - chatMinimum);
    setWidth(Math.max(Math.min(280, maximum), Math.min(maximum, value)));
  };
  useEffect(() => {
    if (width === undefined) return;
    try {
      localStorage.setItem("grimoire.browser.width", String(width));
    } catch {}
  }, [width]);
  useEffect(() => {
    if (open) addressInput.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!bridge) return;
    let active = true;
    const update = (next: BrowserState) => {
      if (active) setState(next);
    };
    const unsubscribe = bridge.onState(update);
    void bridge
      .command({ action: "state" })
      .then(update)
      .catch(() => {});
    return () => {
      active = false;
      unsubscribe();
      void bridge.command({ action: "bounds", visible: false }).catch(() => {});
    };
  }, [bridge]);
  useEffect(() => {
    setAddress(state.url);
  }, [state.url]);
  useEffect(() => {
    syncBounds();
    if (!open) return;
    const resize = new ResizeObserver(syncBounds);
    if (viewport.current) resize.observe(viewport.current);
    let scheduled = 0;
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(scheduled);
      scheduled = requestAnimationFrame(syncBounds);
    });
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["open"],
      subtree: true,
      childList: true,
    });
    window.addEventListener("resize", syncBounds);
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.querySelector("dialog[open]"))
        close.current();
    };
    window.addEventListener("keydown", escape);
    return () => {
      resize.disconnect();
      observer.disconnect();
      cancelAnimationFrame(scheduled);
      window.removeEventListener("resize", syncBounds);
      window.removeEventListener("keydown", escape);
    };
  }, [open, syncBounds]);

  const command = async (action: BrowserCommand["action"]) => {
    if (bridge) {
      try {
        setState(await bridge.command({ action }));
      } catch {
        setState((current) => ({ ...current, error: true }));
      }
    } else if (action === "clear") setState(empty);
    else if (action === "reload" && frame.current)
      frame.current.src = state.url;
  };
  const navigate = async (event: FormEvent) => {
    event.preventDefault();
    let url;
    try {
      url = normalizeBrowserUrl(address);
    } catch {
      setInputError(true);
      return;
    }
    setInputError(false);
    setAddress(url);
    if (bridge) {
      try {
        setState(await bridge.command({ action: "navigate", url }));
      } catch {
        setState((current) => ({ ...current, url, error: true }));
      }
    } else setState({ ...empty, url, title: new URL(url).hostname });
  };
  if (!open) return null;
  return (
    <aside
      ref={panel}
      style={{ width }}
      className={`browser-drawer ${resizing ? "is-resizing" : ""}`}
      id="browser-drawer"
      aria-label={t("builtInBrowser")}
    >
      <div
        className="browser-resize-handle"
        role="separator"
        aria-label={t("resizeBrowser")}
        aria-orientation="vertical"
        tabIndex={0}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = {
            x: event.clientX,
            width: panel.current?.getBoundingClientRect().width ?? 500,
          };
          setResizing(true);
        }}
        onPointerMove={(event) => {
          if (drag.current)
            resizeTo(drag.current.width + drag.current.x - event.clientX);
        }}
        onPointerUp={(event) => {
          drag.current = null;
          setResizing(false);
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onLostPointerCapture={() => {
          drag.current = null;
          setResizing(false);
        }}
        onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
          event.preventDefault();
          resizeTo(
            (panel.current?.getBoundingClientRect().width ?? 500) +
              (event.key === "ArrowLeft" ? 24 : -24),
          );
        }}
      />
      <div className="browser-tabbar">
        <div className="browser-tab" title={state.title || t("newBrowserTab")}>
          <Globe size={14} />
          <span>{state.title || t("newBrowserTab")}</span>
          {state.url && (
            <button
              type="button"
              className="icon-button"
              aria-label={t("closeBrowserTab")}
              onClick={() => void command("clear")}
            >
              <X size={14} />
            </button>
          )}
        </div>
        <button
          type="button"
          className="icon-button"
          title={t("newBrowserTab")}
          aria-label={t("newBrowserTab")}
          onClick={() => void command("clear")}
        >
          <Plus size={17} />
        </button>
        <button
          type="button"
          className="icon-button browser-drawer-close"
          title={t("closeBrowser")}
          aria-label={t("closeBrowser")}
          onClick={onClose}
        >
          <PanelRightClose size={18} />
        </button>
      </div>
      {state.url && (
        <div className="browser-navigation">
          <button
            type="button"
            className="icon-button"
            aria-label={t("browserBack")}
            title={t("browserBack")}
            disabled={!state.canGoBack}
            onClick={() => void command("back")}
          >
            <ArrowLeft size={16} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label={t("browserForward")}
            title={t("browserForward")}
            disabled={!state.canGoForward}
            onClick={() => void command("forward")}
          >
            <ArrowRight size={16} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label={t("browserReload")}
            title={t("browserReload")}
            onClick={() => void command("reload")}
          >
            {state.loading ? (
              <LoaderCircle size={15} className="spin" />
            ) : (
              <RotateCw size={15} />
            )}
          </button>
          <form onSubmit={(event) => void navigate(event)}>
            <input
              ref={addressInput}
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              aria-label={t("browserAddress")}
              spellCheck={false}
              autoCapitalize="none"
            />
            <button
              type="submit"
              className="icon-button"
              aria-label={t("openUrl")}
            >
              <ArrowUpRight size={15} />
            </button>
          </form>
        </div>
      )}
      {inputError && (
        <p className="browser-input-error" role="alert">
          {t("invalidBrowserUrl")}
        </p>
      )}
      <div ref={viewport} className="browser-viewport">
        {!state.url ? (
          <div className="browser-new-tab">
            <div className="browser-home-mark">
              <Globe size={30} strokeWidth={1.3} />
            </div>
            <form
              className="browser-search"
              onSubmit={(event) => void navigate(event)}
            >
              <Search size={18} />
              <input
                ref={addressInput}
                value={address}
                onChange={(event) => {
                  setAddress(event.target.value);
                  setInputError(false);
                }}
                aria-label={t("browserAddress")}
                placeholder={t("browserSearchPlaceholder")}
                spellCheck={false}
                autoCapitalize="none"
              />
              <button
                type="submit"
                className="icon-button"
                aria-label={t("openUrl")}
                disabled={!address.trim()}
              >
                <ArrowRight size={18} />
              </button>
            </form>
          </div>
        ) : state.error ? (
          <div className="browser-page-error">
            <Globe size={28} />
            <p>
              {t(
                state.errorCode.includes("CERT_")
                  ? "browserCertificateFailed"
                  : "browserLoadFailed",
              )}
            </p>
            {state.errorCode && <code>{state.errorCode}</code>}
            <button
              type="button"
              className="text-button"
              onClick={() => void command("reload")}
            >
              {t("browserReload")}
            </button>
          </div>
        ) : !bridge ? (
          <iframe
            ref={frame}
            src={state.url}
            title={t("builtInBrowser")}
            sandbox="allow-scripts allow-forms"
            referrerPolicy="no-referrer"
          />
        ) : null}
      </div>
    </aside>
  );
}
