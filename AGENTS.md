# Repository Guidelines

## Project overview

Grimoire is a local coding agent built with the native Pi SDK, React, assistant-ui, and an optional Electron desktop host. Prefer Pi's native session, model, MCP, Skill, and package APIs over a parallel implementation.

## Repository map

- `apps/grimoire-web/src/`: React UI, internationalization, chat controls, settings, and browser drawer.
- `apps/grimoire-agent/src/`: Hono API, Pi sessions, provider configuration, permissions, executors, and workspace persistence.
- `apps/grimoire-desktop/src/`: Electron main/preload, embedded browser, and application updates.
- `packages/grimoire-core/src/`: shared Zod schemas, types, and stream contracts.
- `tests/`: Vitest behavior and integration tests.
- `patches/`: maintained dependency patches referenced by `pnpm-workspace.yaml`.
- `.github/workflows/`: desktop verification, packaging, and release workflows.

## Setup and development

Use Node.js 22.19+ and the pnpm version pinned in `package.json`. Run commands from the repository root.

```bash
pnpm install --frozen-lockfile
pnpm dev
```

`pnpm dev` starts the web UI at `http://127.0.0.1:5173` and the Pi API at `http://127.0.0.1:3001`. For independent ports, run these in separate terminals:

```bash
PORT=3002 pnpm --filter grimoire-agent dev
GRIMOIRE_AGENT_URL=http://127.0.0.1:3002 pnpm --filter grimoire-web dev --port 5174
```

Check occupied ports before starting services. Do not stop another project's service to claim its port. For web-only requests, start only the web UI and Pi API; do not launch Electron. `pnpm desktop:dev` explicitly starts the desktop development stack.

## Coding conventions

- Follow the surrounding TypeScript, React, ESM, and Prettier conventions. Desktop main/preload modules use CommonJS `.cjs` files.
- Keep code comments, documentation, and committed agent instructions in English. User-facing task updates default to Simplified Chinese unless requested otherwise.
- Add interface text to both languages in `apps/grimoire-web/src/i18n.tsx`. Keep reasoning-effort values in English; localize their field labels.
- Define cross-process request/response shapes in `@grimoire/core`; validate untrusted input at the server boundary.
- Keep changes focused. Preserve unrelated working-tree changes, provider configuration, and existing conversation data.
- Update the relevant README section when changing documented setup, configuration, or behavior. Do not edit generated build output.

## Commit message conventions

Use the format `<type>(<scope>): <description>`. The scope is optional; omit the parentheses when no scope is needed.

`pnpm install` installs the `pre-push` validator; run `pnpm hooks:install` for an existing checkout. The hook checks all commits introduced by the pushed refs and blocks invalid messages. Merge and revert commits must follow the same conventions. The **Commit messages** workflow applies the same validator to branch pushes and PR commits. Configure **Commit message format** as a required status check in branch protection to enforce it before merging.

- Use a lowercase type that matches the change:
  - `feat`: add a feature.
  - `fix`: fix a bug.
  - `docs`: change documentation.
  - `refactor`: restructure code without adding features or fixing bugs.
  - `perf`: improve performance.
  - `test`: add or update tests.
  - `style`: adjust code formatting without changing behavior.
  - `build`: change the build system or dependencies.
  - `ci`: change CI/CD configuration.
  - `chore`: perform other maintenance.
  - `revert`: revert an existing commit.
- When included, use the scope to identify the affected module, such as `auth`, `api`, or `ui`.
- Write the description in Chinese. Keep it concise and specific, with no trailing period.
- Put exactly one space after the colon.
- Describe the actual change; avoid vague descriptions such as "更新代码" or "修复问题".
- For breaking changes, add `!` immediately before the colon, as in `<type>(<scope>)!: <description>`, and explain the compatibility impact in the commit body.

Examples:

```text
feat(ui): 新增模型选择器
fix(api): 修复会话恢复失败
refactor(core)!: 统一会话配置结构
```

## UI changes

Read and follow [the Grimoire UI Skill](.agents/skills/grimoire-ui/SKILL.md) when creating or changing components, forms, menus, or dialogs. Extend shared components and existing design tokens before introducing a new visual pattern.

## Runtime and data invariants

- A chat belongs to one registered local folder. Enforce the binding on the backend and preserve independent running sessions.
- Global Skills default to `$HOME/.agents`; enable/disable choices apply to each Skill across the application. Tests must use isolated Skill roots.
- Provider and integration configuration are application-wide. Model capabilities and overrides belong to the selected model; do not guess unknown capabilities from its name.
- Keep provider secrets on the server. Public settings expose key presence only. Never log secrets, commit credentials, or copy developer configuration into installers.
- Enforce file and shell permissions on the backend. Full access requires server availability and explicit per-chat acknowledgement. Cancellation or failed approval must not execute the action.
- Embedded browser state, cookies, and automation targets belong to their owning session. Preserve browser tools' existing no-approval behavior and password handling.
- Keep application data, shell home/cache/temp directories, and session state outside user source folders. Deleting a registered project must not delete its local source folder.
- Preserve Electron context isolation and IPC sender validation. Browser certificate preferences must not weaken updater HTTPS verification.

## Verification

Choose checks proportional to the change. For behavior changes, run focused tests first; before reporting a completed integration, run the applicable checks:

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm format:check
```

`pnpm exec vitest run tests/<file>.test.ts` runs a focused suite. Add tests for meaningful runtime behavior and regressions; do not add tests that merely repeat CSS or static wording. For UI work, also verify keyboard interaction, popup/dialog positioning, long labels, and both languages in the running web app. Use isolated fixtures for tests that mutate configuration or conversation data. Report checks actually run and any unverified platform behavior.

## Packaging and releases

macOS targets Apple Silicon; Windows targets x64. `pnpm desktop:dmg`, `pnpm desktop:msi`, and `pnpm desktop:win` build local installers. Runtime data, secrets, `.env`, `.data`, and user projects must stay excluded. Keep lockfile patches intact. Change versions, publish tags, or create releases only within the requested delivery scope; never publish a release solely to verify a UI change.
