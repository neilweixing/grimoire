const {
  app,
  BrowserWindow,
  dialog,
  Menu,
  ipcMain,
  shell,
  autoUpdater: nativeUpdater,
  utilityProcess,
  clipboard,
  nativeTheme,
} = require("electron");
const { join, isAbsolute, dirname, basename } = require("node:path");
const {
  appendFileSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  watch,
} = require("node:fs");
const { attachEmbeddedBrowser } = require("./embedded-browser.cjs");
const { attachClipboardBridge } = require("./clipboard.cjs");
const { attachAppBridge, minimizeOnClose } = require("./app-controls.cjs");
const {
  desktopDataDirectory,
  migrateDesktopData,
  desktopLayout,
  migrateDesktopLayout,
} = require("./data-directory.cjs");
const { autoUpdater } = require("electron-updater");
const { createDesktopUpdater, attachUpdateBridge } = require("./updater.cjs");

const development = !app.isPackaged && process.env.GRIMOIRE_DESKTOP_DEV === "1";
app.setName(development ? "Grimoire Dev" : "Grimoire");
const legacyDataDir = app.getPath("userData");
const dataOverride = process.env.GRIMOIRE_DESKTOP_USER_DATA;
const dataDir = desktopDataDirectory({
  override: dataOverride,
  development,
  legacy: legacyDataDir,
});
mkdirSync(dataDir, { recursive: true, mode: 0o700 });
const layout = desktopLayout(dataDir);
mkdirSync(layout.logs, { recursive: true, mode: 0o700 });
// Keep the original lock location so older installed versions cannot run during migration.
app.setPath("userData", dataDir);
const log = (message) => {
  appendFileSync(
    join(layout.logs, "desktop.log"),
    `${new Date().toISOString()} ${message}\n`,
    { mode: 0o600 },
  );
  if (development) process.stdout.write(`[agent] ${message}\n`);
};
let service;
let browserAutomation;
let window;
let url;
let quitting = false;
let folderOpen = false;
let agentWatcher;
let agentReloadTimer;
let agentRestarts = Promise.resolve();
let desktopUpdater;
const stoppingServices = new WeakSet();
const smokeFile = process.env.GRIMOIRE_DESKTOP_SMOKE_REPORT;
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    if (window?.isMinimized()) window.restore();
    window?.show();
    window?.focus();
  });
  try {
    if (!development && !dataOverride)
      migrateDesktopData(legacyDataDir, dataDir);
    migrateDesktopLayout(dataDir);
    app.setPath("userData", layout.desktop);
    app.setPath("sessionData", layout.desktop);
    app.whenReady().then(start).catch(fail);
  } catch (error) {
    fail(error);
  }
}

