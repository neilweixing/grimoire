<p align="center">
  <img src="apps/grimoire-web/public/grimoire-mark.svg" alt="Grimoire Logo" width="96" height="96" />
</p>

# Grimoire

> Spells written in code

Grimoire is a local web coding agent built with the [native Pi SDK](https://github.com/earendil-works/pi/tree/main/packages/coding-agent), [`@assistant-ui/react-pi`](https://github.com/assistant-ui/assistant-ui/tree/main/packages/react-pi), backend permissions, and one-time tool approvals. The default executor uses [Anthropic Sandbox Runtime](https://github.com/anthropics/sandbox-runtime), also used by Pi's sandbox extension example. No Docker daemon or container image is required.

## Quick start

Requirements: Node.js 22.19+ and pnpm 12.23.0.

```bash
pnpm install
pnpm dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). The Agent API binds to `127.0.0.1:3001`.

## Commit message validation

`pnpm install` installs the repository's `pre-push` hook through the `prepare` script. For an existing checkout, run `pnpm hooks:install` once. The installer preserves any existing `core.hooksPath` configuration by reporting a conflict instead of overwriting it.

Before each push, the hook checks every commit introduced by the pushed refs, including earlier unpushed commits. Use `<type>(<scope>): <description>` with a lowercase type from `AGENTS.md`, an optional nonempty scope, exactly one space after the colon, and a Chinese description with no trailing period or whitespace. The checker requires at least one Chinese character and rejects the generic descriptions `更新代码` and `修复问题`; reviewers still assess whether the wording accurately describes the change. Breaking changes use `!` immediately before the colon and require a commit body explaining the compatibility impact.

```text
feat(ui): 新增模型选择器
fix(api): 修复会话恢复失败
```

A rejected push lists the offending commits. Correct the messages with `git commit --amend` or `git rebase -i`, then push again. Merge and revert commits follow the same format; Git's default generated messages must be edited. For a new remote branch or tag, commits already reachable from this remote's local tracking refs are excluded. If no tracking refs exist, the entire reachable history is checked; fetch an existing remote before pushing a new branch. Ref deletions introduce no commits and are skipped. The **Commit messages** GitHub Actions workflow runs on every branch push and pull request, reusing the same validator independently of local hooks. PR checks use the actual base and head SHAs, excluding GitHub's synthetic merge commit. Push checks use the event's before/after SHAs; new branches exclude history reachable from other remote branches. The workflow fetches full history and retrieves missing commit objects when needed; missing history or malformed events fail the check.

Configure **Commit message format** as a required status check in the target branch's protection rule or ruleset to block merging when validation fails. Local `--no-verify` does not skip CI. The workflow reports failures after a push; preventing direct updates to protected branches also requires the repository's branch protection settings.

## Desktop downloads and CI

[Desktop installers](https://github.com/neilweixing/grimoire/actions/workflows/desktop-build.yml) runs format checks, type checks, tests, and code compilation for pushes to `main`, pull requests, `v*` tags, and manual dispatch. Only a push of a `v*` tag builds Apple Silicon DMG/ZIP packages on macOS and Windows x64 MSI/NSIS EXE packages on Windows; PRs, branch pushes, and manual dispatch skip installer packaging. After a successful tag build, download `Grimoire-macOS-arm64` or `Grimoire-Windows-x64` from **Artifacts**. Installers are unsigned; no signing credentials are included in the repository.

Stable version tags such as `v0.1.2` automatically publish verified installers, update payloads, manifests, blockmaps, and `SHA256SUMS.txt` to [GitHub Releases](https://github.com/neilweixing/grimoire/releases). The tag must match the version in `apps/grimoire-desktop/package.json`. To retry publication from an existing successful tag build without rebuilding or downloading installers locally, run [Publish release](https://github.com/neilweixing/grimoire/actions/workflows/release.yml) with the tag and the **Desktop installers** tag-build run ID. The workflow verifies that the tag points to the exact build commit. GitHub Actions transfers the artifacts and creates the release using its built-in `GITHUB_TOKEN`; no personal token is stored in the repository.

Use the repository's `grimoire-release` Skill to publish the current configured version (`$grimoire-release` in Codex, or `/skill:grimoire-release` in Grimoire with this repository selected). It compares the previous reachable stable tag with the release commit on main, summarizes the actual changes into English release notes, creates and pushes the version tag, monitors installer publication, and applies the generated notes after the workflow finishes. Release names are the tag itself, such as `v0.1.2`. No version-specific release-note file needs to be maintained. Publishing requires an explicit release request; creating or explaining the Skill does not publish anything.

The workflow verifies types, tests and builds before packaging. Each platform stages its own dependencies, generates native icons from the SVG logo, and runs the packaged app against isolated test data. The Windows job additionally installs the MSI before testing the installed executable. Local data, provider credentials, projects and chat history are excluded from both installers.

On Windows x64:

```powershell
pnpm install --frozen-lockfile
pnpm desktop:msi
```

Windows uses Pi's native PowerShell tool. The current sandbox runtime supports macOS/Linux, so Windows read-only and workspace modes keep shell execution disabled; explicitly confirmed full access runs PowerShell with the current user's permissions. File tools, providers, MCP, Skills, plugins and the embedded browser remain available. The desktop runtime includes its own Node.js; separately configured MCP servers can still require executables such as Node.js or Python.

## Desktop updates

The app uses `electron-updater` with the public GitHub Releases feed. It checks once after startup and every six hours without downloading or installing anything. A compact terracotta **Update** button appears beside **Settings** only when an update is available. Hover or focus shows the release description. Clicking the button downloads the update and shows progress; the completed download opens a confirmation dialog. Choosing **Later** keeps the app running and defers installation to the next normal quit, so the next launch uses the updated version. **Quit and update** stops running tasks and installs immediately.

In-app installation is enabled for signed macOS apps and Windows NSIS EXE installations. Unsigned macOS apps and MSI installations can check and download updates but require opening the downloaded installer manually. macOS uses a ZIP update payload; Windows uses the NSIS EXE. The current version is displayed at the bottom of General settings. Web and development builds do not install desktop updates.

The build workflow validates the update manifests, payload sizes, and SHA-512 checksums before publishing. Installer metadata and personal tokens are not supplied by the renderer. Update IPC accepts requests only from the main app frame; embedded websites cannot invoke it. Browser certificate preferences do not weaken update HTTPS verification.

Optional signing secrets for GitHub Actions are `MAC_CSC_LINK` / `MAC_CSC_KEY_PASSWORD` and `WINDOWS_CSC_LINK` / `WINDOWS_CSC_KEY_PASSWORD`. macOS notarization can additionally use `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID`. Without signing credentials, macOS remains in manual-install mode. Existing installations without the update feature must install this version manually first.

## macOS desktop (Apple Silicon)

Build the local, unsigned DMG on an Apple Silicon Mac:

```bash
pnpm install
pnpm desktop:dmg
```

The installer is `release/Grimoire-0.1.2-arm64.dmg`. Open it and drag Grimoire into Applications. This local build is not signed with an Apple Developer ID or notarized. macOS may require opening it through the Finder context menu or allowing it in System Settings → Privacy & Security.

For desktop development, run `pnpm desktop:dev`. This starts Vite, builds the Pi service with TypeScript source maps, and launches Electron with debugger endpoints. No DMG or staging build is required. Only Apple Silicon Macs are currently supported.

| Changed files                             | Development behavior                                                       |
| ----------------------------------------- | -------------------------------------------------------------------------- |
| React components and CSS                  | Vite hot updates the renderer                                              |
| Agent sources and `grimoire-core` sources | Rebuilds Pi, gracefully stops the previous service, and reloads the window |
| Electron main process and preload         | Restarts Electron and its Pi service                                       |

A failed Pi compilation keeps the last working service running. Syntax errors in the Electron main process or preload also keep the previous window running. Fixing the source retries the build. Successful service restarts stop active runs; persisted projects and chats remain available. The development profile is `.data/desktop-dev/profile`, separate from both web development data and the installed desktop app. Configure providers and projects in this profile as needed; credentials are not copied automatically.

Vite starts on `http://127.0.0.1:5180` and selects the next port if occupied. The Agent uses an available loopback port, with Vite proxying `/api` to it. Actual addresses are printed at startup. Pi output is shown in the terminal and saved to the development profile's `logs/desktop.log`. `dev-state.json` records the current process IDs and URLs. Press Ctrl+C, or quit the Electron app, to stop the whole development stack.

| Debug target       | Default port | VS Code configuration    |
| ------------------ | ------------ | ------------------------ |
| Electron main      | 9229         | Grimoire: Electron main  |
| Pi utility process | 9230         | Grimoire: Pi service     |
| React renderer     | 9222         | Grimoire: React renderer |

In VS Code, open the repository root and select **Grimoire: Desktop (all processes)**, then press F5. Its background task starts `desktop:dev` before attaching all three debuggers. If the stack is already running from a terminal, attach the individual configurations instead. All debugger attachments retry after process restarts. Use the renderer's DevTools (`Cmd+Option+I`) for CSS, console, and network inspection. Detaching the debugger leaves development services running; stop the terminal task or quit the app to shut them down.

Debugger endpoints bind to loopback. Startup fails clearly if a debugger port is occupied. Override them with `GRIMOIRE_MAIN_INSPECT_PORT`, `GRIMOIRE_AGENT_INSPECT_PORT`, and `GRIMOIRE_RENDERER_INSPECT_PORT`; update the VS Code attach ports to match any overrides. `GRIMOIRE_DESKTOP_USER_DATA` optionally selects another development profile.

To test the production startup path without a DMG, run `pnpm desktop:build` followed by `pnpm desktop:start`. This stages the compiled UI and a self-contained production Agent dependency tree, then launches them without Vite or development inspectors. Installed apps do not need a separately installed Node.js.

Electron launches the Pi service in a utility process, serves the UI and API from one random loopback port, and stops the service on exit. The renderer has Node.js disabled and context isolation enabled. Folder selection uses Electron's native macOS dialog.

The desktop window uses an integrated title bar: content fills the window, native traffic-light controls remain available, and the app header is draggable. Interactive controls are excluded from drag regions. Browser layouts are unchanged.

General settings use `<desktop data>/config/preferences.json` (`~/.grimoire/config/preferences.json` in installed builds, or `%USERPROFILE%\.grimoire\config\preferences.json` on Windows). Language, appearance, and browser certificate trust are saved through the backend and survive restarts; browser local storage is not their source of truth. **Settings → General → Appearance** offers the existing Light appearance and a [One Dark-inspired](https://github.com/atom/one-dark-syntax) Dark appearance. Desktop preferences are injected before the UI renders. Existing `browser-settings.json` certificate choices migrate without deleting the original file. Development and test profiles keep isolated files.

Desktop settings, sessions, and logs live in `~/.grimoire/` on macOS and `%USERPROFILE%\.grimoire\` on Windows (for example, `C:\Users\Alice\.grimoire`). Both platforms use the same layout: `config/providers.json`, `config/preferences.json`, `pi/workspaces.json`, and `pi/workspaces/<id>/agent/sessions/`. On first launch with no existing profile in the new location, provider settings, Pi state (including sessions and attachments), and browser certificate preferences are copied from the previous Electron data directory; the source is retained. An existing new profile is never overwritten or merged with the old profile. The previous flat profile is reorganized on startup: settings move into `config/`, Chromium storage and caches into `desktop/`, logs into `logs/`, and local update results into `updates/`. Pi sessions retain their existing `pi/` paths. A running older app blocks migration; quit it first. Migration resumes after interruptions and retains conflicts under `migrations/` without merging browser databases. Unknown files are left in place. Development and smoke-test profile overrides remain isolated. No project is created on first launch. Existing web development data is not copied automatically. Add your provider and local project folders in the desktop app. The DMG excludes repository `.env`, `.data`, provider credentials, and local projects. Native sandbox execution remains enabled; the desktop app offers full access with explicit per-chat acknowledgement. Web mode still requires server opt-in. Startup diagnostics are written to `logs/desktop.log` in the desktop data directory. The window close button minimizes the app and keeps running tasks alive. Use **Settings → General → Quit Grimoire** to exit, including on Windows without a menu bar. This uses normal application shutdown, stopping Pi and retaining deferred update installation; macOS also retains its native Quit action. Copy actions use a main-frame-only, write-only desktop clipboard bridge; renderer clipboard reads and embedded-page clipboard permissions stay disabled.

To verify a packaged app with isolated test data:

```bash
GRIMOIRE_DESKTOP_USER_DATA=/tmp/grimoire-desktop-smoke \
GRIMOIRE_DESKTOP_SMOKE_REPORT=/tmp/grimoire-desktop-smoke.json \
release/mac-arm64/Grimoire.app/Contents/MacOS/Grimoire
```

The smoke test checks rendered UI, local API, a native Pi demo reply, persisted chats, and a real sandbox command, then exits. Run it again with the same data directory to check session recovery. The report contains test transcripts, so use a fresh directory rather than real provider data.

The provider list starts empty. Add and activate a provider in **Settings → Providers** before sending messages. The scripted demo remains available internally for automated smoke tests; it is not a default provider option in the UI. Then select the model and thinking depth in the composer. The composer uses one popup with Model and Reasoning effort entries. Model opens a list grouped by provider, containing only configured models, without a search field. Reasoning effort opens the selected model's supported levels in the same popup. There is no Back button. Selecting an option, clicking outside, or pressing Escape closes the popup; reopening starts at the main page. A model must support tool calling to edit files or execute commands.

**Provider** uses Pi's bundled API-key provider catalog, including OpenAI, Anthropic, Google, DeepSeek, OpenRouter, Kimi For Coding, Z.AI Coding CN, and Qwen Token Plan variants. Selecting a model loads its known input modalities, context window, maximum output, and supported reasoning levels. OAuth-only providers such as OpenAI Codex subscription login are not yet exposed in this form.

Each connection contains a configured model list and a default model. Add multiple model IDs, select a row to edit that model's capabilities, and optionally choose a different default. The composer offers only configured models, and its thinking-depth menu offers only the selected model's supported levels. Switching models uses Pi's native thinking-level adjustment. Removing the active default selection falls back to the connection's default model for new chats; existing chats retain their selection until changed.

**Custom** supports OpenAI Responses, OpenAI Chat Completions, and Anthropic Messages endpoints. Use the API root, not a full `/chat/completions` URL. **Fetch models** queries the endpoint's model list and reads explicit capability metadata when supplied. Endpoints returning only IDs leave unknown capabilities unset; they are not inferred from model names. **Test reasoning levels** sends real short requests through Pi after confirmation. It tests Pi's known candidate levels regardless of the current manual subset; unknown models test Pi's seven named levels. It sends no chat history, files, or tools, disables retries, and limits requests to 15 seconds each and one minute total. The test distinguishes acceptance, parameter rejection, and inconclusive failures internally; settings show only the updated checkboxes, without a result list. Token-budget adapters use bounded test budgets and cannot prove distinct named effort levels. A successful request does not prove an endpoint honored the parameter. Accepted levels are checked in the draft automatically after the test; **Save provider** persists them. Inconclusive levels retain their previous selection. If no level is accepted, the existing selection is preserved. Pi's known defaults apply automatically; manual per-model values take priority. Testing does not add models to the configured list. Max is available when supported by Pi or explicitly configured; the maintained react-pi compatibility patch includes its type. Custom model IDs can be added without discovery. Local compatible services may omit an API key.

Capability fields support per-model overrides and **Use automatic values**. Existing idle chats refresh their model configuration before the next submitted run, retaining history and the current thinking depth when supported; Pi clamps unsupported levels. Active runs and their queued follow-ups finish with the current model configuration. These values configure the actual Pi model and context metrics, rather than only the settings display. Reasoning-effort labels are localized; values stay English. Declaring image input does not by itself add an attachment-upload interface.

Keys remain on the server; public settings expose only `hasApiKey`. Leaving an edited key blank preserves it only while the connection type, provider, and endpoint remain unchanged. Discovery never forwards a stored key to a changed endpoint implicitly. Deleting a provider removes its stored key.

## Workspaces and sessions

Each workspace is bound to one existing local folder on the Agent server. The sidebar follows New chat / Projects / Recent. Use the Projects add button to name a project. Click Browse to choose an existing folder on the Agent host, or enter its absolute path. Browse opens the host system's native folder dialog (macOS, Windows, or Linux with Zenity/KDialog). Selecting a folder fills the path; cancelling keeps the previous value. A desktop session is required, and manual entry remains available on headless hosts. Projects expand as folders, with their chats displayed as indented file entries. Select a chat to open its owning project automatically. Recent provides shortcuts across projects. Registering the same canonical folder returns the existing workspace.

- New chats belong to the selected workspace. Switching workspaces changes both the chat list and execution directory.
- Chat names are generated from the initial query using the selected model, without blocking the reply. The placeholder New chat remains until the model produces a summary; failed requests can retry on a later message. Raw query prefixes are not used as final titles. Titles are metadata; their model usage is separate from conversation-run metrics.
- A chat's folder binding does not change. The backend rejects cross-workspace session requests and arbitrary per-request working directories.
- Each workspace has a separate session directory, permission store, metrics, audit log, and executor. Provider and integration settings are shared.
- Sessions, model selection, and thinking depth are stored on the server. Provider activation sets the default for new chats; existing chats retain their selection.
- Refreshing or switching chats does not cancel an active task. Reopening a chat loads the current snapshot and reconnects to native Pi events, including pending approvals. Use **Stop** to cancel.
- First launch has no projects. Add an existing local folder through Projects. `GRIMOIRE_WORKSPACE` can explicitly seed one folder when starting the standalone service. Existing registrations are preserved across restarts.
- Project rows keep their name and actions on one line; long names use an ellipsis. Each project offers New chat, Rename, Copy folder path, and Delete.
- Project and chat deletion use matching confirmation dialogs. Deleting a project cancels its active tasks and removes all of its chats, metrics, approvals, and private session state. Local source files and other projects are preserved. Deleting the last project opens the project setup screen.
- Missing or moved registered folders produce an error rather than silently being recreated or rebound.
- Old browser histories are imported idempotently into the default workspace. Original browser data remains intact; other workspaces do not receive those imports.

Workspace separation is an application boundary for one local user, not multi-user account isolation. Explicitly acknowledged full access allows tools to leave their workspace.

## File attachments and Skill selection

Type `/skill` at the beginning of the composer to search enabled Skills with assistant-ui's native `TriggerPopover` primitives. Continue with `/skill:name` or `/skill name` to filter; Arrow keys navigate, Enter/Tab complete, and Escape dismisses. Selection inserts the native `/skill:name` text, preserves any following task text, and never sends the draft. Recognized enabled Skill commands have a warm text highlight; clipboard contents, IME composition, and the text sent to Pi remain native.

Composer controls respond to the chat pane width, including when the browser drawer is resized. Metrics collapse to three icons below 640px and permission labels collapse below 520px; hover or keyboard focus shows full values. Labels return automatically as the pane widens. Drawer resizing leaves a preferred 360px chat pane.

The composer’s plus menu contains **Add local files** and **Use Skill**. Skills open in a searchable side submenu. Shared Radix menus close on outside clicks or focus changes, support keyboard navigation, and keep popups within the viewport. It reuses assistant-ui’s `AddAttachment`, `Attachments`, `AttachmentPrimitive.Name`, and `AttachmentPrimitive.Remove` components. File selection stays in the draft and does not upload or call the model. **Send** stages files in application storage outside the project, then includes references that Pi’s native tools can read. Files are limited to 8 MiB each; the model/tool’s format capabilities still apply. Sent messages show file names rather than internal storage paths, and copying user text omits attachment metadata.

The Skill picker lists enabled project and global Skills through Pi’s native loader, including `.agents/skills` in the project. Choosing a Skill inserts its `/skill:name` command into the draft without executing it. Disabled Skills are omitted. Project Skills take precedence over same-named global Skills, with the same resolution in the picker and native Pi commands. Existing idle sessions refresh through native Pi reload before the next submitted message when discovered Skills change; running sessions and their queues remain intact.

## Permissions and approvals

The composer offers three modes, enforced independently by the Agent service. Device files, sockets, and named pipes are rejected by file tools in every mode, including full access; ordinary external file reads remain available:

| Mode                       | Files                                                                 | Commands                                                                                 | Approval                                                                        |
| -------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Read only                  | Read local files; no edits                                            | OS sandbox permits read-only commands; project writes and command networking are blocked | Mutating operations cannot execute                                              |
| Ask for approval (default) | Project changes run directly; project-external edits require approval | Sandboxed project commands run directly                                                  | Command networking, additional write paths, and external tools require approval |
| Full access                | Files accessible to the server account                                | Unsandboxed host process with network access                                             | Server availability and per-chat acknowledgement; no per-tool prompts           |

The desktop app exposes full access, with per-chat acknowledgement before activation. In web mode it is disabled by default; set `GRIMOIRE_ALLOW_FULL_ACCESS=true` to expose it. It grants the service account's permissions, not root privileges. After a service restart, full-access chats return to Ask for approval mode and require acknowledgement again. Read-only selections persist.

Shell tools declare `networkDomains` for requested network destinations and `writePaths` for additional filesystem write targets. An approval grants those destinations/paths to that command only; it does not widen another chat's sandbox. Commands that try undeclared access remain blocked and are not automatically rerun. Read-only mode is enforced by the filesystem sandbox rather than a command-name allowlist. Built-in browser tools retain the separately requested no-approval behavior.

Approvals show the exact tool arguments and workspace. They apply to one tool call, expire after five minutes, and cannot be reused or applied to another chat. Missing UI, denial, expiry, and cancellation fail closed. Writes are rejected if the target file changes while approval is pending. Mode/model changes are blocked during a run.

The base allowlist is `read`, `ls`, `write`, `edit`, `bash`, and the fictional `inspect_dataset` demo. Desktop sessions additionally register `browser_navigate`, `browser_snapshot`, `browser_click`, and `browser_type`. Unregistered tools are denied. Native MCP and Skills are enabled through application settings, and explicitly installed Pi packages can contribute tools and Skills. Repository-provided extensions, prompt templates, themes, and context files are not automatically enabled. The application-owned inline extension handles language, metrics, and run limits.

Audit records contain timestamps, chat/tool-call IDs, tool names, argument hashes, and outcomes. Raw commands and source code are omitted. Session transcripts do contain prompts, code, and tool results; protect the data directory accordingly.

## MCP, Skills, and plugins

**Settings → MCP** accepts named stdio or streamable HTTP server configurations. For example:

```json
{
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/project"],
  "exposure": "direct"
}
```

For HTTP, use `url` and optional `headers` instead of `command` and `args`. Pi's native `createMcpExtension`, `createCodemodeExtension`, and `createToolSearchExtension` handle transport, resource discovery, and direct/deferred/codemode exposure. Server connection errors appear in the MCP settings. Connections start with a live chat. Remote OAuth uses Pi's native `/mcp login <server>` flow. Native input, select, editor, and confirmation requests are rendered above the composer.

**Settings → Skills** lists discovered Skills, supports additional directories and enable/disable controls, and reloads resources. Global Skills under `$HOME/.agents` (including the conventional `$HOME/.agents/skills` layout) load by default for every project. Each Skill has its own enable/disable control, shared across projects and preserved across restarts. There is no global loading switch. The managed `integrations/skills` directory, project Skill directories, and installed Pi package Skills are also scanned; explicit project/custom entries take precedence over same-named global Skills. Previously configured additional Skill paths remain supported in integration configuration. The settings UI focuses on the discovered list and per-Skill toggles. Native Pi parsing, descriptions, and `/skill:name task` expansion are used. Explicit invocation is shown compactly in the chat; the expanded instructions can be opened. Enabled Skill files and references are readable without permitting edits to protected configuration directories.

MCP, Skill, and plugin settings are application-wide, independent of a selected project. They live under `.data/pi/integrations` in web development or `<desktop data>/pi/integrations` on desktop. Configurations and package files are excluded from installers. MCP settings are stored with owner-only permissions. Headers, environment values, and credentials are plaintext local configuration, not a secret vault.

The sidebar **Plugins** page opens in the main content area. It starts on **Installed**, with no automatic discovery request. **Discover** uses a compact search toolbar with an inset focus border and a responsive grid of package cards showing names, versions, and install actions. It searches npm's `pi-package` catalog, the same discovery marker used by [Pi's official catalog](https://pi.dev/packages). Opening **Installed** invokes Pi's native `checkForAvailableUpdates()` without downloading or installing code. Results are cached for five minutes; Refresh forces a new check. Update is an explicit per-package action using Pi's native `update(source)`, preserves resource filters and disabled state, and is blocked while project tasks are running. Discovery installs use unpinned `npm:package` sources so Pi can track updates. Explicit exact versions remain pinned, version ranges and tags follow Pi's semantics, and `PI_OFFLINE` disables update checks and downloads. Use **Add plugin** for a specific `npm:package@version`. Installs, removal, and resource filtering use `DefaultPackageManager`; installed package versions are retained in native Pi settings. Installing or enabling explicitly trusts local package code. Tool and Skill packages work in the web/Electron host, while terminal-only custom UI and themes require adaptation.

MCP/plugin tools pass through Pi's native `tool_call` pipeline, including nested codemode calls. Read-only annotations allow direct execution; destructive or unannotated calls follow read-only/workspace/full policy. Browser tools keep their explicit no-approval behavior. MCP server processes and installed extension code run with host-process permissions and are not contained by the shell sandbox. Calls are audited with argument hashes rather than plaintext inputs. File and shell tools retain their executor checks.

Saving or reloading updates idle sessions through native `AgentSession.reload()` without replacing the chat or SSE connection. Running chats defer reload until their next submitted message. Plugin changes require running tasks to stop first. The pnpm patch for `@assistant-ui/react-pi@0.0.35` exposes `reloadThread()` and an `onNotification` callback, preserving the native supervisor and its sequence counters; it does not replace the Pi execution loop.

## Lightweight native executor

Sandbox Runtime uses macOS Seatbelt or Linux bubblewrap. On Linux, install its prerequisites:

```bash
sudo apt-get install bubblewrap socat ripgrep
```

macOS uses built-in `sandbox-exec`. Windows command isolation is not implemented by this executor. When platform dependencies are unavailable, commands are refused without falling back to host execution. Full access is a separate, explicit mode.

Workspace mode blocks home-directory reads outside allowed runtime/project paths, restricts writes to the project folder and its isolated shell runtime directory, and denies network access. System programs and selected runtime installation directories remain readable. Protected paths include `.git`, `.data`, `.env*`, `.ssh`, `.aws`, `.codex`, `.agents`, `.pi`, `.npmrc`, `.netrc`, `credentials.json`, and private key files. File tools also reject traversal, symlinks, hardlinks, and special files. Native command policies deny protected paths as well.

Commands receive a minimal environment without provider keys or service credentials. Limits are 60 seconds by default, 120 seconds maximum, and 32 KB captured output. Cancellation terminates the command process group. File tools limit reads to 8 MiB and writes to 1 MiB. Runs are limited to 20 model turns and ten minutes, including approval waits.

Shell commands run with the project as their working directory and an application-managed `HOME`, cache, and temporary directory outside the project. Windows also uses isolated `USERPROFILE`, `APPDATA`, and `LOCALAPPDATA` paths. This applies to workspace and Full access modes. Runtime state lives beside the project's session data; when development data is inside the project, the executor uses an external temporary runtime directory instead. Existing project folders named `Library` are not removed automatically.

`SandboxExecutor` in `apps/grimoire-agent/src/sandbox.ts` owns filesystem and command operations. Pass an alternative executor through `PiServiceOptions.executor` to delegate to a remote sandbox or micro-VM with the same policy/approval flow. The SDK's unrestricted file/command operations are replaced with guarded implementations.

This is a lightweight local process sandbox, not a VM or hostile multi-tenant service. Workspace mode blocks dependency downloads and other network requests; preinstall dependencies or explicitly choose the appropriate execution environment.

## Built-in browser and Agent tools

Use the upper-right browser button to open the URL drawer. Enter an HTTP/HTTPS address; local addresses such as `localhost:5173` are supported. The desktop app uses an isolated `WebContentsView`, with back, forward, reload, and a blank-page action. It does not expose Node.js or the desktop bridge to websites. Links requesting a new window stay in the same browser view. The web version uses a sandboxed iframe and may be limited by website embedding policies.

Drag the drawer's left edge to resize it, or focus the divider and use the arrow keys. Width is remembered locally. On sufficiently wide windows the maximum size reserves 560px for chat; metrics wrap on smaller windows. Opening settings temporarily hides the native webpage so it cannot cover dialogs. New chats show a subtle Grimoire mark and a localized question containing the selected workspace name. The header contains no workspace breadcrumb.

**Settings → General → Ignore browser certificate errors** defaults to off and is saved in the desktop data directory's `config/preferences.json`. It applies only to the built-in browser, allowing self-signed or otherwise untrusted certificates at reduced connection security. Switching recreates the page in a separate browser network partition and resets its navigation history, so turning verification back on cannot reuse certificate exceptions. Provider/Pi requests retain normal TLS verification. Browser settings and browser storage are excluded from the installer with other local data.

Desktop Pi sessions offer four browser tools:

| Tool               | Behavior                                                                             |
| ------------------ | ------------------------------------------------------------------------------------ |
| `browser_navigate` | Opens an HTTP/HTTPS page and reveals the drawer                                      |
| `browser_snapshot` | Reads visible main-page text and interactive references; content is marked untrusted |
| `browser_click`    | Clicks a reference from the latest snapshot using a native input event               |
| `browser_type`     | Replaces a referenced text field without submitting its form                         |

Each project/chat has its own browser page, navigation state, storage partition, and serialized tool queue. Switching chats changes the drawer view without cancelling background browser work. Requests are routed to their owning session; snapshots and element references cannot be reused across sessions. Background actions use the target page’s DevTools input channel without focusing another session’s page. All four browser tools run without approval in every permission mode, including read-only mode. File and command permissions remain governed by the selected mode. Audit records contain hashes, not entered text.

Every interaction validates the page URL, snapshot ID, element identity, and current label before execution. Actions invalidate references, requiring a fresh snapshot. Agents can fill password fields, while password values remain omitted from snapshots and input text is excluded from audit records. Credentials supplied in chat or tool arguments are still sent to the selected model and stored with chat transcripts. Tools cannot execute arbitrary scripts, open host files, change certificate preferences, or access other browsers. Snapshot contents are untrusted page data, may be sent to the selected model, and are stored with chat transcripts. Cross-origin iframe contents and arbitrary desktop automation are not exposed.

## Interface and metrics

- Warm colors, right-aligned user messages, Markdown, code blocks, copy, and stop controls.
- Simplified Chinese and English in **Settings → General**. The thinking-depth label follows the interface language; values stay English: Default, Minimal, Low, Medium, High, Extra high, Max. Unsupported levels are disabled. The current `react-pi` adapter cannot represent Max; it is rejected rather than silently downgraded.
- Model discovery, per-chat reasoning controls, permission modes, and approval cards in the composer.
- Streaming text, optional provider reasoning, and native session recovery. Each assistant run has one collapsed activity summary for tool calls, skill-file reads, reasoning, and intermediate progress. The final answer streams separately through assistant-ui’s smooth, deferred Markdown renderer. The activity automatically closes when answer streaming starts or the run settles; reopening it manually remains stable across token updates. Expand individual calls for terminal-style command/parameter and output panels, with an explicit execution state and bounded scrolling. These panels omit separate Input/Output headings; completed activity summaries omit the leading success icon. Approval cards remain visible outside the collapsed trace, and failures/interrupted runs retain their status.
- User messages show their send time and a source-text copy action. Native user messages retain the pre-expansion input in session metadata, including steering and follow-up messages. Copy uses that original text without injected Skill instructions or attachment metadata. A maintained Pi SDK patch preserves this field when creating messages; the react-pi projection patch exposes it to the copy action. Older sessions without this metadata use a best-effort Skill-command fallback. Assistant copy actions include only the final answer Markdown, excluding collapsed progress and reasoning. Completed assistant answers show their saved Pi message time next to Copy. Multi-turn chats have a right-hand navigation rail with question/answer previews, current-position highlighting, and keyboard-accessible jumps.
- During a run, Enter and the queue action submit native Pi follow-ups, which run after the current work finishes. **Insert now** sends native steering input at the next model/tool boundary. Queued messages appear in a compact area within the composer; Edit retrieves the actual pending queue into the draft through Pi. When multiple messages are pending, the action edits them together, preserving any unsent draft. The composer shows Pi's waiting and steering queues; Stop retains the SDK's queue-clearing behavior.

The status row uses Pi events and explicitly reported provider usage:

| Metric      | Meaning                                                                                   |
| ----------- | ----------------------------------------------------------------------------------------- |
| Turns       | User submissions in the current chat                                                      |
| Steps       | Recorded model calls plus tool execution attempts                                         |
| Output rate | Latest output tokens / model-request time, including waiting and excluding tool execution |
| Tokens      | Cumulative input/output tokens, including repeated context input                          |
| Cache hit   | Cache reads / uncached input plus cache reads and writes                                  |
| Context     | Last input tokens / configured or catalog context window                                  |

Unavailable values show `—`; partial totals carry `≥`. The demo has no real token usage. Metrics are persisted separately from native Pi transcripts. Imported old chats may lack metrics. For custom model IDs, enter a documented context limit in **Settings → Providers → Model capabilities**. Overrides and discovered metadata are scoped to each model; a fallback model's internal limit is never reported as known.

## Modules and transport

```text
apps/grimoire-web/          React, assistant-ui/react-pi, bilingual interface
apps/grimoire-agent/        Hono, native Pi sessions, workspace registry, policies
packages/grimoire-core/     Shared schemas and metric helpers
```

The browser uses `usePiRuntime` and `createPiHttpClient`. `/api/pi` wraps a `PiThreadSupervisor` for the selected workspace. The server owns sessions, tool execution, approvals, and cancellation. SSE carries native Pi snapshots/events. `X-Grimoire-Workspace` identifies a registered workspace; it cannot supply an arbitrary path. The legacy `/api/chat` demo endpoint remains for compatibility and exposes no coding tools.

Code comments and documentation are English. Interface translations live in `apps/grimoire-web/src/i18n.tsx`.

## Configuration and storage

Copy `.env.example` to `.env` if needed. Scripts load it from the repository root.

| Variable                     | Default                 | Purpose                                              |
| ---------------------------- | ----------------------- | ---------------------------------------------------- |
| `PORT`                       | `3001`                  | Loopback API port                                    |
| `GRIMOIRE_AGENT_URL`         | `http://127.0.0.1:3001` | Vite development API proxy target                    |
| `GRIMOIRE_SETTINGS_FILE`     | `.data/providers.json`  | Provider configuration; accepts an absolute override |
| `GRIMOIRE_WORKSPACE`         | Unset                   | Optional initial folder when no registry exists      |
| `GRIMOIRE_ALLOW_FULL_ACCESS` | `false`                 | Allow explicitly acknowledged host execution         |

When changing `PORT`, set `GRIMOIRE_AGENT_URL` to the matching loopback API URL for Vite (for example, `http://127.0.0.1:3002`). The development proxy preserves the browser Host header so origin validation also works with custom web ports. `DATAPI_SETTINGS_FILE` remains a legacy fallback.

Default workspace state lives under `.data/pi`. Additional workspaces use `.data/pi/workspaces/<id>`. Folder registration is stored in `.data/pi/workspaces.json`. These files are ignored by Git. Provider files have owner-only permissions and contain plaintext keys. Chat text and code may be sent to the selected provider.

The application binds to loopback and checks browser origins. It has no user authentication, multi-user authorization, encrypted secret vault, or production deployment. Keep it local until those boundaries are implemented. Request bodies are limited to 2 MiB; native message text is limited to 100,000 characters.

## Commands

```bash
pnpm dev
pnpm typecheck
pnpm test
pnpm build
pnpm check
pnpm format
pnpm format:check
```

After building, `pnpm --filter grimoire-agent start` starts the API. Serve `apps/grimoire-web/dist` behind a server that proxies `/api` to the loopback API. `vite preview` previews static assets only.

### Add an npm plugin

In Plugins, choose **Add plugin**, enter an npm package name, `npm:package@version`, or an `https://www.npmjs.com/package/...` URL, then choose **Search**. Grimoire reads registry metadata without installing or executing package code. **Trust and install** is enabled only after a successful lookup of the current input. Package installation and updates use Pi's native package manager.
