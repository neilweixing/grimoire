const { app, ipcMain, WebContentsView, session } = require("electron");
const { join } = require("node:path");
const { BrowserPreferences } = require("./browser-preferences.cjs");
const { createBrowserAutomation } = require("./browser-tools.cjs");

function browserUrl(value) {
  if (typeof value !== "string" || value.length > 8192)
    throw new Error("Invalid URL.");
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error("Only HTTP and HTTPS URLs are supported.");
  return url.href;
}

function attachEmbeddedBrowser(window, origin) {
  const preferences = new BrowserPreferences(
    join(app.getPath("userData"), "browser-settings.json"),
  );
  let view;
  let requestedVisible = false;
  let bounds;
  let state = {
    url: "",
    title: "",
    loading: false,
    canGoBack: false,
    canGoForward: false,
    error: false,
    errorCode: "",
    ignoreCertificateErrors: preferences.ignoreCertificateErrors,
  };
  const denyDownload = (event) => event.preventDefault();
  const configureSession = () => {
    // Separate partitions prevent accepted certificate results from surviving a switch back to verification.
    const selected = session.fromPartition(
      preferences.ignoreCertificateErrors
        ? "persist:grimoire-browser-unverified"
        : "persist:grimoire-browser",
    );
    selected.setCertificateVerifyProc(
      preferences.ignoreCertificateErrors
        ? (_request, callback) => callback(0)
        : null,
    );
    selected.setPermissionRequestHandler((_contents, _permission, callback) =>
      callback(false),
    );
    selected.setPermissionCheckHandler(() => false);
    selected.on("will-download", denyDownload);
    return selected;
  };
  let browserSession = configureSession();

  const publish = () => {
    if (view && !view.webContents.isDestroyed()) {
      const contents = view.webContents;
      state = {
        ...state,
        url: contents.getURL() || state.url,
        title: contents.getTitle(),
        loading: contents.isLoadingMainFrame(),
        canGoBack: contents.navigationHistory.canGoBack(),
        canGoForward: contents.navigationHistory.canGoForward(),
      };
    }
    if (!window.isDestroyed() && !window.webContents.isDestroyed())
      window.webContents.send("grimoire:browser-state", state);
    return state;
  };
  const position = () => {
    if (!view || window.isDestroyed()) return;
    if (!bounds || !requestedVisible || state.error) {
      view.setVisible(false);
      return;
    }
    const { width, height } = window.getContentBounds();
    const scale = window.webContents.getZoomFactor();
    const x = Math.max(0, Math.round(bounds.x * scale));
    const y = Math.max(48, Math.round(bounds.y * scale));
    const w = Math.min(Math.round(bounds.width * scale), width - x);
    const h = Math.min(Math.round(bounds.height * scale), height - y);
    if (w <= 0 || h <= 0) {
      view.setVisible(false);
      return;
    }
    view.setBounds({ x, y, width: w, height: h });
    view.setVisible(true);
  };
  const clear = () => {
    if (view) {
      const old = view;
      view = undefined;
      window.contentView.removeChildView(old);
      if (!old.webContents.isDestroyed()) old.webContents.close();
    }
    state = {
      url: "",
      title: "",
      loading: false,
      canGoBack: false,
      canGoForward: false,
      error: false,
      errorCode: "",
      ignoreCertificateErrors: preferences.ignoreCertificateErrors,
    };
    return publish();
  };
  const navigate = (value) => {
    const url = browserUrl(value);
    if (!view) {
      view = new WebContentsView({
        webPreferences: {
          session: browserSession,
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          webSecurity: true,
        },
      });
      view.setBackgroundColor("#fffdf9");
      view.setVisible(false);
      window.contentView.addChildView(view);
      const contents = view.webContents;
      for (const event of [
        "did-start-loading",
        "did-stop-loading",
        "did-navigate",
        "did-navigate-in-page",
        "page-title-updated",
      ])
        contents.on(event, publish);
      contents.on(
        "did-fail-load",
        (_event, code, _description, _url, mainFrame) => {
          if (code === -3 || !mainFrame || view?.webContents !== contents)
            return;
          state.error = true;
          state.errorCode = _description;
          position();
          publish();
        },
      );
      contents.on("render-process-gone", () => {
        if (view?.webContents !== contents) return;
        state.error = true;
        position();
        publish();
      });
      const guard = (event) => {
        try {
          browserUrl(event.url);
        } catch {
          event.preventDefault();
        }
      };
      contents.on("will-navigate", guard);
      contents.on("will-redirect", guard);
      contents.setWindowOpenHandler(({ url: target }) => {
        try {
          navigate(target);
        } catch {}
        return { action: "deny" };
      });
    }
    state = { ...state, url, error: false, errorCode: "", loading: true };
    position();
    view.webContents.loadURL(url).catch(() => {});
    return publish();
  };
  const automation = createBrowserAutomation({
    getView: () => view,
    getState: () => state,
    navigate,
    show: () => window.webContents.send("grimoire:browser-open"),
  });
  ipcMain.handle("grimoire:browser-command", async (event, command) => {
    if (
      event.sender !== window.webContents ||
      new URL(event.senderFrame.url).origin !== origin
    )
      throw new Error("Untrusted browser command.");
    if (!command || typeof command !== "object")
      throw new Error("Invalid browser command.");
    switch (command.action) {
      case "bind":
        automation.bind(command.context);
        return state;
      case "state":
        return publish();
      case "settings": {
        const currentUrl = state.url;
        preferences.setIgnoreCertificateErrors(command.ignoreCertificateErrors);
        clear();
        browserSession.removeListener("will-download", denyDownload);
        await browserSession.closeAllConnections();
        browserSession = configureSession();
        return currentUrl ? navigate(currentUrl) : publish();
      }
      case "bounds":
        if (command.bounds) {
          if (
            !["x", "y", "width", "height"].every((key) =>
              Number.isFinite(command.bounds[key]),
            )
          )
            throw new Error("Invalid browser bounds.");
          bounds = command.bounds;
        }
        requestedVisible = command.visible === true;
        position();
        return state;
      case "navigate":
        return navigate(command.url);
      case "back":
        if (view?.webContents.navigationHistory.canGoBack())
          view.webContents.navigationHistory.goBack();
        break;
      case "forward":
        if (view?.webContents.navigationHistory.canGoForward())
          view.webContents.navigationHistory.goForward();
        break;
      case "reload":
        if (view) {
          state.error = false;
          position();
          view.webContents.reload();
        }
        break;
      case "clear":
        return clear();
      default:
        throw new Error("Unsupported browser command.");
    }
    return publish();
  });
  window.webContents.on("did-start-navigation", (event) => {
    if (event.isMainFrame) {
      requestedVisible = false;
      position();
    }
  });
  window.on("closed", () => {
    ipcMain.removeHandler("grimoire:browser-command");
    browserSession.removeListener("will-download", denyDownload);
    if (view && !view.webContents.isDestroyed()) view.webContents.close();
    view = undefined;
  });
  return automation;
}

module.exports = { attachEmbeddedBrowser, browserUrl };
