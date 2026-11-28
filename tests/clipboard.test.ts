import { createRequire } from "node:module";
import { afterEach, expect, it, vi } from "vitest";
import { writeClipboardText } from "../apps/grimoire-web/src/clipboard";
const require = createRequire(import.meta.url);
const {
  attachClipboardBridge,
} = require("../apps/grimoire-desktop/src/clipboard.cjs");
afterEach(() => vi.unstubAllGlobals());

function fixture() {
  let write!: (event: unknown, text: unknown) => void;
  const ipc = {
    handle: vi.fn((_name, handler) => {
      write = handler;
    }),
  };
  const clipboard = { writeText: vi.fn() };
  const frame = { url: "http://127.0.0.1:12345/" };
  const window = { webContents: { mainFrame: frame } };
  attachClipboardBridge(
    ipc,
    clipboard,
    () => window,
    () => "http://127.0.0.1:12345",
  );
  const event = { sender: window.webContents, senderFrame: frame };
  return { write, clipboard, event };
}
it("writes exact Unicode and multiline text from the app's own main frame", () => {
  const { write, clipboard, event } = fixture();
  const text = "原始内容\n**Markdown** \`code\`";
  write(event, text);
  expect(clipboard.writeText).toHaveBeenCalledWith(text);
});
it("rejects another renderer, a child frame, or a navigated foreign origin", () => {
  const { write, clipboard, event } = fixture();
  expect(() => write({ ...event, sender: {} }, "blocked")).toThrow(
    "main application",
  );
  expect(() =>
    write({ ...event, senderFrame: { url: event.senderFrame.url } }, "blocked"),
  ).toThrow("main application");
  event.senderFrame.url = "https://untrusted.example/";
  expect(() => write(event, "blocked")).toThrow("main application");
  expect(clipboard.writeText).not.toHaveBeenCalled();
});
it("rejects invalid or oversized text before writing", () => {
  const { write, clipboard, event } = fixture();
  expect(() => write(event, { text: "invalid" })).toThrow("Invalid clipboard");
  expect(() => write(event, "x".repeat(8 * 1024 * 1024 + 1))).toThrow(
    "Invalid clipboard",
  );
  expect(clipboard.writeText).not.toHaveBeenCalled();
});
it("uses the desktop writer without accessing the browser clipboard", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  const browserWrite = vi.fn();
  vi.stubGlobal("window", { grimoireDesktop: { clipboard: { writeText } } });
  vi.stubGlobal("navigator", { clipboard: { writeText: browserWrite } });
  await writeClipboardText("desktop text");
  expect(writeText).toHaveBeenCalledWith("desktop text");
  expect(browserWrite).not.toHaveBeenCalled();
});
it("uses the browser Clipboard API in web mode and propagates write failures", async () => {
  const writeText = vi
    .fn()
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error("denied"));
  vi.stubGlobal("window", {});
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  await writeClipboardText("web text");
  expect(writeText).toHaveBeenCalledWith("web text");
  await expect(writeClipboardText("failure")).rejects.toThrow("denied");
});
