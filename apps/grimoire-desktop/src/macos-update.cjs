const fs = require("node:fs/promises");
const { createReadStream } = require("node:fs");
const { createHash } = require("node:crypto");
const { join, dirname, resolve, relative, isAbsolute } = require("node:path");
const { promisify } = require("node:util");
const { execFile, spawn } = require("node:child_process");
const yauzl = require("yauzl");
const { treeDigest, writeResult } = require("./macos-update-helper.cjs");
const execute = promisify(execFile);

function inside(root, path) {
  const part = relative(root, path);
  return (
    part === "" ||
    (!isAbsolute(part) && part !== ".." && !part.startsWith("../"))
  );
}

async function verifyArchive(file, sha512) {
  if (typeof sha512 !== "string" || !/^[A-Za-z0-9+/]{86}==$/.test(sha512))
    throw new Error("Missing update SHA-512 checksum.");
  const hash = createHash("sha512");
  for await (const data of createReadStream(file)) hash.update(data);
  if (hash.digest("base64") !== sha512)
    throw new Error("Update checksum mismatch.");
  // Preflight every entry before ditto can follow an archive-created symlink.
  await new Promise((resolvePromise, reject) => {
    yauzl.open(
      file,
      { lazyEntries: true, strictFileNames: true },
      (error, zip) => {
        if (error) return reject(error);
        const names = new Set();
        const links = new Set();
        let bytes = 0;
        const fail = (error) => {
          zip.close();
          reject(error);
        };
        zip.on("error", fail);
        zip.on("entry", (entry) => {
          const name = entry.fileName.replace(/\/$/, "");
          const type = (entry.externalFileAttributes >>> 16) & 0o170000;
          bytes += entry.uncompressedSize;
          if (
            names.has(name.normalize("NFD").toLowerCase()) ||
            names.size >= 100000 ||
            bytes > 4 * 1024 ** 3 ||
            entry.uncompressedSize > 1024 ** 3 ||
            entry.generalPurposeBitFlag & 1 ||
            name.includes("\0") ||
            name
              .split("/")
              .some((part) => !part || part === "." || part === "..") ||
            !(
              name === "Grimoire.app" ||
              name.startsWith("Grimoire.app/") ||
              name === "__MACOSX" ||
              name.startsWith("__MACOSX/")
            ) ||
            ![0, 0o100000, 0o040000, 0o120000].includes(type)
          )
            return fail(
              new Error(
                `Unsafe update archive entry: ${JSON.stringify(name)}.`,
              ),
            );
          names.add(name.normalize("NFD").toLowerCase());
          if (type === 0o120000) links.add(name.normalize("NFD").toLowerCase());
          zip.readEntry();
        });
        zip.on("end", () => {
          for (const name of names) {
            const parts = name.split("/");
            parts.pop();
            while (parts.length) {
              if (links.has(parts.join("/")))
                return fail(
                  new Error("Update archive writes through a symlink."),
                );
              parts.pop();
            }
          }
          resolvePromise();
        });
        zip.readEntry();
      },
    );
  });
}

async function validateLinks(root, path = root) {
  if (path === root && !(await fs.lstat(root)).isDirectory())
    throw new Error("Invalid bundle root.");
  for (const entry of await fs.readdir(path, { withFileTypes: true })) {
    const file = join(path, entry.name);
    if (entry.isSymbolicLink()) {
      const link = await fs.readlink(file);
      if (
        isAbsolute(link) ||
        !inside(root, resolve(dirname(file), link)) ||
        !inside(root, await fs.realpath(file))
      )
        throw new Error("Update contains an external symlink.");
    } else if (entry.isDirectory()) await validateLinks(root, file);
    else if (!entry.isFile())
      throw new Error("Update contains a special file.");
  }
}

async function bundleInfo(bundle) {
  const { stdout } = await execute("/usr/bin/plutil", [
    "-convert",
    "json",
    "-o",
    "-",
    join(bundle, "Contents/Info.plist"),
  ]);
  return JSON.parse(stdout);
}

