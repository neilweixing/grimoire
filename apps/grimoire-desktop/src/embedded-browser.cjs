const { app, ipcMain, WebContentsView, session } = require("electron");
const { join } = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const { createBrowserSessions } = require("./browser-sessions.cjs");
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

function attachEmbeddedBrowser(window, origin, options = {}) {
  const preferences = new BrowserPreferences(
    options.preferencesPath ||
      join(app.getPath("userData"), "preferences.json"),
  );
  let requestedVisible = false;
  let bounds;
  let pages;
  function createPage(binding) {
    const partition =
      createHash("sha256").update(JSON.stringify(binding)).digest("hex") +
      (binding.threadId ? "" : randomUUID());
    let page;
    let view;
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
          ? `persist:grimoire-browser-${partition}-unverified`
          : `persist:grimoire-browser-${partition}`,
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
      if (
        pages.active() === page &&
        !window.isDestroyed() &&
        !window.webContents.isDestroyed()
      )
        window.webContents.send("grimoire:browser-state", state);
      return state;
    };
    const position = () => {
      if (!view || window.isDestroyed()) return;
      const { width, height } = window.getContentBounds();
      const scale = window.webContents.getZoomFactor();
      const visible =
        pages.active() === page && bounds && requestedVisible && !state.error;
      const x = visible ? Math.max(0, Math.round(bounds.x * scale)) : 0;
      const y = visible ? Math.max(48, Math.round(bounds.y * scale)) : 48;
      const w = visible
        ? Math.min(Math.round(bounds.width * scale), width - x)
        : Math.max(320, width);
      const h = visible
        ? Math.min(Math.round(bounds.height * scale), height - y)
        : Math.max(240, height - y);
      view.setBounds({ x, y, width: Math.max(1, w), height: Math.max(1, h) });
      view.setVisible(Boolean(visible && w > 0 && h > 0));
      if (visible && view.webContents.debugger.isAttached())
        void view.webContents.debugger
          .sendCommand("Emulation.clearDeviceMetricsOverride")
          .catch(() => {});
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
            backgroundThrottling: false,
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
      show: () => {
        if (pages.active() === page)
          window.webContents.send("grimoire:browser-open");
      },
    });
    automation.bind(binding);
    page = {
      publish,
      position,
      navigate,
      clear,
      bind: (context) => automation.bind(context),
      execute: (request, signal) => automation.execute(request, signal),
      get view() {
        return view;
      },
      get state() {
        return state;
      },
      async configure() {
        const currentUrl = state.url;
        clear();
        browserSession.removeListener("will-download", denyDownload);
        await browserSession.closeAllConnections();
        browserSession = configureSession();
        if (currentUrl) navigate(currentUrl);
      },
      dispose() {
        browserSession.removeListener("will-download", denyDownload);
        if (view && !view.webContents.isDestroyed()) view.webContents.close();
        view = undefined;
      },
    };
    return page;
  }
  pages = createBrowserSessions(createPage);
  const current = () =>
    pages.active() || pages.bind({ workspace: "", threadId: null });
  ipcMain.handle("grimoire:browser-command", async (event, command) => {
    if (
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame ||
      new URL(event.senderFrame.url).origin !== origin
    )
      throw new Error("Untrusted browser command.");
    if (!command || typeof command !== "object")
      throw new Error("Invalid browser command.");
    const page = current();
    const { view, state } = page;
    switch (command.action) {
      case "bind":
        const selected = pages.bind(command.context);
        for (const entry of pages.values()) entry.position();
        return selected.publish();
      case "state":
        return page.publish();
      case "settings": {
        if (options.updatePreferences) {
          await options.updatePreferences({
            ignoreCertificateErrors: command.ignoreCertificateErrors,
          });
        } else {
          preferences.setIgnoreCertificateErrors(
            command.ignoreCertificateErrors,
          );
          await Promise.all(pages.values().map((entry) => entry.configure()));
        }
        return current().publish();
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
        for (const entry of pages.values()) entry.position();
        return state;
      case "navigate":
        return page.navigate(command.url);
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
          page.position();
          view.webContents.reload();
        }
        break;
      case "clear":
        return page.clear();
      default:
        throw new Error("Unsupported browser command.");
    }
    return page.publish();
  });
  window.webContents.on("did-start-navigation", (event) => {
    if (event.isMainFrame) {
      requestedVisible = false;
      for (const entry of pages.values()) entry.position();
    }
  });
  window.on("closed", () => {
    ipcMain.removeHandler("grimoire:browser-command");
    for (const entry of pages.values()) entry.dispose();
  });
  return {
    execute: (request, signal) => pages.execute(request, signal),
    async applyPreferences(value) {
      if (
        preferences.applyIgnoreCertificateErrors(value.ignoreCertificateErrors)
      )
        await Promise.all(pages.values().map((entry) => entry.configure()));
      current().publish();
    },
  };
}

module.exports = { attachEmbeddedBrowser, browserUrl };
