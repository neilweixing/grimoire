// This file is copied outside the application before quit. Use Node built-ins only.
const fs = require("node:fs/promises");
const { createReadStream } = require("node:fs");
const { createHash, randomUUID } = require("node:crypto");
const { join, dirname } = require("node:path");

async function treeDigest(root) {
  const hash = createHash("sha256");
  async function walk(path, name) {
    const stat = await fs.lstat(path);
    hash.update(JSON.stringify([name, stat.mode, stat.size]) + "\n");
    if (stat.isSymbolicLink()) hash.update(await fs.readlink(path));
    else if (stat.isDirectory()) {
      for (const child of (await fs.readdir(path)).sort())
        await walk(join(path, child), `${name}/${child}`);
    } else if (stat.isFile()) {
      for await (const data of createReadStream(path)) hash.update(data);
    } else throw new Error("Unexpected file in staged update.");
    hash.update("\n");
  }
  await walk(root, "");
  return hash.digest("hex");
}

async function validate(plan) {
  if (
    !Number.isInteger(plan.parentPid) ||
    plan.parentPid <= 1 ||
    !plan.target.endsWith(".app") ||
    dirname(plan.root) !== dirname(plan.target) ||
    !plan.root.startsWith(join(dirname(plan.target), ".grimoire-update-")) ||
    plan.candidate !== join(plan.root, "payload/Grimoire.app") ||
    plan.backup !== join(plan.root, "previous.app")
  )
    throw new Error("Invalid update plan.");
  const original = await fs.lstat(plan.target);
  if (
    !original.isDirectory() ||
    original.dev !== plan.device ||
    original.ino !== plan.inode
  )
    throw new Error(
      "Installed application was replaced while the update was pending.",
    );
  if (
    (await fs.realpath(plan.root)) !== plan.root ||
    (await treeDigest(plan.candidate)) !== plan.digest
  )
    throw new Error("Staged update changed after validation.");
}

async function replaceBundle(plan, rename = fs.rename) {
  await validate(plan);
  await rename(plan.target, plan.backup);
  try {
    await rename(plan.candidate, plan.target);
  } catch (error) {
    // Never delete the backup if either replacement or rollback fails.
    await rename(plan.backup, plan.target);
    throw error;
  }
}

async function run(plan) {
  await validate(plan);
  process.stdout.write("READY\n");
  const deadline = Date.now() + 5 * 60 * 1000;
  while (true) {
    try {
      process.kill(plan.parentPid, 0);
    } catch (error) {
      if (error.code === "ESRCH") break;
      throw error;
    }
    if (Date.now() > deadline)
      throw new Error("Application did not exit; update was not installed.");
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  await replaceBundle(plan);
  await writeResult(plan.resultFile, {
    status: "installed",
    version: plan.version,
    root: plan.root,
    target: plan.target,
  });
}

if (require.main === module) {
  let plan;
  fs.readFile(process.argv[2], "utf8")
    .then((data) => {
      plan = JSON.parse(data);
      return run(plan);
    })
    .catch(async (error) => {
      if (plan?.resultFile)
        await writeResult(plan.resultFile, {
          status: "failed",
          error: error.message,
          version: plan.version,
          root: plan.root,
        }).catch(() => {});
      process.exitCode = 1;
    });
}
async function writeResult(file, result) {
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temp, JSON.stringify(result), {
      mode: 0o600,
      flag: "wx",
    });
    await fs.rename(temp, file);
  } finally {
    await fs.rm(temp, { force: true });
  }
}
module.exports = { treeDigest, replaceBundle, validate, writeResult };
