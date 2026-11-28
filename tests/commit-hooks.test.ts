import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it } from "vitest";

const source = fileURLToPath(new URL("..", import.meta.url));
let root: string;
let repo: string;
let env: NodeJS.ProcessEnv;

function git(...args: string[]) {
  return execFileSync("git", args, { cwd: repo, env, encoding: "utf8" }).trim();
}

function commit(message: string) {
  git("commit", "--allow-empty", "--cleanup=verbatim", "-m", message);
  return git("rev-parse", "HEAD");
}

function push(...refs: string[]) {
  return spawnSync("git", ["push", "origin", ...refs], {
    cwd: repo,
    env,
    encoding: "utf8",
  });
}

function checkCi(eventName: string, event: object) {
  const eventPath = join(root, "event.json");
  writeFileSync(eventPath, JSON.stringify(event));
  return spawnSync(
    process.execPath,
    ["scripts/check-commit-messages.mjs", "--ci"],
    {
      cwd: repo,
      env: {
        ...env,
        GITHUB_EVENT_NAME: eventName,
        GITHUB_EVENT_PATH: eventPath,
      },
      encoding: "utf8",
    },
  );
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "grimoire-commit-hooks-"));
  repo = join(root, "repo");
  mkdirSync(repo);
  env = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: join(root, "gitconfig"),
    GIT_TERMINAL_PROMPT: "0",
  };
  git("init", "-b", "main");
  git("config", "user.name", "Hook Test");
  git("config", "user.email", "hook-test@example.invalid");
  git("config", "commit.gpgsign", "false");
  git("config", "tag.gpgsign", "false");
  git("config", "advice.defaultBranchName", "false");
  git("init", "--bare", join(root, "remote.git"));
  git("remote", "add", "origin", join(root, "remote.git"));
  commit("Historical message before hooks were introduced");
  expect(push("main").status).toBe(0);
  for (const directory of [".githooks", "scripts"]) {
    cpSync(join(source, directory), join(repo, directory), { recursive: true });
  }
  execFileSync(process.execPath, ["scripts/install-git-hooks.mjs"], {
    cwd: repo,
    env,
  });
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

it.each([
  "feat(ui): 新增模型选择器",
  "fix: 修复会话恢复失败",
  "refactor(core)!: 统一会话配置结构\n\n旧配置必须迁移至新的 sessions 字段",
  "build(deps): 升级 React 依赖",
  "revert: 撤销模型选择器变更",
])("allows a push with a valid message: %s", (message) => {
  const oid = commit(message);
  expect(push("main").status).toBe(0);
  expect(git("rev-parse", "refs/remotes/origin/main")).toBe(oid);
});

it.each([
  "Feat(ui): 新增模型选择器",
  "unknown: 新增模型选择器",
  "feat(): 新增模型选择器",
  "feat(ui):新增模型选择器",
  "feat(ui):  新增模型选择器",
  "feat(ui): Add a model picker",
  "feat(ui): 新增模型选择器。",
  "feat(ui): 新增模型选择器.",
  "feat(ui): 新增模型选择器 ",
  "chore: 更新代码",
  "fix: 修复问题",
  "refactor(core)!: 统一会话配置结构",
])("blocks a push with an invalid message: %s", (message) => {
  const previous = git("rev-parse", "refs/remotes/origin/main");
  const oid = commit(message);
  const result = push("main");
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain(oid.slice(0, 12));
  expect(result.stderr).toContain("Push blocked");
  expect(git("rev-parse", "refs/remotes/origin/main")).toBe(previous);
});

it("checks earlier unpushed commits as well as HEAD", () => {
  const invalid = commit("invalid earlier message");
  commit("fix(api): 修复会话恢复失败");
  const result = push("main");
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain(invalid.slice(0, 12));
});

it("excludes existing remote history when pushing a new branch", () => {
  git("checkout", "-b", "feature");
  commit("feat(ui): 新增模型选择器");
  expect(push("feature").status).toBe(0);
});

it("blocks an invalid commit on a new branch", () => {
  git("checkout", "-b", "feature");
  commit("invalid new branch message");
  expect(push("feature").status).not.toBe(0);
});

it("blocks a multi-ref push if any ref contains an invalid commit", () => {
  git("checkout", "-b", "feature");
  commit("invalid feature message");
  git("checkout", "main");
  commit("fix(api): 修复会话恢复失败");
  expect(push("main", "feature").status).not.toBe(0);
});

it("checks commits introduced by a forced update", () => {
  commit("fix(api): 修复会话恢复失败");
  expect(push("main").status).toBe(0);
  git("reset", "--hard", "HEAD~1");
  commit("invalid replacement message");
  expect(push("--force", "main").status).not.toBe(0);
});

