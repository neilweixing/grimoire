import {
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  NativeFolderPicker,
  nativeFolderPicker,
} from "../apps/grimoire-agent/src/native-folder-picker";
import { createApp } from "../apps/grimoire-agent/src/app";
import { SettingsStore } from "../apps/grimoire-agent/src/settings";

let directory: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "grimoire-native-picker-"));
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(directory, { recursive: true, force: true });
});

it("uses the macOS system picker and passes paths as data rather than executable script", async () => {
  const folder = join(directory, '项目 $(echo test); "quoted"');
  mkdirSync(folder);
  const canonical = realpathSync(folder);
  const launch = vi.fn(async () => `${canonical}/\n`);
  const picker = new NativeFolderPicker("darwin", launch);
  expect(await picker.select(folder, "zh-CN")).toBe(canonical);
  const [file, args] = launch.mock.calls[0] as unknown as [string, string[]];
  expect(file).toBe("/usr/bin/osascript");
  expect(args[1]).not.toContain(folder);
  expect(args.slice(2)).toEqual(["选择项目文件夹", canonical]);
});
it("treats system cancellation as no selection and falls back to home for invalid drafts", async () => {
  const launch = vi.fn(async () => {
    throw Object.assign(new Error("Cancelled"), {
      stderr: "User canceled. (-128)",
    });
  });
  const picker = new NativeFolderPicker("darwin", launch);
  expect(await picker.select(join(directory, "missing"))).toBeNull();
  const args = (launch.mock.calls[0] as unknown as [string, string[]])[1];
  expect(args.at(-1)).toBe(homedir());
});
it("uses the Linux system chooser and only falls back when its executable is missing", async () => {
  const launch = vi
    .fn()
    .mockRejectedValueOnce(Object.assign(new Error(), { code: "ENOENT" }))
    .mockResolvedValueOnce(`${directory}\n`);
  expect(await new NativeFolderPicker("linux", launch).select()).toBe(
    realpathSync(directory),
  );
  expect(launch.mock.calls.map((call) => call[0])).toEqual([
    "zenity",
    "kdialog",
  ]);
  const cancel = vi
    .fn()
    .mockRejectedValue(Object.assign(new Error(), { code: 1 }));
  expect(await new NativeFolderPicker("linux", cancel).select()).toBeNull();
  expect(cancel).toHaveBeenCalledTimes(1);
});
it("uses Windows' native folder dialog with an encoded static script", async () => {
  const launch = vi.fn().mockResolvedValue("");
  expect(
    await new NativeFolderPicker("win32", launch).select(directory),
  ).toBeNull();
  const [file, args, options] = launch.mock.calls[0];
  expect(file).toBe("powershell.exe");
  expect(args).toContain("-STA");
  expect(Buffer.from(args.at(-1), "base64").toString("utf16le")).toContain(
    "FolderBrowserDialog",
  );
  expect(options.env.GRIMOIRE_FOLDER_INITIAL).toBe(realpathSync(directory));
});
it("rejects file selections and concurrent system dialogs", async () => {
  const file = join(directory, "file.txt");
  writeFileSync(file, "fixture");
  await expect(
    new NativeFolderPicker("darwin", vi.fn().mockResolvedValue(file)).select(),
  ).rejects.toThrow("unavailable");
  let finish!: (path: string) => void;
  const launch = vi.fn(
    () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
  );
  const picker = new NativeFolderPicker("darwin", launch);
  const first = picker.select();
  await vi.waitFor(() => expect(launch).toHaveBeenCalledTimes(1));
  await expect(picker.select()).rejects.toThrow("already open");
  finish("");
  expect(await first).toBeNull();
});
it("connects the native chooser to the API, including cancellation and origin checks", async () => {
  const choose = vi
    .spyOn(nativeFolderPicker, "select")
    .mockResolvedValue(realpathSync(directory));
  const app = createApp(new SettingsStore(join(directory, "providers.json")));
  const request = (extraHeaders = {}) =>
    app.request("/api/pi/folders/select", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept-Language": "zh-CN",
        ...extraHeaders,
      },
      body: JSON.stringify({ initialPath: directory }),
    });
  expect(await (await request()).json()).toEqual({
    path: realpathSync(directory),
  });
  expect(choose).toHaveBeenCalledWith(
    directory,
    "zh-CN",
    expect.any(AbortSignal),
  );
  choose.mockResolvedValue(null);
  expect(await (await request()).json()).toEqual({ path: null });
  choose.mockClear();
  expect((await request({ Origin: "https://untrusted.example" })).status).toBe(
    403,
  );
  expect(choose).not.toHaveBeenCalled();
  expect((await app.request("/api/pi/folders")).status).toBe(404);
});
it("delegates desktop folder selection to the injected Electron bridge", async () => {
  const choose = vi.fn().mockResolvedValue(realpathSync(directory));
  const fallback = vi.spyOn(nativeFolderPicker, "select");
  const app = createApp(new SettingsStore(join(directory, "providers.json")), {
    dataDir: join(directory, "pi"),
    selectFolder: choose,
  });
  const response = await app.request(
    "http://127.0.0.1:42317/api/pi/folders/select",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://127.0.0.1:42317",
        "Accept-Language": "en",
      },
      body: JSON.stringify({ initialPath: directory }),
    },
  );
  expect(await response.json()).toEqual({ path: realpathSync(directory) });
  expect(choose).toHaveBeenCalledWith(directory, "en", expect.any(AbortSignal));
  expect(fallback).not.toHaveBeenCalled();
  await app.dispose();
});
