import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { afterEach, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const {
  createDesktopUpdater,
  attachUpdateBridge,
  releaseNotesText,
} = require("../apps/grimoire-desktop/src/updater.cjs");
const controllers: Array<{ dispose(): void }> = [];
afterEach(() => {
  controllers.forEach((c) => c.dispose());
  controllers.length = 0;
  vi.useRealTimers();
});
function setup(capability = "automatic", platform = "win32") {
  const engine = Object.assign(new EventEmitter(), {
    checkForUpdates: vi.fn(async () => {
      engine.emit("update-available", {
        version: "0.1.2",
        releaseNotes: "<h2>Fixes</h2><p>Safer updates</p>",
      });
    }),
    downloadUpdate: vi.fn(async () => {
      engine.emit("download-progress", { percent: 42 });
      engine.emit("update-downloaded", {
        version: "0.1.2",
        downloadedFile: "/cache/update.exe",
      });
    }),
    quitAndInstall: vi.fn(),
  });
  const native = new EventEmitter();
  const frame = { url: "http://127.0.0.1:5180/" };
  const window = {
    isDestroyed: () => false,
    webContents: { isDestroyed: () => false, send: vi.fn(), mainFrame: frame },
  };
  const app = { getVersion: () => "0.1.1", quit: vi.fn() };
  const beforeInstall = vi.fn(async () => {});
  const shell = { openPath: vi.fn(), openExternal: vi.fn() };
  const controller = createDesktopUpdater({
    app,
    updater: engine,
    nativeUpdater: native,
    capability,
    platform,
    getWindow: () => window,
    shell,
    beforeInstall,
  });
  controllers.push(controller);
  return { controller, engine, native, app, window, frame, beforeInstall };
}
it("checks in the background without downloading or installing, and keeps the update pending", async () => {
  vi.useFakeTimers();
  const { controller, engine } = setup();
  controller.start();
  await vi.advanceTimersByTimeAsync(15000);
  expect(controller.snapshot()).toMatchObject({
    phase: "available",
    availableVersion: "0.1.2",
    releaseNotes: "Fixes\nSafer updates",
  });
  await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
  expect(engine.checkForUpdates).toHaveBeenCalledTimes(1);
  expect(engine.downloadUpdate).not.toHaveBeenCalled();
  expect(engine.quitAndInstall).not.toHaveBeenCalled();
  expect(engine.autoInstallOnAppQuit).toBe(false);
});
it("downloads only after a click and keeps installation on quit enabled when the prompt is dismissed", async () => {
  const { controller, engine, beforeInstall } = setup();
  await controller.command({ action: "check" });
  await controller.command({ action: "download" });
  expect(controller.snapshot()).toMatchObject({
    phase: "downloaded",
    percent: 100,
  });
  expect(engine.autoInstallOnAppQuit).toBe(true);
  expect(engine.quitAndInstall).not.toHaveBeenCalled();
  expect(beforeInstall).not.toHaveBeenCalled();
  await controller.command({ action: "quit" });
  expect(beforeInstall).toHaveBeenCalledTimes(1);
  expect(engine.quitAndInstall).toHaveBeenCalledWith(false, false);
});
it.each(["macos-unsigned", "windows-msi"])(
  "never automatically installs unsupported %s installations",
  async (capability) => {
    const { controller, engine } = setup(capability);
    await controller.command({ action: "check" });
    await controller.command({ action: "download" });
    expect(engine.autoInstallOnAppQuit).toBe(false);
    await expect(controller.command({ action: "quit" })).rejects.toThrow(
      "No installable update",
    );
    expect(engine.quitAndInstall).not.toHaveBeenCalled();
  },
);
it("waits for native macOS signature validation before announcing a downloaded update", async () => {
  const { controller, native } = setup("automatic", "darwin");
  await controller.command({ action: "check" });
  await controller.command({ action: "download" });
  expect(controller.snapshot().phase).toBe("downloading");
  native.emit("update-downloaded");
  expect(controller.snapshot().phase).toBe("downloaded");
});
it("disables pending installation after a failed download", async () => {
  const { controller, engine } = setup();
  engine.downloadUpdate.mockRejectedValueOnce(new Error("checksum mismatch"));
  await controller.command({ action: "check" });
  await controller.command({ action: "download" });
  expect(controller.snapshot()).toMatchObject({
    phase: "error",
    availableVersion: "0.1.2",
  });
  expect(engine.autoInstallOnAppQuit).toBe(false);
  await expect(controller.command({ action: "quit" })).rejects.toThrow();
});
it("deduplicates simultaneous version checks", async () => {
  const { controller, engine } = setup();
  await Promise.all([
    controller.command({ action: "check" }),
    controller.command({ action: "check" }),
  ]);
  expect(engine.checkForUpdates).toHaveBeenCalledTimes(1);
});
it("rejects update commands from webpages and subframes", async () => {
  const { controller, window, frame } = setup();
  let handle!: (event: unknown, request: unknown) => unknown;
  attachUpdateBridge(
    {
      handle: (_name: string, fn: typeof handle) => {
        handle = fn;
      },
    },
    controller,
    () => window,
    () => "http://127.0.0.1:5180",
  );
  expect(() =>
    handle({ sender: {}, senderFrame: frame }, { action: "quit" }),
  ).toThrow("main application");
  expect(() =>
    handle(
      { sender: window.webContents, senderFrame: { url: frame.url } },
      { action: "check" },
    ),
  ).toThrow("main application");
  expect(
    await handle(
      { sender: window.webContents, senderFrame: frame },
      { action: "state" },
    ),
  ).toMatchObject({ currentVersion: "0.1.1" });
});
it("bounds release notes and exposes plain text rather than executable HTML", () => {
  expect(releaseNotesText([{ note: "<p>A &amp; B</p>" }])).toBe("A & B");
  expect(releaseNotesText("a".repeat(20000)).length).toBe(12000);
});