it("allows deleting a remote ref", () => {
  expect(push("main:obsolete").status).toBe(0);
  expect(push(":obsolete").status).toBe(0);
});

it("checks commits behind annotated tags", () => {
  commit("invalid tagged message");
  git("tag", "-a", "fixture-tag", "-m", "Test tag");
  expect(push("fixture-tag").status).not.toBe(0);
});

it("checks the complete history when pushing to an empty remote", () => {
  git("init", "--bare", join(root, "empty.git"));
  git("remote", "set-url", "origin", join(root, "empty.git"));
  git("update-ref", "-d", "refs/remotes/origin/main");
  const result = push("main");
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("Historical message");
});

it("refuses to overwrite an existing hook configuration", () => {
  git("config", "core.hooksPath", "custom-hooks");
  const result = spawnSync(
    process.execPath,
    ["scripts/install-git-hooks.mjs"],
    {
      cwd: repo,
      env,
      encoding: "utf8",
    },
  );
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("Refusing to replace");
  expect(git("config", "core.hooksPath")).toBe("custom-hooks");
});

it("passes CI for valid commits without rechecking older remote history", () => {
  const before = git("rev-parse", "HEAD");
  const after = commit("ci: 校验提交信息格式");
  expect(
    checkCi("push", { before, after, ref: "refs/heads/main" }).status,
  ).toBe(0);
});

it("fails CI even if the local pre-push hook was bypassed", () => {
  const before = git("rev-parse", "HEAD");
  const after = commit("invalid message bypassing the hook");
  git("-c", "core.hooksPath=", "push", "origin", "main");
  const result = checkCi("push", { before, after, ref: "refs/heads/main" });
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain(after.slice(0, 12));
});

it("checks the full push range, even when HEAD has a valid message", () => {
  const before = git("rev-parse", "HEAD");
  const invalid = commit("invalid earlier message");
  const after = commit("ci: 校验提交信息格式");
  const result = checkCi("push", { before, after, ref: "refs/heads/main" });
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain(invalid.slice(0, 12));
});

it.each(["feat: 新增设置页面", "invalid new branch message"])(
  "checks new-branch commits even after checkout fetched that branch: %s",
  (message) => {
    git("checkout", "-b", "feature/nested");
    const after = commit(message);
    git("-c", "core.hooksPath=", "push", "origin", "feature/nested");
    git(
      "symbolic-ref",
      "refs/remotes/origin/HEAD",
      "refs/remotes/origin/feature/nested",
    );
    const result = checkCi("push", {
      before: "0".repeat(40),
      after,
      ref: "refs/heads/feature/nested",
    });
    expect(result.status === 0).toBe(message.startsWith("feat:"));
    expect(result.stderr).not.toContain("Historical message");
  },
);

it("validates PR commits without checking the synthetic merge commit", () => {
  const base = git("rev-parse", "HEAD");
  git("checkout", "-b", "feature");
  const head = commit("feat: 新增设置页面");
  git("checkout", "main");
  commit("Unrelated target branch message");
  git("merge", "--no-ff", "feature", "-m", "Merge pull request #1");
  expect(
    checkCi("pull_request", {
      pull_request: { base: { sha: base }, head: { sha: head } },
    }).status,
  ).toBe(0);
});

it("rejects invalid PR commits even if the checkout merge message is valid", () => {
  const base = git("rev-parse", "HEAD");
  const head = commit("invalid PR message");
  commit("ci: 校验提交信息格式");
  const result = checkCi("pull_request", {
    pull_request: { base: { sha: base }, head: { sha: head } },
  });
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain(head.slice(0, 12));
});

it("checks replacement commits in a force-push event", () => {
  const before = commit("ci: 校验提交信息格式");
  git("reset", "--hard", "HEAD~1");
  const after = commit("invalid force-push message");
  expect(checkCi("push", { before, after }).status).not.toBe(0);
});

it("fetches the previous tip if a force-push left it outside local history", () => {
  const before = commit("ci: 校验提交信息格式");
  expect(push("main:previous").status).toBe(0);
  git("checkout", "-b", "replacement", "HEAD~1");
  const after = commit("ci: 增加服务端校验");
  git("update-ref", "-d", "refs/heads/main");
  git("update-ref", "-d", "refs/remotes/origin/previous");
  git("reflog", "expire", "--expire=now", "--all");
  git("gc", "--prune=now");
  expect(
    spawnSync("git", ["cat-file", "-e", before], { cwd: repo, env }).status,
  ).not.toBe(0);
  expect(checkCi("push", { before, after }).status).toBe(0);
});

it("skips deleted branches in CI", () => {
  expect(checkCi("push", { deleted: true, after: "0".repeat(40) }).status).toBe(
    0,
  );
});

it("fails closed for an incomplete CI event", () => {
  expect(checkCi("pull_request", {}).status).not.toBe(0);
});
