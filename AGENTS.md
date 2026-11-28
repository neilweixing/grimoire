# Repository Guidelines

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
