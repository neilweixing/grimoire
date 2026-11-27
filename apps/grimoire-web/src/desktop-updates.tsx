import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useId,
  useState,
  type ReactNode,
} from "react";
import {
  ArrowUpCircle,
  Check,
  Download,
  LoaderCircle,
  Settings2,
  X,
} from "lucide-react";
import { useI18n } from "./i18n";

export type DesktopUpdateState = {
  currentVersion: string;
  availableVersion: string | null;
  releaseNotes: string;
  phase:
    | "idle"
    | "checking"
    | "available"
    | "up-to-date"
    | "downloading"
    | "downloaded"
    | "error"
    | "installing";
  percent: number;
  capability:
    | "automatic"
    | "development"
    | "macos-unsigned"
    | "windows-msi"
    | "unsupported";
  error: "failed" | "not-published" | null;
};
export type DesktopUpdateCommand = {
  action:
    "state" | "check" | "download" | "quit" | "open-installer" | "releases";
};
export type DesktopUpdateBridge = {
  command(command: DesktopUpdateCommand): Promise<DesktopUpdateState>;
  onState(listener: (state: DesktopUpdateState) => void): () => void;
};
type Updates = {
  state: DesktopUpdateState | null;
  command: (
    command: DesktopUpdateCommand,
  ) => Promise<DesktopUpdateState | null>;
  showDownloaded: () => void;
};
const Context = createContext<Updates>({
  state: null,
  command: async () => null,
  showDownloaded() {},
});
export const useDesktopUpdates = () => useContext(Context);

export function DesktopUpdatesProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DesktopUpdateState | null>(null);
  const [downloadedOpen, setDownloadedOpen] = useState(false);
  const announced = useRef<string | null>(null);
  const [commandError, setCommandError] = useState(false);
  useEffect(() => {
    const bridge = window.grimoireDesktop?.updates;
    if (!bridge) return;
    let active = true;
    const stop = bridge.onState((next) => {
      if (active) setState(next);
    });
    void bridge
      .command({ action: "state" })
      .then((next) => {
        if (active) setState(next);
      })
      .catch(() => {});
    return () => {
      active = false;
      stop();
    };
  }, []);
  useEffect(() => {
    if (state?.phase !== "downloaded") {
      setDownloadedOpen(false);
      return;
    }
    if (announced.current !== state.availableVersion) {
      announced.current = state.availableVersion;
      setDownloadedOpen(true);
    }
  }, [state?.phase, state?.availableVersion]);
  const command = async (request: DesktopUpdateCommand) => {
    setCommandError(false);
    try {
      const next = await window.grimoireDesktop?.updates?.command(request);
      if (next) setState(next);
      return next ?? null;
    } catch {
      setCommandError(true);
      return null;
    }
  };
  return (
    <Context.Provider
      value={{ state, command, showDownloaded: () => setDownloadedOpen(true) }}
    >
      {children}
      {downloadedOpen && state?.phase === "downloaded" && (
        <DownloadedDialog
          version={state.availableVersion || ""}
          automatic={state.capability === "automatic"}
          error={commandError}
          onClose={() => setDownloadedOpen(false)}
          onConfirm={() =>
            void command({
              action:
                state.capability === "automatic" ? "quit" : "open-installer",
            })
          }
        />
      )}
    </Context.Provider>
  );
}

function DownloadedDialog({
  version,
  automatic,
  error,
  onClose,
  onConfirm,
}: {
  version: string;
  automatic: boolean;
  error: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="project-dialog update-dialog"
      aria-labelledby="update-dialog-title"
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="project-dialog-content">
        <header>
          <span className="update-dialog-icon">
            <Check size={23} />
          </span>
          <button
            type="button"
            className="icon-button"
            aria-label={t("close")}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>
        <h2 id="update-dialog-title">
          {t("updateDownloadedTitle").replace("{version}", version)}
        </h2>
        <p className="confirm-description">
          {t(automatic ? "updateOnQuitMessage" : "updateManualMessage")}
        </p>
        {error && (
          <p className="error-banner" role="alert">
            {t("updateFailed")}
          </p>
        )}
        <footer>
          <button
            type="button"
            className="project-cancel"
            autoFocus
            onClick={onClose}
          >
            {t("updateLater")}
          </button>
          <button type="button" className="primary-button" onClick={onConfirm}>
            {t(automatic ? "quitAndUpdate" : "openUpdateInstaller")}
          </button>
        </footer>
      </div>
    </dialog>
  );
}

