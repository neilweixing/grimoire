const { existsSync } = require("node:fs");
const { join, dirname, resolve } = require("node:path");
const { spawnSync } = require("node:child_process");

const RELEASES_URL = "https://github.com/neilweixing/grimoire/releases/latest";

function updateCapability(app, platform = process.platform) {
  if (!app.isPackaged) return "development";
  if (platform === "win32")
    return existsSync(
      join(dirname(app.getPath("exe")), "resources", "nsis-install"),
    )
      ? "automatic"
      : "windows-msi";
  if (platform === "darwin") {
    const bundle = resolve(app.getAppPath(), "../../..");
    const signature = spawnSync(
      "/usr/bin/codesign",
      ["-dv", "--verbose=4", bundle],
      {
        encoding: "utf8",
        timeout: 5000,
      },
    );
    return signature.status === 0 &&
      /^TeamIdentifier=(?!not set)[A-Z0-9]+$/m.test(signature.stderr || "")
      ? "automatic"
      : "macos-unsigned";
  }
  return "unsupported";
}

function createDesktopUpdater({
  app,
  updater,
  nativeUpdater,
  getWindow,
  shell,
  platform = process.platform,
  capability = updateCapability(app, platform),
  beforeInstall = async () => {},
  onInstallFailure = () => {},
  log = () => {},
}) {
  let state = {
    currentVersion: app.getVersion(),
    availableVersion: null,
    releaseNotes: "",
    phase: "idle",
    percent: 0,
    capability,
    error: null,
  };
  let checkPromise;
  let downloadPromise;
  let downloadedFile;
  let pendingMacDownload;
  let startupTimer;
  let interval;
  const listeners = [];
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  updater.autoRunAppAfterInstall = false;
  updater.allowPrerelease = false;
  updater.allowDowngrade = false;

  const snapshot = () => ({ ...state });
  const publish = (patch) => {
    state = { ...state, ...patch };
    const window = getWindow();
    if (window && !window.isDestroyed() && !window.webContents.isDestroyed())
      window.webContents.send("grimoire:update-state", snapshot());
    return snapshot();
  };
  const failure = (error) => {
    updater.autoInstallOnAppQuit = false;
    log(`Update failed: ${String(error)}`);
    if (state.phase === "installing") onInstallFailure();
    return publish({
      phase: "error",
      error:
        /ERR_UPDATER_(CHANNEL_FILE_NOT_FOUND|LATEST_VERSION_NOT_FOUND)/.test(
          String(error?.code),
        )
          ? "not-published"
          : "failed",
    });
  };
  const version = (info) => {
    if (
      typeof info?.version !== "string" ||
      !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(info.version)
    )
      throw new Error("Invalid update version.");
    return info.version;
  };
  const listen = (emitter, event, handler) => {
    emitter.on(event, handler);
    listeners.push(() => emitter.removeListener(event, handler));
  };
  listen(updater, "error", failure);
  listen(updater, "update-available", (info) => {
    try {
      publish({
        phase: "available",
        availableVersion: version(info),
        releaseNotes: releaseNotesText(info.releaseNotes),
        percent: 0,
        error: null,
      });
    } catch (error) {
      failure(error);
    }
  });
  listen(updater, "update-not-available", () => {
    publish({ phase: "up-to-date", availableVersion: null, error: null });
  });
  listen(updater, "download-progress", (progress) => {
    if (state.phase === "downloading")
      publish({
        percent: Math.max(0, Math.min(100, Number(progress.percent) || 0)),
      });
  });
  listen(updater, "update-downloaded", (info) => {
    try {
      const availableVersion = version(info);
      downloadedFile = info.downloadedFile;
      if (platform === "darwin" && capability === "automatic")
        pendingMacDownload = availableVersion;
      else
        publish({
          phase: "downloaded",
          availableVersion,
          percent: 100,
          error: null,
        });
    } catch (error) {
      failure(error);
    }
  });
  if (nativeUpdater && platform === "darwin" && capability === "automatic")
    listen(nativeUpdater, "update-downloaded", () => {
      if (pendingMacDownload && state.phase === "downloading")
        publish({
          phase: "downloaded",
          availableVersion: pendingMacDownload,
          percent: 100,
          error: null,
        });
    });

  async function check() {
    if (capability === "development" || capability === "unsupported")
      return snapshot();
    if (state.availableVersion) return snapshot();
    if (["downloading", "downloaded", "installing"].includes(state.phase))
      return snapshot();
    if (checkPromise) {
      await checkPromise;
      return snapshot();
    }
    publish({ phase: "checking", error: null });
    checkPromise = Promise.resolve()
      .then(() => updater.checkForUpdates())
      .catch(failure)
      .finally(() => {
        checkPromise = undefined;
      });
    await checkPromise;
    return snapshot();
  }
  async function download() {
    if (downloadPromise) {
      await downloadPromise;
      return snapshot();
    }
    if (state.phase === "downloaded") return snapshot();
    if (
      state.phase !== "available" &&
      !(state.phase === "error" && state.availableVersion)
    )
      throw new Error("Check for an available update before downloading.");
    // A user-requested download opts into installing on the next normal quit.
    updater.autoInstallOnAppQuit = capability === "automatic";
    publish({ phase: "downloading", percent: 0, error: null });
    downloadPromise = Promise.resolve()
      .then(() => updater.downloadUpdate())
      .catch(failure)
      .finally(() => {
        downloadPromise = undefined;
      });
    await downloadPromise;
    return snapshot();
  }
  async function command(request) {
    if (!request || typeof request !== "object")
      throw new Error("Invalid update command.");
    switch (request.action) {
      case "state":
        return snapshot();
      case "check":
        return check();
      case "download":
        return download();
      case "quit":
        if (state.phase !== "downloaded" || capability !== "automatic")
          throw new Error("No installable update is ready.");
        publish({ phase: "installing", error: null });
        try {
          await beforeInstall();
          updater.quitAndInstall(false, false);
        } catch (error) {
          failure(error);
        }
        return snapshot();
      case "open-installer": {
        if (
          state.phase !== "downloaded" ||
          capability === "automatic" ||
          typeof downloadedFile !== "string" ||
          !/\.(zip|exe)$/i.test(downloadedFile) ||
          !existsSync(downloadedFile)
        )
          throw new Error("No downloaded installer is available.");
        const error = await shell.openPath(downloadedFile);
        if (error) throw new Error(error);
        return snapshot();
      }
      case "releases":
        await shell.openExternal(RELEASES_URL);
        return snapshot();
      default:
        throw new Error("Unknown update command.");
    }
  }
  return {
    snapshot,
    command,
    start() {
      if (
        startupTimer ||
        interval ||
        capability === "development" ||
        capability === "unsupported"
      )
        return;
      startupTimer = setTimeout(() => void check(), 15_000);
      interval = setInterval(() => void check(), 6 * 60 * 60 * 1000);
      startupTimer.unref?.();
      interval.unref?.();
    },
    dispose() {
      clearTimeout(startupTimer);
      clearInterval(interval);
      for (const remove of listeners) remove();
    },
  };
}

function attachUpdateBridge(ipcMain, controller, getWindow, getOrigin) {
  ipcMain.handle("grimoire:update-command", (event, request) => {
    const window = getWindow();
    if (
      !window ||
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame ||
      new URL(event.senderFrame.url).origin !== getOrigin()
    )
      throw new Error(
        "Update commands are restricted to the main application.",
      );
    return controller.command(request);
  });
}

function releaseNotesText(value) {
  const text =
    typeof value === "string"
      ? value
      : Array.isArray(value)
        ? value
            .map((entry) => (typeof entry?.note === "string" ? entry.note : ""))
            .join("\n\n")
        : "";
  return text
    .slice(0, 12000)
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/(?:p|h[1-6]|li|ul|ol|pre|div)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}
module.exports = {
  createDesktopUpdater,
  attachUpdateBridge,
  updateCapability,
  releaseNotesText,
};