function createLocalMacInstaller({
  app,
  log = () => {},
  dataDir = app.getPath("userData"),
}) {
  let pending;
  let armed = false;
  const target = resolve(app.getAppPath(), "../../..");
  const resultFile = join(dataDir, "updates", "result.json");

  async function prepare(file, version, sha512) {
    await fs.mkdir(dirname(resultFile), { recursive: true, mode: 0o700 });
    if (pending) {
      await fs.rm(pending.root, { recursive: true, force: true });
      pending = undefined;
    }
    if (
      !target.endsWith(".app") ||
      target.startsWith("/Volumes/") ||
      target.includes("/AppTranslocation/") ||
      (await fs.realpath(target)) !== target
    )
      throw new Error(
        "Install Grimoire in a writable Applications folder before updating.",
      );
    await fs.access(dirname(target), fs.constants.W_OK);
    const original = await fs.stat(target);
    const current = await bundleInfo(target);
    if (
      current.CFBundleIdentifier !== "io.grimoire.desktop" ||
      current.CFBundleShortVersionString !== app.getVersion()
    )
      throw new Error("The installed application changed while running.");
    const root = await fs.mkdtemp(join(dirname(target), ".grimoire-update-"));
    await fs.chmod(root, 0o700);
    try {
      // Copy first, then verify the exact private archive that will be extracted.
      const archive = join(root, "update.zip");
      await fs.copyFile(file, archive, fs.constants.COPYFILE_EXCL);
      await verifyArchive(archive, sha512);
      const extracted = join(root, "payload");
      await fs.mkdir(extracted, { mode: 0o700 });
      await execute("/usr/bin/ditto", ["-x", "-k", archive, extracted], {
        timeout: 120000,
      });
      const candidate = join(extracted, "Grimoire.app");
      await validateLinks(candidate);
      const info = await bundleInfo(candidate);
      if (
        info.CFBundleIdentifier !== current.CFBundleIdentifier ||
        info.CFBundleShortVersionString !== version ||
        info.CFBundleExecutable !== "Grimoire"
      )
        throw new Error("Update bundle identity or version mismatch.");
      const executable = join(candidate, "Contents/MacOS/Grimoire");
      await fs.access(executable, fs.constants.X_OK);
      const { stdout } = await execute("/usr/bin/lipo", ["-archs", executable]);
      if (!stdout.trim().split(/\s+/).includes("arm64"))
        throw new Error("Update does not support Apple Silicon.");
      const manifest = {
        root,
        target,
        candidate,
        backup: join(root, "previous.app"),
        version,
        resultFile,
        parentPid: process.pid,
        device: original.dev,
        inode: original.ino,
        digest: await treeDigest(candidate),
      };
      await fs.copyFile(
        join(__dirname, "macos-update-helper.cjs"),
        join(root, "helper.cjs"),
      );
      await fs.writeFile(join(root, "update.json"), JSON.stringify(manifest), {
        mode: 0o600,
      });
      await fs.rm(archive);
      await fs.rm(resultFile, { force: true });
      pending = manifest;
    } catch (error) {
      await fs.rm(root, { recursive: true, force: true });
      throw error;
    }
  }

  async function installOnQuit() {
    if (!pending || armed) return;
    const child = await new Promise((resolvePromise, reject) => {
      const child = spawn(
        process.execPath,
        [join(pending.root, "helper.cjs"), join(pending.root, "update.json")],
        {
          detached: true,
          cwd: pending.root,
          env: { ELECTRON_RUN_AS_NODE: "1", PATH: "/usr/bin:/bin" },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        child.stdout.destroy();
        child.stderr.destroy();
        if (error) {
          child.kill();
          reject(error);
        } else {
          armed = true;
          child.unref();
          resolvePromise(child);
        }
      };
      const timeout = setTimeout(
        () => finish(new Error("Update helper did not become ready.")),
        30000,
      );
      child.once("error", finish);
      child.once("exit", () =>
        finish(new Error("Update helper exited before becoming ready.")),
      );
      let output = "";
      child.stdout.on("data", (data) => {
        output += data;
        if (output.includes("READY\n")) finish();
      });
    });
    try {
      await writeResult(resultFile, {
        status: "installing",
        version: pending.version,
        helperPid: child.pid,
        target,
        root: pending.root,
      });
    } catch (error) {
      child.kill();
      armed = false;
      throw error;
    }
  }

  async function recover() {
    try {
      const result = JSON.parse(await fs.readFile(resultFile, "utf8"));
      if (result.status === "failed") {
        log(`Local update failed: ${result.error}`);
        return result;
      }
      // Keep the old bundle until the replacement has actually started.
      if (
        result.version === app.getVersion() &&
        result.target === target &&
        dirname(result.root) === dirname(target) &&
        result.root.startsWith(join(dirname(target), ".grimoire-update-"))
      ) {
        await fs.rm(result.root, { recursive: true, force: true });
        await fs.rm(resultFile, { force: true });
      }
    } catch (error) {
      if (error.code !== "ENOENT") log(`Update recovery: ${error.message}`);
    }
    return true;
  }
  return { prepare, installOnQuit, recover };
}
async function waitForLocalUpdate(
  dataDir,
  target,
  {
    timeout = 60000,
    isAlive = (pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch (error) {
        return error.code !== "ESRCH";
      }
    },
  } = {},
) {
  const file = join(dataDir, "updates", "result.json");
  let result;
  try {
    result = JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
  if (result.status !== "installing" || result.target !== target) return false;
  const deadline = Date.now() + timeout;
  while (result.status === "installing") {
    if (
      !Number.isInteger(result.helperPid) ||
      result.helperPid <= 1 ||
      !isAlive(result.helperPid)
    ) {
      // The helper may have published its result between our read and PID check.
      const latest = JSON.parse(await fs.readFile(file, "utf8"));
      if (latest.status !== "installing") return latest.status === "installed";
      await writeResult(file, {
        ...result,
        status: "failed",
        error: "The update helper stopped before confirming installation.",
      });
      return false;
    }
    if (Date.now() >= deadline)
      throw new Error(
        "An application update is still running. Please wait before reopening Grimoire.",
      );
    await new Promise((resolve) => setTimeout(resolve, 100));
    result = JSON.parse(await fs.readFile(file, "utf8"));
  }
  return result.status === "installed";
}
module.exports = {
  waitForLocalUpdate,
  createLocalMacInstaller,
  verifyArchive,
  validateLinks,
  bundleInfo,
};
