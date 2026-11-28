import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import { expect, it, vi } from "vitest";
const require = createRequire(import.meta.url);
const {
  attachAppBridge,
  minimizeOnClose,
} = require("../apps/grimoire-desktop/src/app-controls.cjs");
function fixture() {
  const window = Object.assign(new EventEmitter(), {
    minimize: vi.fn(),
    webContents: { mainFrame: { url: "http://127.0.0.1:12345/" } },
  });
  let quitting = false;
  const app = {
    quit: vi.fn(() => {
      quitting = true;
      window.emit("close", { preventDefault });
    }),
  };
  const preventDefault = vi.fn();
  const handlers = new Map<string, (event: any) => void>();
  const ipc = { handle: vi.fn((name, handler) => handlers.set(name, handler)) };
  minimizeOnClose(window, () => quitting);
  attachAppBridge(
    ipc,
    app,
    () => window,
    () => "http://127.0.0.1:12345",
  );
  return {
    window,
    app,
    preventDefault,
    quit: handlers.get("grimoire:app-quit")!,
    event: {
      sender: window.webContents,
      senderFrame: window.webContents.mainFrame,
    },
  };
}
it("keeps window close as minimize, while explicit Quit enters the normal application shutdown path", () => {
  const { window, app, preventDefault, quit, event } = fixture();
  window.emit("close", { preventDefault });
  expect(window.minimize).toHaveBeenCalledOnce();
  expect(preventDefault).toHaveBeenCalledOnce();
  preventDefault.mockClear();
  quit(event);
  expect(app.quit).toHaveBeenCalledOnce();
  expect(window.minimize).toHaveBeenCalledOnce();
  expect(preventDefault).not.toHaveBeenCalled();
});
it("does not allow embedded pages, child frames or foreign origins to quit the app", () => {
  const { app, quit, event } = fixture();
  expect(() => quit({ ...event, sender: {} })).toThrow("main application");
  expect(() =>
    quit({ ...event, senderFrame: { url: event.senderFrame.url } }),
  ).toThrow("main application");
  event.senderFrame.url = "https://untrusted.example/";
  expect(() => quit(event)).toThrow("main application");
  expect(app.quit).not.toHaveBeenCalled();
});
it("rejects stale quit requests after the main window is gone", () => {
  const app = { quit: vi.fn() };
  let quit!: (event: unknown) => void;
  attachAppBridge(
    {
      handle: (_: string, handler: typeof quit) => {
        quit = handler;
      },
    },
    app,
    () => undefined,
    () => "http://127.0.0.1:12345",
  );
  expect(() => quit({})).toThrow("main application");
  expect(app.quit).not.toHaveBeenCalled();
});
