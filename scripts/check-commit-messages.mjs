import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const git = (args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const headerPattern =
  /^(feat|fix|docs|refactor|perf|test|style|build|ci|chore|revert)(\([^\s():!]+\))?(!)?: ([^\s].*)$/u;

function validate(message) {
  const [subject, ...body] = message.replace(/\n+$/u, "").split("\n");
  const match = headerPattern.exec(subject);
  if (!match) {
    return "Use <type>(<scope>): <description> with a lowercase allowed type and exactly one space after the colon.";
  }
  const description = match[4];
  if (
    description !== description.trim() ||
    !/\p{Script=Han}/u.test(description)
  ) {
    return "Write a Chinese description without leading or trailing whitespace.";
  }
  if (/[.。]$/u.test(description)) {
    return "Do not end the description with a period.";
  }
  if (["更新代码", "修复问题"].includes(description)) {
    return "Describe the specific change instead of using a vague description.";
  }
  if (match[3] && !body.join("\n").trim()) {
    return "Explain the compatibility impact of a breaking change in the commit body.";
  }
  return null;
}

function ciCommits() {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  function ensureCommit(oid) {
    if (typeof oid !== "string" || !/^[a-f0-9]{40,64}$/u.test(oid)) {
      throw new Error("Missing or invalid commit SHA in the GitHub event.");
    }
    if (spawnSync("git", ["cat-file", "-e", `${oid}^{commit}`]).status !== 0) {
      // A force-push may leave the previous tip outside the fetched history.
      git(["fetch", "--no-tags", "origin", oid]);
      git(["cat-file", "-e", `${oid}^{commit}`]);
    }
    return oid;
  }

  if (process.env.GITHUB_EVENT_NAME === "pull_request") {
    const base = ensureCommit(event.pull_request?.base?.sha);
    const head = ensureCommit(event.pull_request?.head?.sha);
    return git(["rev-list", `${base}..${head}`]);
  }
  if (process.env.GITHUB_EVENT_NAME !== "push") {
    throw new Error("CI validation requires a push or pull_request event.");
  }
  if (event.deleted) return "";
  const head = ensureCommit(event.after);
  if (event.before && !/^0+$/u.test(event.before)) {
    return git(["rev-list", `${ensureCommit(event.before)}..${head}`]);
  }
  if (!/^refs\/heads\/.+/u.test(event.ref ?? "")) {
    throw new Error("New-branch validation requires a branch ref.");
  }
  // checkout fetches the just-pushed branch too. Exclude only OTHER branches,
  // otherwise the new commits would already appear to be on the remote.
  const currentRef = `refs/remotes/origin/${event.ref.slice("refs/heads/".length)}`;
  const otherRefs = git([
    "for-each-ref",
    "--format=%(refname)",
    "refs/remotes/origin/",
  ])
    .split("\n")
    .filter(
      (ref) => ref && ref !== currentRef && ref !== "refs/remotes/origin/HEAD",
    );
  return git(["rev-list", head, "--not", ...otherRefs]);
}

function prePushCommits(remote) {
  if (!remote) throw new Error("Missing pre-push remote argument.");
  const commits = new Set();
  for (const line of readFileSync(0, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const fields = line.trim().split(/\s+/u);
    if (fields.length !== 4) throw new Error("Invalid pre-push ref update.");
    const [, localOid, , remoteOid] = fields;
    if (/^0+$/u.test(localOid)) continue; // Deleting a ref introduces no commits.
    // A tag may point to a tree or blob rather than a commit.
    const type = git(["cat-file", "-t", `${localOid}^{}`]);
    if (type !== "commit") continue;
    const range = /^0+$/u.test(remoteOid)
      ? [`${localOid}^{commit}`, "--not", `--remotes=${remote}`]
      : [`${remoteOid}..${localOid}`];
    for (const oid of git(["rev-list", ...range]).split("\n")) {
      if (oid) commits.add(oid);
    }
  }

  return commits;
}

try {
  const ci = process.argv[2] === "--ci";
  const commits = ci
    ? new Set(ciCommits().split("\n").filter(Boolean))
    : prePushCommits(process.argv[2]);
  let invalid = false;
  for (const oid of commits) {
    const message = execFileSync("git", ["show", "-s", "--format=%B", oid], {
      encoding: "utf8",
    });
    const error = validate(message);
    if (!error) continue;
    invalid = true;
    console.error(
      `\n${oid.slice(0, 12)} ${message.split("\n")[0]}\n  ${error}`,
    );
  }
  if (invalid) {
    console.error(
      `\n${ci ? "Commit message check failed." : "Push blocked."} Correct the messages with git commit --amend or git rebase -i, then push again. See AGENTS.md for the commit message conventions.`,
    );
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`Commit message validation failed: ${error.message}`);
  process.exitCode = 1;
}