async function start() {
  Menu.setApplicationMenu(
    process.platform === "win32"
      ? null
      : Menu.buildFromTemplate([
          {
            label: "Grimoire",
            submenu: [
              { role: "about" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
          { role: "editMenu" },
          { role: "viewMenu" },
          { role: "windowMenu" },
        ]),
  );
  const agentUrl = await startAgent();
  url = development ? process.env.GRIMOIRE_DESKTOP_DEV_URL : agentUrl;
  if (!url || !/^http:\/\/127\.0\.0\.1:\d+\/?$/.test(url))
    throw new Error("Invalid local desktop URL.");
  desktopUpdater = createDesktopUpdater({
    app,
    updater: autoUpdater,
    nativeUpdater,
    getWindow: () => window,
    shell,
    log,
    beforeInstall: async () => {
      await stopAgent(service);
      quitting = true;
      agentWatcher?.close();
      clearTimeout(agentReloadTimer);
    },
    onInstallFailure: () => {
      app.relaunch();
      app.exit(1);
    },
  });
  attachUpdateBridge(
    ipcMain,
    desktopUpdater,
    () => window,
    () => new URL(url).origin,
  );
  attachClipboardBridge(
    ipcMain,
    clipboard,
    () => window,
    () => new URL(url).origin,
  );
  attachAppBridge(
    ipcMain,
    app,
    () => window,
    () => new URL(url).origin,
  );
  await openWindow();
  if (!smokeFile) desktopUpdater.start();
  if (development) {
    publishDevState(agentUrl);
    agentWatcher = watch(
      dirname(process.env.GRIMOIRE_DESKTOP_AGENT_ENTRY),
      (_event, filename) => {
        if (filename !== basename(process.env.GRIMOIRE_DESKTOP_AGENT_ENTRY))
          return;
        clearTimeout(agentReloadTimer);
        agentReloadTimer = setTimeout(() => {
          agentRestarts = agentRestarts
            .then(async () => {
              if (quitting) return;
              console.log(
                "[desktop-dev] Restarting Pi after successful build...",
              );
              await stopAgent(service);
              if (quitting) return;
              const nextUrl = await startAgent();
              if (quitting) return;
              publishDevState(nextUrl);
              window?.webContents.reload();
            })
            .catch((error) =>
              console.error(
                "[desktop-dev] Pi restart failed; fix the source to retry.",
                error,
              ),
            );
        }, 150);
      },
    );
    process.once("SIGTERM", () => app.quit());
    process.once("SIGINT", () => app.quit());
  }
  if (smokeFile) await smokeTest();
}

function publishDevState(agentUrl) {
  writeFileSync(
    join(dataDir, "dev-state.json"),
    JSON.stringify(
      {
        pid: process.pid,
        agentPid: service.pid,
        url,
        agentUrl,
        dataDir,
      },
      null,
      2,
    ),
  );
}

async function stopAgent(child) {
  if (!child || !child.pid) return;
  stoppingServices.add(child);
  await new Promise((resolve) => {
    const timeout = setTimeout(() => child.kill(), 5000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
    child.postMessage({ type: "shutdown" });
  });
}

async function startAgent() {
  const resources = app.isPackaged
    ? process.resourcesPath
    : join(__dirname, "../stage");
  const entry = development
    ? process.env.GRIMOIRE_DESKTOP_AGENT_ENTRY
    : join(resources, "agent/dist/desktop.js");
  const child = utilityProcess.fork(entry, [], {
    cwd: dataDir,
    env: {
      ...process.env,
      GRIMOIRE_DESKTOP_DEV: development ? "1" : "0",
      GRIMOIRE_DESKTOP_DATA: dataDir,
      GRIMOIRE_DESKTOP_CONFIG: layout.config,
      GRIMOIRE_DESKTOP_WEB: join(resources, "web"),
      PATH:
        process.platform === "win32"
          ? process.env.PATH
          : `${process.env.PATH || "/usr/bin:/bin:/usr/sbin:/sbin"}:/opt/homebrew/bin:/usr/local/bin`,
    },
    serviceName: "Grimoire Agent",
    stdio: "pipe",
    execArgv: development
      ? [
          `--inspect=127.0.0.1:${process.env.GRIMOIRE_DESKTOP_AGENT_INSPECT_PORT}`,
          "--enable-source-maps",
        ]
      : [],
  });
  service = child;
  const browserRequests = new Map();
  child.on("message", (message) => {
    if (message.type === "preferences-change") {
      const preferences = message.preferences;
      Promise.resolve()
        .then(async () => {
          if (
            !preferences ||
            !["light", "dark"].includes(preferences.appearance) ||
            typeof preferences.ignoreCertificateErrors !== "boolean"
          )
            throw new Error("Invalid desktop preferences.");
          nativeTheme.themeSource = preferences.appearance;
          window?.setBackgroundColor(
            preferences.appearance === "dark" ? "#282c34" : "#fcfaf7",
          );
          await browserAutomation?.applyPreferences(preferences);
        })
        .then(
          () =>
            child.pid &&
            child.postMessage({ type: "preferences-result", id: message.id }),
          (error) =>
            child.pid &&
            child.postMessage({
              type: "preferences-result",
              id: message.id,
              error: error.message,
            }),
        );
      return;
    }
    if (message.type === "browser-cancel")
      browserRequests.get(message.id)?.abort();
    if (message.type !== "browser-request") return;
    const abort = new AbortController();
    browserRequests.set(message.id, abort);
    Promise.resolve()
      .then(() => {
        if (!browserAutomation)
          throw new Error("The browser window is not ready.");
        return browserAutomation.execute(message.request, abort.signal);
      })
      .then(
        (result) => {
          if (child.pid)
            child.postMessage({
              type: "browser-result",
              id: message.id,
              result,
            });
        },
        (error) => {
          if (child.pid)
            child.postMessage({
              type: "browser-result",
              id: message.id,
              error: error.message,
            });
        },
      )
      .finally(() => browserRequests.delete(message.id));
  });
  child.once("exit", () => {
    for (const abort of browserRequests.values()) abort.abort();
    browserRequests.clear();
  });
  child.stdout?.on("data", (data) => log(data.toString()));
  child.stderr?.on("data", (data) => log(data.toString()));
  child.on("exit", (code) => {
    log(`Agent exited (${code}).`);
    if (!quitting && !stoppingServices.has(child)) {
      if (development)
        console.error(
          `[desktop-dev] Pi stopped (${code}); waiting for a source change.`,
        );
      else fail(new Error(`The local Agent stopped (${code}).`));
    }
  });
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () =>
        reject(new Error("The local Agent did not start within 30 seconds.")),
      30_000,
    );
    child.on("message", (message) => {
      if (message.type === "ready") {
        clearTimeout(timeout);
        resolve(message.url);
      }
      if (message.type === "select-folder") selectFolder(message);
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Agent startup failed (${code}).`));
    });
  });
}

async function openWindow() {
  let appearance = "light";
  try {
    appearance =
      JSON.parse(readFileSync(join(layout.config, "preferences.json"), "utf8"))
        .appearance === "dark"
        ? "dark"
        : "light";
  } catch {}
  nativeTheme.themeSource = appearance;
  window = new BrowserWindow({
    width: 1320,
    height: 900,
    minWidth: 820,
    minHeight: 600,
    title: "Grimoire",
    ...(process.platform === "darwin"
      ? { titleBarStyle: "hiddenInset", trafficLightPosition: { x: 8, y: 16 } }
      : {}),
    backgroundColor: appearance === "dark" ? "#282c34" : "#fcfaf7",
    show: false,
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  browserAutomation = attachEmbeddedBrowser(window, new URL(url).origin, {
    preferencesPath: join(layout.config, "preferences.json"),
    updatePreferences: async (patch) => {
      const response = await fetch(`${url}/api/preferences`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!response.ok) throw new Error("Could not save browser preferences.");
      return response.json();
    },
  });
  window.webContents.on("will-navigate", (event, target) => {
    if (new URL(target).origin !== new URL(url).origin) event.preventDefault();
  });
  window.webContents.session.setPermissionRequestHandler(
    (_contents, _permission, callback) => callback(false),
  );
  minimizeOnClose(window, () => quitting);
  window.on("closed", () => {
    window = undefined;
  });
  await window.loadURL(url);
  window.show();
}

async function selectFolder({ id, initialPath, locale }) {
  if (folderOpen)
    return service?.postMessage({ type: "folder-result", id, path: null });
  folderOpen = true;
  try {
    const result = await dialog.showOpenDialog(window, {
      title: locale?.startsWith("zh")
        ? "选择项目文件夹"
        : "Choose a project folder",
      defaultPath:
        typeof initialPath === "string" &&
        isAbsolute(initialPath) &&
        existsSync(initialPath)
          ? initialPath
          : app.getPath("home"),
      properties: ["openDirectory"],
    });
    service?.postMessage({
      type: "folder-result",
      id,
      path: result.canceled ? null : (result.filePaths[0] ?? null),
    });
  } catch (error) {
    log(String(error));
    service?.postMessage({ type: "folder-result", id, path: null });
  } finally {
    folderOpen = false;
  }
}

async function smokeTest() {
  const health = await fetch(`${url}/api/health`).then((r) => r.json());
  let workspaces = await fetch(`${url}/api/pi/workspaces`).then((r) =>
    r.json(),
  );
  if (workspaces.length === 0) {
    const path = join(dataDir, "workspace");
    mkdirSync(path, { recursive: true });
    const response = await fetch(`${url}/api/pi/workspaces`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, name: "Smoke project" }),
    });
    if (response.status !== 201)
      throw new Error("Unable to register the smoke project.");
    workspaces = [await response.json()];
  }
  const smokeHeaders = {
    "Content-Type": "application/json",
    "X-Grimoire-Workspace": workspaces[0].id,
  };
  const providers = await fetch(`${url}/api/providers`).then((r) => r.json());
  const previousChats = await fetch(`${url}/api/pi/threads`, {
    headers: smokeHeaders,
  }).then((r) => r.json());
  const created = await fetch(`${url}/api/pi/threads`, {
    method: "POST",
    headers: smokeHeaders,
    body: JSON.stringify({
      title: "Desktop smoke test",
      initialMessage: { content: "Hello" },
    }),
  });
  if (created.status !== 201)
    throw new Error(`Unable to create a Pi chat: ${await created.text()}`);
  const thread = await created.json();
  let completed;
  for (let attempt = 0; attempt < 100; attempt++) {
    completed = await fetch(`${url}/api/pi/threads/${thread.metadata.id}`, {
      headers: smokeHeaders,
    }).then((r) => r.json());
    if (
      completed.metadata.status !== "running" &&
      completed.messages.some((m) => m.role === "assistant")
    )
      break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (
    !completed.messages.some((m) => m.role === "assistant") ||
    completed.metadata.status === "running"
  )
    throw new Error("The packaged Pi demo did not finish a reply.");
  const sandbox = await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Sandbox smoke test timed out.")),
      30_000,
    );
    const listener = (message) => {
      if (message.type !== "sandbox-result") return;
      clearTimeout(timeout);
      service.removeListener("message", listener);
      resolve(message);
    };
    service.on("message", listener);
    service.postMessage({
      type: "smoke-sandbox",
      path: join(dataDir, "workspace"),
    });
  });
  const ui = await window.webContents
    .executeJavaScript(`new Promise((resolve, reject) => {
    let tries = 0;
    const timer = setInterval(() => {
      if (document.querySelector('.app-shell')) { clearInterval(timer); resolve({ title: document.title, text: document.body.innerText, nodeIntegration: typeof require !== 'undefined', desktop: document.documentElement.dataset.desktop, headerDrag: getComputedStyle(document.querySelector('.topbar')).getPropertyValue('-webkit-app-region'), buttonDrag: getComputedStyle(document.querySelector('.new-chat-button')).getPropertyValue('-webkit-app-region') }); }
      else if (++tries > 100) { clearInterval(timer); reject(new Error('React UI did not render.')); }
    }, 100);
  })`);
  await window.webContents
    .capturePage()
    .then((image) => writeFileSync(`${smokeFile}.png`, image.toPNG()));
  if (
    health.status !== "ok" ||
    sandbox.exitCode !== 0 ||
    sandbox.output?.trim() !== "grimoire-sandbox-ok" ||
    ui.nodeIntegration ||
    ui.desktop !== (process.platform === "darwin" ? "macos" : "windows") ||
    (process.platform === "darwin" && ui.headerDrag !== "drag")
  )
    throw new Error(
      `Desktop smoke test failed: ${JSON.stringify({ health, sandbox, ui })}`,
    );
  writeFileSync(
    smokeFile,
    JSON.stringify(
      {
        packaged: app.isPackaged,
        applicationMenu: Menu.getApplicationMenu() !== null,
        updates: desktopUpdater.snapshot(),
        arch: process.arch,
        electron: process.versions.electron,
        dataDir,
        url,
        health,
        workspaces,
        providers,
        previousChats,
        chat: completed,
        sandbox,
        ui,
        window: {
          bounds: window.getBounds(),
          contentBounds: window.getContentBounds(),
          controls:
            process.platform === "darwin"
              ? window.getWindowButtonPosition()
              : null,
        },
      },
      null,
      2,
    ),
  );
  app.quit();
}

function fail(error) {
  log(error.stack || String(error));
  if (smokeFile)
    writeFileSync(smokeFile, JSON.stringify({ error: String(error) }));
  else if (development) console.error(error);
  else
    dialog.showErrorBox(
      "Grimoire",
      `Unable to start Grimoire.\n${error.message}\n\nLog: ${join(layout.logs, "desktop.log")}`,
    );
  app.exit(1);
}
app.on("activate", () => {
  if (quitting) return;
  if (window) {
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  } else if (url) openWindow().catch(fail);
});
app.on("window-all-closed", () => app.quit());
app.on("before-quit", (event) => {
  if (quitting) return;
  quitting = true;
  if (!service?.pid) return;
  event.preventDefault();
  agentWatcher?.close();
  clearTimeout(agentReloadTimer);
  const timeout = setTimeout(() => {
    service.kill();
    app.quit();
  }, 5000);
  service.once("exit", () => {
    clearTimeout(timeout);
    app.quit();
  });
  service.postMessage({ type: "shutdown" });
});