export function UpdateButton({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n();
  const { state, command, showDownloaded } = useDesktopUpdates();
  const [hovered, setHovered] = useState(false);
  const [anchor, setAnchor] = useState({ left: 12, bottom: 60 });
  const tooltipId = useId();
  if (!window.grimoireDesktop?.updates) return null;
  if (!state || !state.availableVersion) return null;
  const busy =
    state?.phase === "checking" ||
    state?.phase === "downloading" ||
    state?.phase === "installing";
  const disabled =
    !state ||
    busy ||
    state.capability === "development" ||
    state.capability === "unsupported";
  const label =
    state?.phase === "downloading"
      ? `${Math.round(state.percent)}%`
      : t("updates");
  const title =
    state?.capability === "development"
      ? t("updatesDevelopment")
      : state?.phase === "downloading"
        ? t("updateDownloading").replace(
            "{percent}",
            String(Math.round(state.percent)),
          )
        : state?.phase === "up-to-date"
          ? t("updateCurrent")
          : state?.phase === "downloaded"
            ? t("updateReady")
            : t("downloadUpdate");
  const click = async () => {
    if (state?.phase === "downloaded") {
      showDownloaded();
      return;
    }
    const next =
      state?.phase === "available" ||
      (state?.phase === "error" && state.availableVersion)
        ? state
        : await command({ action: "check" });
    if (next?.availableVersion) await command({ action: "download" });
  };
  const openNotes = (element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    setAnchor({
      left: Math.max(12, Math.min(rect.right - 340, window.innerWidth - 352)),
      bottom: window.innerHeight - rect.top + 8,
    });
    setHovered(true);
  };
  return (
    <div
      className="update-control"
      onMouseEnter={(event) => openNotes(event.currentTarget)}
      onMouseLeave={() => setHovered(false)}
      onFocus={(event) => openNotes(event.currentTarget)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          setHovered(false);
      }}
    >
      <button
        type="button"
        className={`${compact ? "icon-button" : "sidebar-update-button"} update-available`}
        aria-label={title}
        aria-describedby={hovered ? tooltipId : undefined}
        disabled={disabled}
        onClick={() => void click()}
      >
        {busy ? (
          <LoaderCircle size={17} className="spin" />
        ) : (
          <ArrowUpCircle size={17} />
        )}
        {!compact && <span>{label}</span>}
      </button>
      {hovered && (
        <div
          className="update-release-popover"
          id={tooltipId}
          role="tooltip"
          style={anchor}
        >
          <strong>
            {t("updateVersionAvailable").replace(
              "{version}",
              state.availableVersion || "",
            )}
          </strong>
          <div className="update-release-notes">
            {state.releaseNotes || t("updateNotesEmpty")}
          </div>
          <button
            className="text-button"
            onClick={() => void command({ action: "releases" })}
          >
            {t("viewUpdateNotes")}
          </button>
        </div>
      )}
    </div>
  );
}

export function SettingsFooter({ onSettings }: { onSettings: () => void }) {
  const { t } = useI18n();
  return (
    <div className="sidebar-footer settings-footer">
      <button type="button" className="settings-button" onClick={onSettings}>
        <Settings2 size={17} />
        {t("settings")}
      </button>
      <UpdateButton />
    </div>
  );
}

export function AppVersion() {
  const { t } = useI18n();
  const { state } = useDesktopUpdates();
  return (
    <div className="settings-version">
      {t("currentVersion").replace(
        "{version}",
        state?.currentVersion || import.meta.env.VITE_APP_VERSION,
      )}
    </div>
  );
}
