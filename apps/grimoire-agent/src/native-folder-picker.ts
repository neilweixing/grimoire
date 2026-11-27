import { execFile } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, sep } from "node:path";
import { PolicyError } from "./permissions.js";

const macScript = `on run argv
  set selectedFolder to choose folder with prompt (item 1 of argv) default location ((POSIX file (item 2 of argv)) as alias)
  return POSIX path of selectedFolder
end run`;
const windowsScript = `Add-Type -AssemblyName System.Windows.Forms
$picker = New-Object System.Windows.Forms.FolderBrowserDialog
$picker.Description = $env:GRIMOIRE_FOLDER_PROMPT
$picker.SelectedPath = $env:GRIMOIRE_FOLDER_INITIAL
try {
  if ($picker.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $picker.SelectedPath }
} finally { $picker.Dispose() }`;

type LaunchOptions = { signal: AbortSignal; env?: NodeJS.ProcessEnv };
type PickerLauncher = (
  file: string,
  args: string[],
  options: LaunchOptions,
) => Promise<string>;
const launchNative: PickerLauncher = (file, args, options) =>
  new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      {
        encoding: "utf8",
        signal: options.signal,
        maxBuffer: 64 * 1024,
        windowsHide: false,
        env: { ...process.env, ...options.env },
      },
      (error, stdout, stderr) => {
        if (error) reject(Object.assign(error, { stderr }));
        else resolve(stdout);
      },
    );
  });

/** Invoke the host's system picker without interpolating paths into script source. */
export class NativeFolderPicker {
  private active = false;
  constructor(
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly launch: PickerLauncher = launchNative,
  ) {}
  async select(
    initialPath = "",
    locale = "en",
    signal?: AbortSignal,
  ): Promise<string | null> {
    if (this.active)
      throw new PolicyError("A system folder picker is already open.");
    this.active = true;
    try {
      let initial = homedir();
      if (isAbsolute(initialPath)) {
        try {
          const resolved = await realpath(initialPath);
          if ((await stat(resolved)).isDirectory()) initial = resolved;
        } catch {
          /* Use the home folder when the draft path is unavailable. */
        }
      }
      const prompt = locale.startsWith("zh")
        ? "选择项目文件夹"
        : "Choose a project folder";
      const options = {
        signal: AbortSignal.any([
          AbortSignal.timeout(300_000),
          ...(signal ? [signal] : []),
        ]),
      };
      let output: string;
      if (this.platform === "darwin")
        output = await this.launch(
          "/usr/bin/osascript",
          ["-e", macScript, prompt, initial],
          options,
        );
      else if (this.platform === "win32")
        output = await this.launch(
          "powershell.exe",
          [
            "-NoProfile",
            "-STA",
            "-EncodedCommand",
            Buffer.from(windowsScript, "utf16le").toString("base64"),
          ],
          {
            ...options,
            env: {
              GRIMOIRE_FOLDER_PROMPT: prompt,
              GRIMOIRE_FOLDER_INITIAL: initial,
            },
          },
        );
      else if (this.platform === "linux") {
        try {
          output = await this.launch(
            "zenity",
            [
              "--file-selection",
              "--directory",
              `--title=${prompt}`,
              `--filename=${initial}${initial.endsWith(sep) ? "" : sep}`,
            ],
            options,
          );
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          output = await this.launch(
            "kdialog",
            ["--getexistingdirectory", initial, "--title", prompt],
            options,
          );
        }
      } else throw new Error("Unsupported desktop platform.");
      const selected = output.replace(/[\r\n]+$/, "");
      if (!selected) return null;
      if (!isAbsolute(selected)) throw new Error("Invalid folder selection.");
      const canonical = await realpath(selected);
      if (!(await stat(canonical)).isDirectory())
        throw new Error("Selection is not a folder.");
      return canonical;
    } catch (error) {
      const failure = error as Error & {
        code?: string | number;
        stderr?: string;
      };
      if (
        (this.platform === "darwin" &&
          /\(-128\)/.test(failure.stderr ?? failure.message)) ||
        (this.platform === "linux" && failure.code === 1) ||
        failure.name === "AbortError"
      )
        return null;
      throw new PolicyError(
        "The system folder picker is unavailable. Enter the folder path manually.",
      );
    } finally {
      this.active = false;
    }
  }
}
export const nativeFolderPicker = new NativeFolderPicker();
